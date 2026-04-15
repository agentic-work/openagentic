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
 * Core memory types for the perpetual context system
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  tokenCount?: number;
  metadata?: Record<string, any>;
}

export interface Memory {
  id: string;
  userId: string;
  type: 'conversation_summary' | 'entity_fact' | 'user_preference' | 'domain_knowledge';
  content: string;
  summary: string;
  entities: string[];
  embedding?: number[];
  importance: number; // 0-1 score
  relevanceScore?: number; // Computed during retrieval
  createdAt: number;
  lastAccessed: number;
  tokenCount: number;
  metadata: Record<string, any>;
}

export interface RankedMemory extends Memory {
  rank: number;
  relevanceScore: number;
  reasons: string[]; // Why this memory was selected
}

export interface Conversation {
  id: string;
  userId: string;
  messages: Message[];
  startTime: number;
  endTime?: number;
  tokenCount: number;
  entities: string[];
  topics: string[];
  importance: number;
}

export interface Entity {
  name: string;
  type: 'technology' | 'project' | 'person' | 'location' | 'concept';
  frequency: number;
  importance: number;
  lastMentioned: number;
  relatedEntities: string[];
}

export interface Topic {
  name: string;
  keywords: string[];
  frequency: number;
  lastDiscussed: number;
  relatedTopics: string[];
}

export interface UserProfile {
  userId: string;
  preferences: Record<string, any>;
  expertiseAreas: string[];
  frequentTopics: Topic[];
  keyEntities: Entity[];
  conversationStyle: string;
  lastUpdated: number;
}

export interface MemorySearchQuery {
  text: string;
  entities?: string[];
  topics?: string[];
  timeRange?: {
    start: number;
    end: number;
  };
  maxResults?: number;
  minRelevanceScore?: number;
  memoryTypes?: Memory['type'][];
}

export interface MemorySearchResult {
  memories: RankedMemory[];
  totalCount: number;
  searchTime: number;
  cacheHit: boolean;
}

export interface MemoryStats {
  totalMemories: number;
  memoriesByType: Record<Memory['type'], number>;
  totalTokens: number;
  averageImportance: number;
  lastUpdated: number;
  cacheStats: {
    hitRate: number;
    missRate: number;
    evictionRate: number;
  };
}