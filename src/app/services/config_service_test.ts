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

  it('locks Gemini and Google Maps when injected by the host environment (e.g. AI Studio)', () => {
    const g = globalThis as Record<string, unknown>;
    g['__STREETREADER_GEMINI_API_KEY__'] = 'AIzaHostGeminiKey';
    g['__STREETREADER_GOOGLE_MAPS_API_KEY__'] = 'AIzaHostMapsKey';

    try {
      const service = new ConfigService();

      expect(service.isGeminiLocked()).toBe(true);
      expect(service.aiProvider()).toBe('gemini');
      expect(service.geminiApiKey()).toBe('AIzaHostGeminiKey');
      expect(service.hasActiveAiKey()).toBe(true);

      // Attempting to change locked AI provider or Gemini key should be ignored
      service.setAiProvider('openai');
      service.setGeminiApiKey('user-override-attempt');
      expect(service.aiProvider()).toBe('gemini');
      expect(service.geminiApiKey()).toBe('AIzaHostGeminiKey');

      expect(service.isGoogleMapsLocked()).toBe(true);
      expect(service.locationService()).toBe('google');
      expect(service.googleMapsApiKey()).toBe('AIzaHostMapsKey');
      expect(service.hasActiveLocationConfig()).toBe(true);

      // Attempting to change locked Location provider or Google Maps key should be ignored
      service.setLocationService('osm');
      service.setGoogleMapsApiKey('user-override-attempt');
      expect(service.locationService()).toBe('google');
      expect(service.googleMapsApiKey()).toBe('AIzaHostMapsKey');
    } finally {
      delete g['__STREETREADER_GEMINI_API_KEY__'];
      delete g['__STREETREADER_GOOGLE_MAPS_API_KEY__'];
    }
  });

  it('parses streetreaderai.conf sections including retrieval_type and image_format and validates required keys', () => {
    const service = TestBed.inject(ConfigService);
    expect(service.validateRequiredKeys()).toContain('gemini_api_key');

    service.applyConfText(`
[system]
imagery_provider = custom_point
location_provider = osm
ai_provider = gemini
max_poi_items = 5

[keys]
gemini_api_key = AIzaTestGeminiKey
custom_imagery_key = CustomKey123

[imagery.custom_point]
retrieval_type = image
image_format = single
requires_key = custom_imagery_key
point_url = https://example.com/meta?lat={lat}&lng={lng}&r={radius}&key={apiKey}
metadata_url = https://example.com/meta?id={imageId}&key={apiKey}
image_url = https://example.com/img?id={imageId}&h={heading}&p={pitch}&key={apiKey}
id_field = pano_id
lat_field = location.lat
lng_field = location.lng
capture_time_field = date
    `);

    expect(service.imageryProvider()).toBe('custom_point');
    expect(service.maxPoiItems()).toBe(5);
    expect(service.validateRequiredKeys()).toBeNull();

    const plugin = service.getImageryPlugin('custom_point');
    expect(plugin).toBeTruthy();
    expect(plugin?.retrievalType).toBe('image');
    expect(plugin?.imageFormat).toBe('single');
    expect(plugin?.idField).toEqual(['pano_id']);
  });
});
