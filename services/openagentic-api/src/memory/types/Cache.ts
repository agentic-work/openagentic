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

import { Message, RankedMemory } from './Memory.js';
import { AugmentedContext } from './Context.js';

/**
 * Cache data structures for Redis-based memory system
 */

export interface SessionCache {
  userId: string;
  sessionId: string;
  messages: Message[];
  contextTokens: number;
  lastTopic: string;
  activeEntities: string[];
  lastActivity: number;
  metadata: {
    messageCount: number;
    averageResponseTime: number;
    topicChanges: number;
  };
}

export interface MemoryIndex {
  userId: string;
  topMemories: RankedMemory[];
  entityFrequency: Record<string, number>;
  topicFrequency: Record<string, number>;
  hotTopics: string[];
  recentEntities: string[];
  lastUpdated: number;
  version: number;
  stats: {
    totalMemories: number;
    averageImportance: number;
    compressionRatio: number;
  };
}

export interface ContextCacheEntry {
  key: string;
  userId: string;
  topicHash: string;
  promptTemplate: string;
  relevantMemories: RankedMemory[];
  totalTokens: number;
  computedAt: number;
  expiresAt: number;
  hitCount: number;
  lastAccessed: number;
  metadata: {
    memoryCount: number;
    entityList: string[];
    compressionRatio: number;
    computationTime: number;
  };
}

export interface CacheKey {
  type: 'session' | 'memory_index' | 'context' | 'embedding' | 'summary';
  userId: string;
  identifier: string; // sessionId, topicHash, etc.
}

export interface CacheOptions {
  ttl?: number;
  sliding?: boolean; // Extend TTL on access
  maxSize?: number;
  compress?: boolean;
  version?: number;
}

export interface CacheStats {
  hitRate: number;
  missRate: number;
  evictionRate: number;
  averageLatency: number;
  memoryUsage: number;
  keyCount: number;
  lastUpdated: number;
}

export interface CacheMetrics {
  operations: {
    gets: number;
    sets: number;
    deletes: number;
    hits: number;
    misses: number;
  };
  performance: {
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
  };
  memory: {
    used: number;
    available: number;
    evictions: number;
  };
  byType: Record<CacheKey['type'], {
    count: number;
    hitRate: number;
    averageSize: number;
  }>;
}

export interface EmbeddingCache {
  text: string;
  hash: string;
  embedding: number[];
  model: string;
  createdAt: number;
  accessCount: number;
}

export interface SummaryCache {
  conversationId: string;
  summary: string;
  tokenCount: number;
  entities: string[];
  importance: number;
  createdAt: number;
}

export interface CacheInvalidationRule {
  type: CacheKey['type'];
  pattern: string;
  conditions: {
    timeElapsed?: number;
    accessCount?: number;
    memoryChange?: boolean;
    userActivity?: boolean;
  };
  action: 'expire' | 'refresh' | 'delete';
}