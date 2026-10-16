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

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DemoModeService } from './demo_mode_service';
import { DemoLocation } from './demo_config';

@Component({
  selector: 'app-demo-navigation',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="demo-nav-container" role="region" aria-label="Demo preset locations">
      <div class="demo-hint">
        Press number keys <strong>1&ndash;4</strong> or click a location:
      </div>
      <div class="demo-location-list">
        @for (loc of demoService.locations; track loc.id) {
          <button
            type="button"
            class="demo-loc-btn"
            [class.active]="demoService.activeLocation().id === loc.id"
            (click)="selectLocation(loc)"
            [attr.aria-label]="'Key ' + loc.key + ': ' + loc.title + ', ' + loc.subtitle">
            <span class="key-badge" aria-hidden="true">{{ loc.key }}</span>
            <span class="loc-text">
              <span class="loc-title">{{ loc.title }}</span>
              <span class="loc-sub">{{ loc.subtitle }}</span>
            </span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .demo-nav-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 4px;
    }
    .demo-hint {
      font-size: 12px;
      color: #475569;
    }
    .demo-location-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .demo-loc-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .demo-loc-btn:hover {
      background: #eff6ff;
      border-color: #60a5fa;
    }
    .demo-loc-btn.active {
      background: #dbeafe;
      border-color: #2563eb;
    }
    .key-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
      border-radius: 4px;
      background: #1e293b;
      color: #ffffff;
      font-family: monospace;
      font-weight: 700;
      font-size: 13px;
    }
    .demo-loc-btn.active .key-badge {
      background: #1d4ed8;
    }
    .loc-text {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .loc-title {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .loc-sub {
      font-size: 11px;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `],
})
export class DemoNavigationComponent {
  protected demoService = inject(DemoModeService);

  protected selectLocation(loc: DemoLocation): void {
    this.demoService.selectLocation(loc);
  }
}
