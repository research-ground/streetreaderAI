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
import { vi } from 'vitest';
import { AiProviderService, formatApiErrorResponse } from './ai_provider_service';
import { clearAllClientCaches } from './client_cache';
import { ConfigService, describeError } from './config_service';
import { ImageryProviderService } from './imagery_provider_service';
import { LocationProviderService } from './location_provider_service';
import { blobToBase64 } from './panorama_crop_service';

describe('Declarative Provider Plugins (.conf)', () => {
  beforeEach(() => {
    clearAllClientCaches();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearAllClientCaches();
  });

  it('ImageryProviderService executes retrieval_type=sequence + image_format=360 plugins via URL templates and dot-paths', async () => {
    const config = TestBed.inject(ConfigService);
    config.applyConfText(`
[system]
imagery_provider = seq_plugin

[imagery.seq_plugin]
retrieval_type = sequence
image_format = 360
bbox_url = https://example.com/bbox?bounds={minLng},{minLat},{maxLng},{maxLat}
sequence_url = https://example.com/seq/{sequenceId}
metadata_url = https://example.com/item/{imageId}
items_path = records
id_field = uid
lat_field = geo.lat
lng_field = geo.lon
heading_field = meta.yaw
capture_time_field = meta.ts
sequence_field = meta.track_id
thumb_url_field = links.pano_hd
    `);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/bbox') || url.includes('/seq/')) {
        return new Response(
          JSON.stringify({
            records: [
              {
                uid: 'img_101',
                geo: { lat: 47.65, lon: -122.35 },
                meta: { yaw: 180, ts: '2026-01-01T00:00:00Z', track_id: 'trk_9' },
                links: { pano_hd: 'https://example.com/pano101.jpg' },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });

    const imagery = TestBed.inject(ImageryProviderService);
    const plugin = config.getImageryPlugin('seq_plugin');
    expect(plugin?.retrievalType).toBe('sequence');
    expect(plugin?.imageFormat).toBe('360');

    const bboxItems = await imagery.getMetadataBbox(47.64, -122.36, 47.66, -122.34);
    expect(bboxItems.length).toBe(1);
    expect(bboxItems[0].imageId).toBe('img_101');
    expect(bboxItems[0].sequenceId).toBe('trk_9');
    expect(bboxItems[0].heading).toBe(180);
    expect(bboxItems[0].thumbUrl).toBe('https://example.com/pano101.jpg');

    const seqItems = await imagery.getSequence('trk_9');
    expect(seqItems.length).toBe(1);
    expect(seqItems[0].imageId).toBe('img_101');
  });

  it('ImageryProviderService falls back across candidate URLs in thumb_url_field when the primary URL fails', async () => {
    const config = TestBed.inject(ConfigService);
    config.applyConfText(`
[system]
imagery_provider = panoramax
    `);

    const attemptedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('api.panoramax.xyz/api/search?ids=')) {
        return new Response(
          JSON.stringify({
            features: [
              {
                id: 'pano_fallback_1',
                geometry: { coordinates: [-122.3497, 47.6492] },
                collection: 'seq_1',
                properties: {
                  'view:azimuth': 90,
                  datetime: '2026-01-01T00:00:00Z',
                },
                assets: {
                  sd: { href: 'https://pano.locus.sbs/api/pictures/pano_fallback_1/sd.jpg' },
                  hd: { href: 'https://pano.locus.sbs/api/pictures/pano_fallback_1/hd.jpg' },
                  thumb: { href: 'https://pano.locus.sbs/api/pictures/pano_fallback_1/thumb.jpg' },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/sd.jpg')) {
        attemptedUrls.push(url);
        throw new TypeError('Failed to fetch');
      }
      if (url.endsWith('/hd.jpg')) {
        attemptedUrls.push(url);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    const imagery = TestBed.inject(ImageryProviderService);
    const meta = await imagery.getMetadata('pano_fallback_1');
    expect(meta?.thumbUrl).toBe('https://pano.locus.sbs/api/pictures/pano_fallback_1/sd.jpg');
    expect(meta?.thumbUrls).toEqual([
      'https://pano.locus.sbs/api/pictures/pano_fallback_1/sd.jpg',
      'https://pano.locus.sbs/api/pictures/pano_fallback_1/hd.jpg',
      'https://pano.locus.sbs/api/pictures/pano_fallback_1/thumb.jpg',
    ]);

    const rendered = await imagery.getImage('pano_fallback_1', 90);
    expect(attemptedUrls).toEqual([
      'https://pano.locus.sbs/api/pictures/pano_fallback_1/sd.jpg',
      'https://pano.locus.sbs/api/pictures/pano_fallback_1/hd.jpg',
    ]);
    expect(rendered).toBeTruthy();
    expect(rendered?.imageId).toBe('pano_fallback_1');
  });

  it('ImageryProviderService executes retrieval_type=image + image_format=single plugins for point lookup and directional viewports', async () => {
    const config = TestBed.inject(ConfigService);
    config.applyConfText(`
[system]
imagery_provider = single_plugin

[keys]
single_key = KeyABC

[imagery.single_plugin]
retrieval_type = image
image_format = single
requires_key = single_key
point_url = https://example.com/point?lat={lat}&lng={lng}&r={radius}&key={apiKey}
metadata_url = https://example.com/point?id={imageId}&key={apiKey}
image_url = https://example.com/render?id={imageId}&h={heading}&p={pitch}&key={apiKey}
id_field = pano_id
lat_field = location.lat
lng_field = location.lng
capture_time_field = date
    `);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/point')) {
        return new Response(
          JSON.stringify({
            pano_id: 'pt_77',
            location: { lat: 47.62, lng: -122.31 },
            date: '2025-09',
          }),
          { status: 200 }
        );
      }
      if (url.includes('/render')) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    const imagery = TestBed.inject(ImageryProviderService);
    const plugin = config.getImageryPlugin('single_plugin');
    expect(plugin?.retrievalType).toBe('image');
    expect(plugin?.imageFormat).toBe('single');

    const meta = await imagery.getMetadata('pt_77');
    expect(meta?.imageId).toBe('pt_77');
    expect(meta?.coordinates).toEqual({ latitude: 47.62, longitude: -122.31 });

    const bboxPointItems = await imagery.getMetadataBbox(47.6199, -122.3101, 47.6201, -122.3099);
    expect(bboxPointItems.length).toBeGreaterThanOrEqual(1);
    expect(bboxPointItems[0].imageId).toBe('pt_77');

    const rendered = await imagery.getImage('pt_77', 270, 5);
    expect(rendered?.imageId).toBe('pt_77');
    expect(rendered?.actualHeading).toBe(270);
    expect((rendered?.image || '').length).toBeGreaterThan(0);
  });

  it('LocationProviderService executes declarative geocode, reverse_geocode, and autocomplete URLs', async () => {
    const config = TestBed.inject(ConfigService);
    config.applyConfText(`
[system]
location_provider = custom_geo

[location.custom_geo]
geocode_url = https://example.com/geo?q={address}
reverse_geocode_url = https://example.com/rev?lat={lat}&lng={lng}
autocomplete_url = https://example.com/auto?q={query}
items_path = matches
lat_field = pos.lat
lng_field = pos.lon
address_field = full_label
street_field = road_name
place_id_field = pid
    `);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/geo') || url.includes('/rev')) {
        return new Response(
          JSON.stringify({
            matches: [
              {
                pos: { lat: 47.6501, lon: -122.3499 },
                full_label: '601 N 34th St, Seattle, WA',
                road_name: 'N 34th St',
                pid: 'place_1',
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/auto')) {
        return new Response(
          JSON.stringify({
            matches: [
              { full_label: '601 N 34th St, Seattle, WA', pid: 'place_1' },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });

    const loc = TestBed.inject(LocationProviderService);
    const geo = await loc.geocode('601 N 34th St');
    expect(geo).toBeTruthy();
    expect(geo!.lat).toBeCloseTo(47.6501, 4);
    expect(geo!.street).toBe('N 34th St');

    const rev = await loc.reverseGeocode(47.6501, -122.3499);
    expect(rev).toBe('601 N 34th St, Seattle, WA');

    const auto = await loc.autocomplete('601 N 34th');
    expect(auto.suggestions).toEqual([
      { description: '601 N 34th St, Seattle, WA', placeId: 'place_1' },
    ]);
  });

  it('AiProviderService executes declarative wire_format=gemini and wire_format=openai plugins', async () => {
    const config = TestBed.inject(ConfigService);
    const ai = TestBed.inject(AiProviderService);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (
        url.includes('generativelanguage.googleapis.com') ||
        url === '/api/proxy'
      ) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer: 'There is a crosswalk ahead.',
                        navigationalAction: 'MOVE_FORWARD',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('api.openai.com')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Brick storefront with a coffee shop awning.',
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });

    // 1. Gemini wire format
    config.applyConfText(`
[system]
ai_provider = gemini

[keys]
gemini_api_key = TestGeminiKey
    `);
    const askRes = await ai.askQuestion('base64img', 'Can I walk forward?', true);
    expect(askRes.answer).toBe('There is a crosswalk ahead.');
    expect(askRes.navigationalAction).toBe('MOVE_FORWARD');

    // 2. OpenAI wire format
    config.applyConfText(`
[system]
ai_provider = openai

[keys]
openai_api_key = TestOpenAiKey
    `);
    const descRes = await ai.describeImage('base64img');
    expect(descRes.description).toBe(
      'Brick storefront with a coffee shop awning.'
    );
  });

  it('restores the real upstream status from X-Upstream-Status (AI Studio-safe proxy errors)', async () => {
    const config = TestBed.inject(ConfigService);
    const ai = TestBed.inject(AiProviderService);
    config.applyConfText(`
[system]
ai_provider = gemini

[keys]
gemini_api_key = TestGeminiKey
    `);
    // What src/server.ts sends for a Gemini 503: HTTP 200 + header + JSON error
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 503,
            status: 'UNAVAILABLE',
            message: 'This model is currently experiencing high demand.',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Upstream-Status': '503' },
        }
      )
    );
    const msg = await ai.describeImage('base64img').catch((e: Error) => e.message);
    expect(msg).toBe(
      'gemini API error (HTTP 503 (UNAVAILABLE)): This model is currently experiencing high demand.'
    );
  });

  it('describeImage errors report HTTP codes and never include HTML bodies', async () => {
    const config = TestBed.inject(ConfigService);
    const ai = TestBed.inject(AiProviderService);
    config.applyConfText(`
[system]
ai_provider = gemini

[keys]
gemini_api_key = TestGeminiKey
    `);
    const html = '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // HTML error page with a failing status
    fetchSpy.mockResolvedValueOnce(
      new Response(html, {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const err502 = await ai.describeImage('base64img').catch((e: Error) => e.message);
    expect(err502).toContain('HTTP 502');
    expect(err502).not.toContain('<');

    // HTML page returned with HTTP 200 (e.g. an SPA fallback or login page)
    fetchSpy.mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
    );
    const err200 = await ai.describeImage('base64img').catch((e: Error) => e.message);
    expect(err200).toContain('HTTP 200');
    expect(err200).toMatch(/instead of JSON|replaced by/);
    expect(err200).not.toContain('<');

    // JSON error from Gemini keeps its code, status, and message
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const err429 = await ai.describeImage('base64img').catch((e: Error) => e.message);
    expect(err429).toContain('HTTP 429 (RESOURCE_EXHAUSTED)');
    expect(err429).toContain('Quota exceeded.');
  });

  it('describeError never surfaces raw JSON parse errors containing HTML', () => {
    let parseErr: unknown;
    try {
      JSON.parse('<!DOCTYPE html><html></html>');
    } catch (e) {
      parseErr = e;
    }
    expect(describeError(parseErr)).not.toContain('<');
  });

  it('formatApiErrorResponse preserves HTTP 503, 429, and strips raw HTML error bodies', () => {
    const err503 = formatApiErrorResponse(
      'gemini',
      503,
      'Service Unavailable',
      JSON.stringify({
        error: {
          code: 503,
          status: 'UNAVAILABLE',
          message: 'The model is overloaded. Please try again later.',
        },
      })
    );
    expect(err503).toContain('HTTP 503 (UNAVAILABLE)');
    expect(err503).toContain('The model is overloaded. Please try again later.');

    const err429 = formatApiErrorResponse(
      'gemini',
      429,
      'Too Many Requests',
      JSON.stringify({
        error: JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'You exceeded your current quota.',
          },
        }),
      })
    );
    expect(err429).toContain('HTTP 429 (RESOURCE_EXHAUSTED)');
    expect(err429).toContain('You exceeded your current quota.');

    const errHtml = formatApiErrorResponse(
      'gemini',
      503,
      'Service Unavailable',
      '<!DOCTYPE html><html><body>503 Service Unavailable</body></html>'
    );
    expect(errHtml).toContain('HTTP 503');
    expect(errHtml).toContain('Service Unavailable');
    expect(errHtml).not.toContain('<!DOCTYPE');
  });

  it('blobToBase64 handles both cross-realm native Blobs (via arrayBuffer) and JSDOM Blobs (via FileReader)', async () => {
    // 1. Cross-realm Blob-like object (reproduces JSDOM FileReader "parameter 1 is not of type 'Blob'" if FileReader is called)
    const crossRealmBlob = {
      size: 4,
      type: 'image/jpeg',
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    } as unknown as Blob;
    expect(await blobToBase64(crossRealmBlob)).toBe('/9j/2Q==');

    // 2. JSDOM Blob (falls back to FileReader if arrayBuffer() is absent)
    const jsdomBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: 'image/jpeg',
    });
    expect(await blobToBase64(jsdomBlob)).toBe('/9j/2Q==');
  });
});
