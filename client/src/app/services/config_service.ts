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

export type ImageryProviderType = 'mapillary' | 'panoramax';
export type LocationProviderType = 'osm' | 'google';
export type AiProviderType = 'gemini' | 'openai';

export const DEFAULT_STARTING_ADDRESS = '601 N 34th St, Seattle, WA';
export const DEFAULT_PANORAMAX_BASE_URL = 'https://api.panoramax.xyz/api';
export const DEFAULT_MAPILLARY_BASE_URL = 'https://graph.mapillary.com';
export const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
export const DEFAULT_GOOGLE_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api';
export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3.8-flash';
export const DEFAULT_OPENAI_MODEL_ID = 'gpt-5.6-terra';

const STORAGE_KEYS = {
  imageryProvider: 'streetreader_imagery_provider',
  mapillaryToken: 'streetreader_mapillary_token',
  panoramaxBaseUrl: 'streetreader_panoramax_base_url',
  locationService: 'streetreader_location_service',
  googleMapsApiKey: 'streetreader_google_maps_api_key',
  aiProvider: 'streetreader_ai_provider',
  geminiApiKey: 'streetreader_gemini_api_key',
  openaiApiKey: 'streetreader_openai_api_key',
  startingAddress: 'streetreader_starting_address',
} as const;

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  private readonly _mapillaryToken = signal<string>(
    this.loadString(STORAGE_KEYS.mapillaryToken, '')
  );
  private readonly _imageryProvider = signal<ImageryProviderType>(
    this.loadImageryProvider()
  );
  private readonly _panoramaxBaseUrl = signal<string>(
    this.loadString(STORAGE_KEYS.panoramaxBaseUrl, DEFAULT_PANORAMAX_BASE_URL)
  );
  private readonly _locationService = signal<LocationProviderType>(
    this.loadEnum<LocationProviderType>(
      STORAGE_KEYS.locationService,
      ['osm', 'google'],
      'osm'
    )
  );
  private readonly _googleMapsApiKey = signal<string>(
    this.loadString(STORAGE_KEYS.googleMapsApiKey, '')
  );
  private readonly _aiProvider = signal<AiProviderType>(
    this.loadEnum<AiProviderType>(
      STORAGE_KEYS.aiProvider,
      ['gemini', 'openai'],
      'gemini'
    )
  );
  private readonly _geminiApiKey = signal<string>(
    this.loadString(STORAGE_KEYS.geminiApiKey, '')
  );
  private readonly _openaiApiKey = signal<string>(
    this.loadString(STORAGE_KEYS.openaiApiKey, '')
  );
  private readonly _startingAddress = signal<string>(
    this.loadString(STORAGE_KEYS.startingAddress, DEFAULT_STARTING_ADDRESS)
  );

  readonly imageryProvider = this._imageryProvider.asReadonly();
  readonly mapillaryToken = this._mapillaryToken.asReadonly();
  readonly panoramaxBaseUrl = this._panoramaxBaseUrl.asReadonly();
  readonly locationService = this._locationService.asReadonly();
  readonly googleMapsApiKey = this._googleMapsApiKey.asReadonly();
  readonly aiProvider = this._aiProvider.asReadonly();
  readonly geminiApiKey = this._geminiApiKey.asReadonly();
  readonly openaiApiKey = this._openaiApiKey.asReadonly();
  readonly startingAddress = this._startingAddress.asReadonly();

  readonly geminiModelId = DEFAULT_GEMINI_MODEL_ID;
  readonly openaiModelId = DEFAULT_OPENAI_MODEL_ID;

  private loadImageryProvider(): ImageryProviderType {
    const saved = localStorage.getItem(STORAGE_KEYS.imageryProvider);
    if (saved === 'mapillary' || saved === 'panoramax') {
      return saved;
    }
    const token = this.loadString(STORAGE_KEYS.mapillaryToken, '');
    return token ? 'mapillary' : 'panoramax';
  }

  private loadString(key: string, fallback: string): string {
    const val = localStorage.getItem(key);
    return val !== null && val.trim() !== '' ? val.trim() : fallback;
  }

  private loadEnum<T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T
  ): T {
    const val = localStorage.getItem(key) as T | null;
    return val && allowed.includes(val) ? val : fallback;
  }

  setImageryProvider(provider: ImageryProviderType): void {
    this._imageryProvider.set(provider);
    localStorage.setItem(STORAGE_KEYS.imageryProvider, provider);
  }

  setMapillaryToken(token: string): void {
    const trimmed = token.trim();
    this._mapillaryToken.set(trimmed);
    localStorage.setItem(STORAGE_KEYS.mapillaryToken, trimmed);
  }

  setPanoramaxBaseUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '') || DEFAULT_PANORAMAX_BASE_URL;
    this._panoramaxBaseUrl.set(trimmed);
    localStorage.setItem(STORAGE_KEYS.panoramaxBaseUrl, trimmed);
  }

  setLocationService(service: LocationProviderType): void {
    this._locationService.set(service);
    localStorage.setItem(STORAGE_KEYS.locationService, service);
  }

  setGoogleMapsApiKey(key: string): void {
    const trimmed = key.trim();
    this._googleMapsApiKey.set(trimmed);
    localStorage.setItem(STORAGE_KEYS.googleMapsApiKey, trimmed);
  }

  setAiProvider(provider: AiProviderType): void {
    this._aiProvider.set(provider);
    localStorage.setItem(STORAGE_KEYS.aiProvider, provider);
  }

  setGeminiApiKey(key: string): void {
    const trimmed = key.trim();
    this._geminiApiKey.set(trimmed);
    localStorage.setItem(STORAGE_KEYS.geminiApiKey, trimmed);
  }

  setOpenaiApiKey(key: string): void {
    const trimmed = key.trim();
    this._openaiApiKey.set(trimmed);
    localStorage.setItem(STORAGE_KEYS.openaiApiKey, trimmed);
  }

  setStartingAddress(address: string): void {
    const trimmed = address.trim() || DEFAULT_STARTING_ADDRESS;
    this._startingAddress.set(trimmed);
    localStorage.setItem(STORAGE_KEYS.startingAddress, trimmed);
  }

  hasActiveAiKey(): boolean {
    return this._aiProvider() === 'gemini'
      ? this._geminiApiKey().length > 0
      : this._openaiApiKey().length > 0;
  }

  hasActiveImageryConfig(): boolean {
    return this._imageryProvider() === 'panoramax' || this._mapillaryToken().length > 0;
  }
}
