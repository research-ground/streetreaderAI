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

const memoryFallback = new Map<string, string>();

/**
 * Safe wrapper around `localStorage` that gracefully falls back to an in-memory
 * Map when running inside sandboxed iframes (e.g., Google AI Studio) where
 * third-party storage may throw a `SecurityError`.
 */
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
        return localStorage.getItem(key);
      }
    } catch {
      // Fall back to in-memory store when localStorage throws SecurityError
    }
    return memoryFallback.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(key, value);
        return;
      }
    } catch {
      // Fall back to in-memory store when localStorage throws SecurityError or QuotaExceededError
    }
    memoryFallback.set(key, value);
  },

  removeItem(key: string): void {
    memoryFallback.delete(key);
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore SecurityError
    }
  },

  keys(): string[] {
    const keySet = new Set<string>(memoryFallback.keys());
    try {
      if (typeof localStorage !== 'undefined') {
        for (const k of Object.keys(localStorage)) {
          keySet.add(k);
        }
      }
    } catch {
      // Ignore SecurityError
    }
    return [...keySet];
  },

  clear(): void {
    memoryFallback.clear();
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.clear === 'function') {
        localStorage.clear();
      }
    } catch {
      // Ignore SecurityError
    }
  },
};
