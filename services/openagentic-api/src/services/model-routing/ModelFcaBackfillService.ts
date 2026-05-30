/**
 * ModelFcaBackfillService (2026-05-24)
 *
 * Boot-time backfill of the first-class
 * `model_role_assignments.function_calling_accuracy` column from the
 * ModelCapabilityRegistry benchmark table.
 *
 * Why: the column ships NULL on every row that pre-dates the migration. The
 * SmartModelRouter sources per-model FCA from this column (falling back to the
 * capabilities JSON, then 0). A NULL/0 FCA fails every RouterTuning FCA floor,
 * so the router can't select on capability or route DOWN to a cheap model.
 * This backfill seeds the real benchmark values (gpt-oss=0.87, sonnet=0.96, …)
 * so router tuning works on the first boot after the migration lands.
 *
 * Idempotent + safe to run on every pod start:
 *   - Only rows WHERE function_calling_accuracy IS NULL are touched — an
 *     admin-set value or an already-seeded value is never clobbered.
 *   - A row whose model has no usable MCR FCA is left NULL (admin can set it).
 *
 * The MCR is the documented carve-out for model-id-keyed literals
 * (see docs/rules/no-hardcoded-models.md) — same source the router already
 * uses for per-model pricing.
 */
import type { Logger } from 'pino';
import { classifyModelFca } from './classifyModelFca.js';

export interface ModelFcaBackfillPrismaLike {
  modelRoleAssignment: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<Array<{
      id: string;
      model: string;
      provider: string;
      capabilities?: unknown;
      function_calling_accuracy: number | null;
    }>>;
    update(args: {
      where: { id: string };
      data: { function_calling_accuracy: number; capabilities?: unknown };
    }): Promise<{ id: string }>;
  };
}

export interface ModelFcaBackfillResult {
  updated: number;
}

/** Returns the benchmark FCA (0..1) for a model id, or null when unknown. */
export type FcaLookup = (modelId: string) => number | null;

export class ModelFcaBackfillService {
  constructor(
    private readonly prisma: ModelFcaBackfillPrismaLike,
    private readonly logger: Logger,
    /** Raw MCR benchmark lookup; classifyModelFca falls back to a tier-default. */
    private readonly fcaLookup: FcaLookup,
  ) {}

  async backfill(): Promise<ModelFcaBackfillResult> {
    const nullRows = await this.prisma.modelRoleAssignment.findMany({
      where: { function_calling_accuracy: null },
      select: { id: true, model: true, provider: true, capabilities: true, function_calling_accuracy: true },
    });

    let updated = 0;
    for (const row of nullRows) {
      let mcrFca: number | null = null;
      try {
        mcrFca = this.fcaLookup(row.model);
      } catch {
        mcrFca = null;
      }
      const caps = (row.capabilities && typeof row.capabilities === 'object'
        ? (row.capabilities as Record<string, unknown>)
        : {});
      const ctx =
        typeof caps.contextWindowTokens === 'number'
          ? (caps.contextWindowTokens as number)
          : typeof caps.maxContextTokens === 'number'
            ? (caps.maxContextTokens as number)
            : undefined;

      // Every model gets a usable FCA — MCR benchmark or a structural
      // tier-default. Never leaves a row at 0/NULL (which would filter it out
      // of every router pool + the Live Scoring Lab).
      const { fca, source } = classifyModelFca({
        modelId: row.model,
        providerName: row.provider,
        mcrFca,
        contextWindowTokens: ctx,
      });

      await this.prisma.modelRoleAssignment.update({
        where: { id: row.id },
        data: {
          function_calling_accuracy: fca,
          // Stamp provenance so the UI can label estimated vs measured.
          capabilities: { ...caps, fcaSource: source },
        },
      });
      updated++;
    }

    if (updated > 0) {
      this.logger.info(
        { updated, scanned: nullRows.length },
        '[ModelFcaBackfill] classified function_calling_accuracy for all unset rows (MCR benchmark + tier-default)',
      );
    }
    return { updated };
  }
}
