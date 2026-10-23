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
import { AskQuestionResponse, DescribeImageResponse } from './api_service';
import {
  AiPluginConfig,
  ConfigService,
  interpolateUrlTemplate,
} from './config_service';

export const CHAT_PREAMBLE =
  'You can only answer questions about the visual scene and landmarks to ' +
  'support blind and low vision travelers. If asked about anything else, ' +
  "including the people who live in an area, the area's political " +
  'affiliation, house prices, or other tasks, you must refuse to answer ' +
  'that. We do not want to track any individual pedestrians or cars, such ' +
  'as tracking license plates. We do not allow bulk downloading or scraping.';

export const DESCRIPTION_PROMPT = `
Provide a brief (2-3 sentence) description of the current image. This will be shared with a blind traveler. The goal is to describe the area depicted rather than the specific image, so do not describe ephemeral elements like weather or cars, instead focus on the street layout, nearby buildings and other features.
`.trim();

export function buildQuestionPrompt(
  question: string,
  detectActions: boolean
): string {
  if (!detectActions) {
    return `${CHAT_PREAMBLE}\n\nAnswer this question about the street view image accurately: ${question}`;
  }
  return `${CHAT_PREAMBLE}

You are an assistant for a blind traveler. You are looking at a Street View panorama.
The user has said: "${question}"

Instructions:
1. Answer any questions accurately based on the visual information.
2. If the user expresses an intent to move or turn (e.g., "turn left", "go forward", "what's behind me?"), identify the corresponding action.
3. If no specific navigational action is requested, set the navigationalAction to "NONE".

Supported Action Types:
- TURN_LEFT: User wants to rotate left.
- TURN_RIGHT: User wants to rotate right.
- TURN_AROUND: User wants to face the opposite direction.
- MOVE_FORWARD: User wants to move to the next panorama in front of them.
- MOVE_BACKWARD: User wants to move to the panorama behind them.`;
}

const VALID_ACTIONS = new Set([
  'TURN_LEFT',
  'TURN_RIGHT',
  'TURN_AROUND',
  'MOVE_FORWARD',
  'MOVE_BACKWARD',
  'NONE',
]);

function normalizeAction(
  raw: unknown
): AskQuestionResponse['navigationalAction'] {
  const s = String(raw || 'NONE')
    .trim()
    .toUpperCase();
  return VALID_ACTIONS.has(s)
    ? (s as AskQuestionResponse['navigationalAction'])
    : 'NONE';
}

function stripDataUrlPrefix(base64OrDataUrl: string): string {
  const idx = base64OrDataUrl.indexOf(',');
  return idx >= 0 ? base64OrDataUrl.slice(idx + 1) : base64OrDataUrl;
}

@Injectable({
  providedIn: 'root',
})
export class AiProviderService {
  private readonly config = inject(ConfigService);

  private getActivePlugin(): AiPluginConfig {
    const plugin = this.config.getAiPlugin();
    if (!plugin) {
      throw new Error(
        `AI provider "${this.config.aiProvider()}" is not defined in streetreaderai.conf.`
      );
    }
    return plugin;
  }

  private ensurePluginKey(plugin: AiPluginConfig): string {
    if (!plugin.requiresKey) return '';
    const key = this.config.getKeyByName(plugin.requiresKey);
    if (!key) {
      throw new Error(
        `Missing required key "${plugin.requiresKey}" for AI provider "${plugin.name}". Set it in streetreaderai.conf or streetreaderai.local.conf.`
      );
    }
    return key;
  }

  async describeImage(imageBase64: string): Promise<DescribeImageResponse> {
    if (!imageBase64) {
      throw new Error('Missing image data.');
    }
    const cleanBase64 = stripDataUrlPrefix(imageBase64);
    const plugin = this.getActivePlugin();
    const description =
      plugin.wireFormat === 'openai'
        ? await this.openaiDescribe(plugin, cleanBase64)
        : await this.geminiDescribe(plugin, cleanBase64);
    return { description };
  }

  async askQuestion(
    imageBase64: string,
    question: string,
    detectActions: boolean = false
  ): Promise<AskQuestionResponse> {
    if (!imageBase64 || !question) {
      throw new Error('Missing image or question.');
    }
    const cleanBase64 = stripDataUrlPrefix(imageBase64);
    const plugin = this.getActivePlugin();
    return plugin.wireFormat === 'openai'
      ? this.openaiAsk(plugin, cleanBase64, question, detectActions)
      : this.geminiAsk(plugin, cleanBase64, question, detectActions);
  }

  // =====================================================================
  // Gemini Wire Format (`wire_format = gemini`)
  // =====================================================================

  private async fetchGemini(
    plugin: AiPluginConfig,
    body: Record<string, unknown>
  ): Promise<Response> {
    const apiKey = this.ensurePluginKey(plugin);
    const url = interpolateUrlTemplate(plugin.endpointUrl, {
      model: plugin.modelId,
      apiKey,
    });
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async geminiDescribe(
    plugin: AiPluginConfig,
    cleanBase64: string
  ): Promise<string> {
    const resp = await this.fetchGemini(plugin, {
      contents: [
        {
          parts: [
            { text: DESCRIPTION_PROMPT },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            description: { type: 'STRING' },
          },
          required: ['description'],
        },
      },
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(
        `AI API error (HTTP ${resp.status}): ${errBody.slice(0, 200)}`
      );
    }

    const data = await resp.json();
    const rawText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    try {
      const parsed = JSON.parse(rawText);
      if (parsed?.description) {
        return String(parsed.description);
      }
    } catch {
      // If plain text returned, return directly
    }
    return String(rawText).trim();
  }

  private async geminiAsk(
    plugin: AiPluginConfig,
    cleanBase64: string,
    question: string,
    detectActions: boolean
  ): Promise<AskQuestionResponse> {
    const prompt = buildQuestionPrompt(question, detectActions);
    const resp = await this.fetchGemini(plugin, {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            answer: { type: 'STRING' },
            navigationalAction: {
              type: 'STRING',
              enum: [
                'TURN_LEFT',
                'TURN_RIGHT',
                'TURN_AROUND',
                'MOVE_FORWARD',
                'MOVE_BACKWARD',
                'NONE',
              ],
            },
          },
          required: ['answer', 'navigationalAction'],
        },
      },
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(
        `AI API error (HTTP ${resp.status}): ${errBody.slice(0, 200)}`
      );
    }

    const data = await resp.json();
    const rawText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    try {
      const parsed = JSON.parse(rawText);
      return {
        answer: String(parsed?.answer || rawText),
        navigationalAction: detectActions
          ? normalizeAction(
              parsed?.navigationalAction ?? parsed?.action_type
            )
          : 'NONE',
      };
    } catch {
      return {
        answer: String(rawText).trim(),
        navigationalAction: 'NONE',
      };
    }
  }

  // =====================================================================
  // OpenAI Chat Completions Wire Format (`wire_format = openai`)
  // =====================================================================

  private async openaiDescribe(
    plugin: AiPluginConfig,
    cleanBase64: string
  ): Promise<string> {
    const key = this.ensurePluginKey(plugin);
    const resp = await fetch(plugin.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: plugin.modelId,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DESCRIPTION_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${cleanBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(
        `AI API error (HTTP ${resp.status}): ${errBody.slice(0, 200)}`
      );
    }

    const data = await resp.json();
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  private async openaiAsk(
    plugin: AiPluginConfig,
    cleanBase64: string,
    question: string,
    detectActions: boolean
  ): Promise<AskQuestionResponse> {
    const key = this.ensurePluginKey(plugin);
    const prompt = buildQuestionPrompt(question, detectActions);

    const resp = await fetch(plugin.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: plugin.modelId,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'chat_response',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                answer: { type: 'string' },
                navigationalAction: {
                  type: 'string',
                  enum: [
                    'TURN_LEFT',
                    'TURN_RIGHT',
                    'TURN_AROUND',
                    'MOVE_FORWARD',
                    'MOVE_BACKWARD',
                    'NONE',
                  ],
                },
              },
              required: ['answer', 'navigationalAction'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${cleanBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(
        `AI API error (HTTP ${resp.status}): ${errBody.slice(0, 200)}`
      );
    }

    const data = await resp.json();
    const rawContent = data?.choices?.[0]?.message?.content || '{}';
    try {
      const parsed = JSON.parse(rawContent);
      return {
        answer: String(parsed?.answer || rawContent),
        navigationalAction: detectActions
          ? normalizeAction(parsed?.navigationalAction)
          : 'NONE',
      };
    } catch {
      return {
        answer: String(rawContent).trim(),
        navigationalAction: 'NONE',
      };
    }
  }
}
