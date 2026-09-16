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
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { StateService } from '../../services/state_service';

@Component({
  selector: 'app-adjacent-links',
  standalone: true,
  imports: [CommonModule, MatListModule, MatCardModule],
  templateUrl: './adjacent_links.html',
  styleUrl: './adjacent_links.css',
})
export class AdjacentLinksComponent {
  protected stateService = inject(StateService);
  protected links = computed(() => this.stateService.state().adjacentNodes);
}
