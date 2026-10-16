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

import { Injectable, signal } from '@angular/core';

export type UiComponentId = 'navigation' | 'poi_list' | 'adjacent_links' | 'scene_description' | 'chat';
export type Side = 'left' | 'right';

export interface UiComponentState {
  id: UiComponentId;
  visible: boolean;
  side: Side;
  order: number;
}

@Injectable({
  providedIn: 'root'
})
export class UiService {
  // Initial state for UI components
  private componentsState = signal<Record<UiComponentId, UiComponentState>>({
    navigation: { id: 'navigation', visible: true, side: 'left', order: 0 },
    'scene_description': { id: 'scene_description', visible: true, side: 'left', order: 1 },
    'poi_list': { id: 'poi_list', visible: false, side: 'right', order: 2 },
    'adjacent_links': { id: 'adjacent_links', visible: false, side: 'right', order: 3 },
    chat: { id: 'chat', visible: true, side: 'right', order: 4 }
  });

  readonly state = this.componentsState.asReadonly();

  toggleVisibility(id: UiComponentId) {
    this.componentsState.update((s) => ({
      ...s,
      [id]: { ...s[id], visible: !s[id].visible }
    }));
  }

  setVisibility(id: UiComponentId, visible: boolean) {
    this.componentsState.update((s) => ({
      ...s,
      [id]: { ...s[id], visible }
    }));
  }

  moveSide(id: UiComponentId, side: Side) {
    this.componentsState.update((s) => ({
      ...s,
      [id]: { ...s[id], side }
    }));
  }

  getComponentsBySide(side: Side) {
    return Object.values(this.componentsState())
      .filter((c) => c.side === side && c.visible)
      .sort((a, b) => a.order - b.order);
  }
}