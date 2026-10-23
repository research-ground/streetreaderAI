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

import { Injectable, inject } from '@angular/core';
import {
  AutocompleteItem,
  AutocompleteResponse,
  GetNearbyPlacesResponse,
  NearbyPlace,
  RelativePosition,
} from './api_service';
import { metadataCache, queryAudit } from './client_cache';
import {
  ConfigService,
  getFieldByPath,
  interpolateUrlTemplate,
  LocationPluginConfig,
} from './config_service';
import {
  DEFAULT_OVERPASS_ENDPOINTS,
  extractPoisFromOsmElements,
  OSM_MAP_API_URL,
  OsmPoiItem,
  osmPoiTileCache,
} from './road_data_service';

export interface GeocodeResult {
  lat: number;
  lng: number;
  address: string;
  street?: string | null;
}

export const M_PER_DEG_LAT = 111139.0;

export function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = Math.PI / 180;
  const dLon = (lng2 - lng1) * toRad;
  const rLat1 = lat1 * toRad;
  const rLat2 = lat2 * toRad;
  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  const dx =
    (lng2 - lng1) * M_PER_DEG_LAT * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

export function getRelativePosition(
  camLat: number,
  camLng: number,
  camHeading: number,
  poiLat: number,
  poiLng: number
): RelativePosition {
  const poiBearing = calculateBearing(camLat, camLng, poiLat, poiLng);
  const diff = ((((poiBearing - camHeading + 180) % 360) + 360) % 360) - 180;
  return {
    side: diff > 0 ? 'RIGHT' : 'LEFT',
    depth: Math.abs(diff) < 90 ? 'FRONT' : 'BEHIND',
  };
}

@Injectable({
  providedIn: 'root',
})
export class LocationProviderService {
  private readonly config = inject(ConfigService);

  private getActivePlugin(): LocationPluginConfig {
    const plugin = this.config.getLocationPlugin();
    if (!plugin) {
      throw new Error(
        `Location provider "${this.config.locationService()}" is not defined in streetreaderai.conf.`
      );
    }
    return plugin;
  }

  private ensurePluginKey(plugin: LocationPluginConfig): string {
    if (!plugin.requiresKey) return '';
    const key = this.config.getKeyByName(plugin.requiresKey);
    if (!key) {
      throw new Error(
        `Missing required key "${plugin.requiresKey}" for location provider "${plugin.name}". Set it in streetreaderai.conf or streetreaderai.local.conf.`
      );
    }
    return key;
  }

  private extractItems(
    payload: unknown,
    itemsPath: string
  ): Record<string, unknown>[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) {
      return payload as Record<string, unknown>[];
    }
    if (!itemsPath) {
      return [payload as Record<string, unknown>];
    }
    const extracted = getFieldByPath(payload, [itemsPath]);
    if (Array.isArray(extracted)) {
      return extracted as Record<string, unknown>[];
    }
    if (extracted && typeof extracted === 'object') {
      return [extracted as Record<string, unknown>];
    }
    return [];
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const plugin = this.getActivePlugin();
    if (!plugin.geocodeUrl) return null;

    const norm = address.trim().toLowerCase();
    const cacheKey = `${plugin.name}:fwd:${norm}`;
    const cached = metadataCache.get(cacheKey) as GeocodeResult | undefined;
    if (cached) {
      queryAudit.recordCacheHit(`${plugin.name}_geocode`);
      return cached;
    }

    const apiKey = this.ensurePluginKey(plugin);
    const url = interpolateUrlTemplate(plugin.geocodeUrl, {
      address,
      apiKey,
    });

    try {
      queryAudit.recordExternal(`${plugin.name}_fwd`, norm);
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (resp.status === 429) {
        throw new Error(
          'Geocoding rate limit exceeded. Please wait a few moments before trying again.'
        );
      }
      if (!resp.ok) return null;
      const data = await resp.json();

      if (plugin.statusField && plugin.statusOkValue) {
        const statusVal = getFieldByPath(data, [plugin.statusField]);
        if (String(statusVal || '') !== plugin.statusOkValue) {
          return null;
        }
      }

      const items = this.extractItems(data, plugin.itemsPath);
      if (items.length === 0) return null;
      const first = items[0];

      const rawLat = getFieldByPath(first, plugin.latField);
      const rawLng = getFieldByPath(first, plugin.lngField);
      if (rawLat === undefined || rawLng === undefined) return null;

      let street =
        plugin.streetField.length > 0
          ? (getFieldByPath(first, plugin.streetField) as string | undefined) ??
            null
          : null;
      if (!street && Array.isArray(first['address_components'])) {
        for (const comp of first['address_components'] as Array<
          Record<string, unknown>
        >) {
          const types = comp['types'];
          if (Array.isArray(types) && types.includes('route')) {
            street = String(comp['long_name'] || '') || null;
            break;
          }
        }
      }

      const rawAddr = getFieldByPath(first, plugin.addressField);
      const res: GeocodeResult = {
        lat: Number(rawLat),
        lng: Number(rawLng),
        address: String(rawAddr || address),
        street,
      };
      metadataCache.put(cacheKey, res);
      return res;
    } catch (e) {
      if (e instanceof Error && e.message.includes('rate limit')) {
        throw e;
      }
    }
    return null;
  }

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const plugin = this.getActivePlugin();
    if (!plugin.reverseGeocodeUrl) return null;

    const cacheKey = `${plugin.name}:rev:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const cached = metadataCache.get(cacheKey) as
      | { formatted_address?: string }
      | undefined;
    if (cached?.formatted_address) {
      queryAudit.recordCacheHit(`${plugin.name}_rev_geocode`);
      return cached.formatted_address;
    }

    const apiKey = this.ensurePluginKey(plugin);
    const url = interpolateUrlTemplate(plugin.reverseGeocodeUrl, {
      lat,
      lng,
      apiKey,
    });

    try {
      queryAudit.recordExternal(
        `${plugin.name}_rev`,
        `${lat.toFixed(5)},${lng.toFixed(5)}`
      );
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return null;
      const data = await resp.json();

      if (plugin.statusField && plugin.statusOkValue) {
        const statusVal = getFieldByPath(data, [plugin.statusField]);
        if (String(statusVal || '') !== plugin.statusOkValue) {
          return null;
        }
      }

      const items = this.extractItems(data, plugin.itemsPath);
      if (items.length === 0) return null;
      const rawAddr = getFieldByPath(items[0], plugin.addressField);
      if (rawAddr) {
        const formatted = String(rawAddr);
        metadataCache.put(cacheKey, { formatted_address: formatted });
        return formatted;
      }
    } catch {
      // Ignore reverse geocode errors
    }
    return null;
  }

  async autocomplete(
    query: string,
    sessionToken?: string
  ): Promise<AutocompleteResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { suggestions: [] };
    }
    const plugin = this.getActivePlugin();
    const suggestions = await this.pluginAutocomplete(
      plugin,
      trimmed,
      sessionToken
    );
    return { suggestions };
  }

  private async pluginAutocomplete(
    plugin: LocationPluginConfig,
    query: string,
    sessionToken?: string
  ): Promise<AutocompleteItem[]> {
    const norm = query.trim().toLowerCase();
    if (norm.length < 3) return [];
    if (!plugin.autocompleteUrl) return [];

    // POST-based Places v1 autocomplete endpoint
    if (plugin.autocompleteUrl.includes(':autocomplete')) {
      const apiKey = this.ensurePluginKey(plugin);
      queryAudit.recordExternal(`${plugin.name}_auto`, norm);
      try {
        const body: Record<string, unknown> = { input: query };
        if (sessionToken) {
          body['sessionToken'] = sessionToken;
        }
        const resp = await fetch(plugin.autocompleteUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
          },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          const data = await resp.json();
          const suggestions = Array.isArray(data?.suggestions)
            ? data.suggestions
            : [];
          return suggestions
            .map((s: Record<string, unknown>) => {
              const pred = s['placePrediction'] as
                | Record<string, unknown>
                | undefined;
              const textObj = pred?.['text'] as { text?: string } | undefined;
              return {
                description: String(textObj?.text || ''),
                placeId: String(pred?.['placeId'] || ''),
              };
            })
            .filter((item: AutocompleteItem) => Boolean(item.description));
        }
      } catch {
        // Fall through to geocode fallback
      }
      try {
        const geo = await this.geocode(query);
        if (geo) {
          return [{ description: geo.address, placeId: geo.address }];
        }
      } catch {
        // Ignore fallback error
      }
      return [];
    }

    const cacheKey = `${plugin.name}:auto:${norm}`;
    const cached = metadataCache.get(cacheKey) as AutocompleteItem[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit(`${plugin.name}_auto`);
      return cached;
    }

    const apiKey = this.ensurePluginKey(plugin);
    const url = interpolateUrlTemplate(plugin.autocompleteUrl, {
      query,
      apiKey,
    });
    try {
      queryAudit.recordExternal(`${plugin.name}_auto`, norm);
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      const items = this.extractItems(data, plugin.itemsPath);
      const results = items
        .map((p) => ({
          description: String(getFieldByPath(p, plugin.addressField) ?? ''),
          placeId: String(getFieldByPath(p, plugin.placeIdField) ?? ''),
        }))
        .filter((item) => Boolean(item.description));
      metadataCache.put(cacheKey, results);
      return results;
    } catch {
      return [];
    }
  }

  async getNearbyPlaces(params: {
    lat: number;
    lng: number;
    radius?: number;
    heading?: number;
  }): Promise<GetNearbyPlacesResponse> {
    const radius = params.radius ?? 100;
    const heading = params.heading ?? 0;
    const plugin = this.getActivePlugin();
    const rawPlaces = plugin.nearbyUrl
      ? await this.pluginNearbySearch(plugin, params.lat, params.lng, radius)
      : await this.osmNearbySearch(params.lat, params.lng, radius);

    const places: NearbyPlace[] = [];
    for (const p of rawPlaces) {
      const rel = getRelativePosition(
        params.lat,
        params.lng,
        heading,
        p.lat,
        p.lng
      );
      places.push({
        name: p.name,
        vicinity: p.vicinity,
        location: { latitude: p.lat, longitude: p.lng },
        types: p.types,
        relativePosition: rel,
      });
    }
    return { places };
  }

  private async osmNearbySearch(
    lat: number,
    lng: number,
    radius: number
  ): Promise<OsmPoiItem[]> {
    const cacheKey = `osm:nearby:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
    const cached = metadataCache.get(cacheKey) as OsmPoiItem[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('osm_nearby');
      return cached;
    }

    const dLat = radius / M_PER_DEG_LAT;
    const dLng =
      radius / (M_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180.0), 0.1));

    // 1. Check if an already-loaded OSM v0.6 road tile covers this radius
    for (const tile of osmPoiTileCache.values()) {
      if (
        lat - dLat >= tile.minLat &&
        lat + dLat <= tile.maxLat &&
        lng - dLng >= tile.minLng &&
        lng + dLng <= tile.maxLng
      ) {
        queryAudit.recordCacheHit('osm_nearby');
        const nearby = tile.pois
          .map((p) => ({
            poi: p,
            dist: calculateDistance(lat, lng, p.lat, p.lng),
          }))
          .filter((item) => item.dist <= radius)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 20)
          .map((item) => item.poi);
        metadataCache.put(cacheKey, nearby);
        return nearby;
      }
    }

    // 2. Fetch directly from the official OpenStreetMap v0.6 /api/0.6/map.json endpoint
    const minLat = lat - dLat * 1.25;
    const maxLat = lat + dLat * 1.25;
    const minLng = lng - dLng * 1.25;
    const maxLng = lng + dLng * 1.25;
    try {
      const url = new URL(OSM_MAP_API_URL);
      url.searchParams.set('bbox', `${minLng},${minLat},${maxLng},${maxLat}`);
      queryAudit.recordExternal(
        'osm_nearby',
        `${lat.toFixed(4)},${lng.toFixed(4)}:${radius}`
      );
      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (resp.ok) {
        const payload = await resp.json();
        const elements: Record<string, unknown>[] = Array.isArray(
          payload?.elements
        )
          ? payload.elements
          : [];
        const allPois = extractPoisFromOsmElements(elements);
        const nearby = allPois
          .map((p) => ({
            poi: p,
            dist: calculateDistance(lat, lng, p.lat, p.lng),
          }))
          .filter((item) => item.dist <= radius)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 20)
          .map((item) => item.poi);
        metadataCache.put(cacheKey, nearby);
        return nearby;
      }
    } catch {
      // Fall back to Overpass mirrors below
    }

    // 3. Fallback to Overpass API mirrors
    const query = `[out:json][timeout:12];node(around:${radius},${lat},${lng})["name"];out 20;`;
    for (const endpoint of DEFAULT_OVERPASS_ENDPOINTS) {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        const results = extractPoisFromOsmElements(elements)
          .map((p) => ({
            poi: p,
            dist: calculateDistance(lat, lng, p.lat, p.lng),
          }))
          .filter((item) => item.dist <= radius)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 20)
          .map((item) => item.poi);
        metadataCache.put(cacheKey, results);
        return results;
      } catch {
        // Try next Overpass mirror
      }
    }
    return [];
  }

  private async pluginNearbySearch(
    plugin: LocationPluginConfig,
    lat: number,
    lng: number,
    radius: number
  ): Promise<
    Array<{
      lat: number;
      lng: number;
      name: string;
      vicinity: string;
      types: string[];
    }>
  > {
    const apiKey = this.ensurePluginKey(plugin);
    const cacheKey = `${plugin.name}:nearby:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
    const cached = metadataCache.get(cacheKey) as
      | Array<{
          lat: number;
          lng: number;
          name: string;
          vicinity: string;
          types: string[];
        }>
      | undefined;
    if (cached) {
      queryAudit.recordCacheHit(`${plugin.name}_nearby`);
      return cached;
    }

    queryAudit.recordExternal(
      `${plugin.name}_nearby`,
      `${lat.toFixed(4)},${lng.toFixed(4)}:${radius}`
    );
    try {
      const resp = await fetch(plugin.nearbyUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.displayName,places.shortFormattedAddress,places.formattedAddress,places.location,places.types',
        },
        body: JSON.stringify({
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius,
            },
          },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const places = Array.isArray(data?.places) ? data.places : [];
        const results = places
          .map((p: Record<string, unknown>) => {
            const loc = p['location'] as
              | { latitude?: number; longitude?: number }
              | undefined;
            const dn = p['displayName'] as { text?: string } | undefined;
            return {
              lat: Number(loc?.latitude ?? lat),
              lng: Number(loc?.longitude ?? lng),
              name: String(dn?.text || 'Unknown Place'),
              vicinity: String(
                p['shortFormattedAddress'] || p['formattedAddress'] || ''
              ),
              types: Array.isArray(p['types']) ? (p['types'] as string[]) : [],
            };
          })
          .filter((r: { name: string }) => Boolean(r.name));
        metadataCache.put(cacheKey, results);
        return results;
      }
    } catch {
      // Fall back to OSM nearby POIs
    }
    return this.osmNearbySearch(lat, lng, radius);
  }
}
