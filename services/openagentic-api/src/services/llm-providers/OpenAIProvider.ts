/**
 * OpenAI Provider - Direct OpenAI API Integration
 *
 * Supports both official OpenAI API and any OpenAI-compatible endpoint.
 * Uses the openai SDK for chat completions, streaming, tool calls, etc.
 */

import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  CompletionRequest,
  CompletionResponse,
  NormalizerState,
  ProviderConfig,
  ProviderHealth,
} from './ILLMProvider.js';
import { NormalizedStreamEvent } from '../NormalizedStreamTypes.js';

/**
 * Normalize a raw OpenAI SSE chunk into NormalizedStreamEvents.
 *
 * OpenAI streams pure OpenAI-format chunks — no content_block events, no
 * reasoning_content. We synthesise a thinking block on the first assistant
 * chunk so every response has a consistent thinking node in the activity tree.
 */
export function normalizeOpenAIChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
  const events: NormalizedStreamEvent[] = [];
  const pendingTools = state.pendingTools;

  // Usage-only chunk (no choices)
  if (!rawChunk.choices?.length && rawChunk.usage) {
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

  const choice = rawChunk.choices?.[0];
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
      provider: 'openai',
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
      finishReason: choice.finish_reason,
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

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  readonly type = 'openai' as any;
  readonly streamFormat = 'openai' as const;

  private apiKey = '';
  private baseUrl = 'https://api.openai.com/v1';
  private defaultModel = 'gpt-4o';

  constructor(logger: Logger) {
    super(logger, 'openai');
  }

  async initialize(config: Record<string, any>): Promise<void> {
    this.apiKey = config.apiKey || config.key || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || config.endpoint || 'https://api.openai.com/v1';
    this.defaultModel = config.chatModel || config.model || config.modelId || 'gpt-4o';

    if (!this.apiKey) {
      this.logger.warn('OpenAI provider initialized without API key');
    }

    this.initialized = true;
    this.logger.info({
      baseUrl: this.baseUrl,
      model: this.defaultModel,
      hasApiKey: !!this.apiKey,
    }, 'OpenAI provider initialized');
  }

  normalizeChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
    return normalizeOpenAIChunk(rawChunk, state);
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;

    try {
      const body: any = {
        model,
        messages: request.messages,
        temperature: request.temperature ?? 1.0,
        stream: request.stream ?? false,
      };

      if (request.max_tokens) body.max_tokens = request.max_tokens;
      if (request.top_p !== undefined) body.top_p = request.top_p;
      if (request.frequency_penalty !== undefined) body.frequency_penalty = request.frequency_penalty;
      if (request.presence_penalty !== undefined) body.presence_penalty = request.presence_penalty;
      if (request.tools?.length) body.tools = request.tools;
      if (request.tool_choice) body.tool_choice = request.tool_choice;
      if (request.response_format) body.response_format = request.response_format;

      const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
      }

      if (request.stream) {
        return this.streamResponse(response, model);
      }

      const data = await response.json() as CompletionResponse;
      const latency = Date.now() - startTime;
      const tokens = data.usage?.total_tokens || 0;
      this.trackSuccess(latency, tokens, 0);
      return data;

    } catch (error) {
      this.trackFailure();
      throw error;
    }
  }

  private async *streamResponse(response: Response, model: string): AsyncGenerator<any> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            yield JSON.parse(data);
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    try {
      const url = `${this.baseUrl.replace(/\/+$/, '')}/models`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      if (!response.ok) return [];
      const data = await response.json() as any;
      return (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.id,
        provider: 'openai',
      }));
    } catch {
      return [];
    }
  }

  async getHealth(): Promise<ProviderHealth> {
    try {
      const url = `${this.baseUrl.replace(/\/+$/, '')}/models`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      return {
        status: response.ok ? 'healthy' : 'unhealthy',
        provider: 'openai',
        endpoint: this.baseUrl,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: 'openai',
        endpoint: this.baseUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
      };
    }
  }

  // Cache for discovered models (5-minute TTL)
  private discoveredModelCache?: { models: import('./ILLMProvider.js').DiscoveredModel[]; timestamp: number };
  private static readonly DISCOVER_CACHE_TTL_MS = 5 * 60 * 1000;

  /**
   * Discover models available from OpenAI via live API.
   * Calls GET /v1/models on the configured base URL.
   * Filters to chat/embedding models (excludes fine-tunes, deprecated, internal).
   * On failure: returns empty array (no hardcoded fallback).
   */
  async discoverModels(): Promise<import('./ILLMProvider.js').DiscoveredModel[]> {
    type DiscoveredModel = import('./ILLMProvider.js').DiscoveredModel;

    if (!this.apiKey) {
      this.logger.warn('[OpenAIProvider] Cannot discover models — no API key');
      return [];
    }

    // Check cache
    const now = Date.now();
    if (this.discoveredModelCache && (now - this.discoveredModelCache.timestamp) < OpenAIProvider.DISCOVER_CACHE_TTL_MS) {
      return this.discoveredModelCache.models;
    }

    try {
      const url = `${this.baseUrl.replace(/\/+$/, '')}/models`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenAI models API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json() as any;
      const apiModels = (data.data || []) as any[];

      const models: DiscoveredModel[] = apiModels
        .filter((m: any) => {
          const id = (m.id || '').toLowerCase();
          // Exclude fine-tunes, internal models, deprecated
          if (id.includes(':ft-') || id.includes('ft:')) return false;
          if (id.startsWith('dall-e') || id.startsWith('tts') || id.startsWith('whisper')) return false;
          // Keep chat models, embedding models, and image gen models
          return id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4') ||
                 id.includes('embed') || id.includes('chatgpt') || id.includes('dall-e');
        })
        .map((m: any): DiscoveredModel => {
          const modelId = m.id || '';
          const ml = modelId.toLowerCase();

          // Infer capabilities
          const isEmbed = ml.includes('embed');
          const hasVision = ml.includes('gpt-4o') || ml.includes('gpt-4.1') || ml.includes('o3') || ml.includes('o1') || ml.includes('o4');
          const hasThinking = ml.includes('o1') || ml.includes('o3') || ml.includes('o4');
          const hasTools = !isEmbed;

          // Infer family
          let family = 'openai';
          if (ml.includes('gpt-4.1')) family = 'gpt-4.1';
          else if (ml.includes('gpt-4o')) family = 'gpt-4o';
          else if (ml.includes('gpt-4')) family = 'gpt-4';
          else if (ml.includes('gpt-3.5')) family = 'gpt-3.5';
          else if (ml.includes('o3')) family = 'o3';
          else if (ml.includes('o1')) family = 'o1';
          else if (ml.includes('o4')) family = 'o4';
          else if (isEmbed) family = 'embedding';

          // Infer cost tier
          let costTier: DiscoveredModel['costTier'] = 'mid';
          if (ml.includes('o3') || ml.includes('o4') || ml.includes('gpt-4.1') && !ml.includes('mini') && !ml.includes('nano')) costTier = 'premium';
          else if (ml.includes('mini') || ml.includes('nano') || isEmbed) costTier = 'low';
          else if (ml.includes('gpt-4o') && !ml.includes('mini')) costTier = 'high';

          // Infer context window
          let contextWindow: number | undefined;
          if (ml.includes('gpt-4.1')) contextWindow = 1047576;
          else if (ml.includes('o3') || ml.includes('o1') || ml.includes('o4')) contextWindow = 200000;
          else if (ml.includes('gpt-4o')) contextWindow = 128000;
          else if (ml.includes('gpt-3.5')) contextWindow = 16384;

          // Infer max output
          let maxOutputTokens: number | undefined;
          if (ml.includes('o3') || ml.includes('o1') || ml.includes('o4')) maxOutputTokens = 100000;
          else if (ml.includes('gpt-4.1')) maxOutputTokens = 32768;
          else if (ml.includes('gpt-4o')) maxOutputTokens = 16384;

          return {
            id: modelId,
            name: modelId,
            provider: 'openai',
            description: `OpenAI ${modelId}${m.owned_by ? ` (${m.owned_by})` : ''}`,
            family,
            costTier,
            capabilities: {
              chat: !isEmbed,
              vision: hasVision,
              tools: hasTools,
              thinking: hasThinking,
              embeddings: isEmbed,
              imageGeneration: false,
              streaming: !isEmbed,
            },
            contextWindow,
            maxOutputTokens,
          };
        });

      // Cache results
      this.discoveredModelCache = { models, timestamp: now };

      this.logger.info({ discoveredCount: models.length }, '[OpenAIProvider] Live model discovery complete');
      return models;
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[OpenAIProvider] Live model discovery failed — returning empty list');
      return [];
    }
  }

  /**
   * Query OpenAI /v1/models/{model} for model metadata.
   * OpenAI API returns limited info (id, owner, created), so we return null
   * and let the caller fall back to ModelCapabilityRegistry.
   */
  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    // OpenAI's /v1/models endpoint doesn't return parameter metadata.
    return null;
  }

  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 4096, temperature: 1.0, topP: 1.0, topK: 0,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: false, thinkingBudget: 0, thinkingLevel: '',
      supportsTopK: false, supportsFreqPenalty: true, supportsThinking: false,
      thinkingMode: 'budget',
      temperatureRange: [0, 2], maxTokensRange: [256, 128000], topKRange: [0, 0],
      defaultChatModel: 'gpt-4o', defaultEmbeddingModel: 'text-embedding-3-small',
    };
  }

  async generateImage(request: import('./ILLMProvider.js').ImageGenerationRequest): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    if (!this.initialized || !this.apiKey) {
      throw new Error('[OpenAIProvider] Not initialized or API key not configured');
    }

    const model = request.model || 'dall-e-3';
    const startTime = Date.now();

    this.logger.info({ model, promptLength: request.prompt.length }, '[OpenAIProvider] generateImage started');

    const body: Record<string, any> = {
      model,
      prompt: request.prompt,
      n: request.n || 1,
      size: request.size || '1024x1024',
      response_format: 'b64_json',
    };
    if (request.style) {
      body.style = request.style;
    }

    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`[OpenAIProvider] Image generation failed (${response.status}): ${errorText}`);
    }

    const result = await response.json() as any;

    if (!result.data || !result.data[0] || !result.data[0].b64_json) {
      throw new Error('[OpenAIProvider] No image data in response');
    }

    const durationMs = Date.now() - startTime;
    this.logger.info({ model, durationMs }, '[OpenAIProvider] generateImage completed');

    return {
      imageBase64: result.data[0].b64_json,
      revisedPrompt: result.data[0].revised_prompt,
      model,
      provider: 'openai',
      format: 'png',
      generationTimeMs: durationMs,
    };
  }
}
