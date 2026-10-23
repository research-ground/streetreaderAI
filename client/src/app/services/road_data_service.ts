/*
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { Injectable } from '@angular/core';
import { LruCache, queryAudit, roadCache, singleflight } from './client_cache';

export interface OsmGeomPoint {
  lat: number;
  lon: number;
}

export interface OsmWayElement {
  type?: string;
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
  geometry: OsmGeomPoint[];
}

export interface OsmPoiItem {
  lat: number;
  lng: number;
  name: string;
  vicinity: string;
  types: string[];
}

export interface TilePoiEntry {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  pois: OsmPoiItem[];
}

export interface RoadDataSource {
  getWays(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<OsmWayElement[] | null>;
}

export const NAVIGABLE_HIGHWAYS =
  'residential|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|' +
  'unclassified|living_street|pedestrian';
export const NAVIGABLE_HIGHWAY_SET = new Set(NAVIGABLE_HIGHWAYS.split('|'));
export const OSM_MAP_API_URL = 'https://api.openstreetmap.org/api/0.6/map.json';
export const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const POI_TAG_KEYS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'office',
  'craft',
  'healthcare',
  'historic',
] as const;

export const osmPoiTileCache = new LruCache<TilePoiEntry>(64);

function bboxCacheKey(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number
): string {
  return `${minLat.toFixed(5)},${minLng.toFixed(5)},${maxLat.toFixed(5)},${maxLng.toFixed(5)}`;
}

/**
 * Extracts named POIs (`node` and building/area `way` elements) from an
 * OpenStreetMap `/api/0.6/map.json` elements array.
 */
export function extractPoisFromOsmElements(
  elements: Record<string, unknown>[],
  nodesMap?: Map<number, [number, number]>
): OsmPoiItem[] {
  const nodes = nodesMap ?? new Map<number, [number, number]>();
  if (!nodesMap) {
    for (const el of elements) {
      if (
        el['type'] === 'node' &&
        typeof el['id'] === 'number' &&
        typeof el['lat'] === 'number' &&
        typeof el['lon'] === 'number'
      ) {
        nodes.set(el['id'], [el['lat'], el['lon']]);
      }
    }
  }

  const pois: OsmPoiItem[] = [];
  const seenNames = new Set<string>();

  for (const el of elements) {
    const tags = (el['tags'] as Record<string, string>) || {};
    const name = tags['name']?.trim();
    if (!name || tags['highway']) continue;

    let category = '';
    for (const k of POI_TAG_KEYS) {
      if (tags[k]) {
        category = tags[k].replace(/_/g, ' ');
        break;
      }
    }
    if (!category) continue;

    let lat: number | undefined;
    let lng: number | undefined;
    if (
      el['type'] === 'node' &&
      typeof el['lat'] === 'number' &&
      typeof el['lon'] === 'number'
    ) {
      lat = el['lat'];
      lng = el['lon'];
    } else if (el['type'] === 'way' && Array.isArray(el['nodes'])) {
      const pts = (el['nodes'] as number[])
        .map((nid) => nodes.get(nid))
        .filter((p): p is [number, number] => Boolean(p));
      if (pts.length > 0) {
        lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      }
    }

    if (lat === undefined || lng === undefined) continue;
    const dedupKey = `${name.toLowerCase()}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    if (seenNames.has(dedupKey)) continue;
    seenNames.add(dedupKey);

    pois.push({
      lat,
      lng,
      name,
      vicinity: category,
      types: [category],
    });
  }
  return pois;
}

/**
 * Fast small-bbox road source backed by the official OpenStreetMap v0.6
 * `/api/0.6/map.json` endpoint (Fastly CDN, CORS `*`).
 */
export class OsmMapApiRoadSource implements RoadDataSource {
  constructor(private readonly endpoint: string = OSM_MAP_API_URL) {}

  async getWays(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<OsmWayElement[] | null> {
    const key = bboxCacheKey(minLat, minLng, maxLat, maxLng);
    const cached = roadCache.get(key) as OsmWayElement[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('overpass');
      return cached;
    }

    const bboxParam = `${minLng},${minLat},${maxLng},${maxLat}`;
    queryAudit.recordExternal('overpass', `osm06:${key}`);
    try {
      const url = new URL(this.endpoint);
      url.searchParams.set('bbox', bboxParam);
      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return null;
      const payload = await resp.json();
      const elements: Record<string, unknown>[] = Array.isArray(payload?.elements)
        ? payload.elements
        : [];

      const nodes = new Map<number, [number, number]>();
      for (const el of elements) {
        if (
          el['type'] === 'node' &&
          typeof el['id'] === 'number' &&
          typeof el['lat'] === 'number' &&
          typeof el['lon'] === 'number'
        ) {
          nodes.set(el['id'], [el['lat'], el['lon']]);
        }
      }

      // Also extract and cache all POIs in this tile so nearby POI queries are instant!
      const pois = extractPoisFromOsmElements(elements, nodes);
      osmPoiTileCache.put(key, {
        minLat,
        minLng,
        maxLat,
        maxLng,
        pois,
      });

      const ways: OsmWayElement[] = [];
      for (const el of elements) {
        if (el['type'] !== 'way' || typeof el['id'] !== 'number') continue;
        const tags = (el['tags'] as Record<string, string>) || {};
        const hw = tags['highway'];
        if (!hw || !NAVIGABLE_HIGHWAY_SET.has(hw)) continue;
        const rawNodes = Array.isArray(el['nodes']) ? (el['nodes'] as number[]) : [];
        const nodeIds = rawNodes.filter((nid) => nodes.has(nid));
        if (nodeIds.length < 2) continue;

        ways.push({
          type: 'way',
          id: el['id'],
          nodes: nodeIds,
          tags,
          geometry: nodeIds.map((nid) => {
            const pt = nodes.get(nid)!;
            return { lat: pt[0], lon: pt[1] };
          }),
        });
      }

      roadCache.put(key, ways);
      return ways;
    } catch {
      return null;
    }
  }
}

/**
 * Fallback Overpass API road source with automatic mirror rotation.
 */
export class OverpassRoadSource implements RoadDataSource {
  private activeIdx = 0;

  constructor(
    private readonly endpoints: string[] = [...DEFAULT_OVERPASS_ENDPOINTS],
    private readonly timeoutS: number = 25
  ) {}

  async getWays(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<OsmWayElement[]> {
    const key = bboxCacheKey(minLat, minLng, maxLat, maxLng);
    const cached = roadCache.get(key) as OsmWayElement[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('overpass');
      return cached;
    }

    const bboxStr = `${minLat},${minLng},${maxLat},${maxLng}`;
    queryAudit.recordExternal('overpass', key);
    const query = `[out:json][timeout:${Math.round(this.timeoutS)}];way(${bboxStr})["highway"~"^(${NAVIGABLE_HIGHWAYS})$"];out body geom qt;`;

    for (let attempt = 0; attempt < this.endpoints.length; attempt++) {
      const endpoint = this.endpoints[this.activeIdx % this.endpoints.length];
      try {
        const body = new URLSearchParams({ data: query });
        const resp = await fetch(endpoint, {
          method: 'POST',
          body,
        });
        if (!resp.ok) {
          this.activeIdx = (this.activeIdx + 1) % this.endpoints.length;
          continue;
        }
        const data = await resp.json();
        const elements: OsmWayElement[] = Array.isArray(data?.elements)
          ? data.elements
          : [];
        roadCache.put(key, elements);
        return elements;
      } catch {
        this.activeIdx = (this.activeIdx + 1) % this.endpoints.length;
      }
    }
    throw new Error('All Overpass road network endpoints failed.');
  }
}

@Injectable({
  providedIn: 'root',
})
export class RoadDataService {
  private readonly sources: RoadDataSource[] = [
    new OsmMapApiRoadSource(),
    new OverpassRoadSource(),
  ];

  async fetchWaysForTile(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<OsmWayElement[]> {
    const key = bboxCacheKey(minLat, minLng, maxLat, maxLng);
    const cached = roadCache.get(key) as OsmWayElement[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('road');
      return cached;
    }

    return singleflight(`road_tile:${key}`, async () => {
      const again = roadCache.get(key) as OsmWayElement[] | undefined;
      if (again) {
        queryAudit.recordCacheHit('road');
        return again;
      }
      for (const src of this.sources) {
        try {
          const ways = await src.getWays(minLat, minLng, maxLat, maxLng);
          if (ways && ways.length > 0) {
            roadCache.put(key, ways);
            return ways;
          }
        } catch {
          // Try next road data source
        }
      }
      return [];
    });
  }
}
