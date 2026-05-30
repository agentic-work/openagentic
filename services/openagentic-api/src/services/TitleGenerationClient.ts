/**
 * Title Generation Client
 *
 * Uses ProviderManager to support any configured LLM provider (Azure, AWS Bedrock, Vertex AI)
 * Previously used Azure OpenAI directly - now uses multi-provider system
 */

import fetch from 'node-fetch';
import { Logger } from 'pino';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { ModelConfigurationService } from './ModelConfigurationService.js';
import { DEFAULT_SERVICE_PROMPTS } from './prompt/ServicePromptService.js';

// Minimal interface for injected ServicePromptService (Sprint W).
interface ServicePromptLike {
  getPrompt(key: string): Promise<string>;
}

interface TitleClientConfig {
  defaultModel?: string;
  timeout?: number;
  providerManager?: any; // ProviderManager instance
}

interface CompletionRequest {
  model?: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  user?: string;
  metadata?: Record<string, any>;
}

interface CompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
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
 * Title Generation Client using ProviderManager
 * Supports any configured LLM provider (AWS Bedrock, Azure OpenAI, Vertex AI)
 */
export class TitleGenerationClient {
  private logger: Logger;
  private config: TitleClientConfig;
  private providerManager: any;
  // Cached resolved model (from providerManager.listModels) so we don't
  // re-query on every title call. Cleared on updateConfig().
  private resolvedModel?: string;
  /** Sprint W (2026-05-19) — optional injected ServicePromptService for DB-backed prompt. */
  private _servicePromptSvc?: ServicePromptLike;

  constructor(logger: Logger, config: Partial<TitleClientConfig> = {}, servicePromptSvc?: ServicePromptLike) {
    this.logger = logger.child({ service: 'TitleGenerationClient' });
    this.config = {
      // defaultModel is intentionally left undefined here — resolved per-request
      // from ModelConfigurationService (DB SoT). Callers may still pass an
      // explicit defaultModel in config to override (e.g. in tests).
      timeout: 5000, // 5 second timeout for title generation
      ...config
    };

    this.providerManager = config.providerManager;
    this._servicePromptSvc = servicePromptSvc;

    if (!this.providerManager) {
      this.logger.warn('No ProviderManager provided - title generation will be disabled');
    }
  }

  /**
   * Resolve a real, available model id when the caller passed undefined or
   * 'auto'. Walks the live provider.listModels() output and picks the
   * cheapest/smallest-looking model by name heuristic. Cached after first
   * successful resolve. Title generation is a tiny task — it's fine to pick
   * any small chat model.
   */
  private async resolveModel(requested?: string): Promise<string | undefined> {
    if (requested && requested !== 'auto') return requested;
    if (this.config.defaultModel && this.config.defaultModel !== 'auto') {
      return this.config.defaultModel;
    }
    // Resolve from DB (SoT) — ModelConfigurationService has its own 60s TTL
    // cache so this is cheap on the hot path. No per-instance caching here
    // (Pattern A: request-time re-read, correctness over microseconds).
    try {
      const titleAssignment = await ModelConfigurationService.getServiceModel('titleGeneration');
      const dbModel = titleAssignment?.modelId ?? await ModelConfigurationService.getDefaultChatModel();
      if (dbModel) return dbModel;
    } catch (dbErr: any) {
      this.logger.warn({ err: dbErr.message }, 'TitleGen failed to resolve model from DB — falling through to providerManager heuristic');
    }
    if (this.resolvedModel) return this.resolvedModel;
    if (!this.providerManager?.listModels) return undefined;

    try {
      const models: Array<{ id: string; name?: string; provider?: string }> =
        await this.providerManager.listModels();
      if (!Array.isArray(models) || models.length === 0) return undefined;

      // Preference ordered by "likely cheapest / smallest first". These are
      // heuristics on id substrings, so stay stable across stale model IDs.
      const prefs = [
        'haiku', 'nova-micro', 'nova-lite',
        'gpt-oss:20b', 'gpt-oss', 'qwen3:14b', 'qwen2',
        'llama3:8b', 'phi', 'mistral',
        'gpt-4o-mini', 'gpt-5-mini', 'gpt-5-nano',
      ];
      for (const pref of prefs) {
        const hit = models.find(m => m.id && m.id.toLowerCase().includes(pref));
        if (hit) {
          this.resolvedModel = hit.id;
          this.logger.info({ model: hit.id, hint: pref }, 'TitleGen resolved model by preference');
          return hit.id;
        }
      }
      // Fall back to whatever's first.
      this.resolvedModel = models[0].id;
      this.logger.info({ model: models[0].id }, 'TitleGen resolved model by first-available');
      return this.resolvedModel;
    } catch (err: any) {
      this.logger.warn({ err: err.message }, 'TitleGen failed to resolve model from providerManager');
      return undefined;
    }
  }

  /**
   * Generate a completion for title generation using ProviderManager
   */
  async generateCompletion(params: CompletionRequest): Promise<{ content: string }> {
    if (!this.providerManager) {
      throw new Error('ProviderManager not initialized - cannot generate titles');
    }

    const startTime = Date.now();

    // Lazy-resolve the model when caller passed nothing or 'auto' — avoids
    // ProviderManager erroring with `Model "auto" is not available` when
    // TITLE_GENERATION_MODEL / ECONOMICAL_MODEL env vars are unset.
    const model = await this.resolveModel(params.model);
    if (!model) {
      throw new Error('No model available for title generation');
    }

    try {
      const response: any = await this.providerManager.createCompletion({
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.3,
        max_tokens: params.max_tokens ?? 20,
        stream: false
      });

      const content = response.choices?.[0]?.message?.content || '';
      const latency = Date.now() - startTime;

      this.logger.debug({
        model: response.model,
        latency,
        tokens: response.usage,
        content: content.substring(0, 100)
      }, 'Title generation completed');

      // Track metrics
      this.trackMetrics({
        model: response.model,
        latency,
        tokens: response.usage?.total_tokens || 0,
        success: true
      });

      return { content };

    } catch (error: any) {
      const latency = Date.now() - startTime;

      this.logger.error({
        error: error.message,
        latency,
        model
      }, 'Title generation failed');

      // Track failure metrics
      this.trackMetrics({
        model: model || 'unknown',
        latency,
        tokens: 0,
        success: false
      });

      throw error;
    }
  }

  /**
   * Sprint W (2026-05-19) — DB-backed multiple-titles system prompt.
   *
   * When `servicePromptSvc` is provided, reads from DB key `title_gen.client`.
   * Falls back to DEFAULT_SERVICE_PROMPTS default when unavailable.
   */
  async getMultipleTitlesPrompt(servicePromptSvc?: ServicePromptLike): Promise<string> {
    let fallbackReason = 'NO-SVC-INJECTED';
    if (servicePromptSvc) {
      try {
        return await servicePromptSvc.getPrompt('title_gen.client');
      } catch (err) {
        fallbackReason = 'DB-READ-THREW';
        this.logger.warn(
          { err, key: 'title_gen.client', reason: fallbackReason },
          '[TitleGenClient] DB prompt read failed, using inline default',
        );
      }
    }
    // Gap #3 — loud fallback signal.
    this.logger.warn(
      { key: 'title_gen.client', reason: fallbackReason },
      '[ServicePrompt fallback] using DEFAULT_SERVICE_PROMPTS constant — DB row missing or read failed (title_gen.client)',
    );
    return DEFAULT_SERVICE_PROMPTS['title_gen.client'].body;
  }

  /**
   * Generate multiple title suggestions
   */
  async generateMultipleTitles(
    userMessage: string,
    count: number = 3,
    style?: 'concise' | 'descriptive' | 'creative'
  ): Promise<string[]> {
    const stylePrompts = {
      concise: 'Generate very short, concise titles (2-4 words)',
      descriptive: 'Generate descriptive but clear titles (4-7 words)',
      creative: 'Generate creative, engaging titles that capture attention'
    };

    const basePrompt = await this.getMultipleTitlesPrompt(this._servicePromptSvc);
    const systemPrompt = `Generate ${count} different title suggestions for a chat conversation.
${stylePrompts[style || 'concise']}.
${basePrompt}
Each title should be on a new line.
No numbers, bullets, or prefixes - just the titles.`;

    try {
      const response = await this.generateCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate titles for: "${userMessage.substring(0, 500)}"` }
        ],
        temperature: 0.7, // Higher temperature for variety
        max_tokens: 60 // More tokens for multiple titles
      });

      const titles = response.content
        .split('\n')
        .map(title => title.trim())
        .filter(title => title.length > 2 && title.length < 100)
        .slice(0, count);

      return titles.length > 0 ? titles : [`Chat ${new Date().toLocaleTimeString()}`];

    } catch (error) {
      this.logger.error({ error }, 'Failed to generate multiple titles');
      return [`Chat ${new Date().toLocaleTimeString()}`];
    }
  }

  /**
   * Track metrics for monitoring
   */
  private trackMetrics(metrics: {
    model: string;
    latency: number;
    tokens: number;
    success: boolean;
  }): void {
    // In production, this would send to a metrics service
    if (process.env.ENABLE_METRICS === 'true') {
      // Example: Send to Prometheus, DataDog, etc.
      this.logger.info({ metrics }, 'Title generation metrics');
    }
  }

  /**
   * Health check for LLM provider connection
   */
  async healthCheck(): Promise<boolean> {
    if (!this.providerManager) {
      return false;
    }

    try {
      const healthStatus = await this.providerManager.getHealthStatus();
      return Array.from(healthStatus.values()).some((health: any) => health.status === 'healthy');
    } catch (error) {
      this.logger.error({ error }, 'LLM provider health check failed');
      return false;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TitleClientConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.providerManager) {
      this.providerManager = config.providerManager;
      // Invalidate cached model — new providerManager may expose a
      // different model catalog.
      this.resolvedModel = undefined;
    }
  }
}