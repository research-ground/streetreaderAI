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

import { Component, inject, signal, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../services/api_service';
import { StateService } from '../../services/state_service';
import { DescriptionService } from '../../services/description_service';
import { DescriptionCacheService } from '../../services/description_cache_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { StreetViewLinksService } from '../../services/street_view_links_service';
import { Subscription, Subject, takeUntil, debounce, timer, of } from 'rxjs';

@Component({
  selector: 'app-scene-description',
  standalone: true,
  imports: [CommonModule, MatProgressBarModule],
  templateUrl: './scene_description.html',
  styleUrl: './scene_description.css',
})
export class SceneDescriptionComponent implements OnDestroy {
  private apiService = inject(ApiService);
  private stateService = inject(StateService);
  private descriptionService = inject(DescriptionService);
  private cache = inject(DescriptionCacheService);
  private speechOutputService = inject(SpeechOutputService);
  private streetViewLinksService = inject(StreetViewLinksService);
  private subscription: Subscription;
  private destroy$ = new Subject<void>();
  private currentFetch$ = new Subject<void>();

  protected description = computed(() => this.stateService.state().description);
  protected isLoading = signal<boolean>(false);
  
  protected availableDirections = computed(() => {
    const heading = this.stateService.currentHeading();
    const nodes = this.stateService.state().adjacentNodes;
    return this.streetViewLinksService.getAvailableDirections(heading, nodes);
  });

  constructor() {
    this.subscription = this.descriptionService.refreshNeeded$
      .pipe(
        debounce((force) => {
          this.currentFetch$.next();
          return force ? of(0) : timer(250);
        }),
      )
      .subscribe((force) => {
        this.fetchDescription(force);
      });

    this.descriptionService.cancel$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.currentFetch$.next();
      this.isLoading.set(false);
    });
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    this.speechOutputService.stop();
    this.currentFetch$.next();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private fetchDescription(force: boolean = false) {
    // Cancel any previous pending request
    this.currentFetch$.next();

    const loc = this.stateService.currentLocation();
    const heading = this.stateService.currentHeading();
    const image = this.stateService.currentImage();
    const autoDescribe = this.stateService.autoDescribe();

    // Reset description to ensure change detection for screen readers
    this.stateService.setMetadata({ description: null });

    // 1. Check cache first if not forced
    if (!force) {
      const cachedDescription = this.cache.get(loc.lat, loc.lng, heading, loc.imageId);
      if (cachedDescription) {
        this.processDescription(cachedDescription, true);
        return;
      }
    }

    // 2. If no cache and not auto-describing (and not a forced refresh), 
    // we stop here and tell the user no description is available yet.
    if (!force && !autoDescribe) {
      this.processDescription('No description available.', false);
      return;
    }

    // 3. If forced or auto-describing, we need an image to fetch a new one
    if (!image) {
      this.processDescription('No description available.', false);
      return;
    }

    this.isLoading.set(true);
    
    this.apiService.describeImage(image)
      .pipe(takeUntil(this.currentFetch$))
      .subscribe({
        next: (response) => {
          if (response && response.description) {
            this.cache.set(loc.lat, loc.lng, heading, response.description, loc.imageId);
            this.processDescription(response.description, false);
          } else {
            this.processDescription('Could not generate a description for this view.', false);
          }
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Error fetching description:', err);
          const msg =
            err instanceof Error && err.message.includes('API Key is not configured')
              ? err.message
              : 'An error occurred while fetching the description.';
          this.processDescription(msg, false);
          this.isLoading.set(false);
        }
      });
  }

  private processDescription(baseDesc: string, isCached: boolean) {
    let finalDesc = baseDesc;
    
    const directions = this.availableDirections();
    if (directions.length > 0) {
      const moveOptions = directions.filter(d => ['forward', 'backward'].includes(d));
      if (moveOptions.length > 0) {
        finalDesc += ` You can move ${moveOptions.join(' and ')}.`;
      }
      
      const sidePaths = [];
      if (directions.includes('paths to the left')) sidePaths.push('left');
      if (directions.includes('paths to the right')) sidePaths.push('right');
      
      if (sidePaths.length > 0) {
        finalDesc += ` There are also paths to the ${sidePaths.join(' and ')}.`;
      }
    }

    this.stateService.setMetadata({ description: finalDesc + (isCached ? ' (cached)' : '') });
    this.speechOutputService.speak(finalDesc);
  }
}
