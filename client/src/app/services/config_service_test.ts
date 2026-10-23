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

import { TestBed } from '@angular/core/testing';
import {
  ConfigService,
  DEFAULT_GEMINI_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  DEFAULT_PANORAMAX_BASE_URL,
  DEFAULT_STARTING_ADDRESS,
} from './config_service';
import { safeStorage } from './safe_storage';

describe('ConfigService', () => {
  beforeEach(() => {
    safeStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    safeStorage.clear();
  });

  it('defaults to panoramax, osm, and gemini when localStorage is empty', () => {
    const service = TestBed.inject(ConfigService);
    expect(service.imageryProvider()).toBe('panoramax');
    expect(service.panoramaxBaseUrl()).toBe(DEFAULT_PANORAMAX_BASE_URL);
    expect(service.locationService()).toBe('osm');
    expect(service.aiProvider()).toBe('gemini');
    expect(service.geminiModelId).toBe(DEFAULT_GEMINI_MODEL_ID);
    expect(service.openaiModelId).toBe(DEFAULT_OPENAI_MODEL_ID);
    expect(service.startingAddress()).toBe(DEFAULT_STARTING_ADDRESS);
    expect(service.hasActiveImageryConfig()).toBe(true);
    expect(service.hasActiveAiKey()).toBe(false);
  });

  it('persists provider selections and API keys in localStorage', () => {
    const service = TestBed.inject(ConfigService);

    service.setImageryProvider('mapillary');
    expect(service.imageryProvider()).toBe('mapillary');
    expect(service.hasActiveImageryConfig()).toBe(false);

    service.setMapillaryToken('  MLY|test-token-123  ');
    expect(service.mapillaryToken()).toBe('MLY|test-token-123');
    expect(localStorage.getItem('streetreader_mapillary_token')).toBe(
      'MLY|test-token-123'
    );
    expect(service.hasActiveImageryConfig()).toBe(true);

    service.setLocationService('google');
    service.setGoogleMapsApiKey('AIzaGoogleKey');
    expect(service.locationService()).toBe('google');
    expect(service.googleMapsApiKey()).toBe('AIzaGoogleKey');

    service.setGeminiApiKey('AIzaGeminiKey');
    expect(service.hasActiveAiKey()).toBe(true);

    service.setAiProvider('openai');
    expect(service.hasActiveAiKey()).toBe(false);
    service.setOpenaiApiKey('sk-test-openai');
    expect(service.hasActiveAiKey()).toBe(true);
  });

  it('locks Gemini and Google Maps when provided by the key-sharing proxy', () => {
    const service = TestBed.inject(ConfigService);

    service.setAiProvider('openai');
    service.setLocationService('osm');
    expect(service.aiProvider()).toBe('openai');
    expect(service.locationService()).toBe('osm');

    service.applyProxyStatus({ gemini: true, googleMaps: true });

    expect(service.isGeminiLocked()).toBe(true);
    expect(service.useGeminiProxy()).toBe(true);
    expect(service.aiProvider()).toBe('gemini');
    expect(service.hasActiveAiKey()).toBe(true);

    // Attempting to change locked AI provider or Gemini key should be ignored
    service.setAiProvider('openai');
    service.setGeminiApiKey('user-override-attempt');
    expect(service.aiProvider()).toBe('gemini');
    expect(service.geminiApiKey()).toBe('');

    expect(service.isGoogleMapsLocked()).toBe(true);
    expect(service.useGoogleMapsProxy()).toBe(true);
    expect(service.locationService()).toBe('google');
    expect(service.hasActiveLocationConfig()).toBe(true);

    // Attempting to change locked Location provider or Google Maps key should be ignored
    service.setLocationService('osm');
    service.setGoogleMapsApiKey('user-override-attempt');
    expect(service.locationService()).toBe('google');
    expect(service.googleMapsApiKey()).toBe('');
  });
});
