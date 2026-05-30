/**
 * Anthropic Provider - Direct Anthropic API Integration
 *
 * Uses the official @anthropic-ai/sdk for maximum Claude capabilities:
 * - Native extended thinking support
 * - Interleaved thinking (beta)
 * - Proper thinking block preservation
 * - Streaming with thinking_delta events
 * - Earliest access to new Claude features
 *
 * This provider is preferred for Claude models as it provides full access
 * to Claude-specific features that may not be available through Bedrock.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderConfig,
  ProviderHealth,
} from './ILLMProvider.js';
import { MODELS } from '../../config/models.js';
import { shouldEnableParallelToolCalls } from './parallelToolCallsPolicy.js';
import { selectCanonicalNormalizer } from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import { getModelCapabilityRegistry } from '../ModelCapabilityRegistry.js';
// Phase 0.4 — SDK adapter is SoT for canonical → Anthropic Messages wire
// translation. Provider becomes thin: HTTP + auth + thinking-config +
// streaming/non-streaming dispatch. The in-class convertMessages /
// convertTools / convertToolChoice (220 LOC) are DELETED.
import { buildAnthropicWireBody } from './anthropic/buildAnthropicWireBody.js';

// H13: pricing comes from ModelCapabilityRegistry → admin.model_role_assignments.
// Until the registry has a row for the model, calculateCost reports 0 —
// the operator's signal that the row is missing, not a best-guess wrong number.

export interface AnthropicProviderConfig {
  apiKey: string;
  defaultModel?: string;
  maxRetries?: number;
  timeout?: number;
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;
  enableInterleavedThinking?: boolean;
  // Prompt caching configuration (saves 90% on cached content!)
  // See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
  enablePromptCaching?: boolean;
}

export interface TokenCountResult {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly type = 'anthropic' as const;
  readonly streamFormat = 'anthropic' as const; // Native Anthropic format with content_block events

  private client: Anthropic | null = null;
  private config: AnthropicProviderConfig | null = null;

  constructor(logger: Logger) {
    super(logger, 'anthropic');
  }

  async initialize(config: AnthropicProviderConfig): Promise<void> {
    this.logger.info('Initializing Anthropic provider');

    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.config = config;

    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries || 2,
      timeout: config.timeout || 120000,
    });

    this.initialized = true;
    this.logger.info({ defaultModel: config.defaultModel }, 'Anthropic provider initialized');
  }

  async createCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.client || !this.config) {
      throw new Error('Anthropic provider not initialized');
    }

    const startTime = Date.now();

    try {
      // Resolve model first — needed for capability gates (thinking).
      const model = request.model || this.config.defaultModel || MODELS.anthropic;

      // Capability + provider-config decisions (NOT wire shape — those
      // live in the SDK adapter via buildAnthropicWireBody).
      const parallelOn = shouldEnableParallelToolCalls({
        tools: request.tools as any,
        metadata: (request as any).metadata,
      });
      // Z.ET (2026-05-19) — honor per-request extended thinking toggle.
      // When the UI Brain toggle is OFF the caller sends
      // extendedThinkingEnabled:false. Only enable thinking when:
      //   (a) the caller did NOT explicitly turn it off (undefined = ON), AND
      //   (b) the model supports it (shouldEnableThinking).
      // The `!== false` guard treats undefined (omitted) as ON — backwards-
      // compatible: callers that don't set the field see no behavior change.
      const supportsThinking =
        (request as any).extendedThinkingEnabled !== false &&
        this.shouldEnableThinking(model);
      const thinkingConfig = supportsThinking ? this.getThinkingConfig() : null;
      const thinkingBudgetTokens = thinkingConfig?.budget_tokens;

      // Default tool_choice='auto' if caller passed tools but no explicit
      // choice. The legacy path did this inline; we forward it to the
      // helper via the request object so the SDK adapter sees it.
      const effectiveRequest: CompletionRequest =
        !request.tool_choice && request.tools && request.tools.length > 0
          ? { ...request, tool_choice: 'auto' }
          : request;

      // Phase 0.4 — SDK adapter is SoT for canonical → Anthropic wire shape.
      const anthropicRequest = buildAnthropicWireBody(effectiveRequest, {
        model,
        parallelOn,
        supportsThinking,
        thinkingBudgetTokens,
      }) as unknown as Anthropic.MessageCreateParams;

      // Optional system-prompt cache_control. The SDK adapter doesn't yet
      // attach cache_control markers (Phase 0.5 future work); the provider
      // wraps in applyCaching() which prepends the `cache_control:ephemeral`
      // marker when prompt-caching is enabled.
      if (anthropicRequest.system) {
        (anthropicRequest as any).system = this.applyCaching(
          anthropicRequest.system as any,
        ) as any;
      }

      // Handle streaming
      if (request.stream) {
        return this.createStreamingCompletion(anthropicRequest, model);
      }

      // Non-streaming request — strip the stream flag that buildAnthropicWireBody
      // may have set, so the Anthropic SDK returns a Message (not a Stream).
      const nonStreamingRequest: Anthropic.MessageCreateParamsNonStreaming = {
        ...anthropicRequest,
        stream: false,
      } as Anthropic.MessageCreateParamsNonStreaming;
      const response = await this.client.messages.create(nonStreamingRequest);

      const latency = Date.now() - startTime;
      const tokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      const cost = this.calculateCost(model, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);

      this.trackSuccess(latency, tokens, cost);

      return this.convertResponse(response, model);
    } catch (error: any) {
      this.trackFailure();
      this.logger.error({ error: error.message, stack: error.stack }, 'Anthropic completion failed');
      throw error;
    }
  }

  /**
   * Create streaming completion with proper thinking support.
   *
   * Wire-in: every native Anthropic SDK event flows through the canonical
   * SDK normalizer (`selectCanonicalNormalizer('anthropic', …)`). The
   * normalizer is a passthrough state-machine for Anthropic-shape input —
   * it preserves text/thinking/tool_use/signature deltas verbatim, and
   * synthesizes any missing wrapper events so downstream always sees the
   * canonical pair (`message_start` → … → `message_delta` → `message_stop`).
   *
   * Cost tracking remains a side effect of this method: token counts are
   * captured from the raw SDK events before delegation, then `trackSuccess`
   * fires at `message_stop`.
   */
  private async *createStreamingCompletion(
    request: Anthropic.MessageCreateParams,
    model: string
  ): AsyncGenerator<any> {
    if (!this.client) throw new Error('Client not initialized');

    const stream = await this.client.messages.stream(request);

    const normalizer = selectCanonicalNormalizer('anthropic', {
      messageId: `msg_${Date.now()}_anthropic`,
      model,
    });

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const event of stream) {
        if (event.type === 'message_start') {
          inputTokens = event.message.usage?.input_tokens || 0;
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens || 0;
        }

        const canonicalEvents = normalizer.consume(event);
        for (const out of canonicalEvents) {
          yield out;
        }

        if (event.type === 'message_stop') {
          const cost = this.calculateCost(model, inputTokens, outputTokens);
          this.trackSuccess(0, inputTokens + outputTokens, cost);
        }
      }
    } finally {
      const flushed = normalizer.finalize();
      for (const out of flushed) {
        yield out;
      }
    }
  }

  // Phase 0.4 (2026-05-12) — convertMessages / convertTools /
  // convertToolChoice DELETED. Wire-shape translation moved to the SDK
  // adapter via `buildAnthropicWireBody` (see import above). The adapter
  // is the SoT for canonical → Anthropic Messages wire conversion;
  // provider-specific decoration (thinking, output_config, sampling)
  // lives in the helper alongside.

  /**
   * Wire-format gate: does this model accept the `thinking` field in the
   * request body?
   *
   * Source of truth: ModelCapabilityRegistry.supportsThinking(model), which
   * reads `capabilities.thinking` from admin.model_role_assignments (the
   * registry SoT). This eliminates the former substring-sniff and closes
   * CLAUDE.md Rule 7 for AnthropicProvider (Task A, 2026-05-19).
   *
   * Fail-safe: if the registry is not yet initialised (null), returns false
   * so a missing registry row never accidentally enables thinking.
   */
  private shouldEnableThinking(model: string): boolean {
    if (!this.config?.enableThinking) return false;
    return getModelCapabilityRegistry()?.supportsThinking(model) ?? false;
  }

  /**
   * Get thinking configuration for extended thinking
   * Note: Interleaved thinking is enabled via beta header, not this config
   */
  private getThinkingConfig(): { type: 'enabled'; budget_tokens: number } | null {
    if (!this.config?.enableThinking) return null;

    return {
      type: 'enabled',
      budget_tokens: this.config.thinkingBudgetTokens || 16000,
    };
  }

  /**
   * Wire-format gate: which Anthropic models accept the
   * `interleaved-thinking-2025-05-14` beta header. Claude 4 family only.
   * This is an SDK contract, not a config decision. Cage-safe substrings.
   */
  private supportsInterleavedThinking(model: string): boolean {
    if (!this.config?.enableThinking) return false;
    const ml = model.toLowerCase();
    const interleavedMarkers = ['opus-4', 'sonnet-4', 'haiku-4'];
    return interleavedMarkers.some((m) => ml.includes(m));
  }

  /**
   * Get beta headers for the request
   */
  private getBetaHeaders(model: string): string[] {
    const betas: string[] = [];

    // Add interleaved thinking beta for Claude 4 models
    if (this.supportsInterleavedThinking(model)) {
      betas.push('interleaved-thinking-2025-05-14');
    }

    return betas;
  }

  /**
   * Convert Anthropic response to OpenAI-compatible format
   */
  private convertResponse(response: Anthropic.Message, model: string): CompletionResponse {
    let content = '';
    const toolCalls: any[] = [];
    let thinkingContent = '';

    // Process content blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'thinking') {
        thinkingContent = block.thinking;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const result: CompletionResponse = {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: this.mapStopReason(response.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      },
    };

    // Add thinking content as metadata if present
    if (thinkingContent) {
      (result as any).thinking = thinkingContent;
    }

    return result;
  }

  /**
   * Map Anthropic stop reason to OpenAI format
   */
  private mapStopReason(stopReason: string | null): string {
    switch (stopReason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }

  /**
   * Calculate cost for request via ModelCapabilityRegistry (admin.model_role_assignments SoT).
   * Returns 0 if the model isn't registered — the operator's cue to add it.
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const caps = getModelCapabilityRegistry()?.getCapabilities(model);
    const inputPer1k = typeof caps?.inputCostPer1k === 'number' ? caps.inputCostPer1k : 0;
    const outputPer1k = typeof caps?.outputCostPer1k === 'number' ? caps.outputCostPer1k : 0;
    return (inputTokens / 1000) * inputPer1k + (outputTokens / 1000) * outputPer1k;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    // H13: no static catalog. Live discovery via discoverModels() (Anthropic
    // /v1/models API) is the SoT; the platform consults
    // admin.model_role_assignments for what's actually configured.
    return [];
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.initialized || !this.client) {
      return {
        status: 'not_initialized',
        provider: 'anthropic',
        lastChecked: new Date(),
      };
    }

    try {
      // Simple health check - just verify we can create a client
      // Anthropic doesn't have a dedicated health endpoint
      return {
        status: 'healthy',
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        lastChecked: new Date(),
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        provider: 'anthropic',
        error: error.message,
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Count tokens in a message before sending - useful for pre-validation
   * This uses the Anthropic token counting API (v0.71.0+)
   * See: https://docs.anthropic.com/en/api/messages-count-tokens
   *
   * @param request - The completion request to count tokens for
   * @returns Token count including cache information if applicable
   */
  async countTokens(request: CompletionRequest): Promise<TokenCountResult> {
    if (!this.initialized || !this.client || !this.config) {
      throw new Error('Anthropic provider not initialized');
    }

    const model = request.model || this.config.defaultModel || MODELS.anthropic;
    // Phase 0.4 — use the SDK adapter via the wire helper so countTokens
    // mirrors the createCompletion wire shape byte-for-byte. The helper
    // returns the full Anthropic body; countTokens only needs
    // model + messages + system + tools, so we destructure.
    const wire = buildAnthropicWireBody(request, {
      model,
      parallelOn: false, // doesn't matter for token count
    });
    const countRequest: any = {
      model,
      messages: (wire as any).messages,
    };
    if ((wire as any).system) countRequest.system = (wire as any).system;
    if ((wire as any).tools) countRequest.tools = (wire as any).tools;

    try {
      // Use the beta countTokens API
      const result = await this.client.beta.messages.countTokens(countRequest);

      this.logger.info({
        model,
        input_tokens: result.input_tokens,
        cache_creation_input_tokens: (result as any).cache_creation_input_tokens,
        cache_read_input_tokens: (result as any).cache_read_input_tokens,
      }, '🔢 [Anthropic] Token count result');

      return {
        input_tokens: result.input_tokens,
        cache_creation_input_tokens: (result as any).cache_creation_input_tokens,
        cache_read_input_tokens: (result as any).cache_read_input_tokens,
      };
    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Failed to count tokens');
      throw error;
    }
  }

  /**
   * Add cache_control to system prompt for prompt caching
   * This is applied when enablePromptCaching is true and system prompt is large enough
   */
  private applyCaching(systemPrompt: string | undefined): string | Anthropic.TextBlockParam[] | undefined {
    if (!systemPrompt) return undefined;

    const enableCaching = this.config?.enablePromptCaching ?? process.env.ANTHROPIC_ENABLE_CACHING === 'true';

    // Prompt caching requires minimum 1024 tokens (~4KB of text)
    // Apply cache_control for system prompts larger than 4KB
    if (enableCaching && systemPrompt.length >= 4096) {
      this.logger.info({
        systemLength: systemPrompt.length,
        caching: true
      }, '💾 [Anthropic] System prompt caching enabled');

      return [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }] as any;
    }

    return systemPrompt;
  }

  // Cache for discovered models (5-minute TTL)
  private discoveredModelCache?: { models: import('./ILLMProvider.js').DiscoveredModel[]; timestamp: number };
  private static readonly DISCOVER_CACHE_TTL_MS = 5 * 60 * 1000;

  /**
   * Discover models available from Anthropic via live API.
   * Calls GET https://api.anthropic.com/v1/models
   * On failure: returns empty array (no hardcoded fallback).
   */
  async discoverModels(): Promise<import('./ILLMProvider.js').DiscoveredModel[]> {
    type DiscoveredModel = import('./ILLMProvider.js').DiscoveredModel;

    if (!this.client || !this.config?.apiKey) {
      this.logger.warn('[AnthropicProvider] Cannot discover models — not initialized');
      return [];
    }

    // Build set of already-configured model IDs
    const configuredIds = new Set<string>();
    try {
      const existing = await this.listModels();
      for (const m of existing) configuredIds.add(m.id);
    } catch { /* ignore */ }

    // Check cache
    const now = Date.now();
    if (this.discoveredModelCache && (now - this.discoveredModelCache.timestamp) < AnthropicProvider.DISCOVER_CACHE_TTL_MS) {
      const cached = this.discoveredModelCache.models;
      for (const model of cached) {
        model.configured = configuredIds.has(model.id);
      }
      return cached;
    }

    try {
      // Call Anthropic Models API
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Anthropic models API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json() as any;
      const apiModels = data.data || [];

      // H13 / discovery-only inference:
      // The Anthropic /v1/models API returns id + display_name only. The
      // capability/family/cost-tier tags below are SUBSTRING INFERENCE of
      // last resort — they populate the *Add Model* picker so the operator
      // sees something useful before they save the row.
      //
      // Once the operator persists the row to admin.model_role_assignments,
      // the registry SoT (ModelCapabilityRegistry.getCapabilities) trumps
      // every value below. This block MUST NOT be consulted for routing,
      // pricing, or capability gating — only for the discovery picker.
      const models: DiscoveredModel[] = apiModels.map((m: any): DiscoveredModel => {
        const modelId = m.id || '';
        const displayName = m.display_name || modelId;
        const ml = modelId.toLowerCase();

        // Infer capabilities
        const hasThinking = ml.includes('opus') || ml.includes('sonnet-4') || ml.includes('haiku-4');
        const hasVision = !ml.includes('embed');

        // Infer family
        let family = 'claude';
        if (ml.includes('opus-4-6') || ml.includes('sonnet-4-6')) family = 'claude-4.6';
        else if (ml.includes('4-5')) family = 'claude-4.5';
        else if (ml.includes('claude-3-5')) family = 'claude-3.5';
        else if (ml.includes('claude-3')) family = 'claude-3';

        // Infer cost tier
        let costTier: DiscoveredModel['costTier'] = 'mid';
        if (ml.includes('opus')) costTier = 'premium';
        else if (ml.includes('sonnet')) costTier = 'high';
        else if (ml.includes('haiku')) costTier = 'low';

        // Infer context/output limits
        let contextWindow = 200000;
        let maxOutputTokens = 8192;
        if (ml.includes('4-6') || ml.includes('4-5') || ml.includes('opus-4') || ml.includes('sonnet-4')) {
          maxOutputTokens = 128000;
        }

        return {
          id: modelId,
          name: displayName,
          provider: 'anthropic',
          description: m.description || `Anthropic ${displayName}`,
          family,
          costTier,
          capabilities: {
            chat: true,
            vision: hasVision,
            tools: true,
            thinking: hasThinking,
            embeddings: false,
            imageGeneration: false,
            streaming: true,
          },
          contextWindow,
          maxOutputTokens,
        };
      });

      // Cache results
      this.discoveredModelCache = { models, timestamp: now };

      this.logger.info({ discoveredCount: models.length }, '[AnthropicProvider] Live model discovery complete');

      // Mark configured models
      for (const model of models) {
        model.configured = configuredIds.has(model.id);
      }

      return models;
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[AnthropicProvider] Live model discovery failed — returning empty list');
      return [];
    }
  }

  /**
   * Anthropic doesn't have a model info API — use ModelCapabilityRegistry as fallback.
   */
  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    // Anthropic API has no model metadata endpoint.
    // The caller should fall back to ModelCapabilityRegistry for model-specific limits.
    return null;
  }

  /**
   * Provider-level defaults — reflects Anthropic API defaults (temperature, topK, etc.).
   * These values match the actual defaults the Anthropic SDK uses when params are omitted.
   */
  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 8192, temperature: 1.0, topP: 0.999, topK: 40,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: true, thinkingBudget: 10000, thinkingLevel: '',
      supportsTopK: true, supportsFreqPenalty: false, supportsThinking: true,
      thinkingMode: 'budget',
      temperatureRange: [0, 1], maxTokensRange: [256, 128000], topKRange: [1, 500],
      // H13: no hardcoded default — admin must select a model from the registry.
      defaultChatModel: '', defaultEmbeddingModel: '',
    };
  }
}

export default AnthropicProvider;
