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

/**
 * RouteProviderService — 5-Step Navigation Engine (Intersections + Direct Sequence Slices).
 *
 * 1. Identify OSM intersections (merging multi-node junctions and roundabouts)
 *    and walk between them to determine street block adjacency `(cid_a, cid_b)`.
 * 2. Discover and expand 360° camera sequences near intersections, sorting each
 *    sequence's frames chronologically by `captureTime`.
 * 3. Slice each sequence into contiguous passes `frames[idx_a .. idx_b]` that
 *    visit two adjacent intersections within `captureMaxM` (`30m`), with no
 *    intermediate intersection visit (`< 18m`), `sinuosity <= 1.35`, and `maxStep <= 30m`.
 * 4. Pick the single best sequence slice per street block and sample intermediate
 *    frames every `~stepM` (`18m`).
 * 5. Unify each intersection to one canonical node (`osm_<cid>`) and connect each
 *    block as a bidirectional chain `[osm_<cid_a>, seq_<f1>, ..., osm_<cid_b>]`.
 */

import { Injectable, inject } from '@angular/core';
import {
  DebugEdge,
  DebugNode,
  GetViewResponse,
  LatLng,
  Link,
  LocalGraphResponse,
  RenderViewResponse,
} from './api_service';
import { graphCache, queryAudit, windowCache } from './client_cache';
import {
  ImageryProviderClient,
  ImageryProviderService,
  LocationMetadata,
} from './imagery_provider_service';
import {
  calculateDistance,
  LocationProviderService,
  M_PER_DEG_LAT,
} from './location_provider_service';
import { OsmWayElement, RoadDataService } from './road_data_service';

const STREET_ABBREVS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  rd: 'road',
  dr: 'drive',
  pl: 'place',
  ln: 'lane',
  ct: 'court',
  pkwy: 'parkway',
  hwy: 'highway',
  ter: 'terrace',
  cir: 'circle',
};

export function compassBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dx =
    (lng2 - lng1) * Math.cos((((lat1 + lat2) * 0.5) * Math.PI) / 180.0);
  const dy = lat2 - lat1;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return 0.0;
  return (((Math.atan2(dx, dy) * 180.0) / Math.PI) + 360.0) % 360.0;
}

export function angDiff(a: number, b: number): number {
  return Math.abs(((((a - b + 180.0) % 360.0) + 360.0) % 360.0) - 180.0);
}

export function normStreet(name?: string | null): string {
  const raw = (name || '').trim().toLowerCase();
  if (!raw) return '';
  let tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/^[.,]+|[.,]+$/g, ''))
    .filter(Boolean);
  if (tokens.length > 1 && /^\d+$/.test(tokens[0])) {
    tokens = tokens.slice(1);
  }
  return tokens.map((t) => STREET_ABBREVS[t] || t).join(' ');
}

export interface RouteParams {
  stepM: number;
  captureMaxM: number;
  junctionMergeM: number;
  maxSinuosity: number;
  maxFrameStepM: number;
  panosOnly: boolean;
  snapshotRadiusM: number;
}

export const DEFAULT_ROUTE_PARAMS: RouteParams = {
  stepM: 18.0,
  captureMaxM: 30.0,
  junctionMergeM: 30.0,
  maxSinuosity: 1.35,
  maxFrameStepM: 30.0,
  panosOnly: true,
  snapshotRadiusM: 350.0,
};

// =====================================================================
// §1 ROAD GEOMETRY — Intersections & Block Adjacency (Step 1)
// =====================================================================

export interface Leg {
  wayId: number;
  along: number;
  direction: number;
  bearing: number;
  streetName: string;
}

export interface RoadMarker {
  osmNodeId: number;
  lat: number;
  lng: number;
  kind: 'intersection' | 'join' | 'dead_end';
  legs: Leg[];
  streetNames: string[];
}

export interface PathSlice {
  wayId: number;
  fromAlong: number;
  toAlong: number;
  direction: number;
  startDist: number;
}

export interface WalkResult {
  slices: PathSlice[];
  endMarker: RoadMarker | null;
  totalDist: number;
}

interface InternalWay {
  wayId: number;
  pts: Array<[number, number]>;
  offsets: number[];
  length: number;
  name: string;
  nodeAlongs: Array<[number, number]>;
}

function nextMarkerOnWay(
  markers: Array<[number, number]>,
  along: number,
  direction: number
): [number, number] | null {
  if (direction > 0) {
    const threshold = along + 0.1;
    for (let i = 0; i < markers.length; i++) {
      if (markers[i][0] > threshold) {
        return markers[i];
      }
    }
    return null;
  } else {
    const threshold = along - 0.1;
    for (let i = markers.length - 1; i >= 0; i--) {
      if (markers[i][0] < threshold) {
        return markers[i];
      }
    }
    return null;
  }
}

export class RoadNetwork {
  readonly p: RouteParams;
  readonly ways = new Map<number, InternalWay>();
  readonly nodeWays = new Map<number, Map<number, number[]>>();
  readonly nodeCoords = new Map<number, [number, number]>();
  readonly markers = new Map<number, RoadMarker>();
  readonly wayMarkers = new Map<number, Array<[number, number]>>();
  clusterRep = new Map<number, number>();
  clusterMembers = new Map<number, number[]>();

  constructor(params?: Partial<RouteParams>) {
    this.p = { ...DEFAULT_ROUTE_PARAMS, ...params };
  }

  addWays(overpassWays: OsmWayElement[]): number {
    const touchedNodes = new Set<number>();
    let added = 0;

    for (const way of overpassWays) {
      const wayId = way.id;
      const geom = way.geometry || [];
      const osmNodes = way.nodes || [];
      if (
        wayId === undefined ||
        wayId === null ||
        this.ways.has(wayId) ||
        geom.length < 2 ||
        osmNodes.length !== geom.length
      ) {
        continue;
      }

      const pts: Array<[number, number]> = geom.map((pt) => [pt.lat, pt.lon]);
      const offsets: number[] = [0.0];
      for (let i = 0; i < pts.length - 1; i++) {
        offsets.push(
          offsets[offsets.length - 1] +
            calculateDistance(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
        );
      }
      const name = way.tags?.['name'] || '';
      const nodeAlongs: Array<[number, number]> = offsets
        .map((off, idx): [number, number] => [off, osmNodes[idx]])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

      const w: InternalWay = {
        wayId,
        pts,
        offsets,
        length: offsets[offsets.length - 1],
        name,
        nodeAlongs,
      };
      this.ways.set(wayId, w);

      for (const [along, nid] of nodeAlongs) {
        let byWay = this.nodeWays.get(nid);
        if (!byWay) {
          byWay = new Map<number, number[]>();
          this.nodeWays.set(nid, byWay);
        }
        let alongList = byWay.get(wayId);
        if (!alongList) {
          alongList = [];
          byWay.set(wayId, alongList);
        }
        alongList.push(along);
      }

      for (let i = 0; i < osmNodes.length; i++) {
        this.nodeCoords.set(osmNodes[i], pts[i]);
        touchedNodes.add(osmNodes[i]);
      }
      added++;
    }

    for (const nid of touchedNodes) {
      this.rebuildMarker(nid);
    }
    for (const [wayId, w] of this.ways.entries()) {
      this.wayMarkers.set(
        wayId,
        w.nodeAlongs
          .filter(([, nid]) => this.markers.has(nid))
          .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      );
    }
    this.rebuildClusters();
    return added;
  }

  private shouldMergeMarkers(a: RoadMarker, b: RoadMarker): boolean {
    const d = calculateDistance(a.lat, a.lng, b.lat, b.lng);
    if (d > this.p.junctionMergeM) return false;
    if (d <= 6.0) return true;

    const waysA = this.nodeWays.get(a.osmNodeId);
    const waysB = this.nodeWays.get(b.osmNodeId);
    if (d <= 20.0 && waysA && waysB) {
      for (const wid of waysA.keys()) {
        if (!waysB.has(wid)) continue;
        const w = this.ways.get(wid);
        if (w && w.length <= 65.0) {
          const isClosed =
            w.pts[0][0] === w.pts[w.pts.length - 1][0] &&
            w.pts[0][1] === w.pts[w.pts.length - 1][1];
          if (!w.name || isClosed) {
            return true;
          }
        }
      }
    }

    const sa = new Set(a.streetNames.filter(Boolean));
    const sb = new Set(b.streetNames.filter(Boolean));
    if (sa.size >= 2 && sa.size === sb.size && [...sa].every((s) => sb.has(s))) {
      for (const sname of sa) {
        const wa = new Set(
          a.legs.filter((l) => l.streetName === sname).map((l) => l.wayId)
        );
        const wb = new Set(
          b.legs.filter((l) => l.streetName === sname).map((l) => l.wayId)
        );
        const hasOverlap = [...wa].some((wid) => wb.has(wid));
        if (wa.size >= 1 && wb.size >= 1 && !hasOverlap) {
          return true;
        }
      }
    }
    return false;
  }

  private rebuildClusters(): void {
    const decision = [...this.markers.values()].filter(
      (m) => m.kind === 'intersection'
    );
    const parent = new Map<number, number>();
    const membersByRoot = new Map<number, RoadMarker[]>();
    for (const m of decision) {
      parent.set(m.osmNodeId, m.osmNodeId);
      membersByRoot.set(m.osmNodeId, [m]);
    }

    const find = (x: number): number => {
      let cur = x;
      while (parent.get(cur)! !== cur) {
        const p = parent.get(cur)!;
        const gp = parent.get(p)!;
        parent.set(cur, gp);
        cur = gp;
      }
      return cur;
    };

    const pairs: Array<[number, RoadMarker, RoadMarker]> = [];
    for (let i = 0; i < decision.length; i++) {
      for (let j = i + 1; j < decision.length; j++) {
        const a = decision[i];
        const b = decision[j];
        if (this.shouldMergeMarkers(a, b)) {
          pairs.push([calculateDistance(a.lat, a.lng, b.lat, b.lng), a, b]);
        }
      }
    }
    pairs.sort(
      (x, y) =>
        x[0] - y[0] ||
        x[1].osmNodeId - y[1].osmNodeId ||
        x[2].osmNodeId - y[2].osmNodeId
    );

    for (const [, a, b] of pairs) {
      const ra = find(a.osmNodeId);
      const rb = find(b.osmNodeId);
      if (ra === rb) continue;
      const combined = [
        ...(membersByRoot.get(ra) || []),
        ...(membersByRoot.get(rb) || []),
      ];
      let maxPairDist = 0;
      for (const x of combined) {
        for (const y of combined) {
          const dist = calculateDistance(x.lat, x.lng, y.lat, y.lng);
          if (dist > maxPairDist) maxPairDist = dist;
        }
      }
      if (maxPairDist <= this.p.junctionMergeM) {
        const lo = Math.min(ra, rb);
        const hi = Math.max(ra, rb);
        parent.set(hi, lo);
        membersByRoot.set(lo, combined);
        membersByRoot.delete(hi);
      }
    }

    this.clusterRep = new Map<number, number>();
    this.clusterMembers = new Map<number, number[]>();
    for (const nid of parent.keys()) {
      const rep = find(nid);
      this.clusterRep.set(nid, rep);
      let list = this.clusterMembers.get(rep);
      if (!list) {
        list = [];
        this.clusterMembers.set(rep, list);
      }
      list.push(nid);
    }
  }

  junctionOf(marker: RoadMarker): RoadMarker {
    const repId = this.clusterRep.get(marker.osmNodeId) ?? marker.osmNodeId;
    return this.markers.get(repId) ?? marker;
  }

  junctionLegs(marker: RoadMarker): Leg[] {
    const repId = this.clusterRep.get(marker.osmNodeId) ?? marker.osmNodeId;
    const memberList = this.clusterMembers.get(repId) ?? [marker.osmNodeId];
    const members = new Set<number>(memberList);
    const rawLegs: Leg[] = [];
    for (const mid of memberList) {
      const m = this.markers.get(mid);
      if (m) rawLegs.push(...m.legs);
    }
    if (members.size <= 1) return rawLegs;

    const externalLegs: Leg[] = [];
    for (const leg of rawLegs) {
      const markers = this.wayMarkers.get(leg.wayId) || [];
      const wLeg = this.ways.get(leg.wayId);
      const isClosedLoop =
        wLeg &&
        wLeg.length <= 65.0 &&
        wLeg.pts.length >= 3 &&
        wLeg.pts[0][0] === wLeg.pts[wLeg.pts.length - 1][0] &&
        wLeg.pts[0][1] === wLeg.pts[wLeg.pts.length - 1][1] &&
        markers.length > 0 &&
        markers.every(
          ([, mNid]) =>
            members.has(mNid) || this.markers.get(mNid)?.kind === 'join'
        );
      if (isClosedLoop) continue;

      const nxt = nextMarkerOnWay(markers, leg.along, leg.direction);
      if (
        nxt &&
        members.has(nxt[1]) &&
        Math.abs(nxt[0] - leg.along) <= this.p.junctionMergeM * 1.5
      ) {
        continue;
      }

      const fwdCheck = this.walk(leg.wayId, leg.along, leg.direction, 60.0);
      if (fwdCheck.endMarker && members.has(fwdCheck.endMarker.osmNodeId)) {
        continue;
      }
      externalLegs.push(leg);
    }
    return externalLegs.length > 0 ? externalLegs : rawLegs;
  }

  private rebuildMarker(osmNodeId: number): boolean {
    const occurrences = this.nodeWays.get(osmNodeId);
    if (!occurrences) {
      this.markers.delete(osmNodeId);
      return false;
    }

    const legs: Leg[] = [];
    const names: string[] = [];
    let endpoint = false;

    for (const [wayId, alongs] of occurrences.entries()) {
      const w = this.ways.get(wayId)!;
      for (const along of alongs) {
        if (along <= 0.5 || along >= w.length - 0.5) {
          endpoint = true;
        }
        if (along > 0.5) {
          legs.push({
            wayId,
            along,
            direction: -1,
            bearing: this.bearingAt(wayId, along, -1),
            streetName: w.name,
          });
        }
        if (along < w.length - 0.5) {
          legs.push({
            wayId,
            along,
            direction: 1,
            bearing: this.bearingAt(wayId, along, 1),
            streetName: w.name,
          });
        }
      }
      if (w.name) {
        names.push(w.name);
      }
    }

    if ((occurrences.size < 2 && !endpoint) || legs.length === 0) {
      this.markers.delete(osmNodeId);
      return false;
    }

    let kind: RoadMarker['kind'];
    if (legs.length === 1) {
      kind = 'dead_end';
    } else if (
      legs.length === 2 &&
      (new Set(legs.map((l) => l.streetName)).size === 1 ||
        (angDiff(legs[0].bearing, (legs[1].bearing + 180.0) % 360.0) <= 25.0 &&
          (!legs[0].streetName ||
            !legs[1].streetName ||
            legs.some((l) =>
              ['bridge', 'tunnel', 'viaduct', 'overpass'].some((k) =>
                (l.streetName || '').toLowerCase().includes(k)
              )
            ))))
    ) {
      kind = 'join';
    } else {
      kind = 'intersection';
    }

    const [lat, lng] = this.nodeCoords.get(osmNodeId)!;
    const uniqNames = [...new Set(names)];
    this.markers.set(osmNodeId, {
      osmNodeId,
      lat,
      lng,
      kind,
      legs,
      streetNames: uniqNames,
    });
    return true;
  }

  marker(osmNodeId: number): RoadMarker | undefined {
    return this.markers.get(osmNodeId);
  }

  bearingAt(wayId: number, along: number, direction: number): number {
    const w = this.ways.get(wayId)!;
    const sample = Math.max(
      0.01,
      Math.min(along + (direction >= 0 ? 0.05 : -0.05), w.length - 0.01)
    );
    let idx = 0;
    for (let i = 0; i < w.offsets.length; i++) {
      if (w.offsets[i] <= sample) idx = i;
      else break;
    }
    idx = Math.max(0, Math.min(idx, w.pts.length - 2));
    const p1 = direction >= 0 ? w.pts[idx] : w.pts[idx + 1];
    const p2 = direction >= 0 ? w.pts[idx + 1] : w.pts[idx];
    return compassBearing(p1[0], p1[1], p2[0], p2[1]);
  }

  walk(
    wayId: number,
    along: number,
    direction: number,
    maxDist: number,
    maxHops: number = 20
  ): WalkResult {
    const slices: PathSlice[] = [];
    let dist = 0.0;
    let curWay = wayId;
    let curAlong = along;
    let curDir = direction;

    for (let hop = 0; hop < maxHops; hop++) {
      const w = this.ways.get(curWay);
      if (!w) break;
      const nxt = nextMarkerOnWay(
        this.wayMarkers.get(curWay) || [],
        curAlong,
        curDir
      );
      const target = nxt ? nxt[0] : curDir > 0 ? w.length : 0.0;
      const segLen = Math.abs(target - curAlong);
      if (dist + segLen >= maxDist) {
        slices.push({
          wayId: curWay,
          fromAlong: curAlong,
          toAlong: curAlong + curDir * (maxDist - dist),
          direction: curDir,
          startDist: dist,
        });
        return { slices, endMarker: null, totalDist: maxDist };
      }
      if (segLen > 0) {
        slices.push({
          wayId: curWay,
          fromAlong: curAlong,
          toAlong: target,
          direction: curDir,
          startDist: dist,
        });
        dist += segLen;
      }
      if (!nxt) {
        return { slices, endMarker: null, totalDist: dist };
      }
      const marker = this.markers.get(nxt[1]);
      if (!marker) {
        curAlong = target;
        continue;
      }
      if (marker.kind !== 'join') {
        return { slices, endMarker: marker, totalDist: dist };
      }
      const arrivedBy = marker.legs.find(
        (l) =>
          l.wayId === curWay &&
          Math.abs(l.along - target) < 0.6 &&
          l.direction === -curDir
      );
      const onward = marker.legs.find((l) => l !== arrivedBy);
      if (!onward || !arrivedBy) {
        return { slices, endMarker: marker, totalDist: dist };
      }
      curWay = onward.wayId;
      curAlong = onward.along;
      curDir = onward.direction;
    }
    return { slices, endMarker: null, totalDist: dist };
  }
}

// =====================================================================
// §2 5-STEP SEQUENCE GRAPH SOLVER (Steps 2–5)
// =====================================================================

export interface NodePlace {
  nodeId: string;
  kind: 'intersection' | 'waypoint';
  lat: number;
  lng: number;
  image: LocationMetadata | null;
  streetNames: string[];
  osmNodeId?: number;
}

export interface OutLink {
  nodeId: string;
  bearing: number;
  distanceM: number;
  lat: number;
  lng: number;
  streetName: string;
  image: LocationMetadata | null;
  arrivalBearing: number;
}

export interface ClusterInfo {
  id: string;
  repId: number;
  lat: number;
  lng: number;
  streets: string[];
  legs: Leg[];
}

export interface ChosenPass {
  seqId: string;
  cidA: number;
  cidB: number;
  frames: LocationMetadata[];
  sampled?: LocationMetadata[];
  chain?: NodePlace[];
  pathLen: number;
  score: number;
}

export function pairKeyStr(cidA: number, cidB: number): string {
  const lo = Math.min(cidA, cidB);
  const hi = Math.max(cidA, cidB);
  return `${lo}:${hi}`;
}

export class AreaSnapshot {
  readonly p: RouteParams;
  readonly images: LocationMetadata[] = [];
  private readonly imageIds = new Set<string>();
  private readonly expandedSequences = new Set<string>();
  private readonly fetchedJunctions = new Set<number>();
  private readonly discoveredCids = new Set<number>();

  solved = false;
  readonly clusters = new Map<number, ClusterInfo>();
  readonly adjacentPairs = new Map<
    string,
    { cidA: number; cidB: number; streetName: string }
  >();
  readonly chosenPasses = new Map<string, ChosenPass>();
  readonly canonicalInterFrame = new Map<number, LocationMetadata>();
  readonly nodes = new Map<string, NodePlace>();
  readonly adj = new Map<string, OutLink[]>();

  constructor(
    readonly roads: RoadNetwork,
    initialImages: LocationMetadata[] = [],
    readonly provider: ImageryProviderClient | null = null,
    params?: Partial<RouteParams>,
    readonly visitedImageIds: Set<string> = new Set(),
    readonly brokenImageIds: Set<string> = new Set(),
    readonly activeSequences: string[] = []
  ) {
    this.p = { ...roads.p, ...params };
    if (initialImages.length > 0) {
      this.ingestMetas(initialImages);
    }
  }

  private get providerName(): string {
    return this.provider?.providerName || 'none';
  }

  ingestMetas(metas: LocationMetadata[]): void {
    for (const m of metas) {
      if (
        m.imageId &&
        !this.imageIds.has(m.imageId) &&
        !this.brokenImageIds.has(m.imageId)
      ) {
        if ((!this.p.panosOnly || m.isPano) && m.coordinates) {
          this.images.push(m);
          this.imageIds.add(m.imageId);
          this.solved = false;
        }
      }
    }
  }

  async expandSequence(
    seqId: string | null | undefined,
    cacheOnly: boolean = false
  ): Promise<number> {
    if (!seqId || !this.provider || this.expandedSequences.has(String(seqId))) {
      return 0;
    }
    const seqStr = String(seqId);
    const seqKey = `${this.providerName}:seq:${seqStr}`;
    const cachedRaw = windowCache.get(seqKey) as LocationMetadata[] | undefined;
    let metas: LocationMetadata[] = [];

    if (cachedRaw) {
      queryAudit.recordCacheHit('sequence');
      metas = cachedRaw;
    } else if (!cacheOnly) {
      metas = (await this.provider.getSequence(seqStr)) || [];
      if (!windowCache.get(seqKey)) {
        windowCache.put(seqKey, metas);
      }
    } else {
      return 0;
    }

    this.expandedSequences.add(seqStr);
    if (metas.length > 0) {
      this.ingestMetas(metas);
    }
    return metas.length;
  }

  async ensureJunction(
    cid: number,
    cLat: number,
    cLng: number,
    cacheOnly: boolean = false
  ): Promise<LocationMetadata[]> {
    if (!this.provider) return [];
    const jKey = `${this.providerName}:junction_v3:${cid}`;
    const cached = windowCache.get(jKey) as LocationMetadata[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('window');
      this.ingestMetas(cached);
      this.fetchedJunctions.add(cid);
      return cached;
    }
    if (cacheOnly || this.fetchedJunctions.has(cid)) {
      return [];
    }
    this.fetchedJunctions.add(cid);
    const dLat = this.p.captureMaxM / M_PER_DEG_LAT;
    const dLng =
      this.p.captureMaxM /
      (M_PER_DEG_LAT * Math.max(Math.cos((cLat * Math.PI) / 180.0), 0.1));
    const metas =
      (await this.provider.getMetadataBbox(
        cLat - dLat,
        cLng - dLng,
        cLat + dLat,
        cLng + dLng
      )) || [];
    windowCache.put(jKey, metas);
    this.ingestMetas(metas);
    return metas;
  }

  buildClustersAndAdjacency(): void {
    this.clusters.clear();
    this.adjacentPairs.clear();

    const interMarkers = [...this.roads.markers.values()].filter(
      (m) => m.kind === 'intersection'
    );
    const allowDeadEnd = interMarkers.length < 2;

    for (const m of this.roads.markers.values()) {
      if (m.kind !== 'intersection' && !(allowDeadEnd && m.kind === 'dead_end')) {
        continue;
      }
      const rep =
        m.kind === 'intersection' ? this.roads.junctionOf(m) : m;
      if (!this.clusters.has(rep.osmNodeId)) {
        const memberIds = this.roads.clusterMembers.get(rep.osmNodeId) ?? [
          rep.osmNodeId,
        ];
        const members = memberIds
          .map((mid) => this.roads.markers.get(mid))
          .filter((x): x is RoadMarker => Boolean(x));
        const legs =
          m.kind === 'intersection'
            ? this.roads.junctionLegs(rep)
            : [...rep.legs];
        const streets = [
          ...new Set(legs.map((l) => l.streetName).filter(Boolean)),
        ].sort();
        this.clusters.set(rep.osmNodeId, {
          id: `osm_${rep.osmNodeId}`,
          repId: rep.osmNodeId,
          lat: members.reduce((s, x) => s + x.lat, 0) / members.length,
          lng: members.reduce((s, x) => s + x.lng, 0) / members.length,
          streets,
          legs,
        });
      }
    }

    for (const [cid, c] of this.clusters.entries()) {
      for (const leg of c.legs) {
        const wRes = this.roads.walk(leg.wayId, leg.along, leg.direction, 600.0);
        if (wRes.endMarker) {
          const em = wRes.endMarker;
          const repCid =
            em.kind === 'intersection'
              ? this.roads.junctionOf(em).osmNodeId
              : em.osmNodeId;
          if (repCid !== cid && this.clusters.has(repCid)) {
            const pk = pairKeyStr(cid, repCid);
            const existing = this.adjacentPairs.get(pk);
            if (!existing || (!existing.streetName && leg.streetName)) {
              this.adjacentPairs.set(pk, {
                cidA: Math.min(cid, repCid),
                cidB: Math.max(cid, repCid),
                streetName: leg.streetName || '',
              });
            }
          }
        }
      }
    }
  }

  async discoverAndExpand(
    centerLat: number,
    centerLng: number,
    radiusM: number = 45.0
  ): Promise<void> {
    if (this.clusters.size === 0) {
      this.buildClustersAndAdjacency();
    }
    if (!this.provider) return;

    const nearCids = new Set<number>();
    for (const [cid, c] of this.clusters.entries()) {
      if (calculateDistance(centerLat, centerLng, c.lat, c.lng) <= radiusM) {
        nearCids.add(cid);
      }
    }
    if (nearCids.size === 0 && this.clusters.size > 0) {
      const nearest = [...this.clusters.keys()]
        .sort(
          (a, b) =>
            calculateDistance(
              centerLat,
              centerLng,
              this.clusters.get(a)!.lat,
              this.clusters.get(a)!.lng
            ) -
            calculateDistance(
              centerLat,
              centerLng,
              this.clusters.get(b)!.lat,
              this.clusters.get(b)!.lng
            )
        )
        .slice(0, 2);
      for (const cid of nearest) nearCids.add(cid);
    }

    if ([...nearCids].every((cid) => this.discoveredCids.has(cid))) {
      return;
    }
    for (const cid of nearCids) this.discoveredCids.add(cid);

    const neighborCids = new Set<number>(nearCids);
    for (const pair of this.adjacentPairs.values()) {
      if (nearCids.has(pair.cidA) || nearCids.has(pair.cidB)) {
        neighborCids.add(pair.cidA);
        neighborCids.add(pair.cidB);
      }
    }

    for (const cid of neighborCids) {
      const c = this.clusters.get(cid)!;
      await this.ensureJunction(cid, c.lat, c.lng, true);
    }

    const missing = [...neighborCids].filter(
      (cid) => !this.fetchedJunctions.has(cid)
    );
    if (missing.length > 0) {
      await Promise.all(
        missing.map(async (cid) => {
          const c = this.clusters.get(cid)!;
          try {
            await this.ensureJunction(cid, c.lat, c.lng, false);
          } catch {
            // Ignore single junction fetch failure
          }
        })
      );
    }

    const uniqueSeqs = [
      ...new Set(this.images.map((m) => m.sequenceId).filter(Boolean)),
    ] as string[];
    for (const sid of uniqueSeqs) {
      await this.expandSequence(sid, true);
    }

    const seqDistAt = new Map<number, Map<string, number>>();
    for (const cid of neighborCids) {
      seqDistAt.set(cid, new Map<string, number>());
    }

    for (const m of this.images) {
      if (!m.sequenceId || !m.coordinates || (this.p.panosOnly && !m.isPano)) {
        continue;
      }
      const sid = String(m.sequenceId);
      const mlat = m.coordinates.latitude;
      const mlng = m.coordinates.longitude;
      for (const cid of neighborCids) {
        const c = this.clusters.get(cid)!;
        const d = calculateDistance(mlat, mlng, c.lat, c.lng);
        const bySeq = seqDistAt.get(cid)!;
        if (d <= this.p.captureMaxM && d < (bySeq.get(sid) ?? Infinity)) {
          bySeq.set(sid, d);
        }
      }
    }

    const toExpand: string[] = [];
    for (const pair of this.adjacentPairs.values()) {
      if (!nearCids.has(pair.cidA) && !nearCids.has(pair.cidB)) continue;
      const mapA = seqDistAt.get(pair.cidA);
      const mapB = seqDistAt.get(pair.cidB);
      if (!mapA || !mapB) continue;
      const shared = [...mapA.keys()].filter((s) => mapB.has(s));
      shared.sort((sa, sb) => {
        const scoreA =
          mapA.get(sa)! +
          mapB.get(sa)! -
          (this.activeSequences.includes(sa) ? 10.0 : 0.0);
        const scoreB =
          mapA.get(sb)! +
          mapB.get(sb)! -
          (this.activeSequences.includes(sb) ? 10.0 : 0.0);
        return scoreA - scoreB;
      });
      for (const sid of shared.slice(0, 2)) {
        if (!this.expandedSequences.has(sid) && !toExpand.includes(sid)) {
          toExpand.push(sid);
        }
      }
    }

    const hasExpandedShared = [...this.adjacentPairs.values()].some((pair) => {
      if (!nearCids.has(pair.cidA) && !nearCids.has(pair.cidB)) return false;
      const mapA = seqDistAt.get(pair.cidA);
      const mapB = seqDistAt.get(pair.cidB);
      if (!mapA || !mapB) return false;
      return [...mapA.keys()].some(
        (s) => mapB.has(s) && this.expandedSequences.has(s)
      );
    });

    if (toExpand.length === 0 && !hasExpandedShared) {
      const fallback = new Map<string, number>();
      for (const cid of nearCids) {
        const mapC = seqDistAt.get(cid);
        if (!mapC) continue;
        for (const [sid, d] of mapC.entries()) {
          if (!this.expandedSequences.has(sid)) {
            if (d < (fallback.get(sid) ?? Infinity)) {
              fallback.set(sid, d);
            }
          }
        }
      }
      const rankedFallback = [...fallback.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2);
      for (const [sid] of rankedFallback) {
        toExpand.push(sid);
      }
    }

    if (toExpand.length > 0) {
      await Promise.all(
        toExpand.map(async (sid) => {
          try {
            await this.expandSequence(sid, false);
          } catch {
            // Ignore sequence expansion failure
          }
        })
      );
    }
  }

  async solve(
    centerLat?: number,
    centerLng?: number,
    radiusM: number = 45.0
  ): Promise<void> {
    if (this.clusters.size === 0) {
      this.buildClustersAndAdjacency();
    }
    if (
      centerLat !== undefined &&
      centerLng !== undefined &&
      this.provider !== null
    ) {
      await this.discoverAndExpand(centerLat, centerLng, radiusM);
    }
    if (this.solved) return;

    this.chosenPasses.clear();
    this.canonicalInterFrame.clear();
    this.nodes.clear();
    this.adj.clear();

    const sequences = new Map<string, LocationMetadata[]>();
    const noneSeqFrames: LocationMetadata[] = [];
    for (const m of this.images) {
      if (
        !this.brokenImageIds.has(m.imageId) &&
        m.coordinates &&
        (!this.p.panosOnly || m.isPano)
      ) {
        if (m.sequenceId) {
          const sid = String(m.sequenceId);
          let arr = sequences.get(sid);
          if (!arr) {
            arr = [];
            sequences.set(sid, arr);
          }
          arr.push(m);
        } else {
          noneSeqFrames.push(m);
        }
      }
    }

    for (const [sid, rawFrames] of [...sequences.entries()]) {
      const dedup = new Map<string, LocationMetadata>();
      for (const f of rawFrames) dedup.set(f.imageId, f);
      const frames = [...dedup.values()];
      if (frames.length < 2) {
        sequences.delete(sid);
      } else {
        frames.sort(
          (a, b) =>
            String(a.captureTime || '').localeCompare(
              String(b.captureTime || '')
            ) || a.imageId.localeCompare(b.imageId)
        );
        sequences.set(sid, frames);
      }
    }

    if (noneSeqFrames.length >= 2) {
      const dedup = new Map<string, LocationMetadata>();
      for (const f of noneSeqFrames) dedup.set(f.imageId, f);
      sequences.set(
        '__synthetic__',
        [...dedup.values()].sort(
          (a, b) =>
            a.coordinates.latitude - b.coordinates.latitude ||
            a.coordinates.longitude - b.coordinates.longitude ||
            String(a.captureTime || '').localeCompare(
              String(b.captureTime || '')
            ) ||
            a.imageId.localeCompare(b.imageId)
        )
      );
    }

    const interRadiusM = this.p.captureMaxM;
    const passesByPair = new Map<string, ChosenPass[]>();

    for (const [sid, frames] of sequences.entries()) {
      const visitsByCid = new Map<number, Array<Array<[number, number]>>>();
      for (let idx = 0; idx < frames.length; idx++) {
        const f = frames[idx];
        const lat = f.coordinates.latitude;
        const lng = f.coordinates.longitude;
        for (const [cid, c] of this.clusters.entries()) {
          const d = calculateDistance(lat, lng, c.lat, c.lng);
          if (d <= interRadiusM) {
            let groups = visitsByCid.get(cid);
            if (!groups) {
              groups = [];
              visitsByCid.set(cid, groups);
            }
            if (
              groups.length > 0 &&
              idx -
                groups[groups.length - 1][
                  groups[groups.length - 1].length - 1
                ][0] <=
                8
            ) {
              groups[groups.length - 1].push([idx, d]);
            } else {
              groups.push([[idx, d]]);
            }
          }
        }
      }

      const visits: Array<[number, number, number]> = [];
      for (const [cid, groups] of visitsByCid.entries()) {
        for (const g of groups) {
          let best = g[0];
          for (const item of g) {
            if (item[1] < best[1]) best = item;
          }
          visits.push([cid, best[0], best[1]]);
        }
      }
      visits.sort((a, b) => a[1] - b[1]);

      for (let vI = 0; vI < visits.length; vI++) {
        for (let vJ = vI + 1; vJ < Math.min(visits.length, vI + 4); vJ++) {
          const [cidA, idxA, dA] = visits[vI];
          const [cidB, idxB, dB] = visits[vJ];
          const pk = pairKeyStr(cidA, cidB);
          if (cidA === cidB || idxB <= idxA || !this.adjacentPairs.has(pk)) {
            continue;
          }
          let hasIntermediateVisit = false;
          for (let m = vI + 1; m < vJ; m++) {
            const [cidM, idxM, dM] = visits[m];
            if (
              cidM !== cidA &&
              cidM !== cidB &&
              idxA + 3 < idxM &&
              idxM < idxB - 3 &&
              dM < 18.0
            ) {
              hasIntermediateVisit = true;
              break;
            }
          }
          if (hasIntermediateVisit) continue;

          const subFrames = frames.slice(idxA, idxB + 1);
          const steps: number[] = [];
          let pathLen = 0.0;
          let maxStep = 0.0;
          for (let k = 0; k < subFrames.length - 1; k++) {
            const s = calculateDistance(
              subFrames[k].coordinates.latitude,
              subFrames[k].coordinates.longitude,
              subFrames[k + 1].coordinates.latitude,
              subFrames[k + 1].coordinates.longitude
            );
            steps.push(s);
            pathLen += s;
            if (s > maxStep) maxStep = s;
          }
          const cA = this.clusters.get(cidA)!;
          const cB = this.clusters.get(cidB)!;
          const straightD = calculateDistance(cA.lat, cA.lng, cB.lat, cB.lng);
          const sinuosity = pathLen / Math.max(straightD, 1.0);
          if (
            sinuosity > this.p.maxSinuosity ||
            maxStep > Math.max(this.p.maxFrameStepM, this.p.stepM * 1.6)
          ) {
            continue;
          }
          const score =
            Math.abs(sinuosity - 1.0) * 50.0 +
            (dA + dB) +
            maxStep -
            (this.activeSequences.includes(sid) ? 5.0 : 0.0);

          let list = passesByPair.get(pk);
          if (!list) {
            list = [];
            passesByPair.set(pk, list);
          }
          list.push({
            seqId: sid,
            cidA,
            cidB,
            frames: subFrames,
            pathLen,
            score,
          });
        }
      }
    }

    const intersectionEndpointFrames = new Map<number, LocationMetadata[]>();
    for (const [pk, candList] of [...passesByPair.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      let best = candList[0];
      for (const cand of candList) {
        if (cand.score < best.score) best = cand;
      }
      const frames = best.frames;
      const cumD: number[] = [0.0];
      for (let i = 0; i < frames.length - 1; i++) {
        cumD.push(
          cumD[cumD.length - 1] +
            calculateDistance(
              frames[i].coordinates.latitude,
              frames[i].coordinates.longitude,
              frames[i + 1].coordinates.latitude,
              frames[i + 1].coordinates.longitude
            )
        );
      }
      const totalD = cumD[cumD.length - 1];
      const nSteps = Math.max(1, Math.round(totalD / Math.max(this.p.stepM, 5.0)));
      const sampled: LocationMetadata[] = [frames[0]];
      if (frames.length > 2) {
        for (let k = 1; k < nSteps; k++) {
          const targetD = totalD * (k / nSteps);
          let bestI = 1;
          let bestDiff = Math.abs(cumD[1] - targetD);
          for (let i = 2; i < frames.length - 1; i++) {
            const diff = Math.abs(cumD[i] - targetD);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestI = i;
            }
          }
          if (sampled[sampled.length - 1].imageId !== frames[bestI].imageId) {
            sampled.push(frames[bestI]);
          }
        }
      }
      if (
        sampled[sampled.length - 1].imageId !== frames[frames.length - 1].imageId
      ) {
        sampled.push(frames[frames.length - 1]);
      }
      best.sampled = sampled;
      this.chosenPasses.set(pk, best);

      let listA = intersectionEndpointFrames.get(best.cidA);
      if (!listA) {
        listA = [];
        intersectionEndpointFrames.set(best.cidA, listA);
      }
      listA.push(sampled[0]);

      let listB = intersectionEndpointFrames.get(best.cidB);
      if (!listB) {
        listB = [];
        intersectionEndpointFrames.set(best.cidB, listB);
      }
      listB.push(sampled[sampled.length - 1]);
    }

    for (const [cid, endFrames] of intersectionEndpointFrames.entries()) {
      const c = this.clusters.get(cid)!;
      let bestFrame = endFrames[0];
      let bestCost = Infinity;
      for (const f of endFrames) {
        const avgMutual =
          endFrames.reduce(
            (sum, ef) =>
              sum +
              calculateDistance(
                f.coordinates.latitude,
                f.coordinates.longitude,
                ef.coordinates.latitude,
                ef.coordinates.longitude
              ),
            0
          ) / endFrames.length;
        const cost =
          avgMutual +
          0.5 *
            calculateDistance(
              f.coordinates.latitude,
              f.coordinates.longitude,
              c.lat,
              c.lng
            );
        if (cost < bestCost) {
          bestCost = cost;
          bestFrame = f;
        }
      }
      this.canonicalInterFrame.set(cid, bestFrame);
    }

    for (const [cid, c] of this.clusters.entries()) {
      let fInter = this.canonicalInterFrame.get(cid) ?? null;
      if (!fInter) {
        const nearImgs = this.images.filter(
          (m) =>
            calculateDistance(
              c.lat,
              c.lng,
              m.coordinates.latitude,
              m.coordinates.longitude
            ) <= interRadiusM
        );
        if (nearImgs.length > 0) {
          nearImgs.sort(
            (a, b) =>
              calculateDistance(
                c.lat,
                c.lng,
                a.coordinates.latitude,
                a.coordinates.longitude
              ) -
              calculateDistance(
                c.lat,
                c.lng,
                b.coordinates.latitude,
                b.coordinates.longitude
              )
          );
          fInter = nearImgs[0];
          this.canonicalInterFrame.set(cid, fInter);
        }
      }
      const nodeId = `osm_${cid}`;
      this.nodes.set(nodeId, {
        nodeId,
        kind: 'intersection',
        lat: fInter ? fInter.coordinates.latitude : c.lat,
        lng: fInter ? fInter.coordinates.longitude : c.lng,
        image: fInter,
        streetNames: [...c.streets],
        osmNodeId: cid,
      });
    }

    for (const [pk, info] of this.chosenPasses.entries()) {
      const streetName = this.adjacentPairs.get(pk)?.streetName || '';
      const nodeA = this.nodes.get(`osm_${info.cidA}`)!;
      const nodeB = this.nodes.get(`osm_${info.cidB}`)!;
      const midNodes: NodePlace[] = [];
      const sampled = info.sampled || [];

      for (const fMid of sampled.slice(1, -1)) {
        if (
          (nodeA.image && fMid.imageId === nodeA.image.imageId) ||
          (nodeB.image && fMid.imageId === nodeB.image.imageId)
        ) {
          continue;
        }
        if (
          calculateDistance(
            nodeA.lat,
            nodeA.lng,
            fMid.coordinates.latitude,
            fMid.coordinates.longitude
          ) < 5.0
        ) {
          continue;
        }
        if (
          calculateDistance(
            nodeB.lat,
            nodeB.lng,
            fMid.coordinates.latitude,
            fMid.coordinates.longitude
          ) < 5.0
        ) {
          continue;
        }
        const wpId = `seq_${fMid.imageId}`;
        const wpNode: NodePlace = {
          nodeId: wpId,
          kind: 'waypoint',
          lat: fMid.coordinates.latitude,
          lng: fMid.coordinates.longitude,
          image: fMid,
          streetNames: streetName ? [streetName] : [],
        };
        this.nodes.set(wpId, wpNode);
        midNodes.push(wpNode);
      }

      const chain = [nodeA, ...midNodes, nodeB];
      info.chain = chain;
      for (let i = 0; i < chain.length - 1; i++) {
        const u = chain[i];
        const v = chain[i + 1];
        const dUv = Math.round(calculateDistance(u.lat, u.lng, v.lat, v.lng) * 10) / 10;
        const brgUv = Math.round(compassBearing(u.lat, u.lng, v.lat, v.lng) * 10) / 10;
        const brgVu = Math.round(compassBearing(v.lat, v.lng, u.lat, u.lng) * 10) / 10;

        let adjU = this.adj.get(u.nodeId);
        if (!adjU) {
          adjU = [];
          this.adj.set(u.nodeId, adjU);
        }
        adjU.push({
          nodeId: v.nodeId,
          bearing: brgUv,
          distanceM: dUv,
          lat: v.lat,
          lng: v.lng,
          streetName,
          image: v.image,
          arrivalBearing: brgUv,
        });

        let adjV = this.adj.get(v.nodeId);
        if (!adjV) {
          adjV = [];
          this.adj.set(v.nodeId, adjV);
        }
        adjV.push({
          nodeId: u.nodeId,
          bearing: brgVu,
          distanceM: dUv,
          lat: u.lat,
          lng: u.lng,
          streetName,
          image: u.image,
          arrivalBearing: brgVu,
        });
      }
    }

    this.solved = true;
  }
}

// =====================================================================
// §3 GRAPH QUERIES & ROUTE PROVIDER SERVICE
// =====================================================================

export async function placeNode(
  snap: AreaSnapshot,
  nodeId: string
): Promise<NodePlace | null> {
  if (!snap.solved) {
    await snap.solve();
  }
  const existing = snap.nodes.get(nodeId);
  if (existing) return existing;

  if (nodeId.startsWith('osm_')) {
    const rawId = Number(nodeId.slice(4));
    if (Number.isNaN(rawId)) return null;
    const mk = snap.roads.marker(rawId);
    if (mk) {
      const rep = snap.roads.junctionOf(mk);
      const repKey = `osm_${rep.osmNodeId}`;
      return (
        snap.nodes.get(repKey) ?? {
          nodeId: repKey,
          kind: 'intersection',
          lat: rep.lat,
          lng: rep.lng,
          image: snap.canonicalInterFrame.get(rep.osmNodeId) ?? null,
          streetNames: [...rep.streetNames],
          osmNodeId: rep.osmNodeId,
        }
      );
    }
  }
  if (nodeId.startsWith('seq_')) {
    const imgId = nodeId.slice(4);
    for (const m of snap.images) {
      if (m.imageId === imgId) {
        return {
          nodeId,
          kind: 'waypoint',
          lat: m.coordinates.latitude,
          lng: m.coordinates.longitude,
          image: m,
          streetNames: [],
        };
      }
    }
  }
  return null;
}

export async function pickSeed(
  snap: AreaSnapshot,
  lat: number,
  lng: number,
  streetHint?: string | null
): Promise<{ place: NodePlace; image: LocationMetadata } | null> {
  await snap.solve(lat, lng);
  let candidates = [...snap.nodes.values()].filter(
    (n) => n.image !== null && (snap.adj.get(n.nodeId)?.length ?? 0) > 0
  );
  if (candidates.length === 0) {
    candidates = [...snap.nodes.values()].filter((n) => n.image !== null);
  }
  if (candidates.length === 0 && snap.provider) {
    const dLat = 35.0 / M_PER_DEG_LAT;
    const dLng =
      35.0 / (M_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180.0), 0.1));
    const probe =
      (await snap.provider.getMetadataBbox(
        lat - dLat,
        lng - dLng,
        lat + dLat,
        lng + dLng
      )) || [];
    snap.ingestMetas(probe);
    for (const m of probe) {
      if (m.sequenceId) {
        await snap.expandSequence(m.sequenceId, false);
      }
    }
    await snap.solve(lat, lng);
    candidates = [...snap.nodes.values()].filter(
      (n) => n.image !== null && (snap.adj.get(n.nodeId)?.length ?? 0) > 0
    );
    if (candidates.length === 0) {
      candidates = [...snap.nodes.values()].filter((n) => n.image !== null);
    }
  }
  if (candidates.length === 0) return null;

  const hintNorm = streetHint ? normStreet(streetHint) : '';
  if (hintNorm) {
    const named = candidates.filter(
      (n) =>
        n.streetNames.some((s) => normStreet(s) === hintNorm) &&
        calculateDistance(lat, lng, n.lat, n.lng) <= 100.0
    );
    if (named.length > 0) {
      candidates = named;
    }
  }
  candidates.sort(
    (a, b) =>
      calculateDistance(lat, lng, a.lat, a.lng) -
      calculateDistance(lat, lng, b.lat, b.lng)
  );
  const best = candidates[0];
  return { place: best, image: best.image! };
}

@Injectable({
  providedIn: 'root',
})
export class RouteProviderService {
  private readonly imagery = inject(ImageryProviderService);
  private readonly location = inject(LocationProviderService);
  private readonly roadData = inject(RoadDataService);

  private readonly p: RouteParams = { ...DEFAULT_ROUTE_PARAMS };
  private readonly brokenImageIds = new Set<string>();
  private readonly visitedImageIds = new Set<string>();
  private readonly activeSequences: string[] = [];
  private readonly tileSnapshots = new Map<string, AreaSnapshot>();

  resetState(): void {
    this.tileSnapshots.clear();
    this.activeSequences.length = 0;
    this.visitedImageIds.clear();
    this.brokenImageIds.clear();
    graphCache.clear();
  }

  private nodeCacheKey(
    canonicalNodeId: string,
    imageId?: string | null
  ): string {
    return `${this.imagery.providerName}:${canonicalNodeId}:${imageId || ''}`;
  }

  private async snapshotAt(lat: number, lng: number): Promise<AreaSnapshot> {
    const tileDeg = 0.004;
    const tLat = Number((Math.round(lat / tileDeg) * tileDeg).toFixed(5));
    const tLng = Number((Math.round(lng / tileDeg) * tileDeg).toFixed(5));
    const tKey = `${this.imagery.providerName}:${tLat}:${tLng}`;

    const existing = this.tileSnapshots.get(tKey);
    if (existing) {
      return existing;
    }

    const cacheRadius = Math.max(this.p.snapshotRadiusM, 250.0);
    const dLat = cacheRadius / M_PER_DEG_LAT;
    const dLng =
      cacheRadius /
      (M_PER_DEG_LAT * Math.max(Math.cos((tLat * Math.PI) / 180.0), 0.1));
    const ways = await this.roadData.fetchWaysForTile(
      Number((tLat - dLat).toFixed(5)),
      Number((tLng - dLng).toFixed(5)),
      Number((tLat + dLat).toFixed(5)),
      Number((tLng + dLng).toFixed(5))
    );

    const rn = new RoadNetwork(this.p);
    rn.addWays(ways);
    const snap = new AreaSnapshot(
      rn,
      [],
      this.imagery,
      this.p,
      this.visitedImageIds,
      this.brokenImageIds,
      this.activeSequences
    );
    if (this.tileSnapshots.size >= 16) {
      const oldest = this.tileSnapshots.keys().next().value;
      if (oldest !== undefined) this.tileSnapshots.delete(oldest);
    }
    this.tileSnapshots.set(tKey, snap);
    return snap;
  }

  private static streetLabelFromNames(
    streetNames: Array<string | undefined | null>
  ): string | null {
    const streets: string[] = [];
    for (const s of streetNames) {
      const st = (s || '').trim();
      if (st && st !== 'Unnamed Street' && !streets.includes(st)) {
        streets.push(st);
      }
    }
    if (streets.length >= 2) {
      return `${streets[0]} & ${streets[1]}`;
    }
    if (streets.length === 1) {
      return streets[0];
    }
    return null;
  }

  private async resolveNodeAddress(
    place: NodePlace,
    links: Link[],
    geocodedAddress?: string | null
  ): Promise<string | null> {
    if (geocodedAddress) return geocodedAddress;
    const label = RouteProviderService.streetLabelFromNames([
      ...place.streetNames,
      ...links.map((l) => l.streetName),
    ]);
    if (label) return label;
    return this.location.reverseGeocode(place.lat, place.lng);
  }

  private static toNavLink(out: OutLink): Link {
    return {
      canonicalNodeId: out.nodeId,
      imageId: out.image?.imageId ?? null,
      heading: out.bearing,
      coordinates: { latitude: out.lat, longitude: out.lng },
      distanceMeters: out.distanceM,
      streetName: out.streetName,
      status: out.image ? 'ok' : 'path_only',
      captureTime: out.image?.captureTime ?? null,
      isPano: Boolean(out.image?.isPano),
      arrivalHeading: out.arrivalBearing,
    };
  }

  private cacheSolvedGraph(snap: AreaSnapshot): void {
    for (const [nodeId, node] of snap.nodes.entries()) {
      const outLinks = snap.adj.get(nodeId) || [];
      if (!node.image || outLinks.length === 0) continue;
      const navLinks = outLinks.map((o) => RouteProviderService.toNavLink(o));
      const address = RouteProviderService.streetLabelFromNames([
        ...node.streetNames,
        ...navLinks.map((l) => l.streetName),
      ]);
      const payload: Record<string, unknown> = {
        imageId: node.image.imageId,
        canonicalNodeId: node.nodeId,
        coordinates: { latitude: node.lat, longitude: node.lng },
        captureTime: node.image.captureTime || '',
        address,
        links: navLinks,
        status: 'ok',
        isPano: Boolean(node.image.isPano),
      };
      graphCache.put(this.nodeCacheKey(nodeId, null), payload);
      graphCache.put(this.nodeCacheKey(nodeId, node.image.imageId), payload);
    }
  }

  async renderView(params: {
    imageId: string;
    heading?: number;
    pitch?: number;
  }): Promise<RenderViewResponse> {
    if (!params.imageId) {
      throw new Error('Missing imageId.');
    }
    const imageData = await this.imagery.getImage(
      params.imageId,
      params.heading ?? 0,
      params.pitch ?? 0
    );
    if (!imageData) {
      this.brokenImageIds.add(params.imageId);
      throw new Error('Failed to retrieve image data.');
    }
    return {
      imageId: params.imageId,
      image: imageData.image,
      actualHeading: imageData.actualHeading,
    };
  }

  async getPanoView(params: {
    canonicalNodeId?: string;
    imageId?: string;
    address?: string;
    coordinates?: LatLng;
    heading?: number;
    pitch?: number;
  }): Promise<GetViewResponse> {
    let heading = params.heading ?? 0;
    const pitch = params.pitch ?? 0;
    const canonicalNodeId = params.canonicalNodeId;
    const imageId = params.imageId;
    const address = params.address;
    let lat = params.coordinates?.latitude;
    let lng = params.coordinates?.longitude;

    if (canonicalNodeId && !canonicalNodeId.startsWith('osm_')) {
      const cachedNode =
        graphCache.get(this.nodeCacheKey(canonicalNodeId, imageId)) ??
        graphCache.get(this.nodeCacheKey(canonicalNodeId, null));
      const cachedImgId = cachedNode?.['imageId'] as string | undefined;
      if (
        cachedNode &&
        cachedImgId &&
        cachedNode['coordinates'] &&
        !this.brokenImageIds.has(cachedImgId)
      ) {
        queryAudit.recordCacheHit('graph');
        const imageData = await this.imagery.getImage(
          cachedImgId,
          heading,
          pitch
        );
        if (imageData) {
          return {
            image: imageData.image,
            imageId: cachedImgId,
            canonicalNodeId: String(cachedNode['canonicalNodeId']),
            actualHeading: imageData.actualHeading,
            coordinates: cachedNode['coordinates'] as LatLng,
            captureTime: String(cachedNode['captureTime'] ?? ''),
            address: (cachedNode['address'] as string | null) ?? null,
            links: (cachedNode['links'] as Link[]) || [],
            status: 'ok',
            isPano: Boolean(cachedNode['isPano'] ?? true),
          };
        }
        this.brokenImageIds.add(cachedImgId);
      }
    }

    let streetHint: string | null = null;
    let geocodedAddress: string | null = null;
    let seed: { place: NodePlace; image: LocationMetadata } | null = null;
    let snap: AreaSnapshot | null = null;
    let place: NodePlace | null = null;

    if (!canonicalNodeId && !imageId) {
      this.activeSequences.length = 0;
      this.visitedImageIds.clear();
    }

    if (canonicalNodeId && lat !== undefined && lng !== undefined) {
      snap = await this.snapshotAt(lat, lng);
      await snap.solve(lat, lng);
      place = await placeNode(snap, canonicalNodeId);
    }

    if (!place && imageId) {
      const meta = await this.imagery.getMetadata(imageId);
      if (!meta) {
        throw new Error(`Image ID ${imageId} not found.`);
      }
      lat = meta.coordinates.latitude;
      lng = meta.coordinates.longitude;
      snap = await this.snapshotAt(lat, lng);
      snap.ingestMetas([meta]);
      if (meta.sequenceId) {
        await snap.expandSequence(meta.sequenceId, false);
      }
      await snap.solve(lat, lng);
      place = await placeNode(snap, `seq_${imageId}`);
    }

    if (!place && address) {
      if (lat === undefined || lng === undefined) {
        const geo = await this.location.geocode(address);
        if (!geo) {
          throw new Error(`Could not locate address: ${address}`);
        }
        lat = geo.lat;
        lng = geo.lng;
        streetHint = geo.street || address.split(',')[0].trim();
        geocodedAddress = geo.address || address;
      } else {
        streetHint = address.split(',')[0].trim();
        geocodedAddress = address;
      }
    }

    if (!place) {
      if (lat === undefined || lng === undefined) {
        throw new Error(
          'generatePanoramaView needs coordinates (or an address) to locate the node.'
        );
      }
      snap = snap ?? (await this.snapshotAt(lat, lng));
      seed = await pickSeed(snap, lat, lng, streetHint);
      if (!seed) {
        throw new Error(
          `No imagery available near ${lat.toFixed(5)}, ${lng.toFixed(5)}.`
        );
      }
      place = seed.place;
    }

    let ref: LocationMetadata | null = null;
    if (seed) {
      ref = seed.image;
    } else if (place.image && !this.brokenImageIds.has(place.image.imageId)) {
      ref = place.image;
    } else if (imageId && !this.brokenImageIds.has(imageId) && snap) {
      ref = snap.images.find((m) => m.imageId === imageId) ?? null;
    }

    if (
      ref?.sequenceId &&
      !this.activeSequences.includes(ref.sequenceId)
    ) {
      this.activeSequences.push(ref.sequenceId);
    }

    if (snap && (!snap.solved || !snap.adj.has(place.nodeId))) {
      await snap.solve(place.lat, place.lng);
    }
    const rawOutLinks = snap ? snap.adj.get(place.nodeId) || [] : [];
    const links = rawOutLinks.map((o) => RouteProviderService.toNavLink(o));
    const resolvedAddress = await this.resolveNodeAddress(
      place,
      links,
      geocodedAddress
    );

    if (seed && links.length > 0 && ref) {
      const camH = Number(ref.heading || 0);
      const minLinkDiff = Math.min(
        ...links.map((l) => angDiff(heading, l.heading))
      );
      if (
        minLinkDiff > 45.0 ||
        (heading === 0.0 && camH !== 0.0 && angDiff(0.0, camH) > 120.0)
      ) {
        let bestLink = links[0];
        for (const l of links) {
          if (angDiff(l.heading, camH) < angDiff(bestLink.heading, camH)) {
            bestLink = l;
          }
        }
        heading = Math.round(bestLink.heading * 10) / 10;
      }
    }

    if (!ref) {
      return {
        image: null,
        imageId: null,
        canonicalNodeId: place.nodeId,
        actualHeading: heading,
        coordinates: { latitude: place.lat, longitude: place.lng },
        captureTime: '',
        address: resolvedAddress,
        links,
        status: 'path_only',
        message:
          'No imagery is available at this location; you can still navigate to nearby points.',
      };
    }

    const imageData = await this.imagery.getImage(
      ref.imageId,
      heading,
      pitch
    );
    if (!imageData) {
      this.brokenImageIds.add(ref.imageId);
      throw new Error('Failed to retrieve image data.');
    }

    this.visitedImageIds.add(ref.imageId);
    if (snap) {
      this.cacheSolvedGraph(snap);
    }

    return {
      image: imageData.image,
      imageId: ref.imageId,
      canonicalNodeId: place.nodeId,
      actualHeading: imageData.actualHeading,
      coordinates: { latitude: place.lat, longitude: place.lng },
      captureTime: ref.captureTime || '',
      address: resolvedAddress,
      links,
      status: 'ok',
      isPano: Boolean(ref.isPano),
    };
  }

  async getLocalGraph(
    lat: number,
    lng: number,
    radiusM: number = 80.0
  ): Promise<LocalGraphResponse> {
    const snap = await this.snapshotAt(lat, lng);
    await snap.solve(lat, lng, radiusM);

    const degLat = radiusM / 111320.0;
    const degLng =
      radiusM /
      (111320.0 * Math.max(Math.cos((lat * Math.PI) / 180.0), 0.1));
    const minLat = lat - degLat;
    const maxLat = lat + degLat;
    const minLng = lng - degLng;
    const maxLng = lng + degLng;

    let currentNodeId: string | null = null;
    if (snap.nodes.size > 0) {
      let nearest: NodePlace | null = null;
      let nearestDist = Infinity;
      for (const n of snap.nodes.values()) {
        const d = calculateDistance(lat, lng, n.lat, n.lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = n;
        }
      }
      if (nearest && nearestDist <= 50.0) {
        currentNodeId = nearest.nodeId;
      }
    }

    const debugNodes: DebugNode[] = [];
    const inBoxNodeIds = new Set<string>();
    for (const [nodeId, node] of snap.nodes.entries()) {
      if (
        node.lat >= minLat &&
        node.lat <= maxLat &&
        node.lng >= minLng &&
        node.lng <= maxLng
      ) {
        inBoxNodeIds.add(nodeId);
        debugNodes.push({
          canonicalNodeId: node.nodeId,
          coordinates: { latitude: node.lat, longitude: node.lng },
          kind: node.kind,
          status: node.image ? 'ok' : 'path_only',
          imageId: node.image?.imageId ?? null,
          streetNames: [...node.streetNames],
          sequenceId: node.image?.sequenceId ?? null,
        });
      }
    }

    const debugEdges: DebugEdge[] = [];
    for (const [pk, info] of snap.chosenPasses.entries()) {
      const chain = info.chain || [];
      if (
        chain.length >= 2 &&
        chain.some((n) => inBoxNodeIds.has(n.nodeId))
      ) {
        const u = chain[0];
        const v = chain[chain.length - 1];
        debugEdges.push({
          fromId: u.nodeId,
          toId: v.nodeId,
          bearing: compassBearing(u.lat, u.lng, v.lat, v.lng),
          lengthMeters: info.pathLen,
          streetName: snap.adjacentPairs.get(pk)?.streetName || '',
          polyline: chain.map((n) => ({ latitude: n.lat, longitude: n.lng })),
        });
      }
    }

    return {
      center: { latitude: lat, longitude: lng },
      radiusMeters: radiusM,
      currentNodeId,
      nodes: debugNodes,
      edges: debugEdges,
      queryAudit: queryAudit.snapshot(),
    };
  }
}
