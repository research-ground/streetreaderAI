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

import { Injectable, inject } from '@angular/core';
import {
  AutocompleteItem,
  AutocompleteResponse,
  GetNearbyPlacesResponse,
  NearbyPlace,
  RelativePosition,
} from './api_service';
import { metadataCache, queryAudit } from './client_cache';
import {
  ConfigService,
  DEFAULT_GOOGLE_MAPS_BASE_URL,
  DEFAULT_NOMINATIM_BASE_URL,
} from './config_service';
import {
  DEFAULT_OVERPASS_ENDPOINTS,
  extractPoisFromOsmElements,
  OSM_MAP_API_URL,
  OsmPoiItem,
  osmPoiTileCache,
} from './road_data_service';

export interface GeocodeResult {
  lat: number;
  lng: number;
  address: string;
  street?: string | null;
}

export const M_PER_DEG_LAT = 111139.0;

export function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = Math.PI / 180;
  const dLon = (lng2 - lng1) * toRad;
  const rLat1 = lat1 * toRad;
  const rLat2 = lat2 * toRad;
  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  const dx =
    (lng2 - lng1) * M_PER_DEG_LAT * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

export function getRelativePosition(
  camLat: number,
  camLng: number,
  camHeading: number,
  poiLat: number,
  poiLng: number
): RelativePosition {
  const poiBearing = calculateBearing(camLat, camLng, poiLat, poiLng);
  const diff = ((((poiBearing - camHeading + 180) % 360) + 360) % 360) - 180;
  return {
    side: diff > 0 ? 'RIGHT' : 'LEFT',
    depth: Math.abs(diff) < 90 ? 'FRONT' : 'BEHIND',
  };
}

@Injectable({
  providedIn: 'root',
})
export class LocationProviderService {
  private readonly config = inject(ConfigService);

  async geocode(address: string): Promise<GeocodeResult | null> {
    return this.config.locationService() === 'google'
      ? this.googleGeocode(address)
      : this.osmGeocode(address);
  }

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    return this.config.locationService() === 'google'
      ? this.googleReverseGeocode(lat, lng)
      : this.osmReverseGeocode(lat, lng);
  }

  async autocomplete(
    query: string,
    sessionToken?: string
  ): Promise<AutocompleteResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { suggestions: [] };
    }
    const suggestions =
      this.config.locationService() === 'google'
        ? await this.googleAutocomplete(trimmed, sessionToken)
        : await this.osmAutocomplete(trimmed);
    return { suggestions };
  }

  async getNearbyPlaces(params: {
    lat: number;
    lng: number;
    radius?: number;
    heading?: number;
  }): Promise<GetNearbyPlacesResponse> {
    const radius = params.radius ?? 100;
    const heading = params.heading ?? 0;
    const rawPlaces =
      this.config.locationService() === 'google'
        ? await this.googleNearbySearch(params.lat, params.lng, radius)
        : await this.osmNearbySearch(params.lat, params.lng, radius);

    const places: NearbyPlace[] = [];
    for (const p of rawPlaces) {
      const rel = getRelativePosition(
        params.lat,
        params.lng,
        heading,
        p.lat,
        p.lng
      );
      places.push({
        name: p.name,
        vicinity: p.vicinity,
        location: { latitude: p.lat, longitude: p.lng },
        types: p.types,
        relativePosition: rel,
      });
    }
    return { places };
  }

  // =====================================================================
  // OpenStreetMap (Nominatim + Overpass)
  // =====================================================================

  private async osmGeocode(address: string): Promise<GeocodeResult | null> {
    const norm = address.trim().toLowerCase();
    const cacheKey = `nominatim:fwd:${DEFAULT_NOMINATIM_BASE_URL}:${norm}`;
    const cached = metadataCache.get(cacheKey) as GeocodeResult | undefined;
    if (cached) {
      queryAudit.recordCacheHit('nominatim');
      return cached;
    }

    const url = new URL(`${DEFAULT_NOMINATIM_BASE_URL}/search`);
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');

    try {
      queryAudit.recordExternal('nominatim_fwd', norm);
      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (resp.status === 429) {
        throw new Error(
          'OpenStreetMap rate limit exceeded. Please wait a few moments before trying again.'
        );
      }
      if (!resp.ok) return null;
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        const details = first.address || {};
        const res: GeocodeResult = {
          lat: Number(first.lat),
          lng: Number(first.lon),
          address: String(first.display_name || address),
          street: details.road || details.pedestrian || null,
        };
        metadataCache.put(cacheKey, res);
        return res;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('rate limit')) {
        throw e;
      }
    }
    return null;
  }

  private async osmReverseGeocode(
    lat: number,
    lng: number
  ): Promise<string | null> {
    const cacheKey = `nominatim:rev:${DEFAULT_NOMINATIM_BASE_URL}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const cached = metadataCache.get(cacheKey) as
      | { formatted_address?: string }
      | undefined;
    if (cached?.formatted_address) {
      queryAudit.recordCacheHit('nominatim');
      return cached.formatted_address;
    }

    const url = new URL(`${DEFAULT_NOMINATIM_BASE_URL}/reverse`);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('format', 'json');

    try {
      queryAudit.recordExternal(
        'nominatim_rev',
        `${lat.toFixed(5)},${lng.toFixed(5)}`
      );
      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data?.display_name) {
        const formatted = String(data.display_name);
        metadataCache.put(cacheKey, { formatted_address: formatted });
        return formatted;
      }
    } catch {
      // Ignore reverse geocode errors
    }
    return null;
  }

  private async osmAutocomplete(query: string): Promise<AutocompleteItem[]> {
    const norm = query.trim().toLowerCase();
    if (norm.length < 3) return [];
    const cacheKey = `nominatim:auto:${DEFAULT_NOMINATIM_BASE_URL}:${norm}`;
    const cached = metadataCache.get(cacheKey) as AutocompleteItem[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('nominatim');
      return cached;
    }

    const url = new URL(`${DEFAULT_NOMINATIM_BASE_URL}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    try {
      queryAudit.recordExternal('nominatim_auto', norm);
      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      if (Array.isArray(data)) {
        const items = data.map((p: Record<string, unknown>) => ({
          description: String(p['display_name'] ?? ''),
          placeId: String(p['place_id'] ?? ''),
        }));
        metadataCache.put(cacheKey, items);
        return items;
      }
    } catch {
      // Ignore autocomplete errors
    }
    return [];
  }

  private async osmNearbySearch(
    lat: number,
    lng: number,
    radius: number
  ): Promise<OsmPoiItem[]> {
    const cacheKey = `osm:nearby:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
    const cached = metadataCache.get(cacheKey) as OsmPoiItem[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('osm_nearby');
      return cached;
    }

    const dLat = radius / M_PER_DEG_LAT;
    const dLng =
      radius / (M_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180.0), 0.1));

    // 1. Check if an already-loaded OSM v0.6 road tile covers this radius
    for (const tile of osmPoiTileCache.values()) {
      if (
        lat - dLat >= tile.minLat &&
        lat + dLat <= tile.maxLat &&
        lng - dLng >= tile.minLng &&
        lng + dLng <= tile.maxLng
      ) {
        queryAudit.recordCacheHit('osm_nearby');
        const nearby = tile.pois
          .map((p) => ({
            poi: p,
            dist: calculateDistance(lat, lng, p.lat, p.lng),
          }))
          .filter((item) => item.dist <= radius)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 20)
          .map((item) => item.poi);
        metadataCache.put(cacheKey, nearby);
        return nearby;
      }
    }

    // 2. Fetch directly from the official OpenStreetMap v0.6 /api/0.6/map.json endpoint
    const minLat = lat - dLat * 1.25;
    const maxLat = lat + dLat * 1.25;
    const minLng = lng - dLng * 1.25;
    const maxLng = lng + dLng * 1.25;
    try {
      const url = new URL(OSM_MAP_API_URL);
      url.searchParams.set('bbox', `${minLng},${minLat},${maxLng},${maxLat}`);
      queryAudit.recordExternal(
        'osm_nearby',
        `${lat.toFixed(4)},${lng.toFixed(4)}:${radius}`
      );
      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (resp.ok) {
        const payload = await resp.json();
        const elements: Record<string, unknown>[] = Array.isArray(
          payload?.elements
        )
          ? payload.elements
          : [];
        const allPois = extractPoisFromOsmElements(elements);
        const nearby = allPois
          .map((p) => ({
            poi: p,
            dist: calculateDistance(lat, lng, p.lat, p.lng),
          }))
          .filter((item) => item.dist <= radius)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 20)
          .map((item) => item.poi);
        metadataCache.put(cacheKey, nearby);
        return nearby;
      }
    } catch {
      // Fall back to Overpass mirrors below
    }

    // 3. Fallback to Overpass API mirrors
    const query = `[out:json][timeout:12];node(around:${radius},${lat},${lng})["name"];out 20;`;
    for (const endpoint of DEFAULT_OVERPASS_ENDPOINTS) {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        const results = extractPoisFromOsmElements(elements)
          .map((p) => ({
            poi: p,
            dist: calculateDistance(lat, lng, p.lat, p.lng),
          }))
          .filter((item) => item.dist <= radius)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 20)
          .map((item) => item.poi);
        metadataCache.put(cacheKey, results);
        return results;
      } catch {
        // Try next Overpass mirror
      }
    }
    return [];
  }

  // =====================================================================
  // Google Maps Platform (Geocoding API + Places API v1)
  // =====================================================================

  private ensureGoogleKey(): string {
    const key = this.config.googleMapsApiKey();
    if (!key) {
      throw new Error(
        'Google Maps API Key is not configured. Open Settings to enter a Google Maps API key or switch to OpenStreetMap.'
      );
    }
    return key;
  }

  private async googleGeocode(address: string): Promise<GeocodeResult | null> {
    const key = this.ensureGoogleKey();
    const norm = address.trim().toLowerCase();
    const cacheKey = `google:fwd:${DEFAULT_GOOGLE_MAPS_BASE_URL}:${norm}`;
    const cached = metadataCache.get(cacheKey) as GeocodeResult | undefined;
    if (cached) {
      queryAudit.recordCacheHit('google_geocode');
      return cached;
    }

    const url = new URL(`${DEFAULT_GOOGLE_MAPS_BASE_URL}/geocode/json`);
    url.searchParams.set('address', address);
    url.searchParams.set('key', key);

    queryAudit.recordExternal('google_geocode', norm);
    const resp = await fetch(url.toString());
    if (!resp.ok) return null;
    const data = await resp.json();
    if (
      data?.status === 'OK' &&
      Array.isArray(data.results) &&
      data.results.length > 0
    ) {
      const result = data.results[0];
      let street: string | null = null;
      const comps = Array.isArray(result.address_components)
        ? result.address_components
        : [];
      for (const comp of comps) {
        if (Array.isArray(comp.types) && comp.types.includes('route')) {
          street = comp.long_name || null;
          break;
        }
      }
      const res: GeocodeResult = {
        lat: Number(result.geometry.location.lat),
        lng: Number(result.geometry.location.lng),
        address: String(result.formatted_address || address),
        street,
      };
      metadataCache.put(cacheKey, res);
      return res;
    }
    return null;
  }

  private async googleReverseGeocode(
    lat: number,
    lng: number
  ): Promise<string | null> {
    const key = this.ensureGoogleKey();
    const cacheKey = `google:rev:${DEFAULT_GOOGLE_MAPS_BASE_URL}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const cached = metadataCache.get(cacheKey) as
      | { formatted_address?: string }
      | undefined;
    if (cached?.formatted_address) {
      queryAudit.recordCacheHit('google_rev_geocode');
      return cached.formatted_address;
    }

    const url = new URL(`${DEFAULT_GOOGLE_MAPS_BASE_URL}/geocode/json`);
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', key);

    queryAudit.recordExternal(
      'google_rev_geocode',
      `${lat.toFixed(5)},${lng.toFixed(5)}`
    );
    const resp = await fetch(url.toString());
    if (!resp.ok) return null;
    const data = await resp.json();
    if (
      data?.status === 'OK' &&
      Array.isArray(data.results) &&
      data.results.length > 0
    ) {
      const out = data.results[0];
      metadataCache.put(cacheKey, out);
      return out.formatted_address || null;
    }
    return null;
  }

  private async googleAutocomplete(
    query: string,
    sessionToken?: string
  ): Promise<AutocompleteItem[]> {
    const key = this.ensureGoogleKey();
    queryAudit.recordExternal('google_autocomplete', query.toLowerCase());
    try {
      const body: Record<string, unknown> = { input: query };
      if (sessionToken) {
        body['sessionToken'] = sessionToken;
      }
      const resp = await fetch(
        'https://places.googleapis.com/v1/places:autocomplete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
          },
          body: JSON.stringify(body),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const suggestions = Array.isArray(data?.suggestions)
          ? data.suggestions
          : [];
        return suggestions
          .map((s: Record<string, unknown>) => {
            const pred = s['placePrediction'] as
              | Record<string, unknown>
              | undefined;
            const textObj = pred?.['text'] as { text?: string } | undefined;
            return {
              description: String(textObj?.text || ''),
              placeId: String(pred?.['placeId'] || ''),
            };
          })
          .filter((item: AutocompleteItem) => Boolean(item.description));
      }
    } catch {
      // Fall back to Geocoding API suggestions if Places v1 isn't enabled on key
    }

    try {
      const geo = await this.googleGeocode(query);
      if (geo) {
        return [{ description: geo.address, placeId: geo.address }];
      }
    } catch {
      // Ignore fallback error
    }
    return [];
  }

  private async googleNearbySearch(
    lat: number,
    lng: number,
    radius: number
  ): Promise<
    Array<{
      lat: number;
      lng: number;
      name: string;
      vicinity: string;
      types: string[];
    }>
  > {
    const key = this.ensureGoogleKey();
    const cacheKey = `google:nearby:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
    const cached = metadataCache.get(cacheKey) as
      | Array<{
          lat: number;
          lng: number;
          name: string;
          vicinity: string;
          types: string[];
        }>
      | undefined;
    if (cached) {
      queryAudit.recordCacheHit('google_nearby');
      return cached;
    }

    queryAudit.recordExternal(
      'google_nearby',
      `${lat.toFixed(4)},${lng.toFixed(4)}:${radius}`
    );
    try {
      const resp = await fetch(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask':
              'places.displayName,places.shortFormattedAddress,places.formattedAddress,places.location,places.types',
          },
          body: JSON.stringify({
            maxResultCount: 20,
            locationRestriction: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius,
              },
            },
          }),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const places = Array.isArray(data?.places) ? data.places : [];
        const results = places
          .map((p: Record<string, unknown>) => {
            const loc = p['location'] as
              | { latitude?: number; longitude?: number }
              | undefined;
            const dn = p['displayName'] as { text?: string } | undefined;
            return {
              lat: Number(loc?.latitude ?? lat),
              lng: Number(loc?.longitude ?? lng),
              name: String(dn?.text || 'Unknown Place'),
              vicinity: String(
                p['shortFormattedAddress'] || p['formattedAddress'] || ''
              ),
              types: Array.isArray(p['types']) ? (p['types'] as string[]) : [],
            };
          })
          .filter((r: { name: string }) => Boolean(r.name));
        metadataCache.put(cacheKey, results);
        return results;
      }
    } catch {
      // Fall back to Overpass nearby POIs if Places API (New) is not enabled
    }
    return this.osmNearbySearch(lat, lng, radius);
  }
}
