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

import { LocationMetadata } from './imagery_provider_service';
import { OsmWayElement } from './road_data_service';
import {
  AreaSnapshot,
  normStreet,
  pickSeed,
  placeNode,
  RoadNetwork,
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
});
