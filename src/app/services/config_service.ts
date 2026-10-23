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

import { Injectable, computed, signal } from '@angular/core';
import { safeStorage } from './safe_storage';

export type ImageryProviderType = string;
export type LocationProviderType = string;
export type AiProviderType = string;

export type ImageryRetrievalType = 'sequence' | 'image';
export type ImageryFormatType = '360' | 'single';

export interface ImageryPluginConfig {
  name: string;
  retrievalType: ImageryRetrievalType;
  imageFormat: ImageryFormatType;
  requiresKey?: string;
  bboxUrl?: string;
  sequenceUrl?: string;
  pointUrl?: string;
  metadataUrl?: string;
  imageUrl?: string;
  itemsPath: string;
  idField: string[];
  latField: string[];
  lngField: string[];
  headingField: string[];
  captureTimeField: string[];
  sequenceField: string[];
  isPanoField: string[];
  fovField: string[];
  dimensionsField: string[];
  thumbUrlField: string[];
}

export interface LocationPluginConfig {
  name: string;
  requiresKey?: string;
  geocodeUrl: string;
  reverseGeocodeUrl: string;
  autocompleteUrl: string;
  nearbyUrl?: string;
  itemsPath: string;
  statusField?: string;
  statusOkValue?: string;
  latField: string[];
  lngField: string[];
  addressField: string[];
  streetField: string[];
  placeIdField: string[];
}

export interface AiPluginConfig {
  name: string;
  requiresKey?: string;
  wireFormat: 'gemini' | 'openai';
  modelId: string;
  endpointUrl: string;
}

export const DEFAULT_STARTING_ADDRESS = '601 N 34th St, Seattle, WA';
export const DEFAULT_PANORAMAX_BASE_URL = 'https://api.panoramax.xyz/api';
export const DEFAULT_MAPILLARY_BASE_URL = 'https://graph.mapillary.com';
export const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
export const DEFAULT_GOOGLE_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api';
export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3.8-flash';
export const DEFAULT_OPENAI_MODEL_ID = 'gpt-5.6-terra';

export const DEFAULT_STREETREADER_CONF = `
[system]
imagery_provider = panoramax
location_provider = osm
ai_provider = gemini
starting_address = 601 N 34th St, Seattle, WA
max_poi_items = 3

[keys]
gemini_api_key =
openai_api_key =
mapillary_token =
google_maps_api_key =

[imagery.panoramax]
retrieval_type = sequence
image_format = 360
bbox_url = https://api.panoramax.xyz/api/search?bbox={minLng},{minLat},{maxLng},{maxLat}&limit=500&filter=field_of_view=360
sequence_url = https://api.panoramax.xyz/api/collections/{sequenceId}/items?limit=500
metadata_url = https://api.panoramax.xyz/api/search?ids={imageId}&limit=1
items_path = features
id_field = id
lat_field = geometry.coordinates.1
lng_field = geometry.coordinates.0
heading_field = properties.view:azimuth
capture_time_field = properties.datetime, properties.datetimetz
sequence_field = collection
fov_field = properties.pers:interior_orientation.field_of_view
dimensions_field = properties.pers:interior_orientation.sensor_array_dimensions
thumb_url_field = assets.sd.href, assets.hd.href, properties.geovisio:image, assets.thumb.href

[imagery.mapillary]
retrieval_type = sequence
image_format = 360
requires_key = mapillary_token
bbox_url = https://graph.mapillary.com/images?access_token={apiKey}&bbox={minLng},{minLat},{maxLng},{maxLat}&fields=id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence&limit=500&is_pano=true
sequence_url = https://graph.mapillary.com/images?access_token={apiKey}&sequence_ids={sequenceId}&fields=id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence&limit=500&is_pano=true
metadata_url = https://graph.mapillary.com/{imageId}?access_token={apiKey}&fields=id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence,thumb_original_url,thumb_2048_url
items_path = data
id_field = id
lat_field = geometry.coordinates.1
lng_field = geometry.coordinates.0
heading_field = computed_compass_angle, compass_angle
capture_time_field = captured_at
sequence_field = sequence
is_pano_field = is_pano
thumb_url_field = thumb_original_url, thumb_2048_url

[location.osm]
geocode_url = https://nominatim.openstreetmap.org/search?q={address}&format=json&limit=1&addressdetails=1
reverse_geocode_url = https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json
autocomplete_url = https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=5
items_path =
lat_field = lat
lng_field = lon
address_field = display_name
street_field = address.road, address.pedestrian
place_id_field = place_id

[location.google]
requires_key = google_maps_api_key
geocode_url = https://maps.googleapis.com/maps/api/geocode/json?address={address}&key={apiKey}
reverse_geocode_url = https://maps.googleapis.com/maps/api/geocode/json?latlng={lat},{lng}&key={apiKey}
autocomplete_url = https://places.googleapis.com/v1/places:autocomplete
nearby_url = https://places.googleapis.com/v1/places:searchNearby
items_path = results
status_field = status
status_ok_value = OK
lat_field = geometry.location.lat
lng_field = geometry.location.lng
address_field = formatted_address
street_field =
place_id_field = place_id

[ai.gemini]
requires_key = gemini_api_key
wire_format = gemini
model_id = gemini-3.8-flash
endpoint_url = https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}

[ai.openai]
requires_key = openai_api_key
wire_format = openai
model_id = gpt-5.6-terra
endpoint_url = https://api.openai.com/v1/chat/completions
`.trim();

const STORAGE_KEYS = {
  startingAddress: 'streetreader_starting_address',
} as const;

export type ParsedConfSections = Record<string, Record<string, string>>;

export function parseConfIni(
  rawText: string,
  base?: ParsedConfSections
): ParsedConfSections {
  const sections: ParsedConfSections = {};
  if (base) {
    for (const [sec, kv] of Object.entries(base)) {
      sections[sec] = { ...kv };
    }
  }

  let currentSection = 'system';
  if (!sections[currentSection]) {
    sections[currentSection] = {};
  }

  const lines = String(rawText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim().toLowerCase();
      if (!sections[currentSection]) {
        sections[currentSection] = {};
      }
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    sections[currentSection][key] = val;
  }

  return sections;
}

function splitFieldList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getFieldByPath(
  obj: unknown,
  paths: string | readonly string[]
): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const list = typeof paths === 'string' ? splitFieldList(paths) : paths;
  for (const path of list) {
    if (!path) continue;
    const parts = path.split('.');
    let cur: unknown = obj;
    for (const part of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      if (Array.isArray(cur) && /^\d+$/.test(part)) {
        cur = cur[Number(part)];
      } else {
        cur = (cur as Record<string, unknown>)[part];
      }
    }
    if (cur !== undefined && cur !== null && cur !== '') {
      return cur;
    }
  }
  return undefined;
}

export function interpolateUrlTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const val = vars[key];
    return val !== undefined && val !== null
      ? encodeURIComponent(String(val))
      : '';
  });
}

function readInjectedEnv(key: string): string {
  try {
    const g = globalThis as Record<string, unknown>;
    const proc = g['process'] as { env?: Record<string, unknown> } | undefined;
    const fromProc = proc?.env?.[key];
    if (typeof fromProc === 'string' && fromProc.trim()) {
      return fromProc.trim();
    }
    const fromGlobal = g[`__STREETREADER_${key}__`];
    if (typeof fromGlobal === 'string' && fromGlobal.trim()) {
      return fromGlobal.trim();
    }
  } catch {
    // Ignore env read errors
  }
  return '';
}

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  private sections: ParsedConfSections = parseConfIni(DEFAULT_STREETREADER_CONF);
  private readonly imageryPlugins = new Map<string, ImageryPluginConfig>();
  private readonly locationPlugins = new Map<string, LocationPluginConfig>();
  private readonly aiPlugins = new Map<string, AiPluginConfig>();
  private readonly customKeys = new Map<string, string>();

  private readonly _envGeminiKey = signal<string>(
    readInjectedEnv('GEMINI_API_KEY') || readInjectedEnv('API_KEY')
  );
  private readonly _envGoogleMapsKey = signal<string>(
    readInjectedEnv('GOOGLE_MAPS_API_KEY')
  );
  private readonly _envOpenaiKey = signal<string>(
    readInjectedEnv('OPENAI_API_KEY')
  );
  private readonly _envMapillaryToken = signal<string>(
    readInjectedEnv('MAPILLARY_TOKEN')
  );

  private readonly _mapillaryToken = signal<string>('');
  private readonly _imageryProvider = signal<ImageryProviderType>('panoramax');
  private readonly _userLocationService = signal<LocationProviderType>('osm');
  private readonly _googleMapsApiKey = signal<string>('');
  private readonly _userAiProvider = signal<AiProviderType>('gemini');
  private readonly _geminiApiKey = signal<string>('');
  private readonly _openaiApiKey = signal<string>('');
  private readonly _startingAddress = signal<string>(
    this.loadString(STORAGE_KEYS.startingAddress, DEFAULT_STARTING_ADDRESS)
  );
  private readonly _maxPoiItems = signal<number>(3);

  /** True when Gemini is provided by the host environment (e.g., Google AI Studio). */
  readonly isGeminiLocked = computed(() => this._envGeminiKey().length > 0);

  /** True when Google Maps is provided by the host environment. */
  readonly isGoogleMapsLocked = computed(
    () => this._envGoogleMapsKey().length > 0
  );

  readonly imageryProvider = this._imageryProvider.asReadonly();
  readonly mapillaryToken = computed<string>(
    () => this._envMapillaryToken() || this._mapillaryToken()
  );

  readonly locationService = computed<LocationProviderType>(() =>
    this.isGoogleMapsLocked() ? 'google' : this._userLocationService()
  );

  readonly googleMapsApiKey = computed<string>(() =>
    this._envGoogleMapsKey() || this._googleMapsApiKey()
  );

  readonly aiProvider = computed<AiProviderType>(() =>
    this.isGeminiLocked() ? 'gemini' : this._userAiProvider()
  );

  readonly geminiApiKey = computed<string>(() =>
    this._envGeminiKey() || this._geminiApiKey()
  );

  readonly openaiApiKey = computed<string>(
    () => this._envOpenaiKey() || this._openaiApiKey()
  );
  readonly startingAddress = this._startingAddress.asReadonly();
  readonly maxPoiItems = this._maxPoiItems.asReadonly();

  readonly geminiModelId = DEFAULT_GEMINI_MODEL_ID;
  readonly openaiModelId = DEFAULT_OPENAI_MODEL_ID;

  constructor() {
    this.applyConfSections(this.sections);
  }

  /**
   * Loads `/streetreaderai.conf.example` as the default layer and merges
   * `/streetreaderai.conf` on top if present.
   */
  async loadConfig(): Promise<void> {
    let baseSections = parseConfIni(DEFAULT_STREETREADER_CONF);
    const exampleText = await this.fetchConfFile('/streetreaderai.conf.example');
    if (exampleText) {
      baseSections = parseConfIni(exampleText, baseSections);
    }
    const userText = await this.fetchConfFile('/streetreaderai.conf');
    if (userText) {
      baseSections = parseConfIni(userText, baseSections);
    }
    this.sections = baseSections;
    this.applyConfSections(this.sections);
  }

  /**
   * Applies raw `.conf` text directly (useful for testing custom provider configs).
   */
  applyConfText(rawConfText: string): void {
    this.sections = parseConfIni(rawConfText, parseConfIni(DEFAULT_STREETREADER_CONF));
    this.applyConfSections(this.sections);
  }

  private async fetchConfFile(path: string): Promise<string | null> {
    if (typeof fetch === 'undefined') return null;
    try {
      const resp = await fetch(path, { cache: 'no-store' });
      if (!resp.ok) return null;
      const text = await resp.text();
      const trimmed = text.trim();
      // Guard against SPA index.html fallback when an optional .local.conf does not exist
      if (
        !trimmed ||
        trimmed.startsWith('<!DOCTYPE') ||
        trimmed.startsWith('<html')
      ) {
        return null;
      }
      return text;
    } catch {
      return null;
    }
  }

  private applyConfSections(sections: ParsedConfSections): void {
    const sys = sections['system'] || {};
    const keys = sections['keys'] || {};

    if (sys['imagery_provider']) {
      this._imageryProvider.set(sys['imagery_provider'].trim());
    }

    if (sys['location_provider']) {
      this._userLocationService.set(sys['location_provider'].trim());
    }

    if (sys['ai_provider']) {
      this._userAiProvider.set(sys['ai_provider'].trim());
    }

    if (sys['starting_address'] && !safeStorage.getItem(STORAGE_KEYS.startingAddress)) {
      this._startingAddress.set(sys['starting_address'].trim());
    }

    if (sys['max_poi_items']) {
      const parsedMax = parseInt(sys['max_poi_items'], 10);
      if (!Number.isNaN(parsedMax) && parsedMax > 0) {
        this._maxPoiItems.set(parsedMax);
      }
    }

    this.customKeys.clear();
    this._geminiApiKey.set('');
    this._openaiApiKey.set('');
    this._mapillaryToken.set('');
    this._googleMapsApiKey.set('');

    for (const [k, v] of Object.entries(keys)) {
      const trimmed = (v || '').trim();
      if (!trimmed) continue;
      this.customKeys.set(k, trimmed);
      if (k === 'gemini_api_key') {
        this._geminiApiKey.set(trimmed);
      } else if (k === 'openai_api_key') {
        this._openaiApiKey.set(trimmed);
      } else if (k === 'mapillary_token' || k === 'mapillary_access_token') {
        this._mapillaryToken.set(trimmed);
      } else if (k === 'google_maps_api_key') {
        this._googleMapsApiKey.set(trimmed);
      }
    }

    this.imageryPlugins.clear();
    this.locationPlugins.clear();
    this.aiPlugins.clear();

    for (const [secName, sec] of Object.entries(sections)) {
      if (secName.startsWith('imagery.')) {
        const name = secName.slice('imagery.'.length);
        const retrievalType: ImageryRetrievalType =
          sec['retrieval_type'] === 'image' || sec['retrieval_type'] === 'single_image'
            ? 'image'
            : 'sequence';
        const imageFormat: ImageryFormatType =
          sec['image_format'] === 'single' || sec['image_format'] === 'directional'
            ? 'single'
            : '360';
        this.imageryPlugins.set(name, {
          name,
          retrievalType,
          imageFormat,
          requiresKey: sec['requires_key'] || undefined,
          bboxUrl: sec['bbox_url'] || undefined,
          sequenceUrl: sec['sequence_url'] || undefined,
          pointUrl: sec['point_url'] || undefined,
          metadataUrl: sec['metadata_url'] || undefined,
          imageUrl: sec['image_url'] || undefined,
          itemsPath: sec['items_path'] ?? '',
          idField: splitFieldList(sec['id_field'] || 'id'),
          latField: splitFieldList(sec['lat_field'] || 'lat'),
          lngField: splitFieldList(sec['lng_field'] || 'lng'),
          headingField: splitFieldList(sec['heading_field']),
          captureTimeField: splitFieldList(sec['capture_time_field']),
          sequenceField: splitFieldList(sec['sequence_field']),
          isPanoField: splitFieldList(sec['is_pano_field']),
          fovField: splitFieldList(sec['fov_field']),
          dimensionsField: splitFieldList(sec['dimensions_field']),
          thumbUrlField: splitFieldList(sec['thumb_url_field']),
        });
      } else if (secName.startsWith('location.')) {
        const name = secName.slice('location.'.length);
        this.locationPlugins.set(name, {
          name,
          requiresKey: sec['requires_key'] || undefined,
          geocodeUrl: sec['geocode_url'] || '',
          reverseGeocodeUrl: sec['reverse_geocode_url'] || '',
          autocompleteUrl: sec['autocomplete_url'] || '',
          nearbyUrl: sec['nearby_url'] || undefined,
          itemsPath: sec['items_path'] ?? '',
          statusField: sec['status_field'] || undefined,
          statusOkValue: sec['status_ok_value'] || undefined,
          latField: splitFieldList(sec['lat_field'] || 'lat'),
          lngField: splitFieldList(sec['lng_field'] || 'lon'),
          addressField: splitFieldList(sec['address_field'] || 'display_name'),
          streetField: splitFieldList(sec['street_field']),
          placeIdField: splitFieldList(sec['place_id_field'] || 'place_id'),
        });
      } else if (secName.startsWith('ai.')) {
        const name = secName.slice('ai.'.length);
        this.aiPlugins.set(name, {
          name,
          requiresKey: sec['requires_key'] || undefined,
          wireFormat: sec['wire_format'] === 'openai' ? 'openai' : 'gemini',
          modelId:
            sec['model_id'] ||
            (sec['wire_format'] === 'openai'
              ? DEFAULT_OPENAI_MODEL_ID
              : DEFAULT_GEMINI_MODEL_ID),
          endpointUrl: sec['endpoint_url'] || '',
        });
      }
    }
  }

  getKeyByName(keyName?: string): string {
    if (!keyName) return '';
    const norm = keyName.trim().toLowerCase();
    if (norm === 'gemini_api_key') return this.geminiApiKey();
    if (norm === 'openai_api_key') return this.openaiApiKey();
    if (norm === 'mapillary_token') return this.mapillaryToken();
    if (norm === 'google_maps_api_key') return this.googleMapsApiKey();
    return (
      this.customKeys.get(norm) ||
      readInjectedEnv(norm.toUpperCase()) ||
      ''
    );
  }

  getImageryPlugin(name?: string): ImageryPluginConfig | undefined {
    return this.imageryPlugins.get((name || this.imageryProvider()).toLowerCase());
  }

  getLocationPlugin(name?: string): LocationPluginConfig | undefined {
    return this.locationPlugins.get((name || this.locationService()).toLowerCase());
  }

  getAiPlugin(name?: string): AiPluginConfig | undefined {
    return this.aiPlugins.get((name || this.aiProvider()).toLowerCase());
  }

  /**
   * Validates that all required keys for the active configured providers are present.
   * Returns an error message string if a required key is missing, or `null` if valid.
   */
  validateRequiredKeys(): string | null {
    const missing: string[] = [];

    const aiPlugin = this.getAiPlugin();
    if (!aiPlugin) {
      missing.push(`Unknown AI provider "${this.aiProvider()}" in streetreaderai.conf`);
    } else if (aiPlugin.requiresKey && !this.getKeyByName(aiPlugin.requiresKey)) {
      missing.push(
        `${aiPlugin.requiresKey} (required by [ai.${aiPlugin.name}])`
      );
    }

    const imgPlugin = this.getImageryPlugin();
    if (!imgPlugin) {
      missing.push(
        `Unknown imagery provider "${this.imageryProvider()}" in streetreaderai.conf`
      );
    } else if (imgPlugin.requiresKey && !this.getKeyByName(imgPlugin.requiresKey)) {
      missing.push(
        `${imgPlugin.requiresKey} (required by [imagery.${imgPlugin.name}])`
      );
    }

    const locPlugin = this.getLocationPlugin();
    if (!locPlugin) {
      missing.push(
        `Unknown location provider "${this.locationService()}" in streetreaderai.conf`
      );
    } else if (locPlugin.requiresKey && !this.getKeyByName(locPlugin.requiresKey)) {
      missing.push(
        `${locPlugin.requiresKey} (required by [location.${locPlugin.name}])`
      );
    }

    if (missing.length === 0) {
      return null;
    }

    return `Missing required API key configuration: ${missing.join(', ')}. Please configure it in streetreaderai.conf.`;
  }

  private loadString(key: string, fallback: string): string {
    const val = safeStorage.getItem(key);
    return val !== null && val.trim() !== '' ? val.trim() : fallback;
  }

  setStartingAddress(address: string): void {
    const trimmed = address.trim() || DEFAULT_STARTING_ADDRESS;
    this._startingAddress.set(trimmed);
    safeStorage.setItem(STORAGE_KEYS.startingAddress, trimmed);
  }

  hasActiveAiKey(): boolean {
    const aiPlugin = this.getAiPlugin();
    if (!aiPlugin?.requiresKey) return true;
    return this.getKeyByName(aiPlugin.requiresKey).length > 0;
  }

  hasActiveImageryConfig(): boolean {
    const imgPlugin = this.getImageryPlugin();
    if (!imgPlugin?.requiresKey) return true;
    return this.getKeyByName(imgPlugin.requiresKey).length > 0;
  }

  hasActiveLocationConfig(): boolean {
    const locPlugin = this.getLocationPlugin();
    if (!locPlugin?.requiresKey) return true;
    return this.getKeyByName(locPlugin.requiresKey).length > 0;
  }
}
