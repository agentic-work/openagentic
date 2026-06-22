/**
 * P2.1 — admin-prompt-analytics route tests.
 *
 * RED test written BEFORE production code is wired (per CLAUDE.md Rule 3a.i).
 * Tests verify that GET /api/admin/prompts/effectiveness:
 *   - Returns 200 with correct shape when prisma returns data
 *   - Aggregates positive/negative/pending counts correctly
 *   - Groups by module name, surfaces usageCount + positiveCount + negativeCount
 *   - Returns 503 when prisma is unavailable
 *   - Returns empty moduleUsage (not 500) when no rows in window
 *
 * Sprint W Phase P2.1 — 2026-05-19
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { adminPromptAnalyticsRoutes } from '../admin-prompt-analytics.js';

/** Simulates the output of the $queryRaw unnest groupBy. */
function makeRawRows(rows: Array<{ module_name: string; outcome: string; cnt: number }>) {
  return rows.map((r) => ({ ...r, cnt: BigInt(r.cnt) }));
}

async function buildApp(prismaOrNull: any) {
  const app = Fastify({ logger: false });
  // Inject prisma via server.app (AppContext pattern)
  app.addHook('preHandler', async (req: any) => {
    (req.server as any).app = { prisma: prismaOrNull };
  });
  await app.register(adminPromptAnalyticsRoutes);
  return app;
}

describe('GET /api/admin/prompts/effectiveness', () => {
  it('returns 503 when prisma is unavailable', async () => {
    const app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it('returns 200 with correct shape on empty data', async () => {
    const fakePrisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const app = await buildApp(fakePrisma);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      totalModules: 0,
      enabledModules: 0,
      recentCompositions: 0,
      positiveOutcomes: 0,
      negativeOutcomes: 0,
      pendingOutcomes: 0,
      moduleUsage: [],
    });
  });

  it('aggregates per-module positive/negative/pending correctly', async () => {
    const rawRows = makeRawRows([
      { module_name: 'azure_tools', outcome: 'positive', cnt: 5 },
      { module_name: 'azure_tools', outcome: 'negative', cnt: 2 },
      { module_name: 'azure_tools', outcome: 'pending', cnt: 1 },
      { module_name: 'memory_context', outcome: 'positive', cnt: 3 },
    ]);
    const fakePrisma = {
      $queryRaw: vi.fn().mockResolvedValue(rawRows),
    };
    const app = await buildApp(fakePrisma);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.positiveOutcomes).toBe(8); // 5 + 3
    expect(body.negativeOutcomes).toBe(2);
    expect(body.pendingOutcomes).toBe(1);
    expect(body.recentCompositions).toBe(11);
    expect(body.totalModules).toBe(2);

    const azureMod = body.moduleUsage.find((m: any) => m.moduleName === 'azure_tools');
    expect(azureMod).toBeDefined();
    expect(azureMod.usageCount).toBe(8); // 5 + 2 + 1
    expect(azureMod.positiveCount).toBe(5);
    expect(azureMod.negativeCount).toBe(2);

    const memMod = body.moduleUsage.find((m: any) => m.moduleName === 'memory_context');
    expect(memMod).toBeDefined();
    expect(memMod.positiveCount).toBe(3);
    expect(memMod.negativeCount).toBe(0);
  });

  it('sorts moduleUsage by usageCount descending', async () => {
    const rawRows = makeRawRows([
      { module_name: 'small_module', outcome: 'positive', cnt: 1 },
      { module_name: 'big_module', outcome: 'positive', cnt: 10 },
    ]);
    const fakePrisma = {
      $queryRaw: vi.fn().mockResolvedValue(rawRows),
    };
    const app = await buildApp(fakePrisma);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.moduleUsage[0].moduleName).toBe('big_module');
    expect(body.moduleUsage[1].moduleName).toBe('small_module');
  });

  it('returns empty moduleUsage (not 500) when queryRaw throws', async () => {
    // Simulates sqlite / test env where $queryRaw syntax isn't supported
    const fakePrisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('syntax not supported')),
    };
    const app = await buildApp(fakePrisma);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.moduleUsage).toEqual([]);
    expect(body.recentCompositions).toBe(0);
  });
});
