/**
 * LLM Provider Interface
 *
 * Defines the contract for all LLM providers (Azure OpenAI, AWS Bedrock, Google Vertex AI)
 */

import type { Logger } from 'pino';
import { NormalizedStreamEvent } from '../NormalizedStreamTypes.js';

/**
 * Provider configuration
 */
export interface ProviderConfig {
  provider: 'azure-openai' | 'aws-bedrock' | 'google-vertex' | 'ollama' | 'azure-ai-foundry' | 'anthropic' | 'openai';
  enabled: boolean;
  priority?: number;
  config: Record<string, any>;
}

/**
 * Chat completion request
 */
export interface CompletionRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;  // Top-K sampling (Gemini, Anthropic, Ollama)
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
  response_format?: any;
  /** Structured output JSON schema (Anthropic output_config) */
  outputSchema?: Record<string, unknown>;
  /** Intelligence slider value 0-100 for effort/quality control */
  sliderValue?: number;
  user?: string;
}

/**
 * Chat completion response
 */
export interface CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: any[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Image generation request
 */
export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  style?: 'vivid' | 'natural';
  n?: number;
}

/**
 * Image generation response
 */
export interface ImageGenerationResponse {
  imageBase64: string;
  revisedPrompt?: string;
  model: string;
  provider: string;
  format: 'png' | 'jpeg' | 'webp';
  generationTimeMs: number;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  status: 'healthy' | 'unhealthy' | 'not_initialized';
  provider: string;
  endpoint?: string;
  error?: string;
  lastChecked: Date;
}

/**
 * Provider metrics
 */
export interface ProviderMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  totalTokens: number;
  totalCost: number;
  lastUsed?: Date;
  /** Breakdown by request type for separate dashboard filtering */
  imageGenRequests?: number;
  imageGenSuccessful?: number;
  imageGenFailed?: number;
  imageGenAvgLatency?: number;
}

/**
 * Stream format types for different providers
 * - 'anthropic': Native Anthropic format with content_block_start/delta/stop events
 * - 'openai': OpenAI-compatible format with choices[0].delta
 * - 'gemini': Google Vertex AI format with candidates[] and thinking support
 */
export type StreamFormat = 'anthropic' | 'openai' | 'gemini';

/**
 * Discovered model from provider catalog — used by Model Garden for discovery
 */
export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  description?: string;
  capabilities: {
    chat: boolean;
    vision: boolean;
    tools: boolean;
    thinking: boolean;
    embeddings: boolean;
    imageGeneration: boolean;
    streaming: boolean;
  };
  maxOutputTokens?: number;
  contextWindow?: number;
  family?: string;
  costTier?: 'free' | 'low' | 'mid' | 'high' | 'premium';
  /** True if the model is already configured in the DB for this provider */
  configured?: boolean;
  /** True if the model needs to be downloaded/pulled before use (Ollama) */
  pullRequired?: boolean;
}

/**
 * Per-stream normalization state — tracks thinking blocks, text blocks, and tag parsing.
 * Passed through normalizeChunk() calls so each provider can accumulate state across chunks.
 */
export interface NormalizerState {
  thinkingId: string | null;
  thinkingStartTime: number | null;
  thinkingAccumulated: string;
  currentBlockIndex: number;
  inThinkTag: boolean;       // for Ollama <think> parsing
  thinkTagBuffer: string;    // for Ollama partial tag buffering
  streamStartEmitted: boolean;
  textBlockId: string | null;
  /** Maps content block index → { type, id } for Anthropic interleaved block tracking */
  blockTypes: Map<number, { type: string; id: string }>;
  /** Input token count captured from message_start for usage event */
  inputTokens: number;
  /** Model name captured from message_start for cost calculation */
  model: string;
  /** Tracks in-flight tool calls by toolId → toolName (OpenAI-style streaming) */
  pendingTools: Map<string, string>;
  /** Maps tool_calls index → toolId for reliable out-of-order parallel tool call resolution */
  toolIndexToId: Map<number, string>;
}

export function createNormalizerState(): NormalizerState {
  return {
    thinkingId: null, thinkingStartTime: null, thinkingAccumulated: '',
    currentBlockIndex: 0, inThinkTag: false, thinkTagBuffer: '',
    streamStartEmitted: false, textBlockId: null,
    blockTypes: new Map(), inputTokens: 0, model: '',
    pendingTools: new Map(), toolIndexToId: new Map(),
  };
}

/**
 * LLM Provider Interface
 */
export interface ILLMProvider {
  /** Provider name */
  readonly name: string;

  /** Provider type */
  readonly type: ProviderConfig['provider'];

  /** 
   * Stream format this provider emits
   * Used by the pipeline to know how to parse streaming responses
   */
  readonly streamFormat: StreamFormat;

  /** Initialize the provider */
  initialize(config: ProviderConfig['config']): Promise<void>;

  /** Check if provider is initialized */
  isInitialized(): boolean;

  /** Create chat completion */
  createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>>;

  /** List available models */
  listModels(): Promise<Array<{
    id: string;
    name: string;
    provider: string;
  }>>;

  /** Get provider health status */
  getHealth(): Promise<ProviderHealth>;

  /** Get provider metrics */
  getMetrics(): ProviderMetrics;

  /** Reset metrics */
  resetMetrics(): void;

  /** Generate text embeddings (optional - for embedding models) */
  embedText?(text: string | string[]): Promise<number[] | number[][]>;

  /**
   * Query the provider's SDK for a specific model's capabilities and defaults.
   * Returns null if the provider doesn't support model info queries.
   * Providers that support this should query their SDK live (e.g., Ollama /api/show, Bedrock GetFoundationModel).
   */
  getModelDefaults?(modelId: string): Promise<Partial<ProviderDefaultConfig> | null>;

  /**
   * Discover models available from the provider's catalog/API.
   * Used by Model Garden to let admins browse and add new models.
   * Returns all models the provider CAN serve, not just configured ones.
   * Optional — falls back to listModels() if not implemented.
   */
  discoverModels?(): Promise<DiscoveredModel[]>;

  /** Normalize a raw provider chunk into NormalizedStreamEvents */
  normalizeChunk?(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[];

  /** Create a normalized stream that yields NormalizedStreamEvents */
  createNormalizedStream?(request: CompletionRequest): AsyncGenerator<NormalizedStreamEvent>;

  /** Generate an image from a text prompt (optional — only image-capable providers) */
  generateImage?(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
}

/**
 * Default model configuration returned by each provider.
 * Used by the admin UI to populate form fields with correct defaults per provider type.
 */
export interface ProviderDefaultConfig {
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  frequencyPenalty: number;
  presencePenalty: number;
  extendedThinkingEnabled: boolean;
  thinkingBudget: number;
  thinkingLevel: string;
  // Capabilities
  supportsTopK: boolean;
  supportsFreqPenalty: boolean;
  supportsThinking: boolean;
  thinkingMode: 'budget' | 'level';
  // Ranges for UI sliders
  temperatureRange: [number, number];
  maxTokensRange: [number, number];
  topKRange: [number, number];
  // Suggested default models
  defaultChatModel: string;
  defaultEmbeddingModel: string;
}

/**
 * Base LLM Provider abstract class
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  protected logger: Logger;
  protected initialized: boolean = false;
  protected metrics: ProviderMetrics;

  constructor(protected providerLogger: Logger, providerName: string) {
    this.logger = providerLogger;
    this.metrics = {
      provider: providerName,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      totalTokens: 0,
      totalCost: 0
    };
  }

  abstract readonly name: string;
  abstract readonly type: ProviderConfig['provider'];
  abstract readonly streamFormat: StreamFormat;
  abstract initialize(config: ProviderConfig['config']): Promise<void>;
  abstract createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>>;
  abstract listModels(): Promise<Array<{ id: string; name: string; provider: string }>>;
  abstract getHealth(): Promise<ProviderHealth>;

  // Optional — subclasses implement to enable createNormalizedStream
  normalizeChunk?(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[];

  isInitialized(): boolean {
    return this.initialized;
  }

  getMetrics(): ProviderMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      provider: this.name,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      totalTokens: 0,
      totalCost: 0
    };
    this.logger.info({ provider: this.name }, 'Metrics reset');
  }

  /**
   * Track a successful request
   */
  protected trackSuccess(latency: number, tokens: number, cost: number): void {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.metrics.totalTokens += tokens;
    this.metrics.totalCost += cost;
    this.metrics.lastUsed = new Date();

    // Update average latency
    const totalLatency = this.metrics.averageLatency * (this.metrics.successfulRequests - 1) + latency;
    this.metrics.averageLatency = totalLatency / this.metrics.successfulRequests;
  }

  /**
   * Track a failed request
   */
  protected trackFailure(): void {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
  }

  /**
   * Default createNormalizedStream — wraps createCompletion and normalizes via normalizeChunk.
   * Subclasses only need to implement normalizeChunk().
   */
  async *createNormalizedStream(request: CompletionRequest): AsyncGenerator<NormalizedStreamEvent> {
    const state = createNormalizerState();
    const streamRequest = { ...request, stream: true };
    const result = await this.createCompletion(streamRequest);

    if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
      for await (const chunk of result as AsyncIterable<any>) {
        if (this.normalizeChunk) {
          const events = this.normalizeChunk(chunk, state);
          for (const event of events) {
            yield event;
          }
        }
      }
    }
  }

  /**
   * Override in subclasses to return provider-specific defaults.
   * Used by the admin API to serve defaults to the UI.
   */
  static getDefaultConfig(): ProviderDefaultConfig {
    return {
      maxTokens: 4096, temperature: 1.0, topP: 1.0, topK: 0,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: false, thinkingBudget: 0, thinkingLevel: '',
      supportsTopK: false, supportsFreqPenalty: false, supportsThinking: false,
      thinkingMode: 'budget',
      temperatureRange: [0, 2], maxTokensRange: [256, 128000], topKRange: [0, 0],
      defaultChatModel: '', defaultEmbeddingModel: '',
    };
  }
}
