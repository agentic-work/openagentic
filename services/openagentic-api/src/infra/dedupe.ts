/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Request Deduplication Cache
 *
 * Map-based cache with TTL + LRU eviction.  Prevents:
 * - Double-click sending the same chat message twice
 * - Duplicate tool calls within the same turn
 * - Duplicate sub-agent spawns in the same execution
 *
 * Usage:
 *   const cache = createDedupeCache({ ttlMs: 5000, maxSize: 500 });
 *   const key = `tool:${toolName}:${argsHash}`;
 *   const existing = cache.get(key);
 *   if (existing) return existing;            // deduplicated!
 *   const result = await executeTool(...);
 *   cache.set(key, result);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DedupeCacheOptions {
  /** How long entries stay valid (ms). Default 10 000. */
  ttlMs?: number;
  /** Maximum number of entries before LRU eviction. Default 1000. */
  maxSize?: number;
}

export interface DedupeCache<T = unknown> {
  /** Get a cached value (returns undefined if expired or missing) */
  get(key: string): T | undefined;
  /** Get a cached promise (for in-flight deduplication) */
  getInflight(key: string): Promise<T> | undefined;
  /** Store a value */
  set(key: string, value: T): void;
  /** Store an in-flight promise (resolves to the value) */
  setInflight(key: string, promise: Promise<T>): void;
  /** Remove a specific key */
  delete(key: string): void;
  /** Remove all entries */
  clear(): void;
  /** Current entry count */
  size(): number;
  /**
   * Deduplicate an async operation.  If a result for `key` exists and is
   * still within TTL, return it immediately.  If an identical call is
   * already in flight, share its promise.  Otherwise execute `fn`, cache
   * the result, and return it.
   */
  dedupeAsync(key: string, fn: () => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Internal entry
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface InflightEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDedupeCache<T = unknown>(opts: DedupeCacheOptions = {}): DedupeCache<T> {
  const ttlMs = opts.ttlMs ?? 10_000;
  const maxSize = opts.maxSize ?? 1000;

  const entries = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, InflightEntry<T>>();

  // Access order for LRU (most-recently-used at end)
  const accessOrder: string[] = [];

  function touch(key: string) {
    const idx = accessOrder.indexOf(key);
    if (idx !== -1) accessOrder.splice(idx, 1);
    accessOrder.push(key);
  }

  function evictIfNeeded() {
    while (entries.size > maxSize && accessOrder.length > 0) {
      const oldest = accessOrder.shift();
      if (oldest) entries.delete(oldest);
    }
  }

  function isExpired(expiresAt: number): boolean {
    return Date.now() >= expiresAt;
  }

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (isExpired(entry.expiresAt)) {
        entries.delete(key);
        return undefined;
      }
      touch(key);
      return entry.value;
    },

    getInflight(key: string): Promise<T> | undefined {
      const entry = inflight.get(key);
      if (!entry) return undefined;
      if (isExpired(entry.expiresAt)) {
        inflight.delete(key);
        return undefined;
      }
      return entry.promise;
    },

    set(key: string, value: T) {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      touch(key);
      evictIfNeeded();
      // Clear inflight for this key
      inflight.delete(key);
    },

    setInflight(key: string, promise: Promise<T>) {
      inflight.set(key, { promise, expiresAt: Date.now() + ttlMs });
    },

    delete(key: string) {
      entries.delete(key);
      inflight.delete(key);
      const idx = accessOrder.indexOf(key);
      if (idx !== -1) accessOrder.splice(idx, 1);
    },

    clear() {
      entries.clear();
      inflight.clear();
      accessOrder.length = 0;
    },

    size() {
      return entries.size;
    },

    async dedupeAsync(key: string, fn: () => Promise<T>): Promise<T> {
      // Check resolved cache
      const cached = this.get(key);
      if (cached !== undefined) return cached;

      // Check in-flight
      const existing = this.getInflight(key);
      if (existing) return existing;

      // Execute and cache
      const promise = fn().then(
        (result) => {
          this.set(key, result);
          return result;
        },
        (err) => {
          inflight.delete(key);
          throw err;
        },
      );

      this.setInflight(key, promise);
      return promise;
    },
  };
}
