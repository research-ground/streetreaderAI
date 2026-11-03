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
import { safeStorage } from './safe_storage';

export interface CachedDescriptionEntry {
  description: string;
  suggestedQuestions?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class DescriptionCacheService {
  private readonly PREFIX = 'streetreader_desc_';

  private getKey(lat: number, lng: number, heading: number, imageId?: string | null): string {
    // Round heading to nearest 45 degrees to handle minor variations
    const snappedHeading = ((Math.round(heading / 45) * 45) % 360 + 360) % 360;
    if (imageId) {
      return `${this.PREFIX}img:${imageId}:${snappedHeading}`;
    }
    return `${this.PREFIX}${lat.toFixed(4)}:${lng.toFixed(4)}:${snappedHeading}`;
  }

  getEntry(lat: number, lng: number, heading: number, imageId?: string | null): CachedDescriptionEntry | null {
    const raw = safeStorage.getItem(this.getKey(lat, lng, heading, imageId));
    if (!raw) return null;
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.description === 'string') {
          return {
            description: parsed.description,
            suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
              ? parsed.suggestedQuestions
              : undefined,
          };
        }
      } catch {
        // Fall through to legacy plain-string handling
      }
    }
    return { description: raw };
  }

  get(lat: number, lng: number, heading: number, imageId?: string | null): string | null {
    return this.getEntry(lat, lng, heading, imageId)?.description ?? null;
  }

  set(
    lat: number,
    lng: number,
    heading: number,
    description: string,
    imageId?: string | null,
    suggestedQuestions?: string[]
  ): void {
    const payload =
      suggestedQuestions && suggestedQuestions.length > 0
        ? JSON.stringify({ description, suggestedQuestions })
        : description;
    safeStorage.setItem(this.getKey(lat, lng, heading, imageId), payload);
  }

  clear(): void {
    safeStorage.keys().forEach(key => {
      if (key.startsWith(this.PREFIX)) {
        safeStorage.removeItem(key);
      }
    });
  }
}
