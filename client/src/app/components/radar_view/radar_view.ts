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

import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StateService } from '../../services/state_service';
import { ApiService, LocalGraphResponse } from '../../services/api_service';
import { Subscription } from 'rxjs';

interface Projected {
  cx: number;
  cy: number;
}

@Component({
  selector: 'app-radar-view',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="radar-card" aria-hidden="true">
      <svg width="200" height="200" viewBox="0 0 240 240" class="radar-svg">
        <!-- Range rings & cardinal crosshairs -->
        <circle cx="120" cy="120" r="50" fill="none" stroke="rgba(148, 163, 184, 0.14)" stroke-width="1" stroke-dasharray="2,2" />
        <circle cx="120" cy="120" r="100" fill="none" stroke="rgba(148, 163, 184, 0.14)" stroke-width="1" stroke-dasharray="2,2" />
        <line x1="120" y1="0" x2="120" y2="240" stroke="rgba(148, 163, 184, 0.10)" stroke-width="1" />
        <line x1="0" y1="120" x2="240" y2="120" stroke="rgba(148, 163, 184, 0.10)" stroke-width="1" />

        <!-- Solved street block polylines -->
        <g *ngFor="let edge of graphEdges()">
          <polyline
            [attr.points]="edge.pointsAttr"
            fill="none"
            stroke="rgba(14, 165, 233, 0.35)"
            stroke-width="7"
            stroke-linecap="round"
            stroke-linejoin="round" />
          <polyline
            [attr.points]="edge.pointsAttr"
            fill="none"
            stroke="#38bdf8"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round" />
        </g>

        <!-- Immediate outgoing links from current node -->
        <g *ngFor="let link of adjacentLinks()">
          <line x1="120" y1="120"
                [attr.x2]="120 + Math.sin(link.heading * Math.PI / 180) * viewScale * (link.distanceMeters || 10)"
                [attr.y2]="120 - Math.cos(link.heading * Math.PI / 180) * viewScale * (link.distanceMeters || 10)"
                stroke="#7dd3fc"
                stroke-width="2.4"
                stroke-dasharray="4,2" />
        </g>

        <!-- Graph nodes (intersections & sequence waypoints) -->
        <g *ngFor="let n of graphNodes()">
          <rect *ngIf="n.kind === 'intersection'"
                [attr.x]="n.pos.cx - 4.5"
                [attr.y]="n.pos.cy - 4.5"
                width="9"
                height="9"
                [attr.transform]="'rotate(45 ' + n.pos.cx + ' ' + n.pos.cy + ')'"
                [attr.fill]="n.status === 'ok' ? '#fbbf24' : '#64748b'"
                stroke="#0f172a"
                stroke-width="1.3" />
          <circle *ngIf="n.kind !== 'intersection'"
                  [attr.cx]="n.pos.cx"
                  [attr.cy]="n.pos.cy"
                  r="3.4"
                  [attr.fill]="n.status === 'ok' ? '#22d3ee' : '#64748b'"
                  stroke="#0f172a"
                  stroke-width="1" />
        </g>

        <!-- GSV-style directional camera FOV cone -->
        <polygon
          [attr.points]="'120,120 ' + (120 + Math.sin((currentHeading() - 28) * Math.PI / 180) * 42) + ',' + (120 - Math.cos((currentHeading() - 28) * Math.PI / 180) * 42) + ' ' + (120 + Math.sin((currentHeading() + 28) * Math.PI / 180) * 42) + ',' + (120 - Math.cos((currentHeading() + 28) * Math.PI / 180) * 42)"
          fill="rgba(250, 204, 21, 0.32)" />

        <!-- User position marker -->
        <circle cx="120" cy="120" r="6" fill="#facc15" stroke="#ffffff" stroke-width="2" />

        <!-- North indicator -->
        <text x="120" y="15" text-anchor="middle" fill="#94a3b8" font-size="11" font-weight="700" font-family="sans-serif">N</text>
      </svg>
    </div>
  `,
  styles: [`
    .radar-card {
      position: absolute;
      bottom: 12px;
      right: 12px;
      z-index: 5;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 10px;
      padding: 6px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
      pointer-events: none;
      user-select: none;
    }
    .radar-svg {
      display: block;
      background: #0b1120;
      border-radius: 7px;
      border: 1px solid rgba(51, 65, 85, 0.8);
    }
  `],
})
export class RadarViewComponent {
  private stateService = inject(StateService);
  private apiService = inject(ApiService);

  protected currentHeading = computed(() => this.stateService.state().heading);
  protected currentLat = computed(() => this.stateService.state().location.lat);
  protected currentLng = computed(() => this.stateService.state().location.lng);
  protected canonicalNodeId = computed(() => this.stateService.state().location.canonicalNodeId);
  protected adjacentLinks = computed(() => this.stateService.state().adjacentNodes);

  protected Math = Math;
  protected readonly radiusMeters = 90;
  protected readonly viewScale = 100 / this.radiusMeters;
  protected localGraph = signal<LocalGraphResponse | null>(null);

  protected graphNodes = computed(() => {
    const g = this.localGraph();
    if (!g) return [];
    return g.nodes.map((n) => ({
      ...n,
      pos: this.project(n.coordinates.latitude, n.coordinates.longitude),
    }));
  });

  protected graphEdges = computed(() => {
    const g = this.localGraph();
    if (!g) return [];
    const byId = new Map(g.nodes.map((n) => [n.canonicalNodeId, n]));
    const edges: { pointsAttr: string }[] = [];
    for (const e of g.edges) {
      let pts: Projected[] = [];
      if (e.polyline && e.polyline.length >= 2) {
        pts = e.polyline.map((p) => this.project(p.latitude, p.longitude));
      } else {
        const a = byId.get(e.fromId);
        const b = byId.get(e.toId);
        if (!a || !b) continue;
        pts = [
          this.project(a.coordinates.latitude, a.coordinates.longitude),
          this.project(b.coordinates.latitude, b.coordinates.longitude),
        ];
      }
      edges.push({
        pointsAttr: pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' '),
      });
    }
    return edges;
  });

  private lastFetchKey = '';
  private graphSub?: Subscription;

  constructor() {
    effect(() => {
      const nodeId = this.canonicalNodeId();
      const lat = this.currentLat();
      const lng = this.currentLng();
      const key = `${nodeId}:${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!nodeId || key === this.lastFetchKey) return;
      this.lastFetchKey = key;
      this.graphSub?.unsubscribe();
      this.graphSub = this.apiService
        .getLocalGraph({ lat, lng, radiusMeters: this.radiusMeters })
        .subscribe({
          next: (res) => this.localGraph.set(res),
          error: (err) => console.warn('getLocalGraph failed:', err),
        });
    });
  }

  private project(lat: number, lng: number): Projected {
    const cLat = this.currentLat();
    const cLng = this.currentLng();
    const dyM = (lat - cLat) * 111320;
    const dxM = (lng - cLng) * 111320 * Math.cos((cLat * Math.PI) / 180);
    return { cx: 120 + dxM * this.viewScale, cy: 120 - dyM * this.viewScale };
  }
}
