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
import { LatLng } from './api_service';
import { metadataCache, queryAudit, singleflight, windowCache } from './client_cache';
import {
  ConfigService,
  DEFAULT_MAPILLARY_BASE_URL,
  DEFAULT_PANORAMAX_BASE_URL,
} from './config_service';
import { PanoramaCropService } from './panorama_crop_service';

export interface LocationMetadata {
  imageId: string;
  coordinates: LatLng;
  captureTime: string;
  heading: number;
  isPano: boolean;
  sequenceId?: string | null;
  thumbUrl?: string | null;
  prevImageId?: string | null;
  nextImageId?: string | null;
  provider?: string;
}

export interface RenderedImageResult {
  image: string;
  imageId: string;
  actualHeading: number;
}

export interface ImageryProviderClient {
  readonly providerName: string;
  getMetadata(imageId: string): Promise<LocationMetadata | null>;
  getSequence(sequenceId: string): Promise<LocationMetadata[]>;
  getMetadataBbox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<LocationMetadata[]>;
  getImage(
    imageId: string,
    heading?: number,
    pitch?: number
  ): Promise<RenderedImageResult | null>;
}

function isoToEpochMs(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return s;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? s : String(ms);
}

@Injectable({
  providedIn: 'root',
})
export class ImageryProviderService implements ImageryProviderClient {
  private readonly config = inject(ConfigService);
  private readonly cropService = inject(PanoramaCropService);
  private readonly panoramaxMemMeta = new Map<string, LocationMetadata>();
  private readonly defaultFov = 120;
  private readonly panosOnly = true;

  get providerName(): string {
    return this.config.imageryProvider();
  }

  getMetadata(imageId: string): Promise<LocationMetadata | null> {
    return this.config.imageryProvider() === 'mapillary'
      ? this.getMapillaryMetadata(imageId)
      : this.getPanoramaxMetadata(imageId);
  }

  getSequence(sequenceId: string): Promise<LocationMetadata[]> {
    return this.config.imageryProvider() === 'mapillary'
      ? this.getMapillarySequence(sequenceId)
      : this.getPanoramaxSequence(sequenceId);
  }

  getMetadataBbox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<LocationMetadata[]> {
    return this.config.imageryProvider() === 'mapillary'
      ? this.getMapillaryMetadataBbox(minLat, minLng, maxLat, maxLng)
      : this.getPanoramaxMetadataBbox(minLat, minLng, maxLat, maxLng);
  }

  getImage(
    imageId: string,
    heading: number = 0,
    pitch: number = 0
  ): Promise<RenderedImageResult | null> {
    return this.config.imageryProvider() === 'mapillary'
      ? this.getMapillaryImage(imageId, heading, pitch)
      : this.getPanoramaxImage(imageId, heading, pitch);
  }

  // =====================================================================
  // Mapillary Graph API v4 Client
  // =====================================================================

  private ensureMapillaryToken(): string {
    const token = this.config.mapillaryToken();
    if (!token) {
      throw new Error(
        'Mapillary Client Token is not configured. Open Settings to enter a Mapillary token or switch to Panoramax.'
      );
    }
    return token;
  }

  private async getMapillaryMetadata(imageId: string): Promise<LocationMetadata | null> {
    const metaKey = `mapillary:${imageId}`;
    const cached = metadataCache.get(metaKey) as LocationMetadata | undefined;
    if (cached) {
      queryAudit.recordCacheHit('mapillary_meta');
      return cached;
    }

    try {
      const token = this.ensureMapillaryToken();
      queryAudit.recordExternal('mapillary_meta', String(imageId));
      const url = new URL(`${DEFAULT_MAPILLARY_BASE_URL}/${encodeURIComponent(imageId)}`);
      url.searchParams.set('access_token', token);
      url.searchParams.set(
        'fields',
        'id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence,thumb_original_url,thumb_2048_url'
      );
      const resp = await fetch(url.toString());
      if (!resp.ok) return null;
      const data = await resp.json();
      const coords = data?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return null;

      const meta: LocationMetadata = {
        imageId: String(data.id),
        coordinates: { latitude: Number(coords[1]), longitude: Number(coords[0]) },
        captureTime: String(data.captured_at ?? ''),
        heading: Number(data.computed_compass_angle ?? data.compass_angle ?? 0),
        isPano: Boolean(data.is_pano),
        sequenceId: data.sequence ? String(data.sequence) : null,
        thumbUrl: data.thumb_original_url || data.thumb_2048_url || null,
        provider: 'mapillary',
      };
      metadataCache.put(metaKey, meta);
      return meta;
    } catch {
      return null;
    }
  }

  private async getMapillarySequence(sequenceId: string): Promise<LocationMetadata[]> {
    if (!sequenceId) return [];
    const seqStr = String(sequenceId);
    const seqKey = `mapillary:seq:${seqStr}`;
    const cached = windowCache.get(seqKey) as LocationMetadata[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('mapillary_seq');
      return cached;
    }

    return singleflight(`mapillary_seq:${this.panosOnly}:${seqStr}`, async () => {
      const again = windowCache.get(seqKey) as LocationMetadata[] | undefined;
      if (again) {
        queryAudit.recordCacheHit('mapillary_seq');
        return again;
      }

      const token = this.ensureMapillaryToken();
      const url = new URL(`${DEFAULT_MAPILLARY_BASE_URL}/images`);
      url.searchParams.set('access_token', token);
      url.searchParams.set('sequence_ids', seqStr);
      url.searchParams.set(
        'fields',
        'id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence'
      );
      url.searchParams.set('limit', '500');
      if (this.panosOnly) {
        url.searchParams.set('is_pano', 'true');
      }

      queryAudit.recordExternal('mapillary_seq', seqStr);
      try {
        const resp = await fetch(url.toString());
        if (!resp.ok) return [];
        const payload = await resp.json();
        const data: Record<string, unknown>[] = Array.isArray(payload?.data)
          ? payload.data
          : [];
        const results: LocationMetadata[] = [];
        for (const img of data) {
          const geom = img['geometry'] as { coordinates?: number[] } | undefined;
          const coords = geom?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) continue;
          results.push({
            imageId: String(img['id']),
            coordinates: { latitude: Number(coords[1]), longitude: Number(coords[0]) },
            captureTime: String(img['captured_at'] ?? ''),
            heading: Number(
              img['computed_compass_angle'] ?? img['compass_angle'] ?? 0
            ),
            isPano: Boolean(img['is_pano']),
            sequenceId: img['sequence'] ? String(img['sequence']) : seqStr,
            provider: 'mapillary',
          });
        }
        results.sort((a, b) => {
          const ta = /^\d+$/.test(a.captureTime) ? Number(a.captureTime) : 0;
          const tb = /^\d+$/.test(b.captureTime) ? Number(b.captureTime) : 0;
          if (ta !== tb) return ta - tb;
          return a.imageId.localeCompare(b.imageId);
        });
        windowCache.put(seqKey, results);
        return results;
      } catch {
        return [];
      }
    });
  }

  private async getMapillaryMetadataBbox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<LocationMetadata[]> {
    const token = this.ensureMapillaryToken();
    const bboxStr = `${minLng},${minLat},${maxLng},${maxLat}`;
    const sfKey = `mapillary_bbox:${this.panosOnly}:${minLng.toFixed(6)},${minLat.toFixed(6)},${maxLng.toFixed(6)},${maxLat.toFixed(6)}`;

    return singleflight(sfKey, async () => {
      const url = new URL(`${DEFAULT_MAPILLARY_BASE_URL}/images`);
      url.searchParams.set('access_token', token);
      url.searchParams.set(
        'fields',
        'id,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,sequence'
      );
      url.searchParams.set('bbox', bboxStr);
      url.searchParams.set('limit', '500');
      if (this.panosOnly) {
        url.searchParams.set('is_pano', 'true');
      }

      queryAudit.recordExternal(
        'mapillary_bbox',
        `${minLat.toFixed(5)},${minLng.toFixed(5)},${maxLat.toFixed(5)},${maxLng.toFixed(5)}`
      );
      const resp = await fetch(url.toString());
      let payload: Record<string, unknown> = {};
      try {
        payload = (await resp.json()) || {};
      } catch {
        payload = {};
      }
      const errObj = payload['error'] as { message?: string } | undefined;
      const errMsg = (errObj?.message || '').toLowerCase();
      if (
        errMsg.includes('reduce the amount of data') ||
        (errMsg.includes('unexpected error') && maxLat - minLat > 0.00008)
      ) {
        return [];
      }
      if (!resp.ok) {
        throw new Error(`Mapillary imagery service error (HTTP ${resp.status})`);
      }

      const data: Record<string, unknown>[] = Array.isArray(payload['data'])
        ? (payload['data'] as Record<string, unknown>[])
        : [];
      const results: LocationMetadata[] = [];
      for (const img of data) {
        const geom = img['geometry'] as { coordinates?: number[] } | undefined;
        const coords = geom?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        results.push({
          imageId: String(img['id']),
          coordinates: { latitude: Number(coords[1]), longitude: Number(coords[0]) },
          captureTime: String(img['captured_at'] ?? ''),
          heading: Number(
            img['computed_compass_angle'] ?? img['compass_angle'] ?? 0
          ),
          isPano: Boolean(img['is_pano']),
          sequenceId: img['sequence'] ? String(img['sequence']) : null,
          provider: 'mapillary',
        });
      }
      return results;
    });
  }

  private async getMapillaryImage(
    imageId: string,
    heading: number,
    pitch: number
  ): Promise<RenderedImageResult | null> {
    try {
      const cacheKey = `mapillary_hd:${imageId}`;
      let decoded = this.cropService.getCached(cacheKey);

      if (decoded) {
        queryAudit.recordCacheHit('mapillary_image');
      } else {
        const metaKey = `mapillary:${imageId}`;
        const metaCached = metadataCache.get(metaKey) as LocationMetadata | undefined;
        let thumbUrl: string | null | undefined;
        let imgHeading = 0;
        let isPano = false;

        if (metaCached?.thumbUrl) {
          queryAudit.recordCacheHit('mapillary_meta');
          thumbUrl = metaCached.thumbUrl;
          imgHeading = Number(metaCached.heading || 0);
          isPano = Boolean(metaCached.isPano);
        } else {
          const token = this.ensureMapillaryToken();
          queryAudit.recordExternal('mapillary_meta', String(imageId));
          const url = new URL(
            `${DEFAULT_MAPILLARY_BASE_URL}/${encodeURIComponent(imageId)}`
          );
          url.searchParams.set('access_token', token);
          url.searchParams.set(
            'fields',
            'compass_angle,computed_compass_angle,thumb_original_url,thumb_2048_url,is_pano'
          );
          const resp = await fetch(url.toString());
          if (!resp.ok) return null;
          const data = await resp.json();
          imgHeading = Number(
            data?.computed_compass_angle ?? data?.compass_angle ?? 0
          );
          thumbUrl = data?.thumb_original_url || data?.thumb_2048_url;
          isPano = Boolean(data?.is_pano);
        }

        if (!thumbUrl) return null;
        queryAudit.recordExternal('mapillary_image', String(imageId));
        const imgResp = await fetch(thumbUrl);
        if (!imgResp.ok) return null;
        const blob = await imgResp.blob();
        if (!blob || blob.size === 0) return null;
        decoded = await this.cropService.decodeAndCache(
          cacheKey,
          blob,
          imgHeading,
          isPano
        );
      }

      if (decoded.isPano) {
        const cropped = this.cropService.cropPanorama(
          decoded,
          heading,
          this.defaultFov,
          960,
          720,
          pitch
        );
        return {
          image: cropped,
          imageId,
          actualHeading: heading,
        };
      }
      return {
        image: decoded.rawBase64,
        imageId,
        actualHeading: decoded.imgHeading,
      };
    } catch {
      return null;
    }
  }

  // =====================================================================
  // Panoramax STAC API Client
  // =====================================================================

  private get panoramaxBaseUrl(): string {
    return (this.config.panoramaxBaseUrl() || DEFAULT_PANORAMAX_BASE_URL).replace(
      /\/+$/,
      ''
    );
  }

  private parsePanoramaxFeature(
    feat: Record<string, unknown>,
    cacheMeta: boolean = false
  ): LocationMetadata | null {
    if (!feat || typeof feat !== 'object') return null;
    const imageId = feat['id'];
    const geom = feat['geometry'] as { coordinates?: number[] } | undefined;
    const coords = geom?.coordinates;
    if (!imageId || !Array.isArray(coords) || coords.length < 2) return null;

    const props = (feat['properties'] as Record<string, unknown>) || {};
    const orient =
      (props['pers:interior_orientation'] as Record<string, unknown>) || {};
    const fov = orient['field_of_view'];
    let isPano = false;
    if (fov !== undefined && fov !== null) {
      const parsedFov = Number(fov);
      isPano = !Number.isNaN(parsedFov) && parsedFov >= 360;
    } else {
      const dims = orient['sensor_array_dimensions'];
      if (Array.isArray(dims) && dims.length === 2 && dims[1]) {
        isPano = Math.abs(Number(dims[0]) / Number(dims[1]) - 2.0) < 0.15;
      }
    }

    const heading = Number(props['view:azimuth'] ?? 0);
    const captureTime = isoToEpochMs(
      props['datetime'] || props['datetimetz'] || ''
    );
    const seqId = feat['collection'] ? String(feat['collection']) : null;

    const assets = (feat['assets'] as Record<string, { href?: string }>) || {};
    const thumbUrl =
      assets['sd']?.href ||
      assets['hd']?.href ||
      (props['geovisio:image'] as string | undefined) ||
      assets['thumb']?.href ||
      null;

    let prevId: string | null = null;
    let nextId: string | null = null;
    const links = Array.isArray(feat['links']) ? feat['links'] : [];
    for (const link of links) {
      if (link && typeof link === 'object') {
        const rel = (link as Record<string, unknown>)['rel'];
        const lid = (link as Record<string, unknown>)['id'];
        if (rel === 'prev' && lid) prevId = String(lid);
        else if (rel === 'next' && lid) nextId = String(lid);
      }
    }

    const meta: LocationMetadata = {
      imageId: String(imageId),
      coordinates: { latitude: Number(coords[1]), longitude: Number(coords[0]) },
      captureTime,
      heading,
      isPano,
      sequenceId: seqId,
      thumbUrl,
      prevImageId: prevId,
      nextImageId: nextId,
      provider: 'panoramax',
    };

    if (this.panoramaxMemMeta.size >= 4096) {
      this.panoramaxMemMeta.clear();
    }
    this.panoramaxMemMeta.set(meta.imageId, meta);
    if (cacheMeta) {
      metadataCache.put(`panoramax:${meta.imageId}`, meta);
    }
    return meta;
  }

  private async getPanoramaxMetadata(
    imageId: string
  ): Promise<LocationMetadata | null> {
    const idStr = String(imageId);
    const mem = this.panoramaxMemMeta.get(idStr);
    if (mem) {
      queryAudit.recordCacheHit('panoramax_meta');
      return mem;
    }
    const cached = metadataCache.get(`panoramax:${idStr}`) as
      | LocationMetadata
      | undefined;
    if (cached) {
      queryAudit.recordCacheHit('panoramax_meta');
      this.panoramaxMemMeta.set(idStr, cached);
      return cached;
    }

    try {
      queryAudit.recordExternal('panoramax_meta', idStr);
      const url = new URL(`${this.panoramaxBaseUrl}/search`);
      url.searchParams.set('ids', idStr);
      url.searchParams.set('limit', '1');
      const resp = await fetch(url.toString());
      if (!resp.ok) return null;
      const payload = await resp.json();
      const features = Array.isArray(payload?.features) ? payload.features : [];
      if (features.length > 0) {
        return this.parsePanoramaxFeature(features[0], true);
      }
    } catch {
      return null;
    }
    return null;
  }

  private async getPanoramaxSequence(
    sequenceId: string
  ): Promise<LocationMetadata[]> {
    if (!sequenceId) return [];
    const seqStr = String(sequenceId);
    const seqKey = `panoramax:seq:${seqStr}`;
    const cached = windowCache.get(seqKey) as LocationMetadata[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit('panoramax_seq');
      return cached;
    }

    return singleflight(`panoramax_seq:${this.panosOnly}:${seqStr}`, async () => {
      const again = windowCache.get(seqKey) as LocationMetadata[] | undefined;
      if (again) {
        queryAudit.recordCacheHit('panoramax_seq');
        return again;
      }

      queryAudit.recordExternal('panoramax_seq', seqStr);
      try {
        const url = new URL(
          `${this.panoramaxBaseUrl}/collections/${encodeURIComponent(seqStr)}/items`
        );
        url.searchParams.set('limit', '500');
        const resp = await fetch(url.toString());
        if (!resp.ok) return [];
        const payload = await resp.json();
        const features = Array.isArray(payload?.features)
          ? payload.features
          : [];

        const results: LocationMetadata[] = [];
        const seen = new Set<string>();
        for (const feat of features) {
          const meta = this.parsePanoramaxFeature(feat);
          if (!meta || seen.has(meta.imageId)) continue;
          if (this.panosOnly && !meta.isPano) continue;
          seen.add(meta.imageId);
          results.push(meta);
        }
        windowCache.put(seqKey, results);
        return results;
      } catch {
        return [];
      }
    });
  }

  private async getPanoramaxMetadataBbox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<LocationMetadata[]> {
    const bboxStr = `${minLng},${minLat},${maxLng},${maxLat}`;
    const sfKey = `panoramax_bbox:${this.panosOnly}:${minLng.toFixed(6)},${minLat.toFixed(6)},${maxLng.toFixed(6)},${maxLat.toFixed(6)}`;

    return singleflight(sfKey, async () => {
      const url = new URL(`${this.panoramaxBaseUrl}/search`);
      url.searchParams.set('bbox', bboxStr);
      url.searchParams.set('limit', '500');
      if (this.panosOnly) {
        url.searchParams.set('filter', 'field_of_view=360');
      }

      queryAudit.recordExternal(
        'panoramax_bbox',
        `${minLat.toFixed(5)},${minLng.toFixed(5)},${maxLat.toFixed(5)},${maxLng.toFixed(5)}`
      );
      const resp = await fetch(url.toString());
      if (!resp.ok) {
        throw new Error(`Panoramax imagery service error (HTTP ${resp.status})`);
      }

      const payload = await resp.json();
      let features: Record<string, unknown>[] = Array.isArray(payload?.features)
        ? payload.features
        : [];

      if (features.length === 0 && this.panosOnly) {
        try {
          const fbUrl = new URL(`${this.panoramaxBaseUrl}/search`);
          fbUrl.searchParams.set('bbox', bboxStr);
          fbUrl.searchParams.set('limit', '500');
          const fbResp = await fetch(fbUrl.toString());
          if (fbResp.ok) {
            const fbPayload = await fbResp.json();
            features = Array.isArray(fbPayload?.features)
              ? fbPayload.features
              : [];
          }
        } catch {
          // Ignore flat fallback error
        }
      }

      const results: LocationMetadata[] = [];
      const seen = new Set<string>();
      for (const feat of features) {
        const meta = this.parsePanoramaxFeature(feat);
        if (!meta || seen.has(meta.imageId)) continue;
        seen.add(meta.imageId);
        results.push(meta);
      }
      return results;
    });
  }

  private async getPanoramaxImage(
    imageId: string,
    heading: number,
    pitch: number
  ): Promise<RenderedImageResult | null> {
    try {
      const cacheKey = `panoramax_hd:${imageId}`;
      let decoded = this.cropService.getCached(cacheKey);

      if (decoded) {
        queryAudit.recordCacheHit('panoramax_image');
      } else {
        const meta = await this.getPanoramaxMetadata(imageId);
        if (!meta?.thumbUrl) return null;

        queryAudit.recordExternal('panoramax_image', String(imageId));
        const imgResp = await fetch(meta.thumbUrl);
        if (!imgResp.ok) return null;
        const blob = await imgResp.blob();
        if (!blob || blob.size === 0) return null;
        decoded = await this.cropService.decodeAndCache(
          cacheKey,
          blob,
          meta.heading,
          meta.isPano
        );
      }

      if (decoded.isPano) {
        const cropped = this.cropService.cropPanorama(
          decoded,
          heading,
          this.defaultFov,
          960,
          720,
          pitch
        );
        return {
          image: cropped,
          imageId,
          actualHeading: heading,
        };
      }
      return {
        image: decoded.rawBase64,
        imageId,
        actualHeading: decoded.imgHeading,
      };
    } catch {
      return null;
    }
  }
}
