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
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { StateService } from '../../services/state_service';
import { ApiService, DebugEdge, DebugNode, LocalGraphResponse } from '../../services/api_service';

interface Projected {
  cx: number;
  cy: number;
}

@Component({
  selector: 'app-debug-panel',
  standalone: true,
  imports: [CommonModule, MatListModule, MatIconModule, MatDividerModule],
  template: `
    <!-- Radar / graph view -->
    <div style="margin-bottom: 16px; border: 1px solid #ccc; border-radius: 4px; padding: 12px; text-align: center; background: #fafafa;">
      <div style="font-weight: 500; margin-bottom: 8px; color: #555;">
        Local Graph &mdash; {{ viewport() }}m radius &nbsp;<span style="color:#888">(N &uarr;)</span>
      </div>
      <svg width="240" height="240" viewBox="0 0 240 240" style="background: white; border: 1px solid #ddd; border-radius: 4px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
        <!-- crosshair -->
        <line x1="120" y1="0" x2="120" y2="240" stroke="#f0f0f0" stroke-width="1" />
        <line x1="0" y1="120" x2="240" y2="120" stroke="#f0f0f0" stroke-width="1" />

        <!-- canonical edges -->
        <g *ngFor="let edge of graphEdges()">
          <line
            [attr.x1]="edge.p1.cx" [attr.y1]="edge.p1.cy"
            [attr.x2]="edge.p2.cx" [attr.y2]="edge.p2.cy"
            stroke="#bbb" stroke-width="2" />
        </g>

        <!-- canonical nodes -->
        <g *ngFor="let n of graphNodes()">
          <ng-container *ngIf="n.kind === 'intersection'">
            <rect [attr.x]="n.pos.cx - 4" [attr.y]="n.pos.cy - 4" width="8" height="8"
                  [attr.fill]="statusFill(n.status)" stroke="#333" stroke-width="1" />
          </ng-container>
          <ng-container *ngIf="n.kind !== 'intersection'">
            <circle [attr.cx]="n.pos.cx" [attr.cy]="n.pos.cy" r="3.5"
                    [attr.fill]="statusFill(n.status)" stroke="#333" stroke-width="0.5" />
          </ng-container>
        </g>

        <!-- adjacency vectors from current node -->
        <g *ngFor="let link of adjacentLinks()">
          <line x1="120" y1="120"
                [attr.x2]="120 + Math.sin(link.heading * Math.PI / 180) * viewScale() * (link.distanceMeters || 10)"
                [attr.y2]="120 - Math.cos(link.heading * Math.PI / 180) * viewScale() * (link.distanceMeters || 10)"
                [attr.stroke]="link.status === 'ok' ? '#5b3fdd' : '#c69224'"
                stroke-width="2" stroke-dasharray="4,3" />
        </g>

        <!-- heading cone -->
        <polygon
          [attr.points]="'120,120 ' + (120 + Math.sin((currentHeading() - 25) * Math.PI / 180) * 40) + ',' + (120 - Math.cos((currentHeading() - 25) * Math.PI / 180) * 40) + ' ' + (120 + Math.sin((currentHeading() + 25) * Math.PI / 180) * 40) + ',' + (120 - Math.cos((currentHeading() + 25) * Math.PI / 180) * 40)"
          fill="rgba(33, 150, 243, 0.35)" />

        <!-- user pin -->
        <circle cx="120" cy="120" r="7" fill="#2196f3" stroke="white" stroke-width="2" />
      </svg>
      <div style="margin-top: 8px; font-size: 0.78em; color: #555; text-align: left;">
        <span style="display: inline-block; width: 10px; height: 10px; background: #4caf50; border: 1px solid #333;"></span> imagery
        &nbsp;<span style="display: inline-block; width: 10px; height: 10px; background: #ffb74d; border: 1px solid #333;"></span> path only
        &nbsp;<span style="display: inline-block; width: 10px; height: 10px; background: #bdbdbd; border: 1px solid #333;"></span> not resolved
        &nbsp;&nbsp;<span style="display: inline-block; width: 10px; height: 10px; background: #4caf50; border: 1px solid #333;"></span> circle=waypoint
        &nbsp;<span style="display: inline-block; width: 10px; height: 10px; background: #4caf50; border: 1px solid #333; transform: rotate(45deg);"></span> square=intersection
      </div>
    </div>

    <mat-list dense>
      <div mat-subheader>Current Location</div>
      <mat-list-item>
        <mat-icon matListItemIcon>my_location</mat-icon>
        <div matListItemTitle>Coordinates</div>
        <div matListItemLine>{{ currentLat() | number:'1.5-5' }}, {{ currentLng() | number:'1.5-5' }}</div>
      </mat-list-item>
      <mat-list-item>
        <mat-icon matListItemIcon>place</mat-icon>
        <div matListItemTitle>Canonical Node</div>
        <div matListItemLine style="font-family: monospace;">{{ canonicalNodeId() || '(none)' }}</div>
      </mat-list-item>
      <mat-list-item>
        <mat-icon matListItemIcon>explore</mat-icon>
        <div matListItemTitle>Heading</div>
        <div matListItemLine>{{ currentHeading() | number:'1.0-1' }}&deg;</div>
      </mat-list-item>
      <mat-list-item>
        <mat-icon matListItemIcon>image</mat-icon>
        <div matListItemTitle>Image ID ({{ locationStatus() }})</div>
        <div matListItemLine style="font-family: monospace;">{{ imageId() || 'None' }}</div>
      </mat-list-item>
    </mat-list>

    <mat-divider></mat-divider>

    <mat-list dense>
      <div mat-subheader>Adjacent Links ({{ adjacentLinks().length }})</div>
      <mat-list-item *ngFor="let link of adjacentLinks()">
        <mat-icon matListItemIcon>{{ link.status === 'ok' ? 'moving' : 'block' }}</mat-icon>
        <div matListItemTitle>
          {{ link.heading | number:'1.0-0' }}&deg; ({{ link.distanceMeters | number:'1.1-1' }}m away)
          <span *ngIf="link.status === 'path_only'" style="color: #b26a00; font-style: italic; font-size: 0.9em;"> — no imagery</span>
        </div>
        <div matListItemLine style="font-family: monospace; font-size: 0.85em; color: #666;">
          {{ link.streetName || '(unnamed)' }} &nbsp;&rarr;&nbsp; {{ link.canonicalNodeId }}
        </div>
      </mat-list-item>
      <mat-list-item *ngIf="adjacentLinks().length === 0">
        <div matListItemLine style="font-style: italic; color: #777;">No adjacent links.</div>
      </mat-list-item>
    </mat-list>

    <mat-divider></mat-divider>

    <mat-list dense>
      <div mat-subheader>Local Graph ({{ graphNodes().length }} nodes / {{ graphEdges().length }} edges)</div>
      <mat-list-item>
        <div matListItemLine>
          {{ okCount() }} with imagery &middot; {{ pathOnlyCount() }} path-only &middot; {{ unknownCount() }} not resolved
        </div>
      </mat-list-item>
    </mat-list>

    <mat-divider></mat-divider>

    <mat-list dense>
      <div mat-subheader>Nearby Places ({{ nearbyPOIs().length }})</div>
      <mat-list-item *ngFor="let poi of nearbyPOIs() | slice:0:5">
        <mat-icon matListItemIcon>place</mat-icon>
        <div matListItemTitle>{{ poi.name }}</div>
        <div matListItemLine>{{ poi.relativePosition?.depth }} {{ poi.relativePosition?.side }}</div>
      </mat-list-item>
      <mat-list-item *ngIf="nearbyPOIs().length === 0">
        <div matListItemLine style="font-style: italic; color: #777;">No places nearby.</div>
      </mat-list-item>
    </mat-list>
  `,
})
export class DebugPanelComponent {
  private stateService = inject(StateService);
  private apiService = inject(ApiService);

  protected currentHeading = computed(() => this.stateService.state().heading);
  protected currentLat = computed(() => this.stateService.state().location.lat);
  protected currentLng = computed(() => this.stateService.state().location.lng);
  protected imageId = computed(() => this.stateService.state().location.imageId);
  protected canonicalNodeId = computed(() => this.stateService.state().location.canonicalNodeId);
  protected locationStatus = computed(() => this.stateService.state().location.status ?? 'unknown');
  protected adjacentLinks = computed(() => this.stateService.state().adjacentNodes);
  protected nearbyPOIs = computed(() => this.stateService.state().nearbyPOIs);

  protected Math = Math;
  protected viewport = signal(80);          // meters covered by the radar's half-width
  protected localGraph = signal<LocalGraphResponse | null>(null);

  protected viewScale = computed(() => 100 / this.viewport());

  protected graphNodes = computed(() => {
    const g = this.localGraph();
    if (!g) return [];
    return g.nodes.map((n) => ({ ...n, pos: this.project(n.coordinates.latitude, n.coordinates.longitude) }));
  });

  protected graphEdges = computed(() => {
    const g = this.localGraph();
    if (!g) return [];
    const byId = new Map(g.nodes.map((n) => [n.canonicalNodeId, n]));
    const edges: { p1: Projected; p2: Projected }[] = [];
    for (const e of g.edges) {
      const a = byId.get(e.fromId);
      const b = byId.get(e.toId);
      if (!a || !b) continue;
      edges.push({
        p1: this.project(a.coordinates.latitude, a.coordinates.longitude),
        p2: this.project(b.coordinates.latitude, b.coordinates.longitude),
      });
    }
    return edges;
  });

  protected okCount = computed(() => this.localGraph()?.nodes.filter((n) => n.status === 'ok').length ?? 0);
  protected pathOnlyCount = computed(() => this.localGraph()?.nodes.filter((n) => n.status === 'path_only').length ?? 0);
  protected unknownCount = computed(() => this.localGraph()?.nodes.filter((n) => n.status === 'unknown').length ?? 0);

  private lastFetchKey = '';

  constructor() {
    // Refresh the graph whenever we land at a new canonical node.
    effect(() => {
      const nodeId = this.canonicalNodeId();
      const lat = this.currentLat();
      const lng = this.currentLng();
      const key = `${nodeId}:${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!nodeId || key === this.lastFetchKey) return;
      this.lastFetchKey = key;
      this.apiService.getLocalGraph({ lat, lng, radiusMeters: this.viewport() }).subscribe({
        next: (res) => this.localGraph.set(res),
        error: (err) => console.warn('getLocalGraph failed:', err),
      });
    });
  }

  protected statusFill(status: string): string {
    switch (status) {
      case 'ok': return '#4caf50';
      case 'path_only': return '#ffb74d';
      default: return '#bdbdbd';
    }
  }

  private project(lat: number, lng: number): Projected {
    const cLat = this.currentLat();
    const cLng = this.currentLng();
    // East-north offsets in metres relative to user.
    const dyM = (lat - cLat) * 111320;
    const dxM = (lng - cLng) * 111320 * Math.cos((cLat * Math.PI) / 180);
    const s = this.viewScale();
    return { cx: 120 + dxM * s, cy: 120 - dyM * s };
  }
}
