/**
 * PricingService — orchestrator that ties a provider-specific pricing
 * fetcher (BedrockPricingFetcher today, AzureRetailPricesFetcher + VertexPricingFetcher
 * in later units) to the Registry write-path.
 *
 * Task #342, step 3 of N. Every Add-Model insert fires a background
 * `fetchAndStorePricing` call so the Registry row gains USD rates
 * without blocking the POST /llm-providers response.
 *
 * ## Atomicity contract
 *
 * The `ModelRoleAssignment` pricing columns carry a CHECK constraint
 * (added in migration step 2): if ANY `cost_per_*_usd` column is
 * non-null, then `pricing_source` AND `pricing_fetched_at` MUST also
 * be non-null. This service honors the invariant by writing all three
 * audit fields in the SAME `prisma.modelRoleAssignment.update` data
 * block — never a partial write.
 *
 * ## Fail-open
 *
 * If the upstream fetcher throws (AWS throttle, network flap, IAM
 * revoked), we LEAVE THE ROW UNCHANGED (rates stay NULL) and log at
 * WARN. Never propagate — this is a background side effect; the
 * Add-Model path must not fail because pricing lookup failed.
 *
 * If the Registry row was deleted between insert and bg fetch (Prisma
 * P2025), also swallow — that's the admin's explicit action, the row
 * is gone and we have nothing to update.
 *
 * ## Hot-path invariant
 *
 * This service is NEVER called on the LLM inference hot path. All
 * LLM calls read pre-cached rates from the Registry row they already
 * resolved. Pricing is fetched at Add-Model time + a daily refresh
 * cron (unit 6).
 */

import type { PrismaClient } from '@prisma/client';
import type { ModelPricing, PricingFetcher } from './types.js';
import { BedrockPricingFetcher } from './BedrockPricingFetcher.js';

/** Narrow PrismaClient surface this service uses — easy to mock. */
export interface PricingPrismaLike {
  modelRoleAssignment: {
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
}

export interface FetchAndStoreInput {
  /** `provider_type` column value — 'aws-bedrock' | 'azure-ai-foundry' | 'vertex-ai' | 'ollama' | ... */
  providerType: string;
  /** Model identifier as stored in the Registry row's `model` column. */
  modelId: string;
  /** Inference region. Null for providers where region doesn't apply (Ollama local, Anthropic direct). */
  region: string | null;
  /** The `admin.model_role_assignments.id` to update. */
  registryRowId: string;
}

/**
 * Log shim. We use `console.*` here because this module is imported
 * from contexts without a Fastify logger on hand (e.g., the auto-sync
 * path can fire from the provider seeder bootstrap). When called from
 * a route with pino in scope, the caller wraps in its own try/catch.
 */
type LogFn = (meta: Record<string, unknown>, msg: string) => void;
function defaultLog(level: 'warn' | 'info'): LogFn {
  return (meta, msg) => {
    const out = { ...meta, msg, level };
    // Pino-compatible JSON line. Using console.warn keeps TTY visible
    // under `tsx watch` without pulling a hard pino dependency into
    // this module.
    if (level === 'warn') console.warn(JSON.stringify(out));
    else console.log(JSON.stringify(out));
  };
}

/**
 * Build the `data` block for the Registry row update — always
 * includes `pricing_source` + `pricing_fetched_at` alongside whatever
 * rate columns the fetcher populated. `undefined` rate values are
 * explicitly written as `null` so re-fetches clear stale prices.
 */
export function pricingToUpdateData(pricing: ModelPricing): Record<string, unknown> {
  return {
    cost_per_input_token_usd: pricing.inputTokenUsd ?? null,
    cost_per_output_token_usd: pricing.outputTokenUsd ?? null,
    cost_per_cache_read_usd: pricing.cacheReadUsd ?? null,
    cost_per_cache_write_usd: pricing.cacheWriteUsd ?? null,
    cost_per_thinking_token_usd: pricing.thinkingTokenUsd ?? null,
    cost_per_embedding_token_usd: pricing.embeddingTokenUsd ?? null,
    pricing_source: pricing.source,
    pricing_fetched_at: new Date(pricing.fetchedAt),
  };
}

export class PricingService {
  /** Lazy-init cache of provider-specific fetchers. */
  private readonly fetchers = new Map<string, PricingFetcher>();
  private readonly logWarn: LogFn;
  private readonly logInfo: LogFn;

  constructor(
    private readonly prisma: PrismaClient | PricingPrismaLike,
    opts?: { logWarn?: LogFn; logInfo?: LogFn },
  ) {
    this.logWarn = opts?.logWarn ?? defaultLog('warn');
    this.logInfo = opts?.logInfo ?? defaultLog('info');
  }

  /**
   * Route a provider type to its catalog fetcher. Lazy-instantiated so
   * importing PricingService doesn't pull `@aws-sdk/client-pricing` into
   * every route that happens to import this file.
   *
   * Returning null means "no pricing for this provider" — NOT a failure.
   */
  private pickFetcher(providerType: string): PricingFetcher | null {
    const cached = this.fetchers.get(providerType);
    if (cached) return cached;

    switch (providerType) {
      case 'aws-bedrock': {
        // The BedrockPricingFetcher class is trivial to instantiate;
        // the heavy `@aws-sdk/client-pricing` load is deferred inside
        // its `fetch()` method via dynamic import. So importing the
        // class at module-load is cheap.
        const fetcher: PricingFetcher = new BedrockPricingFetcher();
        this.fetchers.set(providerType, fetcher);
        return fetcher;
      }
      // Azure (unit 4) and Vertex (unit 5) land in later commits.
      case 'azure-ai-foundry':
      case 'vertex-ai':
      case 'ollama':
      case 'anthropic':
      case 'openai':
      case 'azure-openai':
      case 'google-vertex':
      default:
        return null;
    }
  }

  /**
   * Fetch pricing for a Registry row and persist the rates + source
   * + timestamp atomically. Fail-open: any error is logged and
   * swallowed so upstream callers (the Add-Model route, the daily
   * refresh cron) continue working.
   */
  async fetchAndStorePricing(input: FetchAndStoreInput): Promise<void> {
    const { providerType, modelId, region, registryRowId } = input;

    const fetcher = this.pickFetcher(providerType);
    if (!fetcher) {
      this.logInfo(
        { providerType, modelId, registryRowId },
        '[PricingService] no fetcher for provider type — skipping',
      );
      return;
    }

    // Bedrock (and Azure/Vertex) pricing APIs all require a region.
    // If the provider is CSP-backed but region wasn't threaded through,
    // we can't fetch; leave rates NULL and log so admins can fix.
    if (!region) {
      this.logWarn(
        { providerType, modelId, registryRowId },
        '[PricingService] region missing — cannot fetch CSP pricing, leaving rates NULL',
      );
      return;
    }

    let pricing: ModelPricing;
    try {
      pricing = await fetcher.fetch({ modelId, region });
    } catch (err) {
      this.logWarn(
        {
          providerType,
          modelId,
          region,
          registryRowId,
          error: err instanceof Error ? err.message : String(err),
        },
        '[PricingService] pricing fetch failed — row left with NULL rates (fail-open)',
      );
      return;
    }

    const data = pricingToUpdateData(pricing);
    try {
      await this.prisma.modelRoleAssignment.update({
        where: { id: registryRowId },
        data,
      });
      this.logInfo(
        {
          providerType,
          modelId,
          region,
          registryRowId,
          source: pricing.source,
        },
        '[PricingService] pricing persisted to Registry row',
      );
    } catch (err) {
      // Prisma P2025 = "Record to update not found". Happens when the
      // Registry row was deleted between the insert and this bg fetch —
      // acceptable, just log and move on.
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code: string }).code
          : undefined;
      this.logWarn(
        {
          providerType,
          modelId,
          region,
          registryRowId,
          code,
          error: err instanceof Error ? err.message : String(err),
        },
        '[PricingService] Registry update failed — fail-open, no propagation',
      );
    }
  }
}
