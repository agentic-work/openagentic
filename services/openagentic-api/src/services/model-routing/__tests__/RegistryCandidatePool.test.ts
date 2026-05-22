/**
 * Task 7 tests — SmartModelRouter's candidate pool comes from the Registry
 * (admin.model_role_assignments), not from ModelConfigurationService or
 * providerManager.discoveredCapabilities.
 *
 * We test the pool helper in isolation (so the SmartModelRouter refactor is
 * a one-line source swap): it lists every enabled row, plus whatever meta
 * the router cares about (model id, provider, capabilities, role). Tests
 * assert it EXCLUDES disabled rows and returns model ids so the existing
 * `discoverFromProviders()` loop can reuse the allowlist logic.
 *
 * MC-I unit tests (provider.enabled cross-check) are in the second describe
 * block below and use plain vi.fn() mocks — no database required.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listRegistryCandidatePool,
  type RegistryCandidatePoolPrismaLike,
} from '../RegistryCandidatePool.js';

describe('listRegistryCandidatePool (integration — real Prisma)', () => {
  let prisma: PrismaClient;
  let testUserId: string;
  const providerName = `registry-pool-test-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: ['error'],
    });
    const anyUser = await prisma.user.findFirst({ select: { id: true } });
    if (!anyUser) throw new Error('No seed user');
    testUserId = anyUser.id;
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
  });

  afterAll(async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.$disconnect();
  });

  it('returns empty array when Registry has no rows for this provider', async () => {
    const pool = await listRegistryCandidatePool(prisma as unknown as RegistryCandidatePoolPrismaLike);
    // Can't assert 0 on the whole table — other tests seed rows — but our
    // test provider shouldn't show up.
    expect(pool.find(p => p.provider === providerName)).toBeUndefined();
  });

  it('returns each enabled row with {model, provider, role, capabilities, priority}', async () => {
    await prisma.modelRoleAssignment.createMany({
      data: [
        { role: 'chat', model: 'pool-a', provider: providerName, priority: 100, enabled: true, temperature: 0.7, options: { auto: true }, capabilities: { chat: true, tools: true }, description: 'pool-a', created_by: testUserId } as any,
        { role: 'chat', model: 'pool-b', provider: providerName, priority: 50, enabled: true, temperature: 0.7, options: { auto: true }, capabilities: { chat: true, vision: true }, description: 'pool-b', created_by: testUserId } as any,
      ],
    });
    const pool = await listRegistryCandidatePool(prisma as unknown as RegistryCandidatePoolPrismaLike);
    const ours = pool.filter(p => p.provider === providerName);
    expect(ours).toHaveLength(2);
    const byModel = new Map(ours.map(p => [p.model, p]));
    expect(byModel.get('pool-a')).toMatchObject({ model: 'pool-a', provider: providerName, role: 'chat', priority: 100 });
    expect(byModel.get('pool-a')?.capabilities).toMatchObject({ chat: true, tools: true });
    expect(byModel.get('pool-b')?.capabilities).toMatchObject({ vision: true });
  });

  it('EXCLUDES disabled rows from the candidate pool', async () => {
    // Purge prior seed, make a new one with a mix
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.modelRoleAssignment.createMany({
      data: [
        { role: 'chat', model: 'pool-en', provider: providerName, priority: 100, enabled: true, temperature: 0.7, options: { auto: true }, capabilities: { chat: true }, description: 'pool-en', created_by: testUserId } as any,
        { role: 'chat', model: 'pool-dis', provider: providerName, priority: 100, enabled: false, temperature: 0.7, options: { auto: true }, capabilities: { chat: true }, description: 'pool-dis', created_by: testUserId } as any,
      ],
    });
    const pool = await listRegistryCandidatePool(prisma as unknown as RegistryCandidatePoolPrismaLike);
    const ours = pool.filter(p => p.provider === providerName);
    expect(ours).toHaveLength(1);
    expect(ours[0].model).toBe('pool-en');
  });

  it('is Registry-wide — does not filter by role unless asked', async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.modelRoleAssignment.createMany({
      data: [
        { role: 'chat', model: 'chat-model', provider: providerName, priority: 100, enabled: true, temperature: 0.7, options: { auto: true }, capabilities: { chat: true }, description: 'chat-model', created_by: testUserId } as any,
        { role: 'embeddings', model: 'embed-model', provider: providerName, priority: 100, enabled: true, temperature: 0.7, options: { auto: true }, capabilities: { embeddings: true }, description: 'embed-model', created_by: testUserId } as any,
      ],
    });
    const pool = await listRegistryCandidatePool(prisma as unknown as RegistryCandidatePoolPrismaLike);
    const ours = pool.filter(p => p.provider === providerName).map(p => p.model).sort();
    expect(ours).toEqual(['chat-model', 'embed-model']);
  });
});

// ---------------------------------------------------------------------------
// MC-I unit tests: provider.enabled cross-check (no database required)
// ---------------------------------------------------------------------------

/** Build a typed fake prisma that satisfies RegistryCandidatePoolPrismaLike */
function buildFakePrisma(
  providers: Array<{ name: string }>,
  assignments: Array<{
    id: string;
    model: string;
    provider: string;
    role: string;
    priority: number;
    capabilities: Record<string, unknown>;
  }>,
): RegistryCandidatePoolPrismaLike {
  return {
    lLMProvider: {
      findMany: vi.fn().mockResolvedValue(providers),
    },
    modelRoleAssignment: {
      findMany: vi.fn().mockResolvedValue(assignments),
    },
  } as unknown as RegistryCandidatePoolPrismaLike;
}

describe('listRegistryCandidatePool (MC-I unit — provider.enabled cross-check)', () => {
  it('returns models whose provider is enabled', async () => {
    const fakePrisma = buildFakePrisma(
      // enabled providers returned by lLMProvider.findMany (already filtered by query)
      [{ name: 'azure-enabled' }],
      // assignment rows returned by modelRoleAssignment.findMany
      [
        { id: 'a1', model: 'model-a1', provider: 'azure-enabled', role: 'chat', priority: 1, capabilities: { chat: true } },
        { id: 'a2', model: 'model-a2', provider: 'azure-enabled', role: 'chat', priority: 2, capabilities: { chat: true } },
      ],
    );

    const pool = await listRegistryCandidatePool(fakePrisma);

    expect(pool).toHaveLength(2);
    expect(pool.map(p => p.model).sort()).toEqual(['model-a1', 'model-a2']);
    // Verify the modelRoleAssignment query includes the provider filter
    const assignFindMany = (fakePrisma.modelRoleAssignment.findMany as ReturnType<typeof vi.fn>);
    const callArgs = assignFindMany.mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ provider: { in: ['azure-enabled'] } });
  });

  it('returns empty array when no providers are enabled', async () => {
    const fakePrisma = buildFakePrisma(
      // no enabled providers
      [],
      // assignments should never be queried (or return empty due to in:[])
      [],
    );

    const pool = await listRegistryCandidatePool(fakePrisma);

    expect(pool).toEqual([]);
  });

  it('returns empty array when no model_role_assignments are enabled', async () => {
    const fakePrisma = buildFakePrisma(
      [{ name: 'azure-enabled' }],
      // modelRoleAssignment.findMany returns empty (all models disabled)
      [],
    );

    const pool = await listRegistryCandidatePool(fakePrisma);

    expect(pool).toEqual([]);
  });

  it('excludes deleted providers (deleted_at !== null)', async () => {
    // The lLMProvider query filters deleted_at: null at DB level.
    // Here the fake returns only non-deleted providers — simulating the DB filter.
    // The deleted provider "azure-deleted" is absent from the providers list,
    // so its model rows must not appear in the pool.
    const fakePrisma = buildFakePrisma(
      // only the non-deleted provider comes back from the DB query
      [{ name: 'azure-live' }],
      // only models from the live provider are returned (in: filter excludes deleted)
      [
        { id: 'b1', model: 'live-model', provider: 'azure-live', role: 'chat', priority: 1, capabilities: {} },
      ],
    );

    const pool = await listRegistryCandidatePool(fakePrisma);

    expect(pool).toHaveLength(1);
    expect(pool[0].model).toBe('live-model');
    // Confirm 'azure-deleted' was NOT in the provider filter passed to assignments query
    const assignFindMany = (fakePrisma.modelRoleAssignment.findMany as ReturnType<typeof vi.fn>);
    const inList: string[] = assignFindMany.mock.calls[0][0].where.provider.in;
    expect(inList).not.toContain('azure-deleted');
  });

  it('preserves priority ordering', async () => {
    const fakePrisma = buildFakePrisma(
      [{ name: 'prov-x' }],
      // DB returns already ordered by priority asc (simulating orderBy)
      [
        { id: 'p1', model: 'model-low',  provider: 'prov-x', role: 'chat', priority: 1,  capabilities: {} },
        { id: 'p2', model: 'model-mid',  provider: 'prov-x', role: 'chat', priority: 5,  capabilities: {} },
        { id: 'p3', model: 'model-high', provider: 'prov-x', role: 'chat', priority: 10, capabilities: {} },
      ],
    );

    const pool = await listRegistryCandidatePool(fakePrisma);

    expect(pool.map(p => p.priority)).toEqual([1, 5, 10]);
    expect(pool.map(p => p.model)).toEqual(['model-low', 'model-mid', 'model-high']);
    // Confirm orderBy was passed
    const assignFindMany = (fakePrisma.modelRoleAssignment.findMany as ReturnType<typeof vi.fn>);
    expect(assignFindMany.mock.calls[0][0].orderBy).toEqual([{ priority: 'asc' }]);
  });
});
