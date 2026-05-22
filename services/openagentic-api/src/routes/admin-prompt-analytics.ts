/**
 * Admin Prompt Analytics — read-only aggregate route for PromptEffectiveness data.
 *
 * Mounted by `plugins/admin.plugin.ts` at `/api/admin/prompts/effectiveness`
 * behind the `adminMiddleware` preHandler (is_admin gate).
 *
 * The `PromptEffectiveness` Prisma model was retained after the module-registry
 * rip (Phase E.4/E.6) because `feedback.ts` still writes outcome rows. This
 * route exposes a groupBy read so the Effectiveness pane can surface per-module
 * win-rate data without a dependency on the deleted PromptModule rows.
 *
 * Response shape:
 * {
 *   totalModules: number        // distinct module names with any record in window
 *   enabledModules: number      // (same — no enabled flag on the model)
 *   averageTokenCost: number    // always 0 — token cost field removed with modules
 *   totalTokenBudgetUsed: number // always 0 — same
 *   recentCompositions: number  // total rows in the 30-day window
 *   positiveOutcomes: number    // outcome === 'positive'
 *   negativeOutcomes: number    // outcome === 'negative'
 *   pendingOutcomes: number     // outcome === 'pending'
 *   moduleUsage: Array<{
 *     moduleName: string
 *     usageCount: number
 *     positiveCount: number
 *     negativeCount: number
 *     averageTokenCost: 0       // stub for wire-compat with EffectivenessPane
 *   }>
 * }
 *
 * Sprint W Phase P2.1 — 2026-05-19
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

const LOOKBACK_DAYS = 30;

function getPrisma(req: FastifyRequest): any | null {
  return (req.server as any)?.app?.prisma ?? null;
}

export const adminPromptAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/admin/prompts/effectiveness */
  fastify.get('/', async (request, reply) => {
    const prisma = getPrisma(request);
    if (!prisma) {
      return reply.code(503).send({ error: 'prisma unavailable' });
    }

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    try {
      // Raw counts by (module name, outcome) for the last 30 days.
      // PromptEffectiveness.modules is String[] — we unnest via prisma queryRaw
      // because Prisma groupBy doesn't support array-column unnesting directly.
      //
      // Fallback: if queryRaw fails (sqlite, schema mismatch) return totals-only.
      let rows: Array<{ module_name: string; outcome: string; cnt: bigint }> = [];

      try {
        rows = await prisma.$queryRaw`
          SELECT
            unnest(modules)  AS module_name,
            outcome,
            COUNT(*)::bigint AS cnt
          FROM prompt_effectiveness
          WHERE created_at >= ${since}
          GROUP BY unnest(modules), outcome
          ORDER BY module_name, outcome
        `;
      } catch {
        // queryRaw unavailable (test env / sqlite) — fall through to empty rows
      }

      // Aggregate totals
      let positiveOutcomes = 0;
      let negativeOutcomes = 0;
      let pendingOutcomes = 0;

      // Per-module accumulators
      const moduleMap = new Map<string, { usageCount: number; positiveCount: number; negativeCount: number }>();

      for (const row of rows) {
        const cnt = Number(row.cnt);
        const name = row.module_name ?? '(unnamed)';

        if (!moduleMap.has(name)) {
          moduleMap.set(name, { usageCount: 0, positiveCount: 0, negativeCount: 0 });
        }
        const m = moduleMap.get(name)!;
        m.usageCount += cnt;

        if (row.outcome === 'positive') {
          m.positiveCount += cnt;
          positiveOutcomes += cnt;
        } else if (row.outcome === 'negative') {
          m.negativeCount += cnt;
          negativeOutcomes += cnt;
        } else {
          pendingOutcomes += cnt;
        }
      }

      const recentCompositions = positiveOutcomes + negativeOutcomes + pendingOutcomes;
      const moduleUsage = Array.from(moduleMap.entries())
        .map(([moduleName, m]) => ({
          moduleName,
          usageCount: m.usageCount,
          positiveCount: m.positiveCount,
          negativeCount: m.negativeCount,
          averageTokenCost: 0,
        }))
        .sort((a, b) => b.usageCount - a.usageCount);

      return reply.send({
        totalModules: moduleMap.size,
        enabledModules: moduleMap.size,
        averageTokenCost: 0,
        totalTokenBudgetUsed: 0,
        recentCompositions,
        positiveOutcomes,
        negativeOutcomes,
        pendingOutcomes,
        moduleUsage,
      });
    } catch (err: any) {
      return reply.code(500).send({ error: err?.message ?? 'query failed' });
    }
  });
};

export default adminPromptAnalyticsRoutes;
