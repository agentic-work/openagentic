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
 * Session Store - Abstraction for storing K8sSession data
 * Supports both in-memory (single instance) and Redis (multi-instance HA) storage
 */

import Redis from 'ioredis';
import { K8sSession } from './k8sSessionManager';

export interface SessionStore {
  get(sessionId: string): Promise<K8sSession | null>;
  set(sessionId: string, session: K8sSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
  getAll(): Promise<K8sSession[]>;
  getUserSession(userId: string): Promise<string | null>;
  setUserSession(userId: string, sessionId: string): Promise<void>;
  deleteUserSession(userId: string): Promise<void>;
}

/**
 * In-memory session store - for single instance deployments
 */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, K8sSession>();
  private userSessions = new Map<string, string>();

  async get(sessionId: string): Promise<K8sSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async set(sessionId: string, session: K8sSession): Promise<void> {
    this.sessions.set(sessionId, session);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async getAll(): Promise<K8sSession[]> {
    return Array.from(this.sessions.values());
  }

  async getUserSession(userId: string): Promise<string | null> {
    return this.userSessions.get(userId) || null;
  }

  async setUserSession(userId: string, sessionId: string): Promise<void> {
    this.userSessions.set(userId, sessionId);
  }

  async deleteUserSession(userId: string): Promise<void> {
    this.userSessions.delete(userId);
  }
}

/**
 * Redis session store - for multi-instance HA deployments
 * Supports both direct URL connection and Sentinel mode for HA
 */
export class RedisSessionStore implements SessionStore {
  private redis: Redis;
  private keyPrefix: string;
  private sessionTTL: number; // seconds

  constructor(redisUrl: string, options?: {
    keyPrefix?: string;
    sessionTTL?: number;
    sentinelHost?: string;
    sentinelPort?: number;
    sentinelMasterName?: string;
  }) {
    // Check if we should use sentinel mode
    const useSentinel = options?.sentinelHost || process.env.REDIS_SENTINEL_HOST;

    if (useSentinel) {
      const sentinelHost = options?.sentinelHost || process.env.REDIS_SENTINEL_HOST || 'redis';
      const sentinelPort = options?.sentinelPort || parseInt(process.env.REDIS_SENTINEL_PORT || '26379');
      const masterName = options?.sentinelMasterName || process.env.REDIS_SENTINEL_MASTER || 'mymaster';
      const password = process.env.SESSION_STATE_REDIS_PASSWORD || process.env.REDIS_PASSWORD;

      console.log(`[RedisSessionStore] Using Sentinel mode: ${sentinelHost}:${sentinelPort} master=${masterName}`);
      this.redis = new Redis({
        sentinels: [{ host: sentinelHost, port: sentinelPort }],
        name: masterName,
        password: password,
        sentinelPassword: password,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
      });
    } else {
      console.log(`[RedisSessionStore] Using direct connection: ${redisUrl.replace(/:[^:@]+@/, ':***@')}`);
      this.redis = new Redis(redisUrl);
    }

    this.keyPrefix = options?.keyPrefix || 'openagentic:session:';
    this.sessionTTL = options?.sessionTTL || 86400; // 24 hours default

    this.redis.on('error', (err) => {
      console.error('[RedisSessionStore] Redis connection error:', err);
    });

    this.redis.on('connect', () => {
      console.log('[RedisSessionStore] Connected to Redis');
    });

    this.redis.on('+switch-master', () => {
      console.log('[RedisSessionStore] Sentinel switched master');
    });
  }

  private sessionKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  private userKey(userId: string): string {
    return `${this.keyPrefix}user:${userId}`;
  }

  private allSessionsKey(): string {
    return `${this.keyPrefix}all`;
  }

  async get(sessionId: string): Promise<K8sSession | null> {
    const data = await this.redis.get(this.sessionKey(sessionId));
    if (!data) return null;
    try {
      return JSON.parse(data) as K8sSession;
    } catch {
      return null;
    }
  }

  async set(sessionId: string, session: K8sSession): Promise<void> {
    const key = this.sessionKey(sessionId);
    await this.redis.setex(key, this.sessionTTL, JSON.stringify(session));
    // Add to the set of all sessions
    await this.redis.sadd(this.allSessionsKey(), sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.sessionKey(sessionId));
    await this.redis.srem(this.allSessionsKey(), sessionId);
  }

  async getAll(): Promise<K8sSession[]> {
    const sessionIds = await this.redis.smembers(this.allSessionsKey());
    const sessions: K8sSession[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.get(sessionId);
      if (session) {
        sessions.push(session);
      } else {
        // Clean up stale reference
        await this.redis.srem(this.allSessionsKey(), sessionId);
      }
    }

    return sessions;
  }

  async getUserSession(userId: string): Promise<string | null> {
    return await this.redis.get(this.userKey(userId));
  }

  async setUserSession(userId: string, sessionId: string): Promise<void> {
    await this.redis.setex(this.userKey(userId), this.sessionTTL, sessionId);
  }

  async deleteUserSession(userId: string): Promise<void> {
    await this.redis.del(this.userKey(userId));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Factory function to create the appropriate session store based on configuration
 */
export function createSessionStore(config: { redisUrl?: string; keyPrefix?: string; sessionTTL?: number }): SessionStore {
  if (config.redisUrl) {
    console.log('[SessionStore] Using Redis session store for HA');
    return new RedisSessionStore(config.redisUrl, {
      keyPrefix: config.keyPrefix,
      sessionTTL: config.sessionTTL,
    });
  }

  console.log('[SessionStore] Using in-memory session store (single instance)');
  return new InMemorySessionStore();
}
