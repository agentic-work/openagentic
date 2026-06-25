/**
 * Task 2 tests — provider-create should upsert discovered models into
 * admin.model_role_assignments (the Registry) with sensible defaults.
 *
 * Unit-layer: exercise the plan generator that decides, for each discovered
 * model, whether to INSERT, UPDATE, or PRESERVE (admin-edited) the row.
 * Integration-layer: against the real Postgres via DATABASE_URL, POSTing
 * discovery twice yields the same row count; flipping options.auto=false
 * + a priority change preserves the admin edit on the third sync.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { DiscoveredModel } from '../../llm-providers/ILLMProvider.js';
import {
  planRegistryUpsert,
  upsertDiscoveredModels,
  type RegistryUpsertPrismaLike,
  type RegistryRow,
} from '../RegistryUpsertService.js';

const mkDiscovered = (id: string, capOverrides: Partial<DiscoveredModel['capabilities']> = {}): DiscoveredModel => ({
  id,
  name: id,
  provider: 'test-provider',
  capabilities: {
    chat: true,
    tools: true,
    streaming: true,
    vision: false,
    thinking: false,
    embeddings: false,
    imageGeneration: false,
    ...capOverrides,
  },
});

describe('planRegistryUpsert (unit)', () => {
  const providerName = 'test-provider';

  it('INSERTs a chat model when no existing row matches', () => {
    const plans = planRegistryUpsert(providerName, [mkDiscovered('gpt-5')], [], 'test-user');
    expect(plans).toHaveLength(1);
    expect(plans[0].action).toBe('insert');
    expect(plans[0].row.role).toBe('chat');
    expect(plans[0].row.model).toBe('gpt-5');
    expect(plans[0].row.provider).toBe(providerName);
    expect(plans[0].row.enabled).toBe(true);
    expect(plans[0].row.priority).toBe(100);
    expect(plans[0].row.temperature).toBe(0.7);
    expect(plans[0].row.capabilities).toMatchObject({ chat: true, tools: true });
    expect(plans[0].row.options).toMatchObject({ auto: true });
    expect(plans[0].row.options?.discoveredAt).toBeTypeOf('string');
    expect(plans[0].row.description).toBe('gpt-5');
    expect(plans[0].row.created_by).toBe('test-user');
  });

  it('uses role=embeddings when the model advertises embeddings capability', () => {
    const plans = planRegistryUpsert(
      providerName,
      [mkDiscovered('nomic-embed', { chat: false, embeddings: true })],
      [],
      'test-user',
    );
    expect(plans[0].row.role).toBe('embeddings');
  });

  it('UPDATEs a seeder-managed row (options.auto === true) on the next sync', () => {
    const existing: RegistryRow[] = [
      {
        id: 'row-1',
        role: 'chat',
        model: 'gpt-5',
        provider: providerName,
        priority: 100,
        enabled: true,
        temperature: 0.7,
        max_tokens: null,
        capabilities: { chat: true, tools: false, streaming: false, vision: false, thinking: false, embeddings: false, imageGeneration: false },
        options: { auto: true, discoveredAt: '2026-04-20T00:00:00.000Z' },
        description: 'gpt-5',
        created_by: 'seeder',
      },
    ];
    const plans = planRegistryUpsert(
      providerName,
      [mkDiscovered('gpt-5', { tools: true })], // caps changed from false → true
      existing,
      'test-user',
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].action).toBe('update');
    expect(plans[0].row.capabilities).toMatchObject({ tools: true });
  });

  it('PRESERVEs admin edits (options.auto === false) but refreshes capabilities + description', () => {
    const existing: RegistryRow[] = [
      {
        id: 'row-1',
        role: 'reasoning', // admin changed from 'chat' to 'reasoning'
        model: 'gpt-5',
        provider: providerName,
        priority: 1, // admin changed from 100 to 1
        enabled: true,
        temperature: 0.2, // admin tuned
        max_tokens: 8000,
        capabilities: { chat: true, tools: false, streaming: false, vision: false, thinking: false, embeddings: false, imageGeneration: false },
        options: { auto: false, note: 'hand-tuned for Bob' },
        description: 'old description',
        created_by: 'admin-user-1',
      },
    ];
    const plans = planRegistryUpsert(
      providerName,
      [mkDiscovered('gpt-5', { tools: true, vision: true })],
      existing,
      'test-user',
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].action).toBe('update');
    // Admin edits preserved
    expect(plans[0].row.role).toBe('reasoning');
    expect(plans[0].row.priority).toBe(1);
    expect(plans[0].row.temperature).toBe(0.2);
    expect(plans[0].row.max_tokens).toBe(8000);
    expect(plans[0].row.options).toMatchObject({ auto: false, note: 'hand-tuned for Bob' });
    // Capabilities + description refreshed
    expect(plans[0].row.capabilities).toMatchObject({ tools: true, vision: true });
    expect(plans[0].row.description).toBe('gpt-5');
  });

  it('returns no plans when discovered list is empty', () => {
    const plans = planRegistryUpsert(providerName, [], [], 'test-user');
    expect(plans).toHaveLength(0);
  });

  it('ignores existing rows for other providers when planning', () => {
    const existing: RegistryRow[] = [
      {
        id: 'row-1',
        role: 'chat',
        model: 'gpt-5',
        provider: 'other-provider', // different provider
        priority: 100,
        enabled: true,
        temperature: 0.7,
        max_tokens: null,
        capabilities: {},
        options: { auto: true },
        description: 'gpt-5',
        created_by: 'seeder',
      },
    ];
    const plans = planRegistryUpsert(providerName, [mkDiscovered('gpt-5')], existing, 'test-user');
    expect(plans).toHaveLength(1);
    expect(plans[0].action).toBe('insert');
  });

  it('skips when a sibling row exists at a different role for the same model', () => {
    // Two existing rows for same (model, provider) — one at role=chat, one at
    // role=code. Discovery returns only the model name, planner derives role=chat.
    // The chat row already exists → update it (without changing role). The code
    // row is left alone — never converted to chat (would 500 on the unique constraint).
    const existing: RegistryRow[] = [
      {
        id: 'row-chat',
        role: 'chat',
        model: 'gpt-oss:20b',
        provider: providerName,
        priority: 100,
        enabled: true,
        temperature: 0.7,
        max_tokens: null,
        capabilities: { chat: true, tools: true, streaming: true },
        options: { auto: true },
        description: 'gpt-oss:20b',
        created_by: 'seeder',
      },
      {
        id: 'row-code',
        role: 'code',
        model: 'gpt-oss:20b',
        provider: providerName,
        priority: 10,
        enabled: true,
        temperature: 0.7,
        max_tokens: null,
        capabilities: { chat: true, tools: true, streaming: true },
        options: { auto: true },
        description: 'gpt-oss:20b',
        created_by: 'seeder',
      },
    ];
    const plans = planRegistryUpsert(providerName, [mkDiscovered('gpt-oss:20b')], existing, 'test-user');
    // One update for the chat row; the code sibling stays untouched. No insert (would collide).
    expect(plans).toHaveLength(1);
    expect(plans[0].action).toBe('update');
    expect(plans[0].existingId).toBe('row-chat');
    expect(plans[0].row.role).toBe('chat');
  });

  it('skips entirely when only a sibling at a non-derived role exists', () => {
    // Only the code row exists. Discovery derives role=chat (no embeddings cap),
    // but inserting at (chat, gpt-oss:20b, provider) would collide once anything
    // ever creates the chat sibling, AND silently flipping the existing code row
    // to chat would break codemode routing. Plan emits zero entries — admin
    // rebalances via the UI if they want chat for this model.
    const existing: RegistryRow[] = [
      {
        id: 'row-code',
        role: 'code',
        model: 'gpt-oss:20b',
        provider: providerName,
        priority: 10,
        enabled: true,
        temperature: 0.7,
        max_tokens: null,
        capabilities: {},
        options: { auto: true },
        description: 'gpt-oss:20b',
        created_by: 'seeder',
      },
    ];
    const plans = planRegistryUpsert(providerName, [mkDiscovered('gpt-oss:20b')], existing, 'test-user');
    expect(plans).toHaveLength(0);
  });
});

describe('upsertDiscoveredModels (integration — real Prisma)', () => {
  let prisma: PrismaClient;
  let testUserId: string;
  const providerName = `rust-test-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: ['error'],
    });
    const anyUser = await prisma.user.findFirst({ select: { id: true } });
    if (!anyUser) throw new Error('No seed user — integration test requires user table populated');
    testUserId = anyUser.id;
  });

  afterAll(async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Clear rows for this test provider between specs
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
  });

  it('inserts a row for each discovered model with sensible defaults', async () => {
    const result = await upsertDiscoveredModels(
      { providerName, discovered: [mkDiscovered('m-1'), mkDiscovered('m-2')], createdBy: testUserId },
      prisma as unknown as RegistryUpsertPrismaLike,
    );
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    const rows = await prisma.modelRoleAssignment.findMany({ where: { provider: providerName }, orderBy: { model: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe('chat');
    expect((rows[0].options as any)?.auto).toBe(true);
    expect(rows[0].enabled).toBe(true);
    expect((rows[0].capabilities as any)?.chat).toBe(true);
  });

  it('second POST with same models produces 0 inserts, 2 updates (idempotent count)', async () => {
    await upsertDiscoveredModels(
      { providerName, discovered: [mkDiscovered('m-1'), mkDiscovered('m-2')], createdBy: testUserId },
      prisma as unknown as RegistryUpsertPrismaLike,
    );
    const second = await upsertDiscoveredModels(
      { providerName, discovered: [mkDiscovered('m-1'), mkDiscovered('m-2')], createdBy: testUserId },
      prisma as unknown as RegistryUpsertPrismaLike,
    );
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(2);
    const rows = await prisma.modelRoleAssignment.findMany({ where: { provider: providerName } });
    expect(rows).toHaveLength(2);
  });

  it('preserves admin-edited priority when options.auto flipped to false', async () => {
    // Seed run
    await upsertDiscoveredModels(
      { providerName, discovered: [mkDiscovered('m-1')], createdBy: testUserId },
      prisma as unknown as RegistryUpsertPrismaLike,
    );
    const original = await prisma.modelRoleAssignment.findFirst({ where: { provider: providerName } });
    expect(original).not.toBeNull();
    // Admin flip
    await prisma.modelRoleAssignment.update({
      where: { id: original!.id },
      data: {
        priority: 1,
        options: { auto: false, note: 'admin-tuned' },
        temperature: 0.1,
      },
    });
    // Third sync
    await upsertDiscoveredModels(
      { providerName, discovered: [mkDiscovered('m-1', { vision: true })], createdBy: testUserId },
      prisma as unknown as RegistryUpsertPrismaLike,
    );
    const after = await prisma.modelRoleAssignment.findUnique({ where: { id: original!.id } });
    expect(after?.priority).toBe(1); // preserved
    expect(after?.temperature).toBe(0.1); // preserved
    expect((after?.options as any)?.auto).toBe(false); // preserved
    expect((after?.options as any)?.note).toBe('admin-tuned'); // preserved
    expect((after?.capabilities as any)?.vision).toBe(true); // refreshed
  });

  it('routes an embeddings-capable model to role=embeddings', async () => {
    await upsertDiscoveredModels(
      {
        providerName,
        discovered: [mkDiscovered('embed-1', { chat: false, embeddings: true })],
        createdBy: testUserId,
      },
      prisma as unknown as RegistryUpsertPrismaLike,
    );
    const row = await prisma.modelRoleAssignment.findFirst({ where: { provider: providerName } });
    expect(row?.role).toBe('embeddings');
  });
});

/**
 * Task #342 unit 3 — PricingService fire-and-forget hook.
 *
 * upsertDiscoveredModels must accept an optional pricing-service-like
 * dependency and, after each row is inserted/updated, call
 * `pricingService.fetchAndStorePricing` WITHOUT awaiting — the Add-Model
 * route must return immediately even if pricing fetches are slow.
 */
describe('upsertDiscoveredModels — pricing fire-and-forget (task #342 unit 3)', () => {
  /** Mock Prisma that returns fabricated rows with synthetic UUIDs on create. */
  function mkFakePrisma(): RegistryUpsertPrismaLike & {
    insertedIds: string[];
  } {
    const insertedIds: string[] = [];
    let seq = 0;
    return {
      insertedIds,
      modelRoleAssignment: {
        findMany: async () => [],
        create: async ({ data }) => {
          const id = `fake-id-${++seq}`;
          insertedIds.push(id);
          return { id, ...data };
        },
        update: async ({ where }) => ({ id: where.id }),
      },
    };
  }

  it('calls pricingService.fetchAndStorePricing once per inserted row with the inserted ID', async () => {
    const prisma = mkFakePrisma();
    const fetchAndStorePricing = vi.fn().mockResolvedValue(undefined);
    const pricingService = { fetchAndStorePricing };

    const result = await upsertDiscoveredModels(
      {
        providerName: 'prov-fire',
        providerType: 'aws-bedrock',
        region: 'us-east-1',
        discovered: [mkDiscovered('m-1'), mkDiscovered('m-2'), mkDiscovered('m-3')],
        createdBy: 'tester',
        pricingService,
      },
      prisma,
    );

    expect(result.inserted).toBe(3);
    // All 3 IDs were dispatched.
    // Allow a microtask tick for the fire-and-forget Promise.allSettled.
    await new Promise((r) => setImmediate(r));
    expect(fetchAndStorePricing).toHaveBeenCalledTimes(3);
    const dispatchedIds = fetchAndStorePricing.mock.calls.map((c) => c[0].registryRowId).sort();
    expect(dispatchedIds).toEqual(prisma.insertedIds.slice().sort());
    // providerType + region plumbed through.
    for (const call of fetchAndStorePricing.mock.calls) {
      expect(call[0].providerType).toBe('aws-bedrock');
      expect(call[0].region).toBe('us-east-1');
    }
  });

  it('does NOT await individual pricing fetches before returning (returns fast even when fetch is slow)', async () => {
    const prisma = mkFakePrisma();
    // Fetcher that takes 500ms — if upsert awaits it inline, the
    // timing assertion below will blow up.
    const fetchAndStorePricing = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 500)),
    );
    const pricingService = { fetchAndStorePricing };

    const start = Date.now();
    await upsertDiscoveredModels(
      {
        providerName: 'prov-fast',
        providerType: 'aws-bedrock',
        region: 'us-east-1',
        discovered: [mkDiscovered('m-1'), mkDiscovered('m-2')],
        createdBy: 'tester',
        pricingService,
      },
      prisma,
    );
    const elapsed = Date.now() - start;

    // Target: <100ms even though each pricing fetch is 500ms.
    // Generous upper bound to avoid flakes on slow CI runners.
    expect(elapsed).toBeLessThan(250);
  });

  it('works without a pricingService (back-compat) — no-op, no error', async () => {
    const prisma = mkFakePrisma();
    const result = await upsertDiscoveredModels(
      {
        providerName: 'prov-nopricing',
        discovered: [mkDiscovered('m-1')],
        createdBy: 'tester',
      },
      prisma,
    );
    expect(result.inserted).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // F2 C-3 regression — insert path MUST stamp managed_by='discovered'
  // and update path MUST NOT touch managed_by.
  // ---------------------------------------------------------------------------
  it('insert path stamps managed_by=\'discovered\' on the create payload (F2 C-3)', async () => {
    const prisma = mkFakePrisma();
    // Capture the data passed to create so we can assert on managed_by.
    const captured: any[] = [];
    const captureCreatePrisma: RegistryUpsertPrismaLike = {
      modelRoleAssignment: {
        findMany: async () => [],
        create: async ({ data }) => {
          captured.push(data);
          return { id: `id-${captured.length}`, ...data };
        },
        update: async ({ where }) => ({ id: where.id }),
      },
    };

    await upsertDiscoveredModels(
      {
        providerName: 'p1',
        discovered: [mkDiscovered('m-1'), mkDiscovered('m-2')],
        createdBy: 'u1',
      },
      captureCreatePrisma,
    );

    expect(captured).toHaveLength(2);
    for (const data of captured) {
      expect(data.managed_by).toBe('discovered');
    }
    // Sanity: the payload still includes the legacy fields.
    expect(captured[0].provider).toBe('p1');
    expect(captured[0].role).toBe('chat');
  });

  it('update path does NOT include `managed_by` in the data payload (F2 C-3 — admin-managed rows must keep their flag)', async () => {
    // An existing seeder/admin row already in the DB. Discovery refreshes
    // capabilities; managed_by must not be touched on update.
    const existing: RegistryRow[] = [
      {
        id: 'row-existing',
        role: 'chat',
        model: 'gpt-5',
        provider: 'p1',
        priority: 100,
        enabled: true,
        temperature: 0.7,
        max_tokens: null,
        capabilities: { chat: true },
        options: { auto: true },
        description: 'gpt-5',
        created_by: 'seeder',
      },
    ];
    const captured: any[] = [];
    const captureUpdatePrisma: RegistryUpsertPrismaLike = {
      modelRoleAssignment: {
        findMany: async () => existing,
        create: async ({ data }) => ({ id: 'new', ...data }),
        update: async ({ where, data }) => {
          captured.push(data);
          return { id: where.id, ...data };
        },
      },
    };

    await upsertDiscoveredModels(
      {
        providerName: 'p1',
        discovered: [mkDiscovered('gpt-5', { vision: true })],
        createdBy: 'tester',
      },
      captureUpdatePrisma,
    );

    expect(captured).toHaveLength(1);
    // managed_by MUST NOT appear in the update payload.
    expect(captured[0]).not.toHaveProperty('managed_by');
  });

  it('swallows pricing-fetch rejections via Promise.allSettled — never surfaces as unhandled', async () => {
    const prisma = mkFakePrisma();
    const fetchAndStorePricing = vi.fn().mockRejectedValue(new Error('boom'));
    const pricingService = { fetchAndStorePricing };

    // Must not throw even though the fetcher rejects.
    await expect(
      upsertDiscoveredModels(
        {
          providerName: 'prov-err',
          providerType: 'aws-bedrock',
          region: 'us-east-1',
          discovered: [mkDiscovered('m-1'), mkDiscovered('m-2')],
          createdBy: 'tester',
          pricingService,
        },
        prisma,
      ),
    ).resolves.toEqual(expect.objectContaining({ inserted: 2 }));
    // Let the fire-and-forget allSettled resolve before the test exits
    // so we don't leak an unhandledRejection warning.
    await new Promise((r) => setImmediate(r));
    expect(fetchAndStorePricing).toHaveBeenCalledTimes(2);
  });
});
