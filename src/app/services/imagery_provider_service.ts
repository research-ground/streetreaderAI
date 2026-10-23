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
  getFieldByPath,
  ImageryPluginConfig,
  interpolateUrlTemplate,
} from './config_service';
import { calculateDistance, M_PER_DEG_LAT } from './location_provider_service';
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

function normalizeEpochMs(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return s;
  const parsed = Date.parse(s.length === 7 ? `${s}-01T00:00:00Z` : s);
  return Number.isNaN(parsed) ? s : String(parsed);
}

export function normalizeRawImageId(imageId: string): string {
  const raw = String(imageId || '').trim();
  const atIdx = raw.indexOf('@');
  return atIdx >= 0 ? raw.slice(0, atIdx) : raw;
}

function compassBearingLocal(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dx =
    (lng2 - lng1) * Math.cos((((lat1 + lat2) * 0.5) * Math.PI) / 180.0);
  const dy = lat2 - lat1;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return 0.0;
  return (((Math.atan2(dx, dy) * 180.0) / Math.PI) + 360.0) % 360.0;
}

@Injectable({
  providedIn: 'root',
})
export class ImageryProviderService implements ImageryProviderClient {
  private readonly config = inject(ConfigService);
  private readonly cropService = inject(PanoramaCropService);
  private readonly memMeta = new Map<string, LocationMetadata>();
  private readonly knownJunctions = new Map<string, LocationMetadata>();
  private readonly defaultFov = 120;
  private readonly panosOnly = true;

  private pendingJunctionCount = 0;
  private batchWaiters: Array<() => void> = [];

  get providerName(): string {
    return this.config.imageryProvider();
  }

  private getActivePlugin(): ImageryPluginConfig {
    const plugin = this.config.getImageryPlugin();
    if (!plugin) {
      throw new Error(
        `Imagery provider "${this.providerName}" is not defined in streetreaderai.conf.`
      );
    }
    return plugin;
  }

  private ensurePluginKey(plugin: ImageryPluginConfig): string {
    if (!plugin.requiresKey) return '';
    const key = this.config.getKeyByName(plugin.requiresKey);
    if (!key) {
      throw new Error(
        `Missing required key "${plugin.requiresKey}" for imagery provider "${plugin.name}". Set it in streetreaderai.conf or streetreaderai.local.conf.`
      );
    }
    return key;
  }

  async getMetadata(imageId: string): Promise<LocationMetadata | null> {
    const plugin = this.getActivePlugin();
    const rawId = normalizeRawImageId(imageId);
    if (!rawId) return null;

    const metaKey = `${plugin.name}:${rawId}`;
    const mem = this.memMeta.get(metaKey);
    if (mem) {
      queryAudit.recordCacheHit(`${plugin.name}_meta`);
      return { ...mem, imageId: String(imageId) };
    }

    const cached = metadataCache.get(metaKey) as LocationMetadata | undefined;
    if (cached) {
      queryAudit.recordCacheHit(`${plugin.name}_meta`);
      this.memMeta.set(metaKey, cached);
      return { ...cached, imageId: String(imageId) };
    }

    if (!plugin.metadataUrl) return null;
    try {
      const apiKey = this.ensurePluginKey(plugin);
      const url = interpolateUrlTemplate(plugin.metadataUrl, {
        imageId: rawId,
        apiKey,
      });
      queryAudit.recordExternal(`${plugin.name}_meta`, rawId);
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const payload = await resp.json();
      const items = this.extractItems(payload, plugin.itemsPath);
      if (items.length === 0) return null;
      const parsed = this.parsePluginItem(plugin, items[0], true);
      if (!parsed) return null;
      return { ...parsed, imageId: String(imageId) };
    } catch {
      return null;
    }
  }

  async getSequence(sequenceId: string): Promise<LocationMetadata[]> {
    const plugin = this.getActivePlugin();
    if (!sequenceId) return [];
    const seqStr = String(sequenceId);

    if (plugin.retrievalType === 'image') {
      return this.getPointSampledSequence(plugin, seqStr);
    }

    const seqKey = `${plugin.name}:seq:${seqStr}`;
    const cached = windowCache.get(seqKey) as LocationMetadata[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit(`${plugin.name}_seq`);
      return cached;
    }

    return singleflight(`${plugin.name}_seq:${this.panosOnly}:${seqStr}`, async () => {
      const again = windowCache.get(seqKey) as LocationMetadata[] | undefined;
      if (again) {
        queryAudit.recordCacheHit(`${plugin.name}_seq`);
        return again;
      }

      if (!plugin.sequenceUrl) return [];
      const apiKey = this.ensurePluginKey(plugin);
      const url = interpolateUrlTemplate(plugin.sequenceUrl, {
        sequenceId: seqStr,
        apiKey,
      });

      queryAudit.recordExternal(`${plugin.name}_seq`, seqStr);
      try {
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const payload = await resp.json();
        const items = this.extractItems(payload, plugin.itemsPath);
        const results: LocationMetadata[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          const meta = this.parsePluginItem(plugin, item, false, seqStr);
          if (!meta || seen.has(meta.imageId)) continue;
          if (this.panosOnly && !meta.isPano) continue;
          seen.add(meta.imageId);
          results.push(meta);
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

  async getMetadataBbox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<LocationMetadata[]> {
    const plugin = this.getActivePlugin();
    if (plugin.retrievalType === 'image') {
      return this.getPointSampledBbox(plugin, minLat, minLng, maxLat, maxLng);
    }

    if (!plugin.bboxUrl) return [];
    const apiKey = this.ensurePluginKey(plugin);
    const sfKey = `${plugin.name}_bbox:${this.panosOnly}:${minLng.toFixed(6)},${minLat.toFixed(6)},${maxLng.toFixed(6)},${maxLat.toFixed(6)}`;

    return singleflight(sfKey, async () => {
      const url = interpolateUrlTemplate(plugin.bboxUrl!, {
        minLat,
        minLng,
        maxLat,
        maxLng,
        bbox: `${minLng},${minLat},${maxLng},${maxLat}`,
        apiKey,
      });

      queryAudit.recordExternal(
        `${plugin.name}_bbox`,
        `${minLat.toFixed(5)},${minLng.toFixed(5)},${maxLat.toFixed(5)},${maxLng.toFixed(5)}`
      );
      const resp = await fetch(url);
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
        throw new Error(
          `${plugin.name} imagery service error (HTTP ${resp.status})`
        );
      }

      let items = this.extractItems(payload, plugin.itemsPath);
      if (
        items.length === 0 &&
        this.panosOnly &&
        url.includes('filter=field_of_view')
      ) {
        try {
          const fbUrl = url.replace(/[?&]filter=field_of_view[^&]*/, '');
          const fbResp = await fetch(fbUrl);
          if (fbResp.ok) {
            const fbPayload = await fbResp.json();
            items = this.extractItems(fbPayload, plugin.itemsPath);
          }
        } catch {
          // Ignore flat fallback error
        }
      }

      const results: LocationMetadata[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const meta = this.parsePluginItem(plugin, item);
        if (!meta || seen.has(meta.imageId)) continue;
        seen.add(meta.imageId);
        results.push(meta);
      }
      return results;
    });
  }

  async getImage(
    imageId: string,
    heading: number = 0,
    pitch: number = 0
  ): Promise<RenderedImageResult | null> {
    const plugin = this.getActivePlugin();
    const rawId = normalizeRawImageId(imageId);
    if (!rawId) return null;

    if (plugin.imageFormat === 'single') {
      return this.fetchDirectionalSingleImage(
        plugin,
        rawId,
        imageId,
        heading,
        pitch
      );
    }

    try {
      const cacheKey = `${plugin.name}_hd:${rawId}`;
      let decoded = this.cropService.getCached(cacheKey);

      if (decoded) {
        queryAudit.recordCacheHit(`${plugin.name}_image`);
      } else {
        const meta = await this.getMetadata(rawId);
        if (!meta?.thumbUrl) return null;

        queryAudit.recordExternal(`${plugin.name}_image`, rawId);
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

  // =====================================================================
  // Generic Point-Sampling Mode (`retrieval_type = image`)
  // =====================================================================

  private async fetchPointMetadata(
    plugin: ImageryPluginConfig,
    lat: number,
    lng: number,
    radiusM: number = 25
  ): Promise<LocationMetadata | null> {
    if (!plugin.pointUrl) return null;
    const locKey = `${plugin.name}_pt:${lat.toFixed(5)},${lng.toFixed(5)},${Math.round(radiusM)}`;
    return singleflight(locKey, async () => {
      try {
        const apiKey = this.ensurePluginKey(plugin);
        const url = interpolateUrlTemplate(plugin.pointUrl!, {
          lat,
          lng,
          radius: Math.round(radiusM),
          apiKey,
        });
        queryAudit.recordExternal(
          `${plugin.name}_point_meta`,
          `${lat.toFixed(5)},${lng.toFixed(5)}`
        );
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const payload = await resp.json();
        const items = this.extractItems(payload, plugin.itemsPath);
        if (items.length === 0) return null;
        return this.parsePluginItem(plugin, items[0], true);
      } catch {
        return null;
      }
    });
  }

  private async getPointSampledBbox(
    plugin: ImageryPluginConfig,
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number
  ): Promise<LocationMetadata[]> {
    const cLat = (minLat + maxLat) * 0.5;
    const cLng = (minLng + maxLng) * 0.5;
    const radiusM = Math.max(
      15,
      Math.min(
        50,
        Math.round(calculateDistance(minLat, minLng, maxLat, maxLng) * 0.5)
      )
    );

    this.pendingJunctionCount++;
    let centerMeta: LocationMetadata | null = null;
    try {
      centerMeta = await this.fetchPointMetadata(plugin, cLat, cLng, radiusM);
      if (centerMeta) {
        this.knownJunctions.set(centerMeta.imageId, centerMeta);
      }
    } finally {
      this.pendingJunctionCount--;
      if (this.pendingJunctionCount === 0) {
        const waiters = this.batchWaiters.splice(0, this.batchWaiters.length);
        for (const w of waiters) w();
      }
    }

    if (!centerMeta) return [];

    await this.waitForCurrentJunctionBatch();

    const myId = centerMeta.imageId;
    const results: LocationMetadata[] = [];

    for (const other of this.knownJunctions.values()) {
      if (other.imageId === myId) continue;
      const dist = calculateDistance(
        centerMeta.coordinates.latitude,
        centerMeta.coordinates.longitude,
        other.coordinates.latitude,
        other.coordinates.longitude
      );
      if (dist > 600.0) continue;

      const [metaLo, metaHi] =
        myId.localeCompare(other.imageId) <= 0
          ? [centerMeta, other]
          : [other, centerMeta];

      const seqId = `${plugin.name}_seq_${metaLo.imageId}__${metaHi.imageId}`;
      const [startStub, endStub] = this.buildPairEndpointStubs(
        plugin.name,
        metaLo,
        metaHi,
        seqId
      );
      results.push(startStub, endStub);
    }

    if (results.length === 0) {
      results.push({
        ...centerMeta,
        sequenceId: `${plugin.name}_probe_${myId}`,
      });
    }

    return results;
  }

  private async getPointSampledSequence(
    plugin: ImageryPluginConfig,
    seqStr: string
  ): Promise<LocationMetadata[]> {
    const cacheKey = `${plugin.name}:seq:${seqStr}`;
    const cached = windowCache.get(cacheKey) as LocationMetadata[] | undefined;
    if (cached) {
      queryAudit.recordCacheHit(`${plugin.name}_seq`);
      return cached;
    }

    return singleflight(`${plugin.name}_seq:${seqStr}`, async () => {
      const again = windowCache.get(cacheKey) as LocationMetadata[] | undefined;
      if (again) {
        queryAudit.recordCacheHit(`${plugin.name}_seq`);
        return again;
      }

      const prefix = `${plugin.name}_seq_`;
      if (!seqStr.startsWith(prefix)) return [];

      const rawPair = seqStr.slice(prefix.length);
      const sepIdx = rawPair.indexOf('__');
      if (sepIdx <= 0) return [];

      const idLo = rawPair.slice(0, sepIdx);
      const idHi = rawPair.slice(sepIdx + 2);
      if (!idLo || !idHi) return [];

      const [metaLo, metaHi] = await Promise.all([
        this.knownJunctions.get(idLo) ?? this.getMetadata(idLo),
        this.knownJunctions.get(idHi) ?? this.getMetadata(idHi),
      ]);
      if (!metaLo || !metaHi) return [];

      const [startStub, endStub] = this.buildPairEndpointStubs(
        plugin.name,
        metaLo,
        metaHi,
        seqStr
      );

      const lat1 = metaLo.coordinates.latitude;
      const lng1 = metaLo.coordinates.longitude;
      const lat2 = metaHi.coordinates.latitude;
      const lng2 = metaHi.coordinates.longitude;
      const totalDist = calculateDistance(lat1, lng1, lat2, lng2);

      const intermediates: LocationMetadata[] = [];
      if (totalDist > 24.0) {
        const nSteps = Math.max(2, Math.ceil(totalDist / 16.0));
        const sampleCoords: Array<{ lat: number; lng: number }> = [];
        for (let k = 1; k < nSteps; k++) {
          const frac = k / nSteps;
          sampleCoords.push({
            lat: lat1 + (lat2 - lat1) * frac,
            lng: lng1 + (lng2 - lng1) * frac,
          });
        }

        const sampled = await Promise.all(
          sampleCoords.map((pt) =>
            this.fetchPointMetadata(plugin, pt.lat, pt.lng, 22)
          )
        );

        const seenIds = new Set<string>([
          normalizeRawImageId(metaLo.imageId),
          normalizeRawImageId(metaHi.imageId),
        ]);
        let prevLat = lat1;
        let prevLng = lng1;

        for (const m of sampled) {
          if (!m) continue;
          const rawMidId = normalizeRawImageId(m.imageId);
          if (seenIds.has(rawMidId)) continue;
          const dPrev = calculateDistance(
            prevLat,
            prevLng,
            m.coordinates.latitude,
            m.coordinates.longitude
          );
          const dEnd = calculateDistance(
            m.coordinates.latitude,
            m.coordinates.longitude,
            lat2,
            lng2
          );
          if (dPrev < 4.0 || dEnd < 4.0 || dPrev > 29.0) continue;

          seenIds.add(rawMidId);
          intermediates.push(m);
          prevLat = m.coordinates.latitude;
          prevLng = m.coordinates.longitude;
        }
      }

      const baseEpochMs = 1700000000000;
      const chain: LocationMetadata[] = [startStub];

      for (let i = 0; i < intermediates.length; i++) {
        const m = intermediates[i];
        const nextPt =
          i + 1 < intermediates.length
            ? intermediates[i + 1].coordinates
            : metaHi.coordinates;
        const brg = compassBearingLocal(
          m.coordinates.latitude,
          m.coordinates.longitude,
          nextPt.latitude,
          nextPt.longitude
        );
        const rawMidId = normalizeRawImageId(m.imageId);
        chain.push({
          ...m,
          imageId: `${rawMidId}@${seqStr}`,
          heading: m.heading || brg,
          captureTime: String(baseEpochMs + (i + 1) * 1000),
          sequenceId: seqStr,
          isPano: true,
          provider: plugin.name,
        });
      }

      chain.push(endStub);
      windowCache.put(cacheKey, chain);
      return chain;
    });
  }

  private buildPairEndpointStubs(
    providerName: string,
    metaLo: LocationMetadata,
    metaHi: LocationMetadata,
    seqId: string
  ): [LocationMetadata, LocationMetadata] {
    const rawLo = normalizeRawImageId(metaLo.imageId);
    const rawHi = normalizeRawImageId(metaHi.imageId);
    const brgLoToHi = compassBearingLocal(
      metaLo.coordinates.latitude,
      metaLo.coordinates.longitude,
      metaHi.coordinates.latitude,
      metaHi.coordinates.longitude
    );

    const startStub: LocationMetadata = {
      ...metaLo,
      imageId: `${rawLo}@${seqId}:0`,
      coordinates: metaLo.coordinates,
      heading: brgLoToHi,
      captureTime: '1700000000000',
      sequenceId: seqId,
      isPano: true,
      provider: providerName,
    };

    const endStub: LocationMetadata = {
      ...metaHi,
      imageId: `${rawHi}@${seqId}:1`,
      coordinates: metaHi.coordinates,
      heading: brgLoToHi,
      captureTime: '1700000999000',
      sequenceId: seqId,
      isPano: true,
      provider: providerName,
    };

    return [startStub, endStub];
  }

  private waitForCurrentJunctionBatch(): Promise<void> {
    if (this.pendingJunctionCount === 0) {
      return new Promise((resolve) => setTimeout(resolve, 10));
    }
    return new Promise((resolve) => {
      this.batchWaiters.push(resolve);
    });
  }

  private async fetchDirectionalSingleImage(
    plugin: ImageryPluginConfig,
    rawId: string,
    originalImageId: string,
    heading: number,
    pitch: number
  ): Promise<RenderedImageResult | null> {
    if (!plugin.imageUrl) return null;
    try {
      const apiKey = this.ensurePluginKey(plugin);
      const url = interpolateUrlTemplate(plugin.imageUrl, {
        imageId: rawId,
        heading: ((heading % 360) + 360) % 360,
        pitch,
        fov: 90,
        width: 960,
        height: 720,
        apiKey,
      });
      queryAudit.recordExternal(`${plugin.name}_image`, rawId);
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!blob || blob.size === 0) return null;
      const base64 = await this.blobToBase64(blob);
      return {
        image: base64,
        imageId: originalImageId,
        actualHeading: heading,
      };
    } catch {
      return null;
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = String(reader.result || '');
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // =====================================================================
  // Generic JSON Field Extraction & Normalization
  // =====================================================================

  private extractItems(
    payload: unknown,
    itemsPath: string
  ): Record<string, unknown>[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) {
      return payload as Record<string, unknown>[];
    }
    if (!itemsPath) {
      return [payload as Record<string, unknown>];
    }
    const extracted = getFieldByPath(payload, [itemsPath]);
    if (Array.isArray(extracted)) {
      return extracted as Record<string, unknown>[];
    }
    if (extracted && typeof extracted === 'object') {
      return [extracted as Record<string, unknown>];
    }
    return [payload as Record<string, unknown>];
  }

  private parsePluginItem(
    plugin: ImageryPluginConfig,
    item: Record<string, unknown>,
    cacheMeta: boolean = false,
    fallbackSeqId?: string
  ): LocationMetadata | null {
    if (!item || typeof item !== 'object') return null;

    const rawId = getFieldByPath(item, plugin.idField);
    const rawLat = getFieldByPath(item, plugin.latField);
    const rawLng = getFieldByPath(item, plugin.lngField);
    if (rawId === undefined || rawLat === undefined || rawLng === undefined) {
      return null;
    }

    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

    const rawHeading = getFieldByPath(item, plugin.headingField);
    const heading = rawHeading !== undefined ? Number(rawHeading) : 0;

    const rawCaptureTime = getFieldByPath(item, plugin.captureTimeField);
    const captureTime = normalizeEpochMs(rawCaptureTime);

    const rawSeq = getFieldByPath(item, plugin.sequenceField);
    const seqId =
      rawSeq !== undefined && rawSeq !== null
        ? String(rawSeq)
        : (fallbackSeqId ?? null);

    let isPano = true;
    if (plugin.isPanoField.length > 0) {
      const rawIsPano = getFieldByPath(item, plugin.isPanoField);
      isPano = Boolean(rawIsPano);
    } else if (
      plugin.fovField.length > 0 ||
      plugin.dimensionsField.length > 0
    ) {
      isPano = false;
      const fov = getFieldByPath(item, plugin.fovField);
      if (fov !== undefined && fov !== null) {
        const parsedFov = Number(fov);
        isPano = !Number.isNaN(parsedFov) && parsedFov >= 360;
      } else {
        const dims = getFieldByPath(item, plugin.dimensionsField);
        if (Array.isArray(dims) && dims.length === 2 && dims[1]) {
          isPano = Math.abs(Number(dims[0]) / Number(dims[1]) - 2.0) < 0.15;
        }
      }
    }

    const rawThumb = getFieldByPath(item, plugin.thumbUrlField);
    const thumbUrl = rawThumb ? String(rawThumb) : null;

    let prevId: string | null = null;
    let nextId: string | null = null;
    const links = Array.isArray(item['links']) ? item['links'] : [];
    for (const link of links) {
      if (link && typeof link === 'object') {
        const rel = (link as Record<string, unknown>)['rel'];
        const lid = (link as Record<string, unknown>)['id'];
        if (rel === 'prev' && lid) prevId = String(lid);
        else if (rel === 'next' && lid) nextId = String(lid);
      }
    }

    const meta: LocationMetadata = {
      imageId: String(rawId),
      coordinates: { latitude: lat, longitude: lng },
      captureTime,
      heading: Number.isNaN(heading) ? 0 : heading,
      isPano,
      sequenceId: seqId,
      thumbUrl,
      prevImageId: prevId,
      nextImageId: nextId,
      provider: plugin.name,
    };

    const metaKey = `${plugin.name}:${meta.imageId}`;
    if (this.memMeta.size >= 4096) {
      this.memMeta.clear();
    }
    this.memMeta.set(metaKey, meta);
    if (cacheMeta) {
      metadataCache.put(metaKey, meta);
    }
    return meta;
  }
}
