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
 * Chat processing pipeline types
 */

import { ChatUser, ChatSession, ChatMessage, ChatRequest, StreamContext } from '../interfaces/chat.types.js';
import { PromptEngineeringResult } from '../interfaces/prompt.types.js';
import { MCPInstance, MCPToolCall } from '../interfaces/mcp.types.js';
import type { CodeExecutionContext, CodeExecution, CodeArtifact } from './code-execution.helper.js';
import type { SliderConfig } from '../../../services/SliderService.js';
import type { PipelineConfiguration } from './pipeline-config.schema.js';

// Re-export code execution types
export type { CodeExecutionContext, CodeExecution, CodeArtifact };
export type { SliderConfig };

/**
 * Artifact created during pipeline execution (image gen, agent output, streamed HTML).
 * Accumulated in context.artifacts[] so downstream stages can reference them
 * and they're auto-stored in the user's Milvus collection after completion.
 */
export interface PipelineArtifact {
  id: string;
  type: 'image' | 'html' | 'svg' | 'chart' | 'code' | 'document';
  url: string;              // Accessible URL (e.g., /api/images/xxx.png)
  title?: string;
  mimeType?: string;
  createdBy: 'image-gen' | 'agent' | 'completion' | 'tool';
  sessionId?: string;
  metadata?: Record<string, any>;
}

// Pipeline context - passed through all stages
export interface PipelineContext {
  // Request data
  request: ChatRequest;
  user: ChatUser;
  session: ChatSession;
  
  // Processing state
  messageId: string;
  startTime: Date;
  streamContext: StreamContext;
  forceFinalCompletion?: boolean; // Flag to force final completion without tools
  skipCompletion?: boolean; // Flag to skip completion stage (used by image generation)
  
  // Accumulated data
  messages: ChatMessage[];
  preparedMessages?: ChatMessage[]; // Messages after deduplication/validation (from message-preparation stage)
  systemPrompt?: string;
  promptEngineering?: PromptEngineeringResult;
  mcpInstances?: MCPInstance[];
  mcpCalls?: MCPToolCall[];
  availableTools?: any[];
  ragContext?: any; // RAG retrieved knowledge
  retrievedKnowledge?: {
    docs?: any[];
    chats?: any[];
    artifacts?: any[];
    metadata?: any;
  }; // Knowledge retrieved from RAG stage (for reuse in prompt stage)
  ragMetrics?: {
    retrievalTimeMs?: number;
    docsCount?: number;
    chatsCount?: number;
    artifactsCount?: number;
  }; // RAG performance metrics
  mcpServices?: any; // MCP services discovered during parallel stage
  hasNewToolMessages?: boolean; // Flag indicating new tool messages added (triggers message-prep re-run)
  memoryContext?: any; // Memory system context
  metadata?: Record<string, any>;
  response?: string;

  // Artifact accumulator — images, HTML, SVGs created during this pipeline execution.
  // Populated by image-gen-tool, agent dispatch, and completion stages.
  // Auto-stored in user's Milvus collection after pipeline completes.
  artifacts: PipelineArtifact[];
  promptUsageData?: any; // Prompt usage tracking data

  // MCP Orchestrator connection
  mcpOrchestratorUrl?: string;
  mcpApiKey?: string;

  // Invisible Agent: Code Execution Context
  // Tracks openagentic session for transparent code execution
  codeExecutionContext?: CodeExecutionContext;

  // Configuration
  config: PipelineConfig;
  
  // Services
  milvusService?: any;
  redisService?: any;
  resultStorageService?: any;
  completionService?: any;

  // Utilities
  logger: any;
  emit: (event: string, data: any) => void;
  
  // Error handling
  errors: PipelineError[];
  aborted: boolean;

  // Abort signal — propagated to providers, agents, and workflows.
  // When the client disconnects, the controller is aborted, cancelling
  // all in-flight LLM calls, tool executions, and sub-agent spawns.
  abortController?: AbortController;
  abortSignal?: AbortSignal;

  // Model selection
  modelSelectionReason?: string;

  // Intelligence slider configuration
  sliderConfig?: SliderConfig;

  // Full pipeline configuration (for prompt stage skills, etc.)
  pipelineConfig?: PipelineConfiguration;

  // Budget status (from auth stage)
  budgetStatus?: {
    budgetDollars: number | null;
    spentDollars: number;
    remainingDollars: number | null;
    percentUsed: number | null;
    isOverBudget: boolean;
    isApproachingLimit: boolean;
    wasAutoAdjusted: boolean;
    originalSlider: number | null;
  };
}

export interface PipelineConfig {
  // Model settings
  model: string;
  provider?: string; // LLM provider (vertex-ai, ollama, openai, etc.)
  temperature: number;
  maxTokens: number;

  // Advanced generation parameters (per-model/provider settings)
  topP?: number;              // Nucleus sampling (0-1, all providers)
  topK?: number;              // Top-K sampling (Gemini, Claude)
  frequencyPenalty?: number;  // OpenAI/Azure only (-2 to 2)
  presencePenalty?: number;   // OpenAI/Azure only (-2 to 2)
  
  // Feature flags
  enableMCP: boolean;
  enablePromptEngineering: boolean;
  enableCoT: boolean;
  enableRAG: boolean;
  enableMemory: boolean;
  enableAnalytics: boolean;
  
  // Streaming control
  suppressStreaming?: boolean;
  enableCaching: boolean;
  
  // Timeouts and limits
  requestTimeout: number;
  mcpTimeout: number;
  maxHistoryLength: number;
  maxTokenBudget: number;
  
  // Rate limiting
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  
  // Performance optimization
  optimizeFor?: 'cost' | 'speed' | 'quality';
  maxLatency?: number;
  maxCost?: number;
}

export interface PipelineError {
  stage: string;
  code: string;
  message: string;
  details?: any;
  retryable: boolean;
  timestamp: Date;
}

// Pipeline stage interface
export interface PipelineStage {
  name: string;
  execute(context: PipelineContext): Promise<PipelineContext>;
  rollback?(context: PipelineContext): Promise<void>;
}

// Stage results
export interface AuthStageResult {
  user: ChatUser;
  hasValidToken: boolean;
  tokenExpiry?: Date;
}

export interface ValidationStageResult {
  isValid: boolean;
  errors: string[];
  sanitizedRequest: ChatRequest;
}

export interface PromptStageResult {
  systemPrompt: string;
  promptEngineering: PromptEngineeringResult;
  recommendedModel?: string;
}

export interface MCPStageResult {
  availableTools: any[];
  instances: MCPInstance[];
  toolCalls: MCPToolCall[];
}

export interface CompletionStageResult {
  response: string;
  tokenUsage: any;
  toolCalls: any[];
  finishReason: string;
}

export interface ResponseStageResult {
  message: ChatMessage;
  metadata: Record<string, any>;
}

// Pipeline events
export interface PipelineEvent {
  type: string;
  stage: string;
  data: any;
  timestamp: Date;
  context: {
    userId: string;
    sessionId: string;
    messageId: string;
  };
}

// Pipeline metrics
export interface PipelineMetrics {
  stageTimings: Record<string, number>;
  totalTime: number;
  tokenUsage: any;
  mcpCalls: number;
  cacheHits: number;
  errors: number;
}