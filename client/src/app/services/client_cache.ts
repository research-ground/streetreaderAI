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

import { QueryAuditSummary } from './api_service';

export class LruCache<V> {
  private readonly store = new Map<string, V>();

  constructor(private readonly maxEntries: number = 1024) {}

  get(key: string): V | undefined {
    const val = this.store.get(key);
    if (val !== undefined) {
      this.store.delete(key);
      this.store.set(key, val);
    }
    return val;
  }

  put(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, value);
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

export class QueryAudit {
  private externalCounts: Record<string, number> = {};
  private cacheHits: Record<string, number> = {};
  private seenKeys = new Set<string>();
  private duplicates: string[] = [];

  recordExternal(service: string, key: string = ''): void {
    this.externalCounts[service] = (this.externalCounts[service] ?? 0) + 1;
    if (key) {
      const fullKey = `${service}:${key}`;
      if (this.seenKeys.has(fullKey)) {
        this.duplicates.push(fullKey);
      } else {
        this.seenKeys.add(fullKey);
      }
    }
  }

  recordCacheHit(service: string): void {
    this.cacheHits[service] = (this.cacheHits[service] ?? 0) + 1;
  }

  reset(): void {
    this.externalCounts = {};
    this.cacheHits = {};
    this.seenKeys.clear();
    this.duplicates = [];
  }

  snapshot(): QueryAuditSummary {
    const totalExt = Object.values(this.externalCounts).reduce((a, b) => a + b, 0);
    const totalHits = Object.values(this.cacheHits).reduce((a, b) => a + b, 0);
    return {
      external_calls: { ...this.externalCounts },
      total_external_calls: totalExt,
      cache_hits: { ...this.cacheHits },
      total_cache_hits: totalHits,
      duplicate_queries: [...this.duplicates],
      duplicate_count: this.duplicates.length,
    };
  }
}

export const queryAudit = new QueryAudit();
export const roadCache = new LruCache<unknown[]>(128);
export const metadataCache = new LruCache<unknown>(4096);
export const windowCache = new LruCache<unknown[]>(1024);
export const graphCache = new LruCache<Record<string, unknown>>(2048);

const inFlightPromises = new Map<string, Promise<unknown>>();

export function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightPromises.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const p = fn().finally(() => {
    inFlightPromises.delete(key);
  });
  inFlightPromises.set(key, p);
  return p;
}

export function clearAllClientCaches(): void {
  roadCache.clear();
  metadataCache.clear();
  windowCache.clear();
  graphCache.clear();
  queryAudit.reset();
}
