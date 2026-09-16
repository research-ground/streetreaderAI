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
import { Link } from './api_service';

export interface IntersectionInfo {
  isIntersection: boolean;
  streets: {
    name: string;
    directions: string[];
  }[];
}

@Injectable({
  providedIn: 'root',
})
export class StreetViewLinksService {
  /** Return the link whose heading is closest to `targetHeading` (within 45°). */
  findBestNode(targetHeading: number, adjacentNodes: Link[]): Link | null {
    return this.closestWithin(targetHeading, adjacentNodes, 45);
  }

  /** Forward movement follows the road around bends (user spec, 2026-07-12):
   * if no path lies in the front 45° slice but one lies in the adjacent slice
   * (a slight turn, under 90°), take it — the user's facing then turns along
   * the road via the link's arrival heading. Two options → smallest turn. */
  findForwardNode(targetHeading: number, adjacentNodes: Link[]): Link | null {
    return (
      this.closestWithin(targetHeading, adjacentNodes, 45) ??
      this.closestWithin(targetHeading, adjacentNodes, 90)
    );
  }

  private closestWithin(targetHeading: number, adjacentNodes: Link[], maxDiff: number): Link | null {
    let bestNode: Link | null = null;
    let minAngleDiff = maxDiff;

    for (const node of adjacentNodes) {
      let angleDiff = Math.abs(targetHeading - node.heading);
      if (angleDiff > 180) angleDiff = 360 - angleDiff;
      if (angleDiff < minAngleDiff) {
        minAngleDiff = angleDiff;
        bestNode = node;
      }
    }
    return bestNode;
  }

  /** Directions relative to the user's current heading (front/back/left/right) that
   * have at least one outgoing link. */
  getAvailableDirections(currentHeading: number, adjacentNodes: Link[]): string[] {
    const directions = new Set<string>();
    const threshold = 45;

    for (const node of adjacentNodes) {
      const diff = (node.heading - currentHeading + 360) % 360;
      if (diff <= threshold || diff >= 360 - threshold) directions.add('forward');
      else if (diff > threshold && diff < 90 - threshold) directions.add('front-right');
      else if (diff >= 90 - threshold && diff <= 90 + threshold) directions.add('right');
      else if (diff > 90 + threshold && diff < 180 - threshold) directions.add('back-right');
      else if (diff >= 180 - threshold && diff <= 180 + threshold) directions.add('backward');
      else if (diff > 180 + threshold && diff < 270 - threshold) directions.add('back-left');
      else if (diff >= 270 - threshold && diff <= 270 + threshold) directions.add('left');
      else if (diff > 270 + threshold && diff < 360 - threshold) directions.add('front-left');
    }

    const result: string[] = [];
    if (directions.has('forward')) result.push('forward');
    if (directions.has('backward')) result.push('backward');
    if (['left', 'front-left', 'back-left'].some((d) => directions.has(d))) result.push('paths to the left');
    if (['right', 'front-right', 'back-right'].some((d) => directions.has(d))) result.push('paths to the right');
    return result;
  }

  analyzeIntersection(currentHeading: number, links: Link[]): IntersectionInfo {
    const validLinks = links.filter((l) => l.streetName && l.streetName !== 'Unknown');
    if (validLinks.length === 0) {
      return { isIntersection: false, streets: [] };
    }

    const streetMap = new Map<string, Link[]>();
    for (const link of validLinks) {
      const name = this.cleanStreetName(link.streetName!);
      if (!streetMap.has(name)) streetMap.set(name, []);
      streetMap.get(name)!.push(link);
    }

    const isIntersection = streetMap.size > 1;
    const streets = Array.from(streetMap.entries()).map(([name, streetLinks]) => ({
      name,
      directions: this.getAvailableDirections(currentHeading, streetLinks),
    }));
    return { isIntersection, streets };
  }

  private cleanStreetName(name: string): string {
    if (!name || name === 'Unknown') return 'Unnamed street';
    let cleaned = name.split(',')[0].trim();
    cleaned = cleaned.replace(/^\d+\s+/, '');
    if (!cleaned || /^\d+$/.test(cleaned)) return 'Unnamed street';
    return cleaned;
  }
}
