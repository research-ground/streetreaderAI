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

  it('defaults to panoramax, osm, and gemini from built-in streetreaderai.conf defaults', () => {
    const service = TestBed.inject(ConfigService);
    expect(service.imageryProvider()).toBe('panoramax');
    expect(service.locationService()).toBe('osm');
    expect(service.aiProvider()).toBe('gemini');
    expect(service.geminiModelId).toBe(DEFAULT_GEMINI_MODEL_ID);
    expect(service.openaiModelId).toBe(DEFAULT_OPENAI_MODEL_ID);
    expect(service.startingAddress()).toBe(DEFAULT_STARTING_ADDRESS);
    expect(service.hasActiveImageryConfig()).toBe(true);
    expect(service.hasActiveLocationConfig()).toBe(true);
    expect(service.hasActiveAiKey()).toBe(false);
    expect(service.validateRequiredKeys()).toContain('gemini_api_key');
  });

  it('detects host environment keys (e.g. Google AI Studio) and satisfies required key validation', () => {
    const g = globalThis as Record<string, unknown>;
    g['__STREETREADER_GEMINI_API_KEY__'] = 'AIzaHostGeminiKey';
    g['__STREETREADER_GOOGLE_MAPS_API_KEY__'] = 'AIzaHostMapsKey';

    try {
      const service = new ConfigService();

      expect(service.isGeminiLocked()).toBe(true);
      expect(service.aiProvider()).toBe('gemini');
      expect(service.geminiApiKey()).toBe('AIzaHostGeminiKey');
      expect(service.hasActiveAiKey()).toBe(true);

      expect(service.isGoogleMapsLocked()).toBe(true);
      expect(service.locationService()).toBe('google');
      expect(service.googleMapsApiKey()).toBe('AIzaHostMapsKey');
      expect(service.hasActiveLocationConfig()).toBe(true);

      expect(service.validateRequiredKeys()).toBeNull();
    } finally {
      delete g['__STREETREADER_GEMINI_API_KEY__'];
      delete g['__STREETREADER_GOOGLE_MAPS_API_KEY__'];
    }
  });

  it('parses streetreaderai.conf sections ([system], [keys], [imagery.*], [location.*], [ai.*]) and validates keys', () => {
    const service = TestBed.inject(ConfigService);

    service.applyConfText(`
[system]
imagery_provider = custom_point
location_provider = custom_loc
ai_provider = custom_ai
max_poi_items = 5

[keys]
custom_ai_key = sk-custom-ai
custom_imagery_key = CustomImgKey123
custom_loc_key = CustomLocKey456

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

[location.custom_loc]
requires_key = custom_loc_key
geocode_url = https://example.com/geocode?q={address}&key={apiKey}
reverse_geocode_url = https://example.com/rev?lat={lat}&lng={lng}&key={apiKey}
autocomplete_url = https://example.com/auto?q={query}&key={apiKey}
items_path = data.items
lat_field = coords.lat
lng_field = coords.lng
address_field = label

[ai.custom_ai]
requires_key = custom_ai_key
wire_format = openai
model_id = gpt-5.6-terra
endpoint_url = https://example.com/v1/chat/completions
    `);

    expect(service.imageryProvider()).toBe('custom_point');
    expect(service.locationService()).toBe('custom_loc');
    expect(service.aiProvider()).toBe('custom_ai');
    expect(service.maxPoiItems()).toBe(5);
    expect(service.validateRequiredKeys()).toBeNull();

    const imgPlugin = service.getImageryPlugin('custom_point');
    expect(imgPlugin?.retrievalType).toBe('image');
    expect(imgPlugin?.imageFormat).toBe('single');
    expect(imgPlugin?.idField).toEqual(['pano_id']);

    const locPlugin = service.getLocationPlugin('custom_loc');
    expect(locPlugin?.itemsPath).toBe('data.items');
    expect(locPlugin?.latField).toEqual(['coords.lat']);

    const aiPlugin = service.getAiPlugin('custom_ai');
    expect(aiPlugin?.wireFormat).toBe('openai');
    expect(aiPlugin?.modelId).toBe('gpt-5.6-terra');
  });

  it('reports missing keys when an active provider in streetreaderai.conf lacks its required key', () => {
    const service = TestBed.inject(ConfigService);
    service.applyConfText(`
[system]
imagery_provider = mapillary
location_provider = google
ai_provider = openai

[keys]
openai_api_key =
mapillary_token =
google_maps_api_key =
    `);

    const err = service.validateRequiredKeys();
    expect(err).toContain('openai_api_key (required by [ai.openai])');
    expect(err).toContain('mapillary_token (required by [imagery.mapillary])');
    expect(err).toContain('google_maps_api_key (required by [location.google])');
  });
});
