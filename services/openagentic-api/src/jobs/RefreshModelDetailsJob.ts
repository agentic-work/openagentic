/**
 * #650 U8 — Daily re-sync of every Active Registry row against upstream
 * provider truth.
 *
 * Walks `model_role_assignments` rows where `enabled=true`, calls
 * `provider.discoverModelDetails(modelId, region)` per row, and updates
 * the row in place with the freshly-discovered capabilities, limits,
 * defaults, and pricing. Per-row failures are isolated — one provider
 * being down (network, 403, quota) must NOT abort the entire sweep,
 * because RouterTuning math depends on every Active row staying current.
 *
 * Triggered by:
 * - The k8s CronJob at `helm/openagentic/templates/cron-refresh-model-details.yaml`
 *   which `curl`s the internal endpoint daily at 03:00 UTC.
 * - The admin "Refresh All" button (future) — same job, same code path.
 *
 * Pricing-delta logging: when `cost_per_input_token_usd` or
 * `cost_per_output_token_usd` changes between the stored row and the
 * fresh discovery, an info-level log line records `{from, to}` for both
 * fields so SRE can spot provider price bumps.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import type { ModelDiscoveryRecord } from '../services/llm-providers/discovery/ModelDiscoveryRecord.js';

export interface RefreshModelDetailsJobResult {
  total: number;
  refreshed: number;
  failed: number;
  skipped: number;
}

function decimalToNumberOrNull(d: any): number | null {
  if (d == null) return null;
  if (typeof d === 'number') return d;
  if (typeof d.toString === 'function') {
    const n = parseFloat(d.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export class RefreshModelDetailsJob {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerManager: ProviderManager,
    private readonly logger: Logger,
  ) {}

  async run(): Promise<RefreshModelDetailsJobResult> {
    const rows = await (this.prisma as any).modelRoleAssignment.findMany({
      where: { enabled: true },
    });
    const providers = await (this.prisma as any).lLMProvider.findMany({
      where: { enabled: true },
    });
    const providerByName = new Map<string, any>();
    for (const p of providers) providerByName.set(p.name, p);

    let refreshed = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      const provRow = providerByName.get(row.provider);
      if (!provRow) {
        skipped++;
        continue;
      }
      const inst: any = (this.providerManager as any).getProvider?.(row.provider);
      if (!inst?.discoverModelDetails) {
        skipped++;
        continue;
      }
      const region = (provRow.provider_config as any)?.region
                  ?? (provRow.provider_config as any)?.location;
      try {
        const discovered: ModelDiscoveryRecord | null = await inst.discoverModelDetails(
          row.model,
          region,
        );
        if (!discovered) {
          skipped++;
          continue;
        }

        const before = {
          inputTokenUsd: decimalToNumberOrNull(row.cost_per_input_token_usd),
          outputTokenUsd: decimalToNumberOrNull(row.cost_per_output_token_usd),
        };
        const after = {
          inputTokenUsd: discovered.pricing.inputTokenUsd ?? null,
          outputTokenUsd: discovered.pricing.outputTokenUsd ?? null,
        };
        const delta: any = {};
        if (before.inputTokenUsd !== after.inputTokenUsd) {
          delta.inputTokenUsd = { from: before.inputTokenUsd, to: after.inputTokenUsd };
        }
        if (before.outputTokenUsd !== after.outputTokenUsd) {
          delta.outputTokenUsd = { from: before.outputTokenUsd, to: after.outputTokenUsd };
        }

        const caps = discovered.capabilities;
        await (this.prisma as any).modelRoleAssignment.update({
          where: { id: row.id },
          data: {
            max_tokens: discovered.maxOutputTokens ?? undefined,
            temperature: discovered.temperature ?? 0.5,
            thinking_budget: discovered.thinkingBudget ?? undefined,
            capabilities: caps as any,
            options: {
              contextWindow: discovered.contextWindow,
              family: discovered.family,
              topP: discovered.topP,
              topK: discovered.topK,
              providerType: discovered.providerType,
              pricingRegion: discovered.pricing.region,
              nativeToolCalling: caps.nativeToolCalling,
            } as any,
            cost_per_input_token_usd: discovered.pricing.inputTokenUsd ?? null,
            cost_per_output_token_usd: discovered.pricing.outputTokenUsd ?? null,
            cost_per_cache_read_usd: discovered.pricing.cacheReadUsd ?? null,
            cost_per_cache_write_usd: discovered.pricing.cacheWriteUsd ?? null,
            cost_per_thinking_token_usd: discovered.pricing.thinkingTokenUsd ?? null,
            cost_per_embedding_token_usd: discovered.pricing.embeddingTokenUsd ?? null,
            cost_per_request: discovered.pricing.perRequestUsd ?? null,
            pricing_source: discovered.pricing.source,
            pricing_fetched_at: new Date(discovered.pricing.fetchedAt),
          },
        });
        refreshed++;

        if (Object.keys(delta).length > 0) {
          this.logger.info(
            { rowId: row.id, modelId: row.model, provider: row.provider, delta },
            '[RefreshModelDetailsJob] price delta detected',
          );
        }
      } catch (err) {
        failed++;
        this.logger.warn(
          {
            rowId: row.id,
            modelId: row.model,
            provider: row.provider,
            err: err instanceof Error ? err.message : String(err),
          },
          '[RefreshModelDetailsJob] row refresh failed (continuing)',
        );
      }
    }

    this.logger.info(
      { total: rows.length, refreshed, failed, skipped },
      '[RefreshModelDetailsJob] sweep complete',
    );
    return { total: rows.length, refreshed, failed, skipped };
  }
}
