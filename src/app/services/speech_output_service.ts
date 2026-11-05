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

import { Injectable, computed, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { formatApiErrorResponse } from './ai_provider_service';
import { ConfigService, interpolateUrlTemplate } from './config_service';
import { safeStorage } from './safe_storage';

export type SpeechEngine = 'local' | 'gemini';

export interface GeminiVoice {
  name: string;
  style: string;
}

/** Gemini TTS prebuilt voices. */
export const GEMINI_VOICES: readonly GeminiVoice[] = [
  { name: 'Kore', style: 'Firm' },
  { name: 'Puck', style: 'Upbeat' },
  { name: 'Charon', style: 'Informative' },
  { name: 'Zephyr', style: 'Bright' },
  { name: 'Fenrir', style: 'Excitable' },
  { name: 'Leda', style: 'Youthful' },
  { name: 'Orus', style: 'Firm' },
  { name: 'Aoede', style: 'Breezy' },
  { name: 'Callirrhoe', style: 'Easy-going' },
  { name: 'Autonoe', style: 'Bright' },
  { name: 'Enceladus', style: 'Breathy' },
  { name: 'Iapetus', style: 'Clear' },
  { name: 'Umbriel', style: 'Easy-going' },
  { name: 'Algieba', style: 'Smooth' },
  { name: 'Despina', style: 'Smooth' },
  { name: 'Erinome', style: 'Clear' },
  { name: 'Algenib', style: 'Gravelly' },
  { name: 'Rasalgethi', style: 'Informative' },
  { name: 'Laomedeia', style: 'Upbeat' },
  { name: 'Achernar', style: 'Soft' },
  { name: 'Alnilam', style: 'Firm' },
  { name: 'Schedar', style: 'Even' },
  { name: 'Gacrux', style: 'Mature' },
  { name: 'Pulcherrima', style: 'Forward' },
  { name: 'Achird', style: 'Friendly' },
  { name: 'Zubenelgenubi', style: 'Casual' },
  { name: 'Vindemiatrix', style: 'Gentle' },
  { name: 'Sadachbia', style: 'Lively' },
  { name: 'Sadaltager', style: 'Knowledgeable' },
  { name: 'Sulafat', style: 'Warm' },
];

const DEFAULT_GEMINI_VOICE = 'Kore';
const GEMINI_AUDIO_CACHE_MAX = 50;

function isEnglishVoice(v: SpeechSynthesisVoice): boolean {
  return (v.lang || '').toLowerCase().startsWith('en');
}

/** Wraps raw 16-bit mono PCM samples in a WAV container. */
export function pcm16ToWavBlob(pcm: Uint8Array, sampleRate: number): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm as BlobPart], { type: 'audio/wav' });
}

@Injectable({
  providedIn: 'root'
})
export class SpeechOutputService {
  private readonly config = inject(ConfigService);
  private readonly snackBar = inject(MatSnackBar);

  private readonly ENABLED_KEY = 'streetreader_speech_enabled';
  private readonly RATE_KEY = 'streetreader_speech_rate';
  private readonly VOICE_KEY = 'streetreader_speech_voice';
  private readonly ENGINE_KEY = 'streetreader_speech_engine';
  private readonly GEMINI_VOICE_KEY = 'streetreader_gemini_voice';

  private isEnabled = signal(safeStorage.getItem(this.ENABLED_KEY) !== 'false'); // Default to true
  private currentVoice = signal<SpeechSynthesisVoice | null>(null);
  private speechRate = signal(parseFloat(safeStorage.getItem(this.RATE_KEY) || '1.1'));
  private synthesis = window.speechSynthesis;
  private voices = signal<SpeechSynthesisVoice[]>([]);
  private speechEngine = signal<SpeechEngine>(
    safeStorage.getItem(this.ENGINE_KEY) === 'gemini' ? 'gemini' : 'local'
  );
  private geminiVoiceName = signal<string>(
    safeStorage.getItem(this.GEMINI_VOICE_KEY) || DEFAULT_GEMINI_VOICE
  );

  /**
   * ROBUSTNESS FIX: We maintain a strong reference to the current utterance object.
   * In Chromium-based browsers, if an utterance is garbage-collected before it finishes,
   * the 'onend' event may never fire, which can wedge the entire browser's speech queue.
   */
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  private queue: string[] = [];
  private isSpeakingInternal = false;
  private failsafeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Incremented on stop() so in-flight Gemini requests/playback are discarded. */
  private generation = 0;
  private geminiAbort: AbortController | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private finishCurrentAudio: (() => void) | null = null;
  private readonly geminiAudioCache = new Map<string, Blob>();

  readonly enabled = this.isEnabled.asReadonly();
  readonly rate = this.speechRate.asReadonly();
  readonly selectedVoice = this.currentVoice.asReadonly();
  /** English-only local (browser/OS) voices. */
  readonly availableVoices = computed(() => this.voices().filter(isEnglishVoice));
  readonly engine = this.speechEngine.asReadonly();
  readonly geminiVoice = this.geminiVoiceName.asReadonly();
  readonly geminiVoices = GEMINI_VOICES;

  constructor() {
    if (this.synthesis) {
      const loadVoices = () => {
        const availableVoices = this.synthesis.getVoices().filter(isEnglishVoice);
        this.voices.set(availableVoices);

        // Try to recover the saved voice by name
        const savedVoiceName = safeStorage.getItem(this.VOICE_KEY);
        if (savedVoiceName) {
          const matchedVoice = availableVoices.find(v => v.name === savedVoiceName);
          if (matchedVoice) this.currentVoice.set(matchedVoice);
        }

        if (availableVoices.length > 0 && !this.currentVoice()) {
          this.currentVoice.set(this.pickDefaultVoice(availableVoices));
        }
      };

      loadVoices();
      if (this.synthesis.onvoiceschanged !== undefined) {
        this.synthesis.onvoiceschanged = loadVoices;
      }
    }
  }

  /** Prefer a local OS English voice first, then any English voice. */
  private pickDefaultVoice(englishVoices: SpeechSynthesisVoice[]): SpeechSynthesisVoice {
    return englishVoices.find(v => v.localService) || englishVoices[0];
  }

  setEnabled(enabled: boolean) {
    safeStorage.setItem(this.ENABLED_KEY, enabled.toString());
    this.isEnabled.set(enabled);
    if (!enabled) {
      this.stop();
    }
  }

  setRate(rate: number) {
    safeStorage.setItem(this.RATE_KEY, rate.toString());
    this.speechRate.set(rate);
  }

  setVoice(voice: SpeechSynthesisVoice) {
    safeStorage.setItem(this.VOICE_KEY, voice.name);
    this.currentVoice.set(voice);
  }

  setEngine(engine: SpeechEngine) {
    safeStorage.setItem(this.ENGINE_KEY, engine);
    this.stop();
    this.speechEngine.set(engine);
  }

  setGeminiVoice(name: string) {
    safeStorage.setItem(this.GEMINI_VOICE_KEY, name);
    this.geminiVoiceName.set(name);
  }

  speak(text: string, speakNow: boolean = false) {
    if (!this.isEnabled()) return;
    if (this.speechEngine() === 'local' && !this.synthesis) return;

    if (speakNow) {
      this.stop();
      this.queue = [];
    }

    this.queue.push(text);
    if (!this.isSpeakingInternal) {
      this.processQueue();
    }
  }

  private processQueue() {
    if (this.queue.length === 0 || !this.isEnabled()) {
      this.isSpeakingInternal = false;
      this.clearFailsafe();
      return;
    }

    this.isSpeakingInternal = true;
    const text = this.queue.shift()!;
    const generation = this.generation;

    const onFinished = () => {
      // Ignore completions from speech that was cancelled by stop()
      if (generation !== this.generation) return;
      this.clearFailsafe();
      this.isSpeakingInternal = false;
      this.processQueue();
    };

    console.log("Speaking: " + text);
    if (this.speechEngine() === 'gemini') {
      void this.speakWithGemini(text, generation).then(onFinished);
    } else {
      this.speakLocal(text, onFinished);
    }
  }

  private speakLocal(text: string, onFinished: () => void) {
    if (!this.synthesis) {
      onFinished();
      return;
    }

    /**
     * ROBUSTNESS FIX: Explicitly calling resume() before speak().
     * Browsers (especially Chrome) can sometimes enter a 'paused' state internally
     * without an explicit pause() call, preventing any further speech until resume() is hit.
     */
    if (this.synthesis.paused) {
      this.synthesis.resume();
    }

    // If no voice is set, try to load them and set a default.
    if (!this.currentVoice()) {
      const availableVoices = this.synthesis.getVoices().filter(isEnglishVoice);
      if (availableVoices.length > 0) {
        this.voices.set(availableVoices);
        this.currentVoice.set(this.pickDefaultVoice(availableVoices));
      } else {
        console.warn('[SpeechService] No English voices available to speak with.');
        onFinished();
        return;
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.speechRate();
    utterance.voice = this.currentVoice();
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Keep a strong reference to the utterance to prevent GC bugs in Chrome
    this.currentUtterance = utterance;

    utterance.onend = onFinished;
    utterance.onerror = (err) => {
      console.error('[SpeechService] Utterance error:', err);
      onFinished();
    };

    // Failsafe: if the utterance doesn't finish within 15 seconds, force-clear it
    this.startFailsafe(15000);

    this.synthesis.speak(utterance);
  }

  /**
   * Synthesizes `text` with Gemini TTS and plays it. On failure, shows the API
   * error and falls back to the local voice for this utterance.
   */
  private async speakWithGemini(text: string, generation: number): Promise<void> {
    let audioBlob: Blob;
    try {
      audioBlob = await this.fetchGeminiAudio(text);
    } catch (err) {
      if (generation !== this.generation) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[SpeechService] Gemini TTS failed:', msg);
      this.snackBar.open(`Gemini voice unavailable, using local voice. ${msg}`, 'Dismiss', {
        duration: 6000,
        announcementMessage: msg,
      });
      await new Promise<void>((resolve) => this.speakLocal(text, resolve));
      return;
    }
    if (generation !== this.generation) return;

    const url = URL.createObjectURL(audioBlob);
    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = this.speechRate();
    this.currentAudio = audio;

    await new Promise<void>((resolve) => {
      this.finishCurrentAudio = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => {
        console.error('[SpeechService] Gemini audio playback error');
        resolve();
      };
      audio.play().catch((e) => {
        console.error('[SpeechService] Gemini audio play() rejected:', e);
        resolve();
      });
    });

    this.finishCurrentAudio = null;
    if (this.currentAudio === audio) this.currentAudio = null;
    URL.revokeObjectURL(url);
  }

  private async fetchGeminiAudio(text: string): Promise<Blob> {
    const voiceName = this.geminiVoiceName();
    const cacheKey = `${voiceName}|${text}`;
    const cached = this.geminiAudioCache.get(cacheKey);
    if (cached) return cached;

    const tts = this.config.getGeminiTtsConfig();
    if (!tts) {
      throw new Error('Gemini TTS is not configured ([tts.gemini] in streetreaderai.conf).');
    }
    const apiKey = tts.requiresKey ? this.config.getKeyByName(tts.requiresKey) : '';
    if (tts.requiresKey && !apiKey) {
      throw new Error(`Missing required key "${tts.requiresKey}" for Gemini TTS.`);
    }

    this.geminiAbort = new AbortController();
    const resp = await this.config.proxiedFetch(
      interpolateUrlTemplate(tts.endpointUrl, { model: tts.modelId, apiKey }),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
        signal: this.geminiAbort.signal,
      }
    );

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(
        formatApiErrorResponse('Gemini TTS', resp.status, resp.statusText, errBody)
      );
    }

    const data = await resp.json();
    const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> =
      data?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) {
      throw new Error('Gemini TTS returned no audio.');
    }

    const binary = atob(inline.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const mimeType = (inline.mimeType || '').toLowerCase();
    // Some TTS models return a ready-to-play container (e.g. audio/wav); others
    // return raw 16-bit PCM (audio/L16;rate=24000) that needs a WAV header.
    let blob: Blob;
    if (mimeType.includes('l16') || mimeType.includes('pcm')) {
      const rateMatch = /rate=(\d+)/.exec(mimeType);
      blob = pcm16ToWavBlob(bytes, rateMatch ? Number(rateMatch[1]) : 24000);
    } else {
      blob = new Blob([bytes as BlobPart], { type: mimeType || 'audio/wav' });
    }

    this.geminiAudioCache.set(cacheKey, blob);
    if (this.geminiAudioCache.size > GEMINI_AUDIO_CACHE_MAX) {
      const oldest = this.geminiAudioCache.keys().next().value;
      if (oldest !== undefined) this.geminiAudioCache.delete(oldest);
    }
    return blob;
  }

  private startFailsafe(ms: number) {
    this.clearFailsafe();
    /**
     * ROBUSTNESS FIX: Failsafe Timer.
     * The Web Speech API is notoriously flaky. If an utterance gets stuck (common if 
     * there is a network blip or an engine internal error), neither 'onend' nor 'onerror'
     * will fire. This timer ensures the app state resets so navigation isn't silenced forever.
     */
    this.failsafeTimer = setTimeout(() => {
      console.warn('[SpeechService] Failsafe triggered: Speech seems stuck. Resetting state.');
      this.isSpeakingInternal = false;
      this.synthesis.cancel();
      this.processQueue();
    }, ms);
  }

  private clearFailsafe() {
    if (this.failsafeTimer) {
      clearTimeout(this.failsafeTimer);
      this.failsafeTimer = null;
    }
  }

  stop() {
    this.generation++;
    this.clearFailsafe();
    this.isSpeakingInternal = false;
    this.queue = [];

    // Cancel any in-flight Gemini request and playback
    this.geminiAbort?.abort();
    this.geminiAbort = null;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.finishCurrentAudio?.();
    this.finishCurrentAudio = null;

    if (this.synthesis) {
      /**
       * ROBUSTNESS FIX: cancel() is often asynchronous or can fail to clear the 
       * 'paused' flag. We explicitly resume after cancel to ensure the engine 
       * is ready for the next request.
       */
      this.synthesis.cancel();
      this.currentUtterance = null;

      if (this.synthesis.paused) {
        this.synthesis.resume();
      }
    }
  }
}
