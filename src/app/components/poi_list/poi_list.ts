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

import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { StateService } from '../../services/state_service';
import { NearbyPlace } from '../../services/api_service';

@Component({
  selector: 'app-poi-list',
  standalone: true,
  imports: [CommonModule, MatListModule, MatIconModule],
  templateUrl: './poi_list.html',
  styleUrl: './poi_list.css',
})
export class PoiListComponent {
  private stateService = inject(StateService);
  protected pois = computed(() =>
    this.stateService.state().nearbyPOIs.slice(0, this.stateService.maxPoiItems())
  );

  protected getRelativePosition(poi: NearbyPlace): string {
    if (!poi.relativePosition) return 'unknown position';
    const { side, depth } = poi.relativePosition;
    return `${depth} ${side}`.toLowerCase();
  }

  protected getIcon(types: string[]): string {
    if (types.includes('restaurant') || types.includes('food')) return 'restaurant';
    if (types.includes('park')) return 'park';
    if (types.includes('store')) return 'shopping_cart';
    if (types.includes('bus_station') || types.includes('transit_station')) return 'directions_bus';
    if (types.includes('landmark')) return 'account_balance';
    return 'place';
  }
}
