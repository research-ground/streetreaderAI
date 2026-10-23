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

import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { clearAllClientCaches, queryAudit } from './client_cache';
import {
  ImageryProviderService,
  LocationMetadata,
} from './imagery_provider_service';
import { LocationProviderService } from './location_provider_service';
import {
  extractPoisFromOsmElements,
  osmPoiTileCache,
  OsmWayElement,
  RoadDataService,
} from './road_data_service';
import {
  AreaSnapshot,
  normStreet,
  pickSeed,
  placeNode,
  RoadNetwork,
  RouteProviderService,
} from './route_provider_service';

describe('5-Step RouteProvider Engine (Client-Side)', () => {
  const sampleWays: OsmWayElement[] = [
    {
      id: 100,
      nodes: [1, 2],
      tags: { name: 'N 34th St', highway: 'secondary' },
      geometry: [
        { lat: 47.649, lon: -122.351 },
        { lat: 47.649, lon: -122.35 },
      ],
    },
    {
      id: 101,
      nodes: [1, 3],
      tags: { name: 'Fremont Ave N', highway: 'secondary' },
      geometry: [
        { lat: 47.649, lon: -122.351 },
        { lat: 47.6498, lon: -122.351 },
      ],
    },
    {
      id: 102,
      nodes: [2, 4],
      tags: { name: 'Troll Ave N', highway: 'residential' },
      geometry: [
        { lat: 47.649, lon: -122.35 },
        { lat: 47.6498, lon: -122.35 },
      ],
    },
  ];

  const sequenceFrames: LocationMetadata[] = [
    {
      imageId: 'f1',
      coordinates: { latitude: 47.649, longitude: -122.351 },
      captureTime: '1000',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f2',
      coordinates: { latitude: 47.649, longitude: -122.35075 },
      captureTime: '1001',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f3',
      coordinates: { latitude: 47.649, longitude: -122.3505 },
      captureTime: '1002',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f4',
      coordinates: { latitude: 47.649, longitude: -122.35025 },
      captureTime: '1003',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f5',
      coordinates: { latitude: 47.649, longitude: -122.35 },
      captureTime: '1004',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
  ];

  beforeEach(() => {
    clearAllClientCaches();
    osmPoiTileCache.clear();
  });

  it('normalizes street names and strips leading house numbers', () => {
    expect(normStreet('601 N 34th St.')).toBe('north 34th street');
    expect(normStreet('Fremont Ave N')).toBe('fremont avenue north');
  });

  it('identifies intersections, slices sequences across blocks, and builds bidirectional chains', async () => {
    const rn = new RoadNetwork();
    rn.addWays(sampleWays);

    const snap = new AreaSnapshot(rn, sequenceFrames);
    await snap.solve();

    expect(snap.clusters.has(1)).toBe(true);
    expect(snap.clusters.has(2)).toBe(true);
    expect(snap.adjacentPairs.get('1:2')?.streetName).toBe('N 34th St');

    const node1 = await placeNode(snap, 'osm_1');
    const node2 = await placeNode(snap, 'osm_2');
    expect(node1).toBeTruthy();
    expect(node2).toBeTruthy();
    expect(node1?.image?.imageId).toBe('f1');
    expect(node2?.image?.imageId).toBe('f5');

    const linksFrom1 = snap.adj.get('osm_1') || [];
    expect(linksFrom1.length).toBe(1);
    expect(linksFrom1[0].streetName).toBe('N 34th St');

    // Walk the chain from osm_1 to osm_2
    const pass = snap.chosenPasses.get('1:2');
    expect(pass).toBeTruthy();
    const chainIds = (pass?.chain || []).map((n) => n.nodeId);
    expect(chainIds[0]).toBe('osm_1');
    expect(chainIds[chainIds.length - 1]).toBe('osm_2');
    expect(chainIds.length).toBeGreaterThanOrEqual(3);
  });

  it('picks a seed matching a street hint when available', async () => {
    const rn = new RoadNetwork();
    rn.addWays(sampleWays);
    const snap = new AreaSnapshot(rn, sequenceFrames);

    const seed = await pickSeed(snap, 47.649, -122.3505, '601 N 34th St');
    expect(seed).toBeTruthy();
    expect(seed?.place.image).toBeTruthy();
  });

  it('extracts node and building way POIs from OSM map.json elements and serves them from tile cache without extra HTTP calls', async () => {
    const rawElements: Record<string, unknown>[] = [
      { type: 'node', id: 10, lat: 47.6491, lon: -122.3508 },
      { type: 'node', id: 11, lat: 47.6493, lon: -122.3506 },
      {
        type: 'node',
        id: 20,
        lat: 47.64915,
        lon: -122.3505,
        tags: { name: 'Moment Coffee', amenity: 'cafe' },
      },
      {
        type: 'way',
        id: 30,
        nodes: [10, 11],
        tags: { name: 'PCC Community Markets', shop: 'supermarket' },
      },
      {
        type: 'way',
        id: 40,
        nodes: [10, 11],
        tags: { name: 'N 34th St', highway: 'secondary' },
      },
    ];

    const extracted = extractPoisFromOsmElements(rawElements);
    expect(extracted.length).toBe(2);
    expect(extracted.map((p) => p.name)).toEqual([
      'Moment Coffee',
      'PCC Community Markets',
    ]);

    // Populate the tile POI cache as OsmMapApiRoadSource does when loading road geometry
    osmPoiTileCache.put('tile1', {
      minLat: 47.645,
      minLng: -122.355,
      maxLat: 47.653,
      maxLng: -122.345,
      pois: extracted,
    });

    TestBed.configureTestingModule({});
    const locService = TestBed.inject(LocationProviderService);
    const res = await locService.getNearbyPlaces({
      lat: 47.64917,
      lng: -122.35046,
      radius: 100,
      heading: 270,
    });

    expect(res.places.length).toBe(2);
    expect(res.places[0].name).toBe('Moment Coffee');
    expect(res.places[0].relativePosition.depth).toBe('FRONT');
    // Zero external osm_nearby calls because the road tile cache covered it!
    expect(queryAudit.snapshot().external_calls['osm_nearby'] ?? 0).toBe(0);
    expect(queryAudit.snapshot().cache_hits['osm_nearby']).toBeGreaterThanOrEqual(1);
  });

  it('reuses the loaded OSM road tile snapshot across getPanoView, getLocalGraph, and adjacent movements', async () => {
    const fetchWaysSpy = vi
      .fn()
      .mockResolvedValue(sampleWays);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RoadDataService,
          useValue: { fetchWaysForTile: fetchWaysSpy },
        },
        {
          provide: ImageryProviderService,
          useValue: {
            providerName: 'panoramax',
            getMetadataBbox: vi.fn().mockResolvedValue(sequenceFrames),
            getSequence: vi.fn().mockResolvedValue(sequenceFrames),
            getImage: vi.fn().mockResolvedValue({
              image: 'base64jpeg',
              imageId: 'f1',
              actualHeading: 90,
            }),
          },
        },
      ],
    });

    const routeProvider = TestBed.inject(RouteProviderService);

    // 1. Initial landing at (47.6490, -122.3510)
    const view1 = await routeProvider.getPanoView({
      coordinates: { latitude: 47.649, longitude: -122.351 },
      heading: 90,
    });
    expect(view1.canonicalNodeId).toBe('osm_1');
    expect(fetchWaysSpy).toHaveBeenCalledTimes(1);

    // 2. RadarViewComponent requests local graph nearby
    const graph = await routeProvider.getLocalGraph(47.6495, -122.3505, 90);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(fetchWaysSpy).toHaveBeenCalledTimes(1);

    // 3. Stepping along the street block to the next node
    const nextLink = view1.links![0];
    const view2 = await routeProvider.getPanoView({
      canonicalNodeId: nextLink.canonicalNodeId,
      coordinates: nextLink.coordinates,
      heading: nextLink.heading,
    });
    expect(view2.status).toBe('ok');
    // Still only 1 OSM road tile fetch for the entire neighborhood session!
    expect(fetchWaysSpy).toHaveBeenCalledTimes(1);
  });
});
