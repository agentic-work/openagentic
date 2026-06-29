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
