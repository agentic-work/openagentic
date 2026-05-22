/**
 * LLM Metrics Service
 *
 * Tracks detailed per-request metrics for all LLM API calls including:
 * - Token usage (prompt, completion, cached, reasoning)
 * - Cost calculation based on dynamic pricing from ModelCapabilityRegistry
 * - Latency and performance metrics
 * - Tool/function call tracking
 * - Error tracking
 *
 * IMPORTANT: Pricing is NOT hardcoded - it comes from:
 * 1. ModelCapabilityRegistry (loaded from database or discovered from providers)
 * 2. Provider API responses (when available)
 * 3. Conservative fallback estimates for unknown models
 */

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { Decimal } from '@prisma/client/runtime/library';
import { getModelCapabilityRegistry } from './ModelCapabilityRegistry.js';
import { bedrockPricingService } from './BedrockPricingService.js';
import { trackLLMRequest } from '../metrics/index.js';

export interface LLMRequestMetrics {
  userId?: string;
  sessionId?: string;
  messageId?: string;
  /** API Key ID for tracking external API/CLI usage */
  apiKeyId?: string;

  // Provider & Model
  providerType: string;
  providerName?: string;
  model: string;
  deployment?: string;

  // Request Details
  requestType?: 'chat' | 'completion' | 'embedding';
  /** Source of the request: 'chat' for normal chat, 'code' for code mode */
  source?: 'chat' | 'code' | 'api';
  streaming?: boolean;
  temperature?: number;
  maxTokens?: number;

  // Token Usage
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  estimatedTokens?: boolean;  // True if tokens are estimated (not from API usageMetadata)

  // Performance Metrics (Issue 4l KPIs)
  latencyMs?: number;               // Overall latency
  totalDurationMs?: number;         // Total request duration
  tokensPerSecond?: number;         // Output speed
  timeToFirstTokenMs?: number;      // TTFT - Critical metric for UX
  queueWaitMs?: number;             // Time waiting in queue
  modelLatencyMs?: number;          // Model-specific latency
  concurrentRequests?: number;      // Concurrent load at request time

  // Request/Response Size
  requestSizeBytes?: number;
  responseSizeBytes?: number;

  // Cache & Performance Tracking
  cacheHit?: boolean;               // Cache hit/miss rate
  retryCount?: number;              // Error recovery tracking
  rateLimitHit?: boolean;           // Rate limit tracking

  // Tool Calls
  toolCallsCount?: number;
  toolNames?: string[];

  // Status
  status?: 'success' | 'error' | 'timeout' | 'rate_limited';
  errorCode?: string;
  errorMessage?: string;
  /** Provider's stop_reason / finish_reason / stopReason / done_reason —
   *  passed through to gen_ai_finish_reasons_total when status='success'. */
  finishReason?: string;
  /** Coarse error class for gen_ai_errors_total (timeout / rate_limit /
   *  client_error / server_error / network / unknown). */
  errorClass?: string;

  // Provider metadata
  providerMetadata?: Record<string, any>;

  // Timestamps
  requestStartedAt?: Date;
  requestCompletedAt?: Date;
}

export class LLMMetricsService {
  private static instance: LLMMetricsService;

  static getInstance(): LLMMetricsService {
    if (!LLMMetricsService.instance) {
      LLMMetricsService.instance = new LLMMetricsService();
    }
    return LLMMetricsService.instance;
  }

  /**
   * Calculate cost for a request using dynamic pricing
   *
   * Pricing is fetched DYNAMICALLY from:
   * 1. BedrockPricingService (AWS Pricing API for Bedrock models)
   * 2. ModelCapabilityRegistry (loaded from database or discovered from providers)
   * 3. Conservative fallback only when both are unavailable
   */
  calculateCost(
    providerType: string,
    model: string,
    promptTokens: number = 0,
    completionTokens: number = 0,
    cachedTokens: number = 0
  ): { promptCost: number; completionCost: number; totalCost: number; pricingSource: string; estimatedSavings?: number } {
    let inputCostPer1k: number;
    let outputCostPer1k: number;
    let pricingSource = 'fallback';

    // #651: Embedding-shape calls (no completion tokens, model name has 'embed')
    // don't belong in the chat-completion pricing path. The legacy in-memory
    // ModelCapabilityRegistry tracks input/outputCostPer1k for chat models;
    // embeddings price via embeddingCostPer1k (separate ledger). Short-circuit
    // to a silent zero-cost result so we don't (a) charge bogus chat rates for
    // embeddings or (b) spam a misleading "Model not found in registry" warn
    // on every embedding call.
    if (completionTokens === 0 && /embed/i.test(model)) {
      return { promptCost: 0, completionCost: 0, totalCost: 0, pricingSource: 'embedding-skip' };
    }

    // Ollama models are free (local inference)
    // Calculate estimated_savings: what this would have cost on the nearest cloud equivalent
    if (providerType === 'ollama') {
      let estimatedSavings = 0;
      try {
        // Map local models to cloud equivalents for savings calculation
        const cloudEquivalent = this.getCloudEquivalent(model);
        if (cloudEquivalent) {
          const cloudCost = this.calculateCost(cloudEquivalent.provider, cloudEquivalent.model, promptTokens, completionTokens, cachedTokens);
          estimatedSavings = cloudCost.totalCost;
        }
      } catch {}
      return { promptCost: 0, completionCost: 0, totalCost: 0, pricingSource: 'free', estimatedSavings };
    }

    // For Bedrock models, use BedrockPricingService (fetches from AWS API)
    if (providerType === 'aws-bedrock' || (model && (model.includes('anthropic.') || model.includes('amazon.')))) {
      const bedrockCost = bedrockPricingService.calculateCost(
        model,
        promptTokens,
        completionTokens,
        process.env.AWS_BEDROCK_REGION || 'us-west-2'
      );

      // Apply cached token discount (50% of input cost)
      const cachedCostPer1k = bedrockPricingService.getModelPricing(model).inputPricePer1k * 0.5;
      const effectivePromptTokens = Math.max(0, promptTokens - cachedTokens);
      const cachedCost = (cachedTokens / 1000) * cachedCostPer1k;
      const promptCost = (effectivePromptTokens / 1000) * bedrockPricingService.getModelPricing(model).inputPricePer1k;

      logger.debug({
        model,
        promptTokens,
        completionTokens,
        cachedTokens,
        totalCost: bedrockCost.totalCost,
        source: bedrockCost.source
      }, 'Calculated Bedrock cost');

      return {
        promptCost: parseFloat((promptCost + cachedCost).toFixed(8)),
        completionCost: bedrockCost.outputCost,
        totalCost: parseFloat((promptCost + cachedCost + bedrockCost.outputCost).toFixed(8)),
        pricingSource: 'aws-api',
      };
    }

    // For other providers, use ModelCapabilityRegistry
    const registry = getModelCapabilityRegistry();
    const capabilities = registry?.getCapabilities(model);

    if (capabilities && capabilities.inputCostPer1k !== undefined && capabilities.outputCostPer1k !== undefined) {
      inputCostPer1k = capabilities.inputCostPer1k;
      outputCostPer1k = capabilities.outputCostPer1k;
      pricingSource = 'registry';
    } else {
      // Fallback: Conservative estimate when registry unavailable
      logger.warn({
        providerType,
        model,
        registryAvailable: !!registry,
        capabilitiesFound: !!capabilities
      }, '⚠️ FALLBACK PRICING: Model not found in registry - cost data may be inaccurate');

      // Conservative fallback: $2/1M input, $8/1M output (middle-tier pricing)
      inputCostPer1k = 0.002;  // $2/1M = $0.002/1K
      outputCostPer1k = 0.008; // $8/1M = $0.008/1K
    }

    // Calculate costs
    const cachedCostPer1k = inputCostPer1k * 0.5;
    const effectivePromptTokens = Math.max(0, promptTokens - cachedTokens);
    const promptCost = (effectivePromptTokens / 1000) * inputCostPer1k;
    const cachedCost = (cachedTokens / 1000) * cachedCostPer1k;
    const completionCost = (completionTokens / 1000) * outputCostPer1k;

    logger.debug({
      model,
      promptTokens,
      completionTokens,
      totalCost: promptCost + cachedCost + completionCost,
      source: pricingSource
    }, 'Calculated cost');

    return {
      promptCost: parseFloat((promptCost + cachedCost).toFixed(8)),
      completionCost: parseFloat(completionCost.toFixed(8)),
      totalCost: parseFloat((promptCost + cachedCost + completionCost).toFixed(8)),
      pricingSource,
    };
  }

  /**
   * Log an LLM request with all metrics
   */
  async logRequest(metrics: LLMRequestMetrics): Promise<string | null> {
    // Calculate costs + tokens-per-second up front so the Prom emit
    // always fires, even when the Postgres DB write fails. Operations
    // dashboard is Prom-driven; per-request fact-table drill-down is
    // Postgres-driven; keep the two failure modes independent.
    const costs = this.calculateCost(
      metrics.providerType,
      metrics.model,
      metrics.promptTokens,
      metrics.completionTokens,
      metrics.cachedTokens
    );
    let tokensPerSecond: number | null = null;
    if (metrics.completionTokens && metrics.totalDurationMs && metrics.totalDurationMs > 0) {
      tokensPerSecond = (metrics.completionTokens / metrics.totalDurationMs) * 1000;
    }

    // Tier-1 Prom emit — fire-and-forget, never throws (per metrics/index.ts
    // implementation). Always runs, even if the DB write below fails.
    trackLLMRequest({
      provider: metrics.providerType,
      model: metrics.model,
      operation: (metrics.requestType ?? 'chat') as 'chat' | 'embedding' | 'completion' | 'image',
      status: metrics.status ?? 'success',
      durationMs: metrics.totalDurationMs ?? metrics.latencyMs ?? 0,
      ttftMs: metrics.timeToFirstTokenMs,
      tokensPerSecond: tokensPerSecond ?? metrics.tokensPerSecond,
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      cachedTokens: metrics.cachedTokens,
      reasoningTokens: metrics.reasoningTokens,
      finishReason: metrics.finishReason,
      errorClass: metrics.errorClass ?? metrics.errorCode,
    });

    try {
      const record = await prisma.lLMRequestLog.create({
        data: {
          user_id: metrics.userId || null,
          session_id: metrics.sessionId || null,
          message_id: metrics.messageId || null,
          api_key_id: metrics.apiKeyId || null,

          provider_type: metrics.providerType,
          provider_name: metrics.providerName || null,
          model: metrics.model,
          deployment: metrics.deployment || null,

          request_type: metrics.requestType || 'chat',
          source: metrics.source || 'chat',
          streaming: metrics.streaming ?? false,
          temperature: metrics.temperature || null,
          max_tokens: metrics.maxTokens || null,

          prompt_tokens: metrics.promptTokens || null,
          completion_tokens: metrics.completionTokens || null,
          total_tokens: metrics.totalTokens || null,
          cached_tokens: metrics.cachedTokens || null,
          reasoning_tokens: metrics.reasoningTokens || null,

          prompt_cost: costs.promptCost ? new Decimal(costs.promptCost.toFixed(8)) : null,
          completion_cost: costs.completionCost ? new Decimal(costs.completionCost.toFixed(8)) : null,
          total_cost: costs.totalCost ? new Decimal(costs.totalCost.toFixed(8)) : null,
          pricing_source: costs.pricingSource,

          latency_ms: metrics.latencyMs || null,
          total_duration_ms: metrics.totalDurationMs || null,
          tokens_per_second: tokensPerSecond,
          time_to_first_token_ms: metrics.timeToFirstTokenMs || null,
          queue_wait_ms: metrics.queueWaitMs || null,
          model_latency_ms: metrics.modelLatencyMs || null,
          concurrent_requests: metrics.concurrentRequests || null,

          request_size_bytes: metrics.requestSizeBytes || null,
          response_size_bytes: metrics.responseSizeBytes || null,

          cache_hit: metrics.cacheHit ?? false,
          retry_count: metrics.retryCount ?? 0,
          rate_limit_hit: metrics.rateLimitHit ?? false,

          tool_calls_count: metrics.toolCallsCount || 0,
          tool_names: metrics.toolNames || [],

          status: metrics.status || 'success',
          error_code: metrics.errorCode || null,
          error_message: metrics.errorMessage || null,

          provider_metadata: {
            ...(metrics.providerMetadata || {}),
            ...(costs.estimatedSavings ? { estimatedSavings: costs.estimatedSavings } : {})
          },

          request_started_at: metrics.requestStartedAt || new Date(),
          request_completed_at: metrics.requestCompletedAt || new Date(),
        },
      });

      // Log with visibility into estimated vs actual tokens
      const logData = {
        id: record.id,
        model: metrics.model,
        provider: metrics.providerType,
        promptTokens: metrics.promptTokens,
        completionTokens: metrics.completionTokens,
        totalTokens: metrics.totalTokens,
        cost: costs.totalCost.toFixed(6),
        estimatedTokens: metrics.estimatedTokens || false,
        source: metrics.estimatedTokens ? 'ESTIMATED' : 'API'
      };

      if (metrics.estimatedTokens) {
        logger.warn(logData, '⚠️ LLM request logged with ESTIMATED tokens (not from API)');
      } else {
        logger.debug(logData, 'LLM request logged');
      }

      return record.id;
    } catch (error) {
      logger.error({ error, metrics }, 'Failed to log LLM request');
      return null;
    }
  }

  /**
   * Get aggregated metrics for a time period
   */
  async getAggregatedMetrics(options: {
    userId?: string;
    providerType?: string;
    model?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCost: number;
    avgLatencyMs: number;
    avgTokensPerSecond: number;
    topModels: Array<{ model: string; count: number; cost: number }>;
  }> {
    const where: any = {};

    if (options.userId) where.user_id = options.userId;
    if (options.providerType) where.provider_type = options.providerType;
    if (options.model) where.model = options.model;
    if (options.startDate || options.endDate) {
      where.created_at = {};
      if (options.startDate) where.created_at.gte = options.startDate;
      if (options.endDate) where.created_at.lte = options.endDate;
    }

    const [aggregates, successCount, topModels] = await Promise.all([
      prisma.lLMRequestLog.aggregate({
        where,
        _count: { id: true },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          total_tokens: true,
          total_cost: true,
        },
        _avg: {
          latency_ms: true,
          tokens_per_second: true,
        },
      }),
      prisma.lLMRequestLog.count({
        where: { ...where, status: 'success' },
      }),
      prisma.lLMRequestLog.groupBy({
        by: ['model'],
        where,
        _count: { model: true },
        _sum: { total_cost: true },
        orderBy: { _count: { model: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      totalRequests: aggregates._count.id,
      successfulRequests: successCount,
      failedRequests: aggregates._count.id - successCount,
      totalPromptTokens: aggregates._sum.prompt_tokens || 0,
      totalCompletionTokens: aggregates._sum.completion_tokens || 0,
      totalTokens: aggregates._sum.total_tokens || 0,
      totalCost: Number(aggregates._sum.total_cost || 0),
      avgLatencyMs: Math.round(aggregates._avg.latency_ms || 0),
      avgTokensPerSecond: Math.round((aggregates._avg.tokens_per_second || 0) * 100) / 100,
      topModels: topModels.map((m) => ({
        model: m.model,
        count: m._count.model,
        cost: Number(m._sum.total_cost || 0),
      })),
    };
  }

  /**
   * Get pricing source breakdown for cost transparency.
   * Returns how many requests used each pricing source.
   */
  async getPricingSourceBreakdown(options: {
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ source: string; count: number; totalCost: number }[]> {
    const where: any = {};
    if (options.startDate || options.endDate) {
      where.created_at = {};
      if (options.startDate) where.created_at.gte = options.startDate;
      if (options.endDate) where.created_at.lte = options.endDate;
    }

    const groups = await prisma.lLMRequestLog.groupBy({
      by: ['pricing_source'],
      where,
      _count: { id: true },
      _sum: { total_cost: true },
    });

    return groups.map(g => ({
      source: g.pricing_source || 'unknown',
      count: g._count.id,
      totalCost: Number(g._sum.total_cost || 0),
    }));
  }

  /**
   * Get recent requests for debugging/monitoring
   */
  async getRecentRequests(options: {
    userId?: string;
    limit?: number;
    status?: string;
  }): Promise<any[]> {
    const where: any = {};
    if (options.userId) where.user_id = options.userId;
    if (options.status) where.status = options.status;

    return prisma.lLMRequestLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: options.limit || 50,
      select: {
        id: true,
        provider_type: true,
        model: true,
        prompt_tokens: true,
        completion_tokens: true,
        total_tokens: true,
        total_cost: true,
        latency_ms: true,
        status: true,
        error_message: true,
        tool_calls_count: true,
        created_at: true,
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  /**
   * Get comprehensive performance KPIs
   * Issue 4l: LLM Performance Metrics with all KPIs
   */
  async getPerformanceKPIs(options: {
    userId?: string;
    providerType?: string;
    model?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    // Time to First Token (TTFT)
    avgTTFT: number;
    p50TTFT: number;
    p95TTFT: number;
    p99TTFT: number;

    // Tokens per second (output speed)
    avgTokensPerSecond: number;
    p50TokensPerSecond: number;
    p95TokensPerSecond: number;

    // Total response time
    avgResponseTime: number;
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;

    // Token counts
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;

    // Model latency by type
    modelLatencyByModel: Array<{ model: string; avgLatency: number; count: number }>;

    // Error rates per model
    errorRateByModel: Array<{ model: string; errorRate: number; totalRequests: number }>;

    // Token costs
    totalCost: number;
    avgCostPerRequest: number;
    costByModel: Array<{ model: string; totalCost: number; count: number }>;

    // Concurrent request handling
    avgConcurrentRequests: number;
    maxConcurrentRequests: number;

    // Queue wait times
    avgQueueWait: number;
    p95QueueWait: number;

    // Cache hit/miss rates
    cacheHitRate: number;
    totalCacheHits: number;
    totalCacheMisses: number;
  }> {
    const where: any = {};

    if (options.userId) where.user_id = options.userId;
    if (options.providerType) where.provider_type = options.providerType;
    if (options.model) where.model = options.model;
    if (options.startDate || options.endDate) {
      where.created_at = {};
      if (options.startDate) where.created_at.gte = options.startDate;
      if (options.endDate) where.created_at.lte = options.endDate;
    }

    // Get all relevant metrics in one query
    const requests = await prisma.lLMRequestLog.findMany({
      where,
      select: {
        time_to_first_token_ms: true,
        tokens_per_second: true,
        total_duration_ms: true,
        latency_ms: true,
        model_latency_ms: true,
        prompt_tokens: true,
        completion_tokens: true,
        total_tokens: true,
        total_cost: true,
        model: true,
        concurrent_requests: true,
        queue_wait_ms: true,
        cache_hit: true,
        status: true,
      },
    });

    // Helper function to calculate percentiles
    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const sorted = arr.sort((a, b) => a - b);
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    // Extract non-null values for calculations
    const ttftValues = requests.map(r => r.time_to_first_token_ms).filter((v): v is number => v !== null);
    const tpsValues = requests.map(r => r.tokens_per_second).filter((v): v is number => v !== null);
    const responseTimeValues = requests.map(r => r.total_duration_ms).filter((v): v is number => v !== null);
    const queueWaitValues = requests.map(r => r.queue_wait_ms).filter((v): v is number => v !== null);
    const concurrentValues = requests.map(r => r.concurrent_requests).filter((v): v is number => v !== null);

    // Calculate aggregates
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    // Model-specific latency
    const modelLatencyMap = new Map<string, { sum: number; count: number }>();
    requests.forEach(r => {
      if (r.model && r.model_latency_ms) {
        const existing = modelLatencyMap.get(r.model) || { sum: 0, count: 0 };
        existing.sum += r.model_latency_ms;
        existing.count += 1;
        modelLatencyMap.set(r.model, existing);
      }
    });

    // Error rates by model
    const modelErrorMap = new Map<string, { total: number; errors: number }>();
    requests.forEach(r => {
      if (r.model) {
        const existing = modelErrorMap.get(r.model) || { total: 0, errors: 0 };
        existing.total += 1;
        if (r.status !== 'success') existing.errors += 1;
        modelErrorMap.set(r.model, existing);
      }
    });

    // Cost by model
    const modelCostMap = new Map<string, { sum: number; count: number }>();
    requests.forEach(r => {
      if (r.model && r.total_cost) {
        const existing = modelCostMap.get(r.model) || { sum: 0, count: 0 };
        existing.sum += Number(r.total_cost);
        existing.count += 1;
        modelCostMap.set(r.model, existing);
      }
    });

    // Cache statistics
    const cacheHits = requests.filter(r => r.cache_hit).length;
    const cacheMisses = requests.length - cacheHits;

    return {
      // TTFT metrics
      avgTTFT: Math.round(avg(ttftValues)),
      p50TTFT: Math.round(percentile(ttftValues, 50)),
      p95TTFT: Math.round(percentile(ttftValues, 95)),
      p99TTFT: Math.round(percentile(ttftValues, 99)),

      // Tokens per second
      avgTokensPerSecond: Math.round(avg(tpsValues) * 100) / 100,
      p50TokensPerSecond: Math.round(percentile(tpsValues, 50) * 100) / 100,
      p95TokensPerSecond: Math.round(percentile(tpsValues, 95) * 100) / 100,

      // Response time
      avgResponseTime: Math.round(avg(responseTimeValues)),
      p50ResponseTime: Math.round(percentile(responseTimeValues, 50)),
      p95ResponseTime: Math.round(percentile(responseTimeValues, 95)),
      p99ResponseTime: Math.round(percentile(responseTimeValues, 99)),

      // Token counts
      totalPromptTokens: requests.reduce((sum, r) => sum + (r.prompt_tokens || 0), 0),
      totalCompletionTokens: requests.reduce((sum, r) => sum + (r.completion_tokens || 0), 0),
      totalTokens: requests.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
      avgPromptTokens: Math.round(avg(requests.map(r => r.prompt_tokens || 0))),
      avgCompletionTokens: Math.round(avg(requests.map(r => r.completion_tokens || 0))),

      // Model latency
      modelLatencyByModel: Array.from(modelLatencyMap.entries()).map(([model, data]) => ({
        model,
        avgLatency: Math.round(data.sum / data.count),
        count: data.count,
      })).sort((a, b) => b.count - a.count),

      // Error rates
      errorRateByModel: Array.from(modelErrorMap.entries()).map(([model, data]) => ({
        model,
        errorRate: Math.round((data.errors / data.total) * 10000) / 100,
        totalRequests: data.total,
      })).sort((a, b) => b.totalRequests - a.totalRequests),

      // Costs
      totalCost: Number(requests.reduce((sum, r) => sum + Number(r.total_cost || 0), 0).toFixed(6)),
      avgCostPerRequest: requests.length > 0
        ? Number((requests.reduce((sum, r) => sum + Number(r.total_cost || 0), 0) / requests.length).toFixed(6))
        : 0,
      costByModel: Array.from(modelCostMap.entries()).map(([model, data]) => ({
        model,
        totalCost: Number(data.sum.toFixed(6)),
        count: data.count,
      })).sort((a, b) => b.totalCost - a.totalCost),

      // Concurrent requests
      avgConcurrentRequests: Math.round(avg(concurrentValues) * 100) / 100,
      maxConcurrentRequests: concurrentValues.length > 0 ? Math.max(...concurrentValues) : 0,

      // Queue wait times
      avgQueueWait: Math.round(avg(queueWaitValues)),
      p95QueueWait: Math.round(percentile(queueWaitValues, 95)),

      // Cache metrics
      cacheHitRate: requests.length > 0
        ? Math.round((cacheHits / requests.length) * 10000) / 100
        : 0,
      totalCacheHits: cacheHits,
      totalCacheMisses: cacheMisses,
    };
  }

  /**
   * Map a local/self-hosted model to its nearest cloud equivalent for the
   * "estimated savings" metric. Reads from the registry SoT
   * (admin.model_role_assignments) — picks the cheapest enabled non-Ollama
   * chat-role assignment by token cost. No substring inference, no
   * hardcoded model literals.
   *
   * Synchronous: relies on a cache populated lazily by a background
   * refresh. Returns null until the first refresh lands; the savings
   * metric is best-effort, not load-bearing.
   */
  private cloudEquivalentCache: { provider: string; model: string } | null = null;
  private cloudEquivalentRefreshing = false;
  private cloudEquivalentRefreshedAt = 0;
  private getCloudEquivalent(_model: string): { provider: string; model: string } | null {
    // Lazy refresh — fire-and-forget, don't block calculateCost.
    const FIVE_MIN = 5 * 60_000;
    if (Date.now() - this.cloudEquivalentRefreshedAt > FIVE_MIN && !this.cloudEquivalentRefreshing) {
      this.cloudEquivalentRefreshing = true;
      void prisma.modelRoleAssignment.findFirst({
        where: {
          role: 'chat',
          enabled: true,
          provider: { not: 'ollama' },
        },
        orderBy: [
          { cost_per_request: 'asc' },
          { priority: 'asc' },
        ],
        select: { model: true, provider: true },
      }).then(row => {
        this.cloudEquivalentCache = row ? { provider: row.provider, model: row.model } : null;
        this.cloudEquivalentRefreshedAt = Date.now();
      }).catch(() => {
        this.cloudEquivalentCache = null;
        this.cloudEquivalentRefreshedAt = Date.now();
      }).finally(() => {
        this.cloudEquivalentRefreshing = false;
      });
    }
    return this.cloudEquivalentCache;
  }

  /**
   * Get the calculated cost for a specific request log entry
   */
  async getRequestCost(logId: string): Promise<number | null> {
    try {
      const log = await prisma.lLMRequestLog.findUnique({
        where: { id: logId },
        select: { total_cost: true }
      });
      return log?.total_cost ? Number(log.total_cost) : null;
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const llmMetricsService = LLMMetricsService.getInstance();
