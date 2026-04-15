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
 * Admin Metrics Cache
 *
 * Thin wrapper over the unified Redis client for admin metrics caching.
 * Provides graceful degradation when Redis is unavailable.
 */

import { getRedisClient } from '../utils/redis-client.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services?.child({ component: 'AdminMetricsCache' }) ?? console;
const CACHE_PREFIX = 'admin:metrics:';

export async function getCachedMetrics<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedisClient();
    if (!redis?.isConnected()) return null;
    const cached = await redis.get<T>(`${CACHE_PREFIX}${key}`);
    if (cached) {
      (logger as any).debug?.({ key }, '[ADMIN-CACHE] Hit');
    }
    return cached;
  } catch {
    return null;
  }
}

export async function setCachedMetrics(key: string, data: any, ttlSeconds: number): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis?.isConnected()) return;
    await redis.set(`${CACHE_PREFIX}${key}`, data, ttlSeconds);
    (logger as any).debug?.({ key, ttlSeconds }, '[ADMIN-CACHE] Set');
  } catch {
    // Non-fatal — cache write failure doesn't affect response
  }
}
