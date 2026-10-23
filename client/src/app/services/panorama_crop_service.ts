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
import { LruCache } from './client_cache';

export interface DecodedPanorama {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  rawBase64: string;
  imgHeading: number;
  isPano: boolean;
}

/**
 * Pure client-side 360° equirectangular-to-rectilinear projection using HTML5 Canvas.
 * Ports `crop_panorama` from `server/services/imagery/image_utils.py`.
 */
@Injectable({
  providedIn: 'root',
})
export class PanoramaCropService {
  private readonly decodedCache = new LruCache<DecodedPanorama>(12);

  getCached(cacheKey: string): DecodedPanorama | undefined {
    return this.decodedCache.get(cacheKey);
  }

  clearCache(): void {
    this.decodedCache.clear();
  }

  async decodeAndCache(
    cacheKey: string,
    blob: Blob,
    imgHeading: number,
    isPano: boolean
  ): Promise<DecodedPanorama> {
    const existing = this.decodedCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const rawBase64 = await this.blobToBase64(blob);
    if (!isPano || typeof document === 'undefined') {
      const entry: DecodedPanorama = {
        width: 0,
        height: 0,
        pixels: new Uint8ClampedArray(0),
        rawBase64,
        imgHeading,
        isPano,
      };
      this.decodedCache.put(cacheKey, entry);
      return entry;
    }

    try {
      const img = await this.loadImageFromBlob(blob);
      const maxW = 2048;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const fallback: DecodedPanorama = {
          width: 0,
          height: 0,
          pixels: new Uint8ClampedArray(0),
          rawBase64,
          imgHeading,
          isPano,
        };
        this.decodedCache.put(cacheKey, fallback);
        return fallback;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const decoded: DecodedPanorama = {
        width,
        height,
        pixels: imageData.data,
        rawBase64,
        imgHeading,
        isPano,
      };
      this.decodedCache.put(cacheKey, decoded);
      return decoded;
    } catch {
      const fallback: DecodedPanorama = {
        width: 0,
        height: 0,
        pixels: new Uint8ClampedArray(0),
        rawBase64,
        imgHeading,
        isPano,
      };
      this.decodedCache.put(cacheKey, fallback);
      return fallback;
    }
  }

  /**
   * Projects an equirectangular 360° panorama into a rectilinear camera viewport
   * based on `heading`, `imgHeading`, `fov`, and `pitchDeg`.
   */
  cropPanorama(
    pano: DecodedPanorama,
    heading: number,
    fov: number = 120,
    outputWidth: number = 960,
    outputHeight: number = 720,
    pitchDeg: number = 0
  ): string {
    if (!pano.isPano || pano.width === 0 || pano.height === 0 || typeof document === 'undefined') {
      return pano.rawBase64;
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outputWidth;
    outCanvas.height = outputHeight;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) {
      return pano.rawBase64;
    }

    const outImageData = ctx.createImageData(outputWidth, outputHeight);
    const dst = outImageData.data;
    const src = pano.pixels;
    const srcW = pano.width;
    const srcH = pano.height;

    const yawDeg = ((((heading - pano.imgHeading + 180) % 360) + 360) % 360) - 180;
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;

    const fovRad = (fov * Math.PI) / 180;
    const f = (0.5 * outputWidth) / Math.tan(fovRad / 2);

    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    const halfW = outputWidth * 0.5;
    const halfH = outputHeight * 0.5;
    const invTwoPi = 1 / (2 * Math.PI);
    const invPi = 1 / Math.PI;

    let dstIdx = 0;
    for (let py = 0; py < outputHeight; py++) {
      const Y = py - halfH;
      const yRot = Y * cosP - f * sinP;
      const zRot = Y * sinP + f * cosP;
      const yRotSq = yRot * yRot;

      for (let px = 0; px < outputWidth; px++) {
        const X = px - halfW;
        const xRot = X * cosY + zRot * sinY;
        const zFinal = -X * sinY + zRot * cosY;

        const lon = Math.atan2(xRot, zFinal);
        const norm = Math.sqrt(xRot * xRot + yRotSq + zFinal * zFinal);
        const lat = Math.asin(Math.max(-1, Math.min(1, yRot / norm)));

        let u = (lon * invTwoPi + 0.5) * srcW;
        let v = (lat * invPi + 0.5) * srcH;

        u = ((u % srcW) + srcW) % srcW;
        v = Math.max(0, Math.min(srcH - 1.001, v));

        const x0 = u | 0;
        const y0 = v | 0;
        const x1 = (x0 + 1) % srcW;
        const y1 = Math.min(srcH - 1, y0 + 1);
        const fx = u - x0;
        const fy = v - y0;

        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const idx00 = (y0 * srcW + x0) * 4;
        const idx10 = (y0 * srcW + x1) * 4;
        const idx01 = (y1 * srcW + x0) * 4;
        const idx11 = (y1 * srcW + x1) * 4;

        dst[dstIdx] =
          src[idx00] * w00 + src[idx10] * w10 + src[idx01] * w01 + src[idx11] * w11;
        dst[dstIdx + 1] =
          src[idx00 + 1] * w00 +
          src[idx10 + 1] * w10 +
          src[idx01 + 1] * w01 +
          src[idx11 + 1] * w11;
        dst[dstIdx + 2] =
          src[idx00 + 2] * w00 +
          src[idx10 + 2] * w10 +
          src[idx01 + 2] * w01 +
          src[idx11 + 2] * w11;
        dst[dstIdx + 3] = 255;
        dstIdx += 4;
      }
    }

    ctx.putImageData(outImageData, 0, 0);
    const dataUrl = outCanvas.toDataURL('image/jpeg', 0.9);
    const commaIdx = dataUrl.indexOf(',');
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
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

  private loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }
}
