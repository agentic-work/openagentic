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
 * Azure OpenAI Provider
 *
 * Implements ILLMProvider for Azure OpenAI with proper 2025 SDK patterns
 * Supports both Entra ID (recommended) and API key authentication
 *
 * SDK: openai@4.x with Azure OpenAI v1 API (August 2025+)
 * Auth: @azure/identity for Entra ID
 */

import { AzureOpenAI } from 'openai';
import { ClientSecretCredential, DefaultAzureCredential, getBearerTokenProvider, TokenCredential } from '@azure/identity';
import {
  BaseLLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderHealth,
  ProviderConfig,
  type NormalizerState,
} from './ILLMProvider.js';
import { NormalizedStreamEvent } from '../NormalizedStreamTypes.js';
import type { Logger } from 'pino';

export class AzureOpenAIProvider extends BaseLLMProvider {
  readonly name = 'Azure OpenAI';
  readonly type = 'azure-openai' as const;
  readonly streamFormat = 'openai' as const; // Uses OpenAI-compatible format

  private client?: AzureOpenAI;
  private embeddingClient?: AzureOpenAI;
  private credential?: TokenCredential; // Now supports any TokenCredential (ClientSecretCredential, DefaultAzureCredential, etc.)
  private endpoint?: string;
  private deployment?: string;
  private apiVersion?: string;
  private authType?: 'service-principal' | 'managed-identity' | 'api-key';

  constructor(logger: Logger) {
    super(logger, 'Azure OpenAI');
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    try {
      const {
        endpoint,
        tenantId,
        clientId,
        clientSecret,
        apiKey,
        deployment,
        apiVersion = '2024-10-21' // Latest GA version as of 2025
      } = config;

      if (!endpoint || !deployment) {
        throw new Error('Azure OpenAI configuration missing. Required: endpoint, deployment');
      }

      this.endpoint = endpoint;
      this.deployment = deployment;
      this.apiVersion = apiVersion;

      // Ensure endpoint ends with slash
      const normalizedEndpoint = this.endpoint.endsWith('/') ? this.endpoint : `${this.endpoint}/`;

      // Choose authentication method:
      // 1. Service Principal (tenantId, clientId, clientSecret)
      // 2. API Key (apiKey)
      // 3. DefaultAzureCredential (workload identity / managed identity) - automatic fallback
      if (tenantId && clientId && clientSecret) {
        // Entra ID (Service Principal) authentication using 2025 best practices
        // Use getBearerTokenProvider for automatic token refresh
        this.authType = 'service-principal';
        this.credential = new ClientSecretCredential(
          tenantId,
          clientId,
          clientSecret
        );

        const azureADTokenProvider = getBearerTokenProvider(
          this.credential,
          'https://cognitiveservices.azure.com/.default'
        );

        // Create AzureOpenAI client with token provider
        // IMPORTANT: Temporarily remove AZURE_OPENAI_API_KEY from env to prevent SDK from auto-loading it
        // The SDK throws an error if both apiKey and azureADTokenProvider are provided
        const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_API_KEY;

        try {
          this.client = new AzureOpenAI({
            azureADTokenProvider, // Token provider auto-refreshes
            deployment: this.deployment,
            apiVersion: this.apiVersion,
            endpoint: normalizedEndpoint
          });
        } finally {
          // Restore the API key for other services (like EmbeddingService) that need it
          if (savedApiKey) {
            process.env.AZURE_OPENAI_API_KEY = savedApiKey;
          }
        }

        this.logger.info({
          authType: 'entra-id',
          endpoint: normalizedEndpoint,
          deployment: this.deployment,
          apiVersion: this.apiVersion,
          baseURL: `${normalizedEndpoint}openai/v1/`
        }, 'Azure OpenAI provider initialized with Entra ID (2025 SDK pattern)');

      } else if (apiKey) {
        // API Key authentication (not recommended for production)
        this.authType = 'api-key';
        this.client = new AzureOpenAI({
          apiKey: apiKey,
          deployment: this.deployment,
          apiVersion: this.apiVersion,
          endpoint: normalizedEndpoint
        });

        this.logger.info({
          authType: 'api-key',
          endpoint: normalizedEndpoint,
          deployment: this.deployment,
          apiVersion: this.apiVersion,
          baseURL: `${normalizedEndpoint}openai/v1/`
        }, 'Azure OpenAI provider initialized with API key (2025 SDK pattern)');

      } else {
        // No explicit credentials - use DefaultAzureCredential (workload identity / managed identity)
        // This works automatically in AKS with workload identity, Azure VMs with managed identity,
        // Azure App Service, Azure Functions, and local development with Azure CLI
        this.authType = 'managed-identity';
        this.credential = new DefaultAzureCredential();

        const azureADTokenProvider = getBearerTokenProvider(
          this.credential,
          'https://cognitiveservices.azure.com/.default'
        );

        // Temporarily remove AZURE_OPENAI_API_KEY from env to prevent SDK from auto-loading it
        const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_API_KEY;

        try {
          this.client = new AzureOpenAI({
            azureADTokenProvider,
            deployment: this.deployment,
            apiVersion: this.apiVersion,
            endpoint: normalizedEndpoint
          });
        } finally {
          if (savedApiKey) {
            process.env.AZURE_OPENAI_API_KEY = savedApiKey;
          }
        }

        this.logger.info({
          authType: 'managed-identity',
          endpoint: normalizedEndpoint,
          deployment: this.deployment,
          apiVersion: this.apiVersion,
          baseURL: `${normalizedEndpoint}openai/v1/`,
          credentialType: 'DefaultAzureCredential'
        }, 'Azure OpenAI provider initialized with DefaultAzureCredential (workload identity / managed identity)');
      }

      // Initialize separate embedding client if different endpoint is configured
      await this.initializeEmbeddingClient();

      this.initialized = true;

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize Azure OpenAI provider');
      throw error;
    }
  }

  /**
   * Initialize a separate embedding client to bypass ModelRouter for embeddings
   * Always creates dedicated client for embedding operations
   */
  private async initializeEmbeddingClient(): Promise<void> {
    try {
      const embeddingEndpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || this.endpoint;

      // ALWAYS create a dedicated embedding client to bypass ModelRouter
      // ModelRouter only supports chat completions, not embeddings
      // For embedding operations, always construct a direct baseURL to bypass ModelRouter
      // This ensures embeddings don't go through ModelRouter which only supports chat completions
      const baseURL = `${embeddingEndpoint.replace(/\/+$/, '')}/openai/v1/`;

      this.logger.info({
        embeddingEndpoint,
        baseURL,
        usingDedicatedClient: true,
        reason: 'Bypassing ModelRouter for embeddings'
      }, 'Creating dedicated embedding client');

      if (this.credential) {
        // Use Entra ID authentication for embedding client
        // Temporarily remove API key from env to prevent SDK conflicts
        const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_API_KEY;

        try {
          this.embeddingClient = new AzureOpenAI({
            azureADTokenProvider: getBearerTokenProvider(this.credential, 'https://cognitiveservices.azure.com/.default'),
            apiVersion: this.apiVersion,
            baseURL: baseURL // Direct baseURL to bypass ModelRouter
          });
        } finally {
          // Restore API key for other services
          if (savedApiKey) {
            process.env.AZURE_OPENAI_API_KEY = savedApiKey;
          }
        }
      } else {
        // Use API key authentication
        const apiKey = process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY;

        if (!apiKey) {
          throw new Error('No API key available for embedding client');
        }

        this.embeddingClient = new AzureOpenAI({
          apiKey,
          apiVersion: this.apiVersion,
          baseURL: baseURL // Direct baseURL to bypass ModelRouter
        });
      }

      this.logger.info({
        embeddingEndpoint,
        baseURL,
        usingDedicatedClient: true
      }, 'Azure OpenAI embedding client configured successfully');

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize embedding client');
      throw error;
    }
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.client) {
      throw new Error('Azure OpenAI provider not initialized');
    }

    const startTime = Date.now();

    try {
      // Note: Token refresh is automatic with getBearerTokenProvider (2025 SDK pattern)
      // No manual refresh needed

      // Prepare parameters (model/deployment handled via baseURL)
      const params: any = {
        model: this.deployment, // For Azure v1 API
        messages: request.messages,
        stream: request.stream !== false
      };

      // Add optional parameters only if provided
      if (request.temperature !== undefined) params.temperature = request.temperature;
      if (request.max_tokens !== undefined) params.max_completion_tokens = request.max_tokens;
      if (request.top_p !== undefined) params.top_p = request.top_p;
      if (request.frequency_penalty !== undefined) params.frequency_penalty = request.frequency_penalty;
      if (request.presence_penalty !== undefined) params.presence_penalty = request.presence_penalty;
      if (request.user) params.user = request.user;

      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        params.tools = request.tools;
        params.tool_choice = request.tool_choice || 'auto';
      }

      // Add response format if provided
      if (request.response_format) {
        params.response_format = request.response_format;
      }

      // Make request
      const response = await this.client.chat.completions.create(params);

      const latency = Date.now() - startTime;

      // Track metrics for non-streaming
      if (request.stream === false && 'usage' in response) {
        const tokens = response.usage?.total_tokens || 0;
        const cost = this.calculateCost(tokens);
        this.trackSuccess(latency, tokens, cost);

        this.logger.info({
          model: this.deployment,
          usage: response.usage,
          latency
        }, 'Azure OpenAI completion successful');

        return response as any;
      }

      // For streaming, wrap the response to emit interleaved thinking events
      if (request.stream !== false) {
        return this.wrapStreamWithInterleavedEvents(response as any, this.deployment || '', startTime);
      }

      return response as any;

    } catch (error) {
      this.trackFailure();
      this.logger.error({
        error: error instanceof Error ? error.message : error,
        endpoint: this.endpoint,
        deployment: this.deployment
      }, 'Azure OpenAI completion failed');
      throw error;
    }
  }

  /**
   * Wrap streaming response to emit interleaved thinking events
   * INTERLEAVED THINKING: Converts OpenAI-style reasoning_content to Anthropic-style content_block events
   */
  private async *wrapStreamWithInterleavedEvents(
    stream: AsyncIterable<any>,
    modelName: string,
    startTime: number
  ): AsyncGenerator<any> {
    // Track block indices for proper interleaving
    let blockIndex = 0;
    let currentBlockType: 'thinking' | 'text' | null = null;
    let totalTokens = 0;

    for await (const chunk of stream) {
      // Extract reasoning content for o3-mini and other reasoning models
      const reasoningContent = chunk.choices?.[0]?.delta?.reasoning_content ||
                               chunk.choices?.[0]?.message?.reasoning_content;

      if (reasoningContent) {
        // INTERLEAVED THINKING: Start a new thinking block if not already in one
        if (currentBlockType !== 'thinking') {
          // Close previous block if any
          if (currentBlockType !== null) {
            yield {
              type: 'content_block_stop',
              index: blockIndex
            };
            blockIndex++;
          }

          // Start new thinking block
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking' }
          };
          currentBlockType = 'thinking';
        }

        // Emit thinking delta with block index
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'thinking_delta',
            thinking: reasoningContent
          }
        };

        // NOTE: Do NOT yield OpenAI-compatible format here.
        // Content is already emitted via content_block_* events above.
        // Yielding an additional chunk with delta.thinking would cause duplicate
        // thinking blocks in processProviderStream (processed by both Anthropic path
        // and OpenAI path).
        continue;
      }

      // Handle regular content
      const textContent = chunk.choices?.[0]?.delta?.content;
      if (textContent) {
        // INTERLEAVED THINKING: Start a new text block if switching from thinking
        if (currentBlockType !== 'text') {
          // Close previous block if any
          if (currentBlockType !== null) {
            yield {
              type: 'content_block_stop',
              index: blockIndex
            };
            blockIndex++;
          }

          // Start new text block
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'text' }
          };
          currentBlockType = 'text';
        }

        // Emit text delta with block index
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'text_delta',
            text: textContent
          }
        };
      }

      // Yield original chunk for metadata (model, usage, finish_reason) but NOT content
      // Content is already emitted via content_block_* events above — yielding the original
      // chunk would cause duplicate text in processProviderStream's OpenAI path
      if (!textContent) {
        yield chunk;
      } else {
        // For text chunks, yield metadata only (strip delta.content to prevent duplication)
        if (chunk.choices?.[0]?.finish_reason || chunk.model || chunk.usage) {
          yield {
            ...chunk,
            choices: [{
              ...chunk.choices[0],
              delta: { ...chunk.choices[0].delta, content: undefined }
            }]
          };
        }
      }

      // Check if done
      if (chunk.choices?.[0]?.finish_reason) {
        // INTERLEAVED THINKING: Close the final block
        if (currentBlockType !== null) {
          yield {
            type: 'content_block_stop',
            index: blockIndex
          };
        }

        // Track tokens
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens || 0;
        }

        // Track success
        const latency = Date.now() - startTime;
        const cost = this.calculateCost(totalTokens);
        this.trackSuccess(latency, totalTokens, cost);

        this.logger.info({
          model: modelName,
          duration: latency,
          totalTokens
        }, '[AzureOpenAIProvider] Stream completed');
      }
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    return [{
      id: this.deployment || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL,
      name: this.deployment || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL,
      provider: 'azure-openai'
    }];
  }

  async getHealth(): Promise<ProviderHealth> {
    try {
      if (!this.client) {
        return {
          status: 'not_initialized',
          provider: this.name,
          error: 'Provider not initialized',
          lastChecked: new Date()
        };
      }

      // Test with a simple model list call
      await this.listModels();

      return {
        status: 'healthy',
        provider: this.name,
        endpoint: this.endpoint,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.endpoint,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Note: Token refresh is automatic with getBearerTokenProvider (2025 SDK pattern)
   * Manual refresh methods are deprecated and no longer needed
   */

  /**
   * Generate text embeddings using Azure OpenAI embedding model
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    if (!this.embeddingClient) {
      throw new Error('Azure OpenAI embedding client not initialized');
    }

    try {
      const input = Array.isArray(text) ? text : [text];

      // Use the embedding deployment from environment or fallback
      const embeddingModel = process.env.DEFAULT_EMBEDDING_DEPLOYMENT || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || process.env.EMBEDDING_MODEL;

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        usingDirectClient: true,
        embeddingEndpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT
      }, 'Generating Azure OpenAI embeddings with dedicated client');

      const response = await this.embeddingClient.embeddings.create({
        input,
        model: embeddingModel
      });

      const embeddings = response.data.map(item => item.embedding);

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        dimensions: embeddings[0]?.length,
        usingDirectClient: this.embeddingClient !== this.client
      }, 'Azure OpenAI embeddings generated successfully');

      return Array.isArray(text) ? embeddings : embeddings[0];

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : error,
        endpoint: this.endpoint
      }, 'Azure OpenAI embedding generation failed');
      throw error;
    }
  }

  /**
   * Calculate cost based on tokens
   * TODO: Implement proper pricing based on model
   */
  private calculateCost(tokens: number): number {
    // Placeholder - implement actual pricing
    return tokens * 0.00001;
  }

  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    // Azure OpenAI has no model metadata endpoint. Fall back to ModelCapabilityRegistry.
    return null;
  }

  /**
   * Normalize a raw Azure OpenAI stream chunk into NormalizedStreamEvents.
   * Delegates to the exported pure function for testability.
   */
  normalizeChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
    return normalizeAzureOpenAIChunk(rawChunk, state);
  }

  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 4096, temperature: 1.0, topP: 1.0, topK: 0,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: false, thinkingBudget: 0, thinkingLevel: '',
      supportsTopK: false, supportsFreqPenalty: true, supportsThinking: false,
      thinkingMode: 'budget',
      temperatureRange: [0, 2], maxTokensRange: [256, 128000], topKRange: [0, 0],
      defaultChatModel: 'gpt-4o', defaultEmbeddingModel: 'text-embedding-3-large',
    };
  }
}

// ---------------------------------------------------------------------------
// Exported normalizer function — pure, per-chunk, state-mutating
// ---------------------------------------------------------------------------

/**
 * Normalizes a single raw Azure OpenAI streaming chunk into zero or more
 * NormalizedStreamEvents. Handles two formats:
 *
 * Format A: Anthropic-style content_block_* events (from reasoning models like o3-mini
 *           that go through the wrapStreamWithInterleavedEvents thinking transform)
 * Format B: OpenAI-style choices[0].delta chunks (standard model streaming)
 *
 * State is mutated in place to track block types, thinking accumulation,
 * synthetic thinking, and pending tools across chunk boundaries.
 */
export function normalizeAzureOpenAIChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
  const events: NormalizedStreamEvent[] = [];

  // Format A: Anthropic-style content_block events (from reasoning models)
  if (typeof rawChunk.type === 'string' && rawChunk.type.startsWith('content_block')) {
    return normalizeContentBlockChunk(rawChunk, state, events);
  }

  // Format B: OpenAI-style chunks
  return normalizeOpenAIStyleChunk(rawChunk, state, events);
}

/**
 * Handles Anthropic-style content_block_start/delta/stop events that come
 * from the reasoning model path in wrapStreamWithInterleavedEvents().
 */
function normalizeContentBlockChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[]
): NormalizedStreamEvent[] {
  // Emit stream_start on the first Format A event (reasoning model path never sees an
  // OpenAI-style first chunk, so we must emit it here instead).
  if (!state.streamStartEmitted) {
    state.streamStartEmitted = true;
    events.push({
      type: 'stream_start',
      messageId: '',
      model: state.model || '',
      provider: 'azure-openai',
    });
  }

  const blockTypes = state.blockTypes;

  switch (rawChunk.type) {
    case 'content_block_start': {
      const block = rawChunk.content_block;
      const index: number = rawChunk.index;
      if (block?.type === 'thinking') {
        const id = `tk-${index}`;
        state.thinkingId = id;
        state.thinkingStartTime = Date.now();
        state.thinkingAccumulated = '';
        blockTypes.set(index, { type: 'thinking', id });
        events.push({ type: 'thinking_start', id });
      } else if (block?.type === 'text') {
        const id = `txt-${index}`;
        state.textBlockId = id;
        blockTypes.set(index, { type: 'text', id });
        events.push({ type: 'text_start', id });
      } else if (block?.type === 'tool_use') {
        const id = block.id || `tool-${index}`;
        blockTypes.set(index, { type: 'tool_use', id });
        events.push({ type: 'tool_start', id, toolName: block.name || '', serverName: '' });
      }
      break;
    }

    case 'content_block_delta': {
      const delta = rawChunk.delta;
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);

      if (delta?.type === 'thinking_delta') {
        state.thinkingAccumulated += delta.thinking || '';
        events.push({
          type: 'thinking_delta',
          id: blockInfo?.id || state.thinkingId || `tk-${index}`,
          content: delta.thinking || '',
          accumulated: state.thinkingAccumulated,
        });
      } else if (delta?.type === 'text_delta') {
        events.push({
          type: 'text_delta',
          id: blockInfo?.id || state.textBlockId || `txt-${index}`,
          content: delta.text || '',
        });
      } else if (delta?.type === 'input_json_delta') {
        const toolId = blockInfo?.id || `tool-${index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: delta.partial_json || '' });
      }
      break;
    }

    case 'content_block_stop': {
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);
      if (blockInfo?.type === 'thinking') {
        const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
        events.push({ type: 'thinking_stop', id: blockInfo.id, elapsedMs: elapsed });
        state.thinkingId = null;
        state.thinkingStartTime = null;
        state.thinkingAccumulated = '';
      } else if (blockInfo?.type === 'text') {
        events.push({ type: 'text_stop', id: blockInfo.id });
        state.textBlockId = null;
      } else if (blockInfo?.type === 'tool_use') {
        events.push({ type: 'tool_stop', id: blockInfo.id, result: null, durationMs: 0 });
      }
      blockTypes.delete(index);
      break;
    }
  }

  return events;
}

/**
 * Handles OpenAI-style streaming chunks (choices[0].delta).
 * Emits a synthetic thinking block on the first chunk so every response
 * has a thinking node in the activity tree.
 */
function normalizeOpenAIStyleChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[]
): NormalizedStreamEvent[] {
  const pendingTools = state.pendingTools;

  const choice = rawChunk.choices?.[0];

  // Usage-only chunk (no choices)
  if (!choice && rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
    return events;
  }

  if (!choice) return events;

  const delta = choice.delta;
  if (!delta && !choice.finish_reason) return events;

  // -----------------------------------------------------------------------
  // First chunk — role === 'assistant': emit stream_start + synthetic thinking
  // -----------------------------------------------------------------------
  if (delta?.role === 'assistant' && !state.streamStartEmitted) {
    state.streamStartEmitted = true;
    state.model = rawChunk.model || '';
    events.push({
      type: 'stream_start',
      messageId: rawChunk.id || '',
      model: rawChunk.model || '',
      provider: 'azure-openai',
    });

    // Emit synthetic thinking block (closed when real content arrives)
    const thinkId = 'tk-synth-0';
    state.thinkingId = thinkId;
    state.thinkingStartTime = Date.now();
    events.push({ type: 'thinking_start', id: thinkId });
    events.push({ type: 'thinking_delta', id: thinkId, content: 'Processing', accumulated: 'Processing' });
    return events;
  }

  // -----------------------------------------------------------------------
  // Helper: close synthetic thinking if still active
  // -----------------------------------------------------------------------
  const closeSyntheticThinking = () => {
    if (state.thinkingId) {
      const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
      events.push({ type: 'thinking_stop', id: state.thinkingId, elapsedMs: elapsed });
      state.thinkingId = null;
      state.thinkingStartTime = null;
    }
  };

  // -----------------------------------------------------------------------
  // Text content delta
  // -----------------------------------------------------------------------
  if (delta?.content) {
    closeSyntheticThinking();
    if (!state.textBlockId) {
      state.textBlockId = 'txt-0';
      events.push({ type: 'text_start', id: state.textBlockId });
    }
    events.push({ type: 'text_delta', id: state.textBlockId, content: delta.content });
  }

  // -----------------------------------------------------------------------
  // Tool call deltas
  // -----------------------------------------------------------------------
  if (delta?.tool_calls) {
    closeSyntheticThinking();
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) {
        const toolId = tc.id || `tool-${tc.index}`;
        pendingTools.set(toolId, tc.function.name);
        state.toolIndexToId.set(tc.index, toolId);
        events.push({ type: 'tool_start', id: toolId, toolName: tc.function.name, serverName: '' });
      }
      if (tc.function?.arguments) {
        // Resolve tool ID: prefer explicit id, then toolIndexToId map, then fallback
        const toolId = tc.id || state.toolIndexToId.get(tc.index) || `tool-${tc.index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: tc.function.arguments });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Finish reason
  // -----------------------------------------------------------------------
  if (choice.finish_reason) {
    if (choice.finish_reason === 'tool_calls') {
      for (const [id] of pendingTools) {
        events.push({ type: 'tool_stop', id, result: null, durationMs: 0 });
      }
      pendingTools.clear();
    }

    if (state.textBlockId) {
      events.push({ type: 'text_stop', id: state.textBlockId });
      state.textBlockId = null;
    }

    // Close any still-open synthetic thinking (e.g. response with no content)
    closeSyntheticThinking();

    events.push({
      type: 'stream_end',
      finishReason: choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason,
      totalDurationMs: 0,
    });
  }

  // -----------------------------------------------------------------------
  // Usage embedded in the same chunk
  // -----------------------------------------------------------------------
  if (rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
  }

  return events;
}
