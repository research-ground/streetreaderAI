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

import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UiComponentState } from '../../services/ui_service';
import { AdjacentLinksComponent } from '../adjacent_links/adjacent_links';
import { SceneDescriptionComponent } from '../scene_description/scene_description';
import { NavigationComponent } from '../navigation/navigation';
import { PoiListComponent } from '../poi_list/poi_list';
import { ChatComponent } from '../chat/chat';
import { DemoChatComponent, DemoModeService, DemoNavigationComponent } from '../../demo_mode';

@Component({
  selector: 'app-palette',
  standalone: true,
  imports: [CommonModule, MatExpansionModule, MatButtonModule, MatIconModule, AdjacentLinksComponent, SceneDescriptionComponent, NavigationComponent, PoiListComponent, ChatComponent, DemoNavigationComponent, DemoChatComponent],
  template: `
    <div class="floating-palette" [ngClass]="side + '-palette'">
      <mat-accordion multi>
        @for (comp of components; track comp.id; let i = $index) {
          <mat-expansion-panel [expanded]="true" class="palette-panel" role="region" [attr.aria-label]="getDisplayName(comp.id)">
            <mat-expansion-panel-header>
              <mat-panel-title>{{ getDisplayName(comp.id) }}</mat-panel-title>
            </mat-expansion-panel-header>
            
            <div class="palette-content">
              @if (comp.id === 'navigation') {
                @if (demoService.enabled()) {
                  <app-demo-navigation></app-demo-navigation>
                } @else {
                  <app-navigation></app-navigation>
                }
              } @else if (comp.id === 'scene_description') {
                <app-scene-description></app-scene-description>
              } @else if (comp.id === 'adjacent_links') {
                <app-adjacent-links></app-adjacent-links>
              } @else if (comp.id === 'poi_list') {
                <app-poi-list></app-poi-list>
              } @else if (comp.id === 'chat') {
                @if (demoService.enabled()) {
                  <app-demo-chat></app-demo-chat>
                } @else {
                  <app-chat></app-chat>
                }
              } @else {
                <p>Content for {{ comp.id }}</p>
              }
            </div>
          </mat-expansion-panel>
        }
      </mat-accordion>
    </div>
  `,
  styles: [`
    .floating-palette {
      position: absolute;
      top: 12px;
      width: 320px;
      z-index: 5;
    }
    .left-palette { left: 12px; }
    .right-palette { right: 12px; }
    .palette-panel {
      background: rgba(255, 255, 255, 0.9) !important;
      backdrop-filter: blur(4px);
      margin-bottom: 4px;
    }
    .palette-content { padding: 0; }
    mat-panel-title {
      font-weight: 500;
      font-size: 14px;
    }
    ::ng-deep .mat-expansion-panel-body {
      padding: 0 12px 12px 12px !important;
    }
    ::ng-deep .mat-expansion-panel-header {
      height: 36px !important;
      padding: 0 12px !important;
    }
  `]
})
export class PaletteComponent {
  protected demoService = inject(DemoModeService);
  @Input() components: UiComponentState[] = [];
  @Input() side: 'left' | 'right' = 'left';

  protected getDisplayName(id: string): string {
    const names: Record<string, string> = {
      'navigation': 'Navigation',
      'scene_description': 'Scene Description',
      'adjacent_links': 'Adjacent Panoramas',
      'poi_list': 'Points of Interest',
      'chat': 'Chat & AI Controls'
    };
    return names[id] || id;
  }
}
