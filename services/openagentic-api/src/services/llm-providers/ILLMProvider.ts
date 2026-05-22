/**
 * LLM Provider Interface
 *
 * Defines the contract for all LLM providers (Azure OpenAI, AWS Bedrock, Google Vertex AI)
 */

import type { Logger } from 'pino';
import type { CanonicalStreamFormat } from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import type { ModelDiscoveryRecord } from './discovery/ModelDiscoveryRecord.js';

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
 * Stream format discriminator for provider streaming responses.
 *
 * Type alias for `CanonicalStreamFormat` (`canonicalNormalizer.ts:40-48`),
 * the 8-value SoT used by `selectCanonicalNormalizer(format, opts)`:
 *   - 'anthropic'          — Direct Anthropic Messages API (native SSE)
 *   - 'bedrock-anthropic'  — AWS Bedrock invocation of an Anthropic model
 *   - 'vertex-anthropic'   — Vertex AI Anthropic Claude endpoints
 *   - 'foundry-anthropic'  — Azure AI Foundry Anthropic deployments
 *   - 'ollama'             — Ollama native chat NDJSON
 *   - 'openai'             — OpenAI Chat Completions (Azure OpenAI + OpenAI direct)
 *   - 'gemini'             — Vertex AI Gemini streaming
 *   - 'aif-responses'      — Azure AI Foundry Responses API (`/v1/responses`)
 *
 * The legacy 3-value list (`'anthropic' | 'openai' | 'gemini'`) is now a
 * strict subset of this — existing provider declarations like
 * `readonly streamFormat = 'openai' as const` continue to type-check.
 *
 * D-0 (SDK wire-in) widens the type so providers with multi-mode dispatch
 * (AIF / Bedrock / Vertex) can declare the full 8-value range. D-1 fixes
 * per-provider correctness (e.g. Ollama → `'ollama'`, AIF → dynamic per
 * request via `getStreamFormat(req)`).
 */
export type StreamFormat = CanonicalStreamFormat;
export type { CanonicalStreamFormat } from '@agentic-work/llm-sdk/lib/normalizers/index.js';

/**
 * Per-stream bookkeeping used by provider-specific normalizers
 * (OllamaProvider.normalizeOllamaChunk, AWSBedrockProvider's Gemma path).
 * The fields are intentionally optional + permissive — each normalizer
 * only writes the keys it needs and leaves the rest unset.
 */
export interface NormalizerState {
  streamStartEmitted?: boolean;
  model?: string;
  blockTypes: Map<number, { type: string; id: string }>;
  thinkingId?: string | null;
  thinkingStartTime?: number | null;
  thinkingAccumulated?: string;
  textBlockId?: string | null;
  toolIndexToId: Map<number, string>;
  pendingTools: Map<string, string>;
}

export function createNormalizerState(): NormalizerState {
  return {
    blockTypes: new Map(),
    toolIndexToId: new Map(),
    pendingTools: new Map(),
    thinkingAccumulated: '',
  };
}

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
 * LLM Provider Interface
 */
export interface ILLMProvider {
  /** Provider name */
  readonly name: string;

  /** Provider type */
  readonly type: ProviderConfig['provider'];

  /**
   * Stream format this provider emits (static default).
   *
   * Used by the pipeline at provider-bootstrap time (e.g.
   * `ProviderManager.ts:1180-1181`) when no per-request context is
   * available. Single-mode providers (Anthropic, OpenAI, AzureOpenAI,
   * Ollama) declare this and nothing else.
   *
   * Multi-mode providers (AIF, Bedrock, Vertex) MUST also override
   * `getStreamFormat(request)` so the SDK normalizer factory can
   * dispatch to the correct format per-request.
   */
  readonly streamFormat: StreamFormat;

  /**
   * Per-request stream format dispatch (optional — only multi-mode providers).
   *
   * Returns the `CanonicalStreamFormat` value matching the wire format the
   * provider will actually emit for THIS specific request, given the model
   * and any provider-side configuration. The pipeline calls this once per
   * request just before invoking `selectCanonicalNormalizer(format, opts)`.
   *
   * Single-mode providers MAY skip this; the pipeline falls back to
   * `provider.streamFormat` when `getStreamFormat` is not implemented.
   *
   * Examples:
   *   - AzureAIFoundryProvider:
   *       'aif-responses' if shouldUseResponsesApi(model)
   *       'foundry-anthropic' if Claude or anthropic-format endpoint
   *       'openai' otherwise
   *   - GoogleVertexProvider:
   *       'vertex-anthropic' if model is Claude
   *       'gemini' otherwise
   *   - AWSBedrockProvider:
   *       'bedrock-anthropic' if Claude
   *       'anthropic' fallback for non-Claude (Nova/ConverseStream
   *       wire-in is out of D-1 scope)
   */
  getStreamFormat?(request: CompletionRequest): StreamFormat;

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

  /**
   * #650 Sev-0 — pull all model details (capabilities, limits, defaults,
   * pricing) live from the provider's SDK. Authoritative source for the
   * Registry write at Add-Model time and for the daily refresh cron.
   *
   * Implementations MUST NOT consult any cached / static / inferred data
   * for fields the SDK exposes directly. Where the SDK is silent (e.g.
   * Bedrock context windows), implementations may consult an
   * admin-editable lookup table — never a hardcoded model-id literal.
   *
   * Returns null only if the provider type does not support discovery
   * (legacy Anthropic-direct, OpenAI-direct, etc.). Never returns null
   * for transient SDK errors — those throw so the POST handler can 502.
   */
  discoverModelDetails?(modelId: string, region?: string): Promise<ModelDiscoveryRecord | null>;

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
