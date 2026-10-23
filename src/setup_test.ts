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

// Global test setup and environment polyfills/mocks for Vitest/JSDOM.

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] || null,
    setItem: (key: string, value: string): void => { store[key] = String(value); },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { store = {}; },
    key: (index: number): string | null => Object.keys(store)[index] || null,
    get length(): number { return Object.keys(store).length; }
  };
};

// Polyfill localStorage on both window and globalThis
const mockLocalStorage = createLocalStorageMock();

if (typeof window !== 'undefined') {
  if (!window.localStorage || typeof window.localStorage.getItem !== 'function') {
    Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });
  }
  if (typeof globalThis !== 'undefined' && !(globalThis as any).localStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
      get() { return window.localStorage; },
      configurable: true
    });
  }
} else if (typeof globalThis !== 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });
}
