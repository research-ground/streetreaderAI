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

import { Injectable, signal } from '@angular/core';
import { safeStorage } from './safe_storage';

@Injectable({
  providedIn: 'root'
})
export class SpeechOutputService {
  private readonly ENABLED_KEY = 'streetreader_speech_enabled';
  private readonly RATE_KEY = 'streetreader_speech_rate';
  private readonly VOICE_KEY = 'streetreader_speech_voice';

  private isEnabled = signal(safeStorage.getItem(this.ENABLED_KEY) !== 'false'); // Default to true
  private currentVoice = signal<SpeechSynthesisVoice | null>(null);
  private speechRate = signal(parseFloat(safeStorage.getItem(this.RATE_KEY) || '1.1'));
  private synthesis = window.speechSynthesis;
  private voices = signal<SpeechSynthesisVoice[]>([]);
  
  /**
   * ROBUSTNESS FIX: We maintain a strong reference to the current utterance object.
   * In Chromium-based browsers, if an utterance is garbage-collected before it finishes,
   * the 'onend' event may never fire, which can wedge the entire browser's speech queue.
   */
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  
  private queue: string[] = [];
  private isSpeakingInternal = false;
  private failsafeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly enabled = this.isEnabled.asReadonly();
  readonly rate = this.speechRate.asReadonly();
  readonly selectedVoice = this.currentVoice.asReadonly();
  readonly availableVoices = this.voices.asReadonly();

  constructor() {
    if (this.synthesis) {
      const loadVoices = () => {
        const availableVoices = this.synthesis.getVoices();
        this.voices.set(availableVoices);
        
        // Try to recover the saved voice by name
        const savedVoiceName = safeStorage.getItem(this.VOICE_KEY);
        if (savedVoiceName) {
          const matchedVoice = availableVoices.find(v => v.name === savedVoiceName);
          if (matchedVoice) this.currentVoice.set(matchedVoice);
        }

        if (availableVoices.length > 0 && !this.currentVoice()) {
          // Prefer 'Google US English' if available, then any English voice, then fallback to first available
          const googleUS = availableVoices.find(v => v.name === 'Google US English');
          const englishVoice = availableVoices.find(v => v.lang.startsWith('en'));
          this.currentVoice.set(googleUS || englishVoice || availableVoices[0]);
        }
      };

      loadVoices();
      if (this.synthesis.onvoiceschanged !== undefined) {
        this.synthesis.onvoiceschanged = loadVoices;
      }
    }
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

  speak(text: string, speakNow: boolean = false) {
    if (!this.isEnabled() || !this.synthesis) return;

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
    if (this.queue.length === 0 || !this.isEnabled() || !this.synthesis) {
      this.isSpeakingInternal = false;
      this.clearFailsafe();
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

    this.isSpeakingInternal = true;
    const text = this.queue.shift()!;

    // If no voice is set, try to load them and set a default.
    if (!this.currentVoice()) {
      const availableVoices = this.synthesis.getVoices();
      if (availableVoices.length > 0) {
        this.voices.set(availableVoices);
        const googleUS = availableVoices.find(v => v.name === 'Google US English');
        const englishVoice = availableVoices.find(v => v.lang.startsWith('en'));
        const defaultVoice = googleUS || englishVoice || availableVoices[0];
        this.currentVoice.set(defaultVoice);
      } else {
        console.warn('[SpeechService] No voices available to speak with.');
        this.isSpeakingInternal = false;
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

    const onFinished = () => {
      this.clearFailsafe();
      this.isSpeakingInternal = false;
      this.processQueue();
    };

    utterance.onend = onFinished;
    utterance.onerror = (err) => {
      console.error('[SpeechService] Utterance error:', err);
      onFinished();
    };

    // Failsafe: if the utterance doesn't finish within 15 seconds, force-clear it
    this.startFailsafe(15000);

    console.log("Speaking: " + text);
    this.synthesis.speak(utterance);
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
    if (this.synthesis) {
      /**
       * ROBUSTNESS FIX: cancel() is often asynchronous or can fail to clear the 
       * 'paused' flag. We explicitly resume after cancel to ensure the engine 
       * is ready for the next request.
       */
      this.synthesis.cancel();
      this.clearFailsafe();
      this.isSpeakingInternal = false;
      this.queue = [];
      this.currentUtterance = null;
      
      if (this.synthesis.paused) {
        this.synthesis.resume();
      }
    }
  }
}
