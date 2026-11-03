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

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { GoogleGenAI } from '@google/genai';
import express from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_STREETREADER_CONF,
  ParsedConfSections,
  parseConfIni,
  SERVER_ENV_KEY_PREFIX,
  SERVER_KEY_PREFIX,
} from './app/services/config_service';

const DEFAULT_ALLOWED_HOSTS = new Set<string>([
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'graph.mapillary.com',
  'maps.googleapis.com',
  'places.googleapis.com',
  'api.panoramax.xyz',
  'nominatim.openstreetmap.org',
]);

interface ServerConfigState {
  sections: ParsedConfSections;
  secretKeys: Map<string, string>;
  envKeys: Set<string>;
  allowedHosts: Set<string>;
}

function readConfIfExists(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // Ignore file read errors
  }
  return null;
}

export function loadServerConfigState(rootDir: string = process.cwd()): ServerConfigState {
  let sections = parseConfIni(DEFAULT_STREETREADER_CONF);

  const confFiles = [
    'streetreaderai.conf.example',
    'models.conf.example',
    'streetreaderai.conf',
    'models.conf',
  ];
  for (const fileName of confFiles) {
    const content = readConfIfExists(path.join(rootDir, fileName));
    if (content) {
      sections = parseConfIni(content, sections);
    }
  }

  if (!sections['keys']) {
    sections['keys'] = {};
  }

  const secretKeys = new Map<string, string>();
  const envKeys = new Set<string>();

  for (const [k, v] of Object.entries(sections['keys'])) {
    const trimmed = (v || '').trim();
    if (trimmed) {
      secretKeys.set(k.toLowerCase(), trimmed);
    }
  }

  const envMappings: Array<{ keyName: string; envNames: string[] }> = [
    { keyName: 'gemini_api_key', envNames: ['GEMINI_API_KEY', 'API_KEY'] },
    { keyName: 'openai_api_key', envNames: ['OPENAI_API_KEY'] },
    { keyName: 'mapillary_token', envNames: ['MAPILLARY_TOKEN'] },
    { keyName: 'google_maps_api_key', envNames: ['GOOGLE_MAPS_API_KEY'] },
  ];

  for (const { keyName, envNames } of envMappings) {
    for (const envName of envNames) {
      const envVal = process.env[envName]?.trim();
      if (envVal) {
        secretKeys.set(keyName, envVal);
        envKeys.add(keyName);
        break;
      }
    }
  }

  const allowedHosts = new Set<string>(DEFAULT_ALLOWED_HOSTS);
  for (const sec of Object.values(sections)) {
    for (const [k, v] of Object.entries(sec)) {
      if (k.endsWith('_url') && v) {
        try {
          const sampleUrl = v.replace(/\{[a-zA-Z0-9_]+\}/g, 'placeholder');
          const parsed = new URL(sampleUrl);
          if (parsed.hostname) {
            allowedHosts.add(parsed.hostname.toLowerCase());
          }
        } catch {
          // Ignore relative or non-standard URLs
        }
      }
    }
  }

  return { sections, secretKeys, envKeys, allowedHosts };
}

export function serializeRedactedConf(state: ServerConfigState): string {
  const lines: string[] = [];
  const allSectionNames = new Set<string>([
    ...Object.keys(state.sections),
    'keys',
  ]);

  for (const secName of allSectionNames) {
    lines.push(`[${secName}]`);
    if (secName === 'keys') {
      const allKeyNames = new Set<string>([
        ...Object.keys(state.sections['keys'] || {}),
        ...state.secretKeys.keys(),
      ]);
      for (const k of allKeyNames) {
        const lower = k.toLowerCase();
        const hasSecret = Boolean(state.secretKeys.get(lower));
        if (!hasSecret) {
          lines.push(`${lower} =`);
        } else if (state.envKeys.has(lower)) {
          lines.push(`${lower} = ${SERVER_ENV_KEY_PREFIX}${lower}__`);
        } else {
          lines.push(`${lower} = ${SERVER_KEY_PREFIX}${lower}__`);
        }
      }
    } else {
      const sec = state.sections[secName] || {};
      for (const [k, v] of Object.entries(sec)) {
        lines.push(`${k} = ${v}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function replaceServerKeyPlaceholders(
  input: string,
  secretKeys: Map<string, string>
): { output: string; resolvedKeys: string[] } {
  const resolvedKeys: string[] = [];
  const replaceFn = (_match: string, keyName: string): string => {
    const lower = keyName.toLowerCase();
    const secret = secretKeys.get(lower);
    if (secret) {
      resolvedKeys.push(lower);
      return secret;
    }
    return '';
  };

  let output = input.replace(
    /__SERVER_KEY(?:_ENV)?:([a-zA-Z0-9_]+)__/g,
    replaceFn
  );
  output = output.replace(
    /__SERVER_KEY(?:_ENV)?%3A([a-zA-Z0-9_]+)__/gi,
    (_m, keyName: string) => encodeURIComponent(replaceFn(_m, keyName))
  );
  output = output.replace(
    /%5F%5FSERVER_KEY(?:_ENV)?%3A([a-zA-Z0-9_]+)%5F%5F/gi,
    (_m, keyName: string) => encodeURIComponent(replaceFn(_m, keyName))
  );
  return { output, resolvedKeys };
}

const app = express();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: ['*'],
});

app.use('/api', express.json({ limit: '2048mb' }));

/**
 * Returns the merged INI configuration with all secret values under `[keys]`
 * replaced by server-side placeholders (`__SERVER_KEY:<name>__`).
 */
app.get('/api/config', (_req, res) => {
  const state = loadServerConfigState();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(serializeRedactedConf(state));
});

/**
 * Server-side key-stamping proxy for external provider requests.
 * Uses `@google/genai` with `User-Agent: aistudio-build` for Gemini requests.
 */
app.post('/api/proxy', async (req, res) => {
  try {
    const state = loadServerConfigState();
    const {
      url: rawUrl,
      method = 'GET',
      headers: rawHeaders = {},
      body: rawBody,
    } = (req.body || {}) as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };

    if (!rawUrl || typeof rawUrl !== 'string') {
      res.status(400).json({ error: 'Missing target url in /api/proxy request.' });
      return;
    }

    const { output: resolvedUrl } = replaceServerKeyPlaceholders(
      rawUrl,
      state.secretKeys
    );

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(resolvedUrl);
    } catch {
      res.status(400).json({ error: 'Invalid target url in /api/proxy request.' });
      return;
    }

    const targetHost = parsedUrl.hostname.toLowerCase();
    if (!state.allowedHosts.has(targetHost)) {
      res.status(403).json({
        error: `Target host "${targetHost}" is not in the configured provider allowlist.`,
      });
      return;
    }

    const resolvedHeaders: Record<string, string> = {};
    for (const [hk, hv] of Object.entries(rawHeaders || {})) {
      if (typeof hv === 'string') {
        resolvedHeaders[hk] = replaceServerKeyPlaceholders(
          hv,
          state.secretKeys
        ).output;
      }
    }

    // Use @google/genai SDK on the server when calling standard Gemini generateContent
    const geminiMatch = parsedUrl.pathname.match(
      /\/models\/([^/:]+):generateContent$/
    );
    if (
      targetHost === 'generativelanguage.googleapis.com' &&
      geminiMatch &&
      method.toUpperCase() === 'POST' &&
      rawBody
    ) {
      const modelId = decodeURIComponent(geminiMatch[1]);
      const apiKey =
        state.secretKeys.get('gemini_api_key') ||
        process.env['GEMINI_API_KEY'] ||
        process.env['API_KEY'] ||
        parsedUrl.searchParams.get('key') ||
        '';
      const parsedBody = JSON.parse(rawBody) as {
        contents?: unknown;
        generationConfig?: Record<string, unknown>;
      };

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const sdkResponse = await ai.models.generateContent({
        model: modelId,
        contents: parsedBody.contents as Parameters<
          typeof ai.models.generateContent
        >[0]['contents'],
        config: parsedBody.generationConfig as Parameters<
          typeof ai.models.generateContent
        >[0]['config'],
      });

      res.status(200).json(sdkResponse);
      return;
    }

    if (targetHost === 'generativelanguage.googleapis.com') {
      resolvedHeaders['User-Agent'] = 'aistudio-build';
    }

    const upstreamResp = await fetch(resolvedUrl, {
      method,
      headers: resolvedHeaders,
      body:
        method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD'
          ? rawBody
          : undefined,
    });

    res.status(upstreamResp.status);
    const contentType = upstreamResp.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const arrayBuf = await upstreamResp.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

/**
 * Serve static files from /browser in production builds.
 */
const browserDistFolder = path.resolve(import.meta.dirname, '../browser');
if (fs.existsSync(browserDistFolder)) {
  app.use(
    express.static(browserDistFolder, {
      maxAge: '1y',
      index: false,
      redirect: false,
    })
  );
}

/**
 * Handle all other requests by serving the Angular CSR application shell.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next()
    )
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4200;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
