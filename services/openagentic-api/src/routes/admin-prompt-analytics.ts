/**
 * Admin Prompt Effectiveness Analytics — GET /api/admin/prompts/effectiveness
 *
 * Per-prompt-module usage + outcome rollup for the Prompts → Effectiveness
 * pane (pages-v3/prompts/EffectivenessPane.tsx, hook useEffectiveness()).
 *
 * Backing source: the `prompt_effectiveness` table. Every prompt composition
 * (PromptComposer.compose) writes one row {modules:String[], outcome, model,
 * created_at}; chat feedback flips `outcome` to positive/negative. We unnest
 * `modules[]` and group by (module, outcome) over a 30-day window to produce
 * the `EffectivenessWire` shape the UI expects. `prompt_modules` supplies the
 * enabled/token-budget tiles.
 *
 * Returns 503 when prisma is unavailable. queryRaw failures (e.g. non-pg test
 * env) degrade to an empty rollup (200) rather than 500.
 *
 * Registered standalone so the handler path is `/` — mount with the full
 * prefix `/api/admin/prompts/effectiveness` inside an admin-guarded wrapper
 * (the mount applies adminMiddleware, mirroring routes/admin/prompt-modules.ts;
 * see mount note in PR).
 */
import type { FastifyInstance } from 'fastify';
import { prisma as defaultPrisma } from '../utils/prisma.js';

interface ModuleOutcomeRow {
  module_name: string;
  outcome: string;
  cnt: bigint | number;
}

interface EffectivenessWire {
  totalModules: number;
  enabledModules: number;
  averageTokenCost: number;
  totalTokenBudgetUsed: number;
  moduleUsage: Array<{
    moduleName: string;
    usageCount: number;
    positiveCount: number;
    negativeCount: number;
    averageTokenCost?: number;
  }>;
  recentCompositions: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  pendingOutcomes: number;
}

export async function adminPromptAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    // Prisma comes from the AppContext (server.app.prisma) when present — an
    // explicitly-null prisma there means the DB is unavailable → 503. Only when
    // no AppContext is decorated at all do we fall back to the shared singleton
    // so the route still works in minimal/standalone registrations.
    const appCtx = (request.server as any)?.app;
    const prisma = (appCtx ? appCtx.prisma : defaultPrisma) as typeof defaultPrisma | null;

    if (!prisma) {
      return reply.code(503).send({ error: 'Database unavailable' });
    }

    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Unnest modules[] → one row per (module, outcome) with a count. Done in
    // SQL so a single round-trip covers the whole rollup. Best-effort: a
    // queryRaw failure (e.g. sqlite test env) degrades to an empty rollup.
    let rows: ModuleOutcomeRow[] = [];
    try {
      rows = (await prisma.$queryRaw`
        SELECT unnest(modules) AS module_name, outcome, COUNT(*)::bigint AS cnt
        FROM public.prompt_effectiveness
        WHERE created_at >= ${windowStart}
        GROUP BY module_name, outcome
      `) as ModuleOutcomeRow[];
    } catch {
      rows = [];
    }

    // Aggregate per-module + global outcome tallies.
    const moduleStats: Record<
      string,
      { total: number; positive: number; negative: number }
    > = {};
    let positiveOutcomes = 0;
    let negativeOutcomes = 0;
    let pendingOutcomes = 0;

    for (const row of rows) {
      const cnt = typeof row.cnt === 'bigint' ? Number(row.cnt) : Number(row.cnt ?? 0);
      const moduleName = row.module_name;
      if (!moduleName) continue;

      if (!moduleStats[moduleName]) {
        moduleStats[moduleName] = { total: 0, positive: 0, negative: 0 };
      }
      moduleStats[moduleName].total += cnt;

      if (row.outcome === 'positive') {
        moduleStats[moduleName].positive += cnt;
        positiveOutcomes += cnt;
      } else if (row.outcome === 'negative') {
        moduleStats[moduleName].negative += cnt;
        negativeOutcomes += cnt;
      } else {
        pendingOutcomes += cnt;
      }
    }

    const moduleUsage = Object.entries(moduleStats)
      .map(([moduleName, s]) => ({
        moduleName,
        usageCount: s.total,
        positiveCount: s.positive,
        negativeCount: s.negative,
      }))
      .sort((a, b) => b.usageCount - a.usageCount);

    // Module catalog tiles (enabled count + token budget). Best-effort; the
    // window rollup above is the primary payload, so a catalog read failure
    // must not 500 the pane.
    let enabledModules = 0;
    let averageTokenCost = 0;
    let totalTokenBudgetUsed = 0;
    try {
      const modules = await prisma.promptModule.findMany({
        select: { enabled: true, token_cost: true },
      });
      if (modules.length > 0) {
        const enabled = modules.filter((m) => m.enabled);
        enabledModules = enabled.length;
        averageTokenCost =
          modules.reduce((sum, m) => sum + (m.token_cost ?? 0), 0) / modules.length;
        totalTokenBudgetUsed = enabled.reduce((sum, m) => sum + (m.token_cost ?? 0), 0);
      }
    } catch {
      /* non-fatal — module catalog tiles degrade to zero */
    }

    const recentCompositions = positiveOutcomes + negativeOutcomes + pendingOutcomes;

    const payload: EffectivenessWire = {
      // `totalModules` = distinct modules seen in the effectiveness window,
      // matching the per-module table the UI renders (not the full catalog).
      totalModules: moduleUsage.length,
      enabledModules,
      averageTokenCost,
      totalTokenBudgetUsed,
      moduleUsage,
      recentCompositions,
      positiveOutcomes,
      negativeOutcomes,
      pendingOutcomes,
    };

    return reply.send(payload);
  });
}

export default adminPromptAnalyticsRoutes;
