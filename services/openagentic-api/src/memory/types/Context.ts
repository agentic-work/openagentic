import { Message, RankedMemory } from './Memory.js';

/**
 * Context assembly and management types
 */

export interface ContextBudget {
  total: number;
  reserved: number; // Always reserved for response
  available: number; // Available for context
  allocation: {
    tier1: number; // Session memory
    tier2: number; // Conversation summaries
    tier3: number; // Long-term knowledge
    system: number; // System prompt
  };
}

export interface ContextTier {
  name: string;
  priority: number;
  maxTokens: number;
  usedTokens: number;
  content: string[];
  metadata: Record<string, any>;
}

export interface AugmentedContext {
  systemPrompt: string;
  contextPrompt: string;
  totalTokens: number;
  tiers: {
    tier1: ContextTier; // Recent conversation
    tier2: ContextTier; // Conversation summaries
    tier3: ContextTier; // Long-term knowledge
  };
  relevantMemories: RankedMemory[];
  assemblyTime: number;
  cacheHit: boolean;
  metadata: {
    topicHash: string;
    entityList: string[];
    memoryCount: number;
    compressionRatio: number;
  };
}

export interface ContextTemplate {
  id: string;
  name: string;
  systemPrompt: string;
  memoryPromptTemplate: string;
  knowledgePromptTemplate: string;
  variables: Record<string, string>;
  tokenBudget: ContextBudget;
}

export interface ContextCache {
  key: string;
  userId: string;
  topicHash: string;
  contextPrompt: string;
  relevantMemories: RankedMemory[];
  totalTokens: number;
  computedAt: number;
  expiresAt: number;
  hitCount: number;
  lastAccessed: number;
}

export interface ContextAssemblyOptions {
  userId: string;
  messages: Message[];
  model: string;
  maxTokens?: number;
  includeMemory?: boolean;
  cacheEnabled?: boolean;
  debugMode?: boolean;
}

export interface ContextAssemblyResult {
  context: AugmentedContext;
  performance: {
    totalTime: number;
    cacheTime: number;
    memoryTime: number;
    assemblyTime: number;
  };
  debug?: {
    steps: string[];
    tokenCounts: Record<string, number>;
    memorySelection: string[];
  };
}

export interface TopicClassification {
  primaryTopic: string;
  secondaryTopics: string[];
  confidence: number;
  entities: string[];
  keywords: string[];
  hash: string;
}

export interface ModelCapabilities {
  name: string;
  contextWindow: number;
  tokensPerSecond: number;
  costPerToken: {
    input: number;
    output: number;
  };
  capabilities: string[];
}

export interface ContextTiers {
  tier1: ContextTier;
  tier2: ContextTier;
  tier3: ContextTier;
}