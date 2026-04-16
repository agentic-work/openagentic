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
  NormalizerState,
} from './ILLMProvider.js';
import { NormalizedStreamEvent } from '../NormalizedStreamTypes.js';
import { MODELS } from '../../config/models.js';

// Anthropic model pricing (per 1M tokens)
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

// Default pricing for unknown models
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

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
      // Convert OpenAI-style messages to Anthropic format
      const { systemPrompt, messages } = this.convertMessages(request.messages);

      // Determine model
      const model = request.model || this.config.defaultModel || MODELS.anthropic;

      // Build request parameters
      const anthropicRequest: Anthropic.MessageCreateParams = {
        model,
        max_tokens: request.max_tokens || 8192,
        messages,
        temperature: request.temperature,
        top_p: request.top_p,
      };

      // Add system prompt if present (with optional caching)
      if (systemPrompt) {
        anthropicRequest.system = this.applyCaching(systemPrompt) as any;
      }

      // Add tools if present
      if (request.tools && request.tools.length > 0) {
        anthropicRequest.tools = this.convertTools(request.tools);
      }

      // Handle tool_choice
      if (request.tool_choice) {
        anthropicRequest.tool_choice = this.convertToolChoice(request.tool_choice);
      }

      // Add thinking configuration for supported models
      const thinkingEnabled = this.shouldEnableThinking(model);
      if (thinkingEnabled) {
        const thinkingConfig = this.getThinkingConfig();
        if (thinkingConfig) {
          (anthropicRequest as any).thinking = thinkingConfig;
        }
      }

      // Add effort parameter when thinking is NOT enabled (mutually exclusive)
      // Maps intelligence slider: 0-40% → low, 41-60% → medium (default, omit), 61-100% → high
      if (!thinkingEnabled && request.sliderValue !== undefined) {
        const effort = this.mapSliderToEffort(request.sliderValue);
        if (effort !== 'medium') {
          // Only set effort when non-default; medium is the API default
          (anthropicRequest as any).effort = effort;
        }
      }

      // Add output_config for structured JSON outputs
      if (request.outputSchema) {
        (anthropicRequest as any).output_config = {
          type: 'json_schema',
          schema: request.outputSchema,
        };
      }

      // Handle streaming
      if (request.stream) {
        return this.createStreamingCompletion(anthropicRequest, model);
      }

      // Non-streaming request
      const response = await this.client.messages.create(anthropicRequest);

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
   * Create streaming completion with proper thinking support
   */
  private async *createStreamingCompletion(
    request: Anthropic.MessageCreateParams,
    model: string
  ): AsyncGenerator<any> {
    if (!this.client) throw new Error('Client not initialized');

    // Stream the response - beta headers for interleaved thinking handled by SDK
    const stream = await this.client.messages.stream(request);

    let inputTokens = 0;
    let outputTokens = 0;
    let currentThinking = '';
    let currentText = '';

    for await (const event of stream) {
      // Handle different event types
      if (event.type === 'message_start') {
        inputTokens = event.message.usage?.input_tokens || 0;
        yield {
          type: 'message_start',
          message: {
            id: event.message.id,
            model: event.message.model,
            usage: event.message.usage,
          },
        };
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        // CRITICAL FIX: Emit consistent content_block_start format for ALL block types
        // The completion stage expects content_block_start with content_block.type
        yield {
          type: 'content_block_start',
          index: event.index,
          content_block: block, // Pass through the original block (thinking, text, or tool_use)
        };
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        // CRITICAL FIX: Emit consistent content_block_delta format
        // The completion stage expects delta.type to be 'thinking_delta', 'text_delta', or 'input_json_delta'
        if (delta.type === 'thinking_delta') {
          currentThinking += delta.thinking;
          yield {
            type: 'content_block_delta',
            index: event.index,
            delta: {
              type: 'thinking_delta',
              thinking: delta.thinking,
            },
          };
        } else if (delta.type === 'text_delta') {
          currentText += delta.text;
          yield {
            type: 'content_block_delta',
            index: event.index,
            delta: {
              type: 'text_delta',
              text: delta.text,
            },
          };
        } else if (delta.type === 'input_json_delta') {
          yield {
            type: 'content_block_delta',
            index: event.index,
            delta: {
              type: 'input_json_delta',
              partial_json: delta.partial_json,
            },
          };
        } else if (delta.type === 'signature_delta') {
          // Signature delta marks the end of thinking content - pass through
          yield {
            type: 'content_block_delta',
            index: event.index,
            delta: {
              type: 'signature_delta',
              signature: delta.signature,
            },
          };
        }
      } else if (event.type === 'content_block_stop') {
        yield {
          type: 'content_block_stop',
          index: event.index,
        };
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens || 0;
        yield {
          type: 'message_delta',
          delta: {
            stop_reason: event.delta.stop_reason,
          },
          usage: event.usage,
        };
      } else if (event.type === 'message_stop') {
        const cost = this.calculateCost(model, inputTokens, outputTokens);
        this.trackSuccess(0, inputTokens + outputTokens, cost);

        yield {
          type: 'message_stop',
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        };
      }
    }
  }

  /**
   * Convert OpenAI-style messages to Anthropic format
   */
  private convertMessages(messages: CompletionRequest['messages']): {
    systemPrompt: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    let systemPrompt: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Concatenate system messages
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
        continue;
      }

      if (msg.role === 'user') {
        // Handle content with images - convert OpenAI image_url format to Anthropic format
        if (Array.isArray(msg.content)) {
          const anthropicContent: Anthropic.ContentBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              anthropicContent.push({ type: 'text', text: block.text || '' });
            } else if (block.type === 'image') {
              // Already in Anthropic format
              anthropicContent.push(block as Anthropic.ImageBlockParam);
            } else if (block.type === 'image_url' && block.image_url) {
              // Convert OpenAI image_url format to Anthropic image format
              const imageUrl = block.image_url.url || '';
              if (imageUrl.startsWith('data:')) {
                // Parse data URL: data:image/png;base64,<data>
                const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  anthropicContent.push({
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                      data: match[2],
                    },
                  });
                }
              } else {
                // URL-based image (Anthropic also supports this)
                anthropicContent.push({
                  type: 'image',
                  source: {
                    type: 'url',
                    url: imageUrl,
                  } as any, // Anthropic SDK may need cast for URL type
                });
              }
            }
          }
          anthropicMessages.push({
            role: 'user',
            content: anthropicContent,
          });
        } else {
          anthropicMessages.push({
            role: 'user',
            content: msg.content,
          });
        }
      } else if (msg.role === 'assistant') {
        // Handle tool calls in assistant messages
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const content: Anthropic.ContentBlockParam[] = [];

          // Add text if present
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }

          // Add tool use blocks
          for (const toolCall of msg.tool_calls) {
            let input: Record<string, unknown>;
            try {
              input = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              input = {};
            }

            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input,
            });
          }

          anthropicMessages.push({
            role: 'assistant',
            content,
          });
        } else {
          anthropicMessages.push({
            role: 'assistant',
            content: msg.content,
          });
        }
      } else if (msg.role === 'tool') {
        // Tool result message
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id || '',
              content: msg.content,
            },
          ],
        });
      }
    }

    return { systemPrompt, messages: anthropicMessages };
  }

  /**
   * Convert OpenAI-style tools to Anthropic format
   */
  private convertTools(tools: any[]): Anthropic.Tool[] {
    return tools
      .filter((tool) => tool.type === 'function')
      .map((tool) => ({
        name: tool.function.name,
        description: tool.function.description || '',
        input_schema: tool.function.parameters || { type: 'object', properties: {} },
      }));
  }

  /**
   * Convert tool_choice to Anthropic format
   */
  private convertToolChoice(toolChoice: any): Anthropic.MessageCreateParams['tool_choice'] {
    if (toolChoice === 'auto') {
      return { type: 'auto' };
    } else if (toolChoice === 'none') {
      return { type: 'none' };
    } else if (toolChoice === 'required' || toolChoice?.type === 'required') {
      return { type: 'any' };
    } else if (toolChoice?.function?.name) {
      return { type: 'tool', name: toolChoice.function.name };
    }
    return { type: 'auto' };
  }

  /**
   * Check if model supports thinking
   */
  private shouldEnableThinking(model: string): boolean {
    if (!this.config?.enableThinking) return false;

    // Thinking is supported on Claude 3.5 Sonnet and newer
    const thinkingModels = [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-5-sonnet',
      'claude-3-5-haiku',
    ];

    return thinkingModels.some((m) => model.includes(m));
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
   * Map intelligence slider value (0-100) to Anthropic effort parameter.
   * - 0-40%: "low" (economical, faster responses)
   * - 41-60%: "medium" (balanced, API default)
   * - 61-100%: "high" (premium, deeper reasoning)
   */
  private mapSliderToEffort(sliderValue: number): 'low' | 'medium' | 'high' {
    if (sliderValue <= 40) return 'low';
    if (sliderValue <= 60) return 'medium';
    return 'high';
  }

  /**
   * Check if model supports interleaved thinking (Claude 4 models only)
   * Interleaved thinking allows thinking/text/tool_use blocks to interleave naturally
   */
  private supportsInterleavedThinking(model: string): boolean {
    if (!this.config?.enableThinking) return false;

    // Interleaved thinking is only supported on Claude 4 models
    const interleavedModels = [
      'claude-opus-4',
      'claude-sonnet-4',
      'claude-haiku-4',
    ];

    return interleavedModels.some((m) => model.includes(m));
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
   * Calculate cost for request
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Find matching pricing
    let pricing = DEFAULT_PRICING;
    for (const [key, value] of Object.entries(ANTHROPIC_PRICING)) {
      if (model.includes(key) || key.includes(model)) {
        pricing = value;
        break;
      }
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    // Anthropic doesn't have a list models endpoint, return known models
    return [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic' },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'anthropic' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic' },
    ];
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

    const { systemPrompt, messages } = this.convertMessages(request.messages);
    const model = request.model || this.config.defaultModel || MODELS.anthropic;

    const countRequest: any = {
      model,
      messages,
    };

    if (systemPrompt) {
      countRequest.system = systemPrompt;
    }

    if (request.tools && request.tools.length > 0) {
      countRequest.tools = this.convertTools(request.tools);
    }

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
   * Normalize a raw Anthropic stream chunk into NormalizedStreamEvents.
   * Delegates to the exported pure function for testability.
   */
  normalizeChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
    return normalizeAnthropicChunk(rawChunk, state);
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
      defaultChatModel: 'claude-sonnet-4-6', defaultEmbeddingModel: '',
    };
  }
}

// ---------------------------------------------------------------------------
// Exported normalizer function — pure, per-chunk, state-mutating
// ---------------------------------------------------------------------------

/**
 * Normalizes a single raw Anthropic streaming chunk into zero or more
 * NormalizedStreamEvents.  State is mutated in place to track block types,
 * thinking accumulation, and timing across chunk boundaries.
 */
export function normalizeAnthropicChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
  const events: NormalizedStreamEvent[] = [];
  const blockTypes = state.blockTypes;

  switch (rawChunk.type) {
    case 'message_start': {
      const msg = rawChunk.message;
      state.inputTokens = msg?.usage?.input_tokens || 0;
      state.model = msg?.model || '';
      events.push({
        type: 'stream_start',
        messageId: msg?.id || '',
        model: state.model,
        provider: 'anthropic',
      });
      state.streamStartEmitted = true;
      break;
    }

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
          id: blockTypes.get(index)?.id || state.thinkingId || `tk-${index}`,
          content: delta.thinking || '',
          accumulated: state.thinkingAccumulated,
        });
      } else if (delta?.type === 'text_delta') {
        events.push({
          type: 'text_delta',
          id: blockTypes.get(index)?.id || state.textBlockId || `txt-${index}`,
          content: delta.text || '',
        });
      } else if (delta?.type === 'input_json_delta') {
        const toolId = blockInfo?.id || `tool-${index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: delta.partial_json || '' });
      } else if (delta?.type === 'signature_delta') {
        events.push({
          type: 'redacted_thinking',
          id: state.thinkingId || `tk-${index}`,
          signature: delta.signature,
        });
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

    case 'message_delta': {
      if (rawChunk.usage) {
        const tokensOut = rawChunk.usage.output_tokens || 0;
        const pricing = ANTHROPIC_PRICING[state.model] || DEFAULT_PRICING;
        const cost = (state.inputTokens / 1_000_000) * pricing.input
                   + (tokensOut / 1_000_000) * pricing.output;
        events.push({
          type: 'usage',
          tokensIn: state.inputTokens,
          tokensOut,
          cost,
          contextUsed: 0,
          contextMax: 0,
        });
      }
      break;
    }

    case 'message_stop': {
      events.push({ type: 'stream_end', finishReason: 'stop', totalDurationMs: 0 });
      break;
    }

    default:
      // Unknown event type — return empty array
      break;
  }

  return events;
}

export default AnthropicProvider;
