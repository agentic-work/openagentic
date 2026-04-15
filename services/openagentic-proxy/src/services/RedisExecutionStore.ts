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

import { getRedis } from '../utils/redis';
import { logger } from '../utils/logger';
import type { ExecutionState } from './AgentOrchestrator';

export class RedisExecutionStore {
  private static readonly PREFIX = 'agent:exec:';
  private static readonly INDEX_KEY = 'agent:exec:index';
  private static readonly TTL = 86400; // 24 hours

  async set(state: ExecutionState): Promise<void> {
    try {
      const redis = getRedis();
      const key = `${RedisExecutionStore.PREFIX}${state.executionId}`;
      await redis.set(key, JSON.stringify(state), 'EX', RedisExecutionStore.TTL);
      // Add to sorted set index (score = startedAt for time-based queries)
      await redis.zadd(RedisExecutionStore.INDEX_KEY, state.startedAt, state.executionId);
    } catch (err) {
      logger.warn({ err, executionId: state.executionId }, 'Failed to write execution state to Redis');
    }
  }

  async get(executionId: string): Promise<ExecutionState | null> {
    try {
      const redis = getRedis();
      const data = await redis.get(`${RedisExecutionStore.PREFIX}${executionId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      logger.warn({ err, executionId }, 'Failed to read execution state from Redis');
      return null;
    }
  }

  async list(filters?: { userId?: string; status?: string; limit?: number }): Promise<ExecutionState[]> {
    try {
      const redis = getRedis();
      const ids = await redis.zrevrangebyscore(
        RedisExecutionStore.INDEX_KEY, '+inf', '-inf',
        'LIMIT', 0, filters?.limit || 100
      );
      if (!ids.length) return [];

      const pipeline = redis.pipeline();
      for (const id of ids) {
        pipeline.get(`${RedisExecutionStore.PREFIX}${id}`);
      }
      const results = await pipeline.exec();

      const executions: ExecutionState[] = [];
      for (const [err, data] of (results || [])) {
        if (!err && data) {
          const state = JSON.parse(data as string);
          if (filters?.userId && state.userId !== filters.userId) continue;
          if (filters?.status && state.status !== filters.status) continue;
          executions.push(state);
        }
      }
      return executions;
    } catch (err) {
      logger.warn({ err }, 'Failed to list executions from Redis');
      return [];
    }
  }

  async delete(executionId: string): Promise<void> {
    try {
      const redis = getRedis();
      await redis.del(`${RedisExecutionStore.PREFIX}${executionId}`);
      await redis.zrem(RedisExecutionStore.INDEX_KEY, executionId);
    } catch (err) {
      logger.warn({ err, executionId }, 'Failed to delete execution from Redis');
    }
  }

  async publishKill(executionId: string): Promise<void> {
    try {
      const redis = getRedis();
      await redis.publish(`agent:kill:${executionId}`, 'kill');
    } catch (err) {
      logger.warn({ err, executionId }, 'Failed to publish kill signal');
    }
  }

  async subscribeKill(executionId: string, callback: () => void): Promise<() => void> {
    try {
      const redis = getRedis();
      const sub = redis.duplicate();
      const channel = `agent:kill:${executionId}`;
      await sub.subscribe(channel);
      sub.on('message', (_ch: string, _msg: string) => {
        callback();
      });
      return () => { sub.unsubscribe(channel).catch(() => {}); sub.disconnect(); };
    } catch (err) {
      logger.warn({ err, executionId }, 'Failed to subscribe to kill channel');
      return () => {};
    }
  }

  async getStats(): Promise<{
    activeCount: number;
    totalToday: number;
    completedToday: number;
    failedToday: number;
  }> {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      const allToday = await this.list({ limit: 500 });
      const todayExecs = allToday.filter(e => e.startedAt >= todayMs);

      return {
        activeCount: allToday.filter(e => e.status === 'running' || e.status === 'pending').length,
        totalToday: todayExecs.length,
        completedToday: todayExecs.filter(e => e.status === 'completed').length,
        failedToday: todayExecs.filter(e => e.status === 'failed').length,
      };
    } catch {
      return { activeCount: 0, totalToday: 0, completedToday: 0, failedToday: 0 };
    }
  }
}
