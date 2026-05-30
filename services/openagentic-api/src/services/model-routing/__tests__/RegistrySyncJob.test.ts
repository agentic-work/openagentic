/**
 * RegistrySyncJob tests (task #311, task 2) — the continuous sync loop
 * that mirrors AIF deployment + Ollama host state into the Registry.
 *
 * Contract exercised here:
 *   - Only providers with provider_type ∈ {ollama, azure-ai-foundry} are synced.
 *     Bedrock, Vertex, OpenAI, Anthropic, Azure OpenAI are skipped entirely
 *     (admin uses "Add Model" UI for those).
 *   - Only provider rows with `enabled = true` are synced. A disabled
 *     provider's Registry rows stay frozen until the provider is re-enabled.
 *   - NEW models discovered on re-sync → inserted as enabled Registry rows.
 *   - MISSING models (in DB but not in live discovery) for AIF → marked
 *     `enabled=false` + `options.sync_removed=true`. Audit trail, never
 *     hard-deleted.
 *   - MISSING models for Ollama → same behavior (so `ollama rm`
 *     removes the model from the chat toolbar cleanly).
 *   - Admin-disabled rows (options.admin_override === true OR
 *     options.auto === false) are PRESERVED verbatim — sync must NOT
 *     re-enable them even if the live provider still reports that model.
 *
 * Implementation is pure TypeScript — no DB — tests drive a fake
 * PrismaLike + fake ProviderManager via dependency injection.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import {
  RegistrySyncJob,
  planRegistrySync,
  type RegistrySyncPrismaLike,
  type RegistrySyncProvider,
  type RegistryRowForSync,
} from '../RegistrySyncJob.js';

const mkLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mkLogger(),
} as unknown as Logger);

const mkDiscovered = (id: string, embed = false) => ({
  id,
  name: id,
  provider: 'p',
  capabilities: {
    chat: !embed,
    tools: !embed,
    streaming: !embed,
    vision: false,
    thinking: false,
    embeddings: embed,
    imageGeneration: false,
  },
});

const mkExisting = (id: string, overrides: Partial<RegistryRowForSync> = {}): RegistryRowForSync => ({
  id: `row-${id}`,
  role: 'chat',
  model: id,
  provider: 'p',
  priority: 100,
  enabled: true,
  temperature: 0.7,
  max_tokens: null,
  capabilities: { chat: true },
  options: { auto: true, discoveredAt: '2026-04-20T00:00:00.000Z' },
  description: id,
  created_by: 'seeder',
  ...overrides,
});

describe('planRegistrySync (pure diff)', () => {
  const providerName = 'p';

  it('INSERTs a brand-new model that is in discovery but not in Registry', () => {
    const plan = planRegistrySync({
      providerName,
      discovered: [mkDiscovered('new-model')],
      existing: [],
      createdBy: 'sync-job',
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].model).toBe('new-model');
    expect(plan.inserts[0].enabled).toBe(true);
    expect(plan.softDeletes).toHaveLength(0);
    expect(plan.preserved).toHaveLength(0);
  });

  it('SOFT-DELETEs a Registry row that is missing from the live discovery set', () => {
    const plan = planRegistrySync({
      providerName,
      discovered: [], // nothing discovered
      existing: [mkExisting('alpha')], // alpha no longer on host
      createdBy: 'sync-job',
    });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.softDeletes).toHaveLength(1);
    expect(plan.softDeletes[0].id).toBe('row-alpha');
    expect(plan.softDeletes[0].patch.enabled).toBe(false);
    expect(plan.softDeletes[0].patch.options?.sync_removed).toBe(true);
  });

  it('AIF deployment-list mirror: existing alpha+beta, discovery returns only beta → alpha soft-deleted', () => {
    const plan = planRegistrySync({
      providerName,
      discovered: [mkDiscovered('beta')],
      existing: [mkExisting('alpha'), mkExisting('beta')],
      createdBy: 'sync-job',
    });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.softDeletes).toHaveLength(1);
    expect(plan.softDeletes[0].id).toBe('row-alpha');
  });

  it('PRESERVEs admin-disabled rows (options.admin_override=true) — sync never re-enables', () => {
    const plan = planRegistrySync({
      providerName,
      discovered: [mkDiscovered('alpha')], // still there on host
      existing: [mkExisting('alpha', { enabled: false, options: { admin_override: true, auto: false } })],
      createdBy: 'sync-job',
    });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.softDeletes).toHaveLength(0);
    expect(plan.preserved).toHaveLength(1);
    expect(plan.preserved[0].id).toBe('row-alpha');
    expect(plan.preserved[0].reason).toBe('admin_override');
  });

  it('PRESERVEs admin-edited rows (options.auto=false) on the missing-side too (never hard-deletes admin rows)', () => {
    const plan = planRegistrySync({
      providerName,
      discovered: [], // host says gone
      existing: [mkExisting('alpha', { options: { auto: false, note: 'handtuned' } })],
      createdBy: 'sync-job',
    });
    // Admin-owned rows are never touched — not even soft-deleted
    expect(plan.softDeletes).toHaveLength(0);
    expect(plan.preserved).toHaveLength(1);
    expect(plan.preserved[0].id).toBe('row-alpha');
  });

  it('re-adding a model the admin previously soft-deleted flips enabled back to true on next discovery', () => {
    // Scenario: sync soft-deleted alpha last cycle (enabled=false, sync_removed=true).
    // This cycle discovery returns alpha again → re-enable.
    const plan = planRegistrySync({
      providerName,
      discovered: [mkDiscovered('alpha')],
      existing: [mkExisting('alpha', { enabled: false, options: { auto: true, sync_removed: true } })],
      createdBy: 'sync-job',
    });
    expect(plan.reenables).toHaveLength(1);
    expect(plan.reenables[0].id).toBe('row-alpha');
    expect(plan.reenables[0].patch.enabled).toBe(true);
    expect(plan.reenables[0].patch.options?.sync_removed).toBe(false);
  });

  it('skips re-enable when admin has set admin_override=true even if sync_removed was previously set', () => {
    // Edge case: admin disabled a model while the sync happened to also soft-delete it.
    // admin_override trumps the auto re-enable path.
    const plan = planRegistrySync({
      providerName,
      discovered: [mkDiscovered('alpha')],
      existing: [mkExisting('alpha', {
        enabled: false,
        options: { auto: false, admin_override: true, sync_removed: true },
      })],
      createdBy: 'sync-job',
    });
    expect(plan.reenables).toHaveLength(0);
    expect(plan.preserved).toHaveLength(1);
  });

  it('no-op: existing row matches discovery and is already enabled → nothing changes', () => {
    const plan = planRegistrySync({
      providerName,
      discovered: [mkDiscovered('alpha')],
      existing: [mkExisting('alpha', { enabled: true, options: { auto: true } })],
      createdBy: 'sync-job',
    });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.softDeletes).toHaveLength(0);
    expect(plan.reenables).toHaveLength(0);
  });

  it('ignores rows from other providers when diffing', () => {
    const plan = planRegistrySync({
      providerName,
      discovered: [mkDiscovered('alpha')],
      existing: [
        mkExisting('alpha'),
        mkExisting('beta-from-elsewhere', { provider: 'other-provider' }),
      ],
      createdBy: 'sync-job',
    });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.softDeletes).toHaveLength(0);
  });
});

describe('RegistrySyncJob.syncAll (integration via fake deps)', () => {
  /**
   * Build a minimal in-memory Prisma-compatible fake. Tracks create/update
   * calls so each test can assert the exact mutations the sync job performed.
   */
  function buildFake() {
    const providers: Array<{
      name: string; provider_type: string; enabled: boolean; deleted_at: Date | null;
    }> = [];
    const rows: RegistryRowForSync[] = [];
    const created: any[] = [];
    const updated: Array<{ where: { id: string }; data: any }> = [];

    const prisma: RegistrySyncPrismaLike = {
      lLMProvider: {
        findMany: vi.fn(async (args: any) => {
          const filter = args?.where ?? {};
          return providers.filter(p => {
            if (p.deleted_at !== null && filter.deleted_at === null) return false;
            if ('enabled' in filter && p.enabled !== filter.enabled) return false;
            return true;
          }) as any;
        }),
      },
      modelRoleAssignment: {
        findMany: vi.fn(async (args: any) => {
          const filter = args?.where ?? {};
          return rows.filter(r => !filter.provider || r.provider === filter.provider) as any;
        }),
        create: vi.fn(async ({ data }: any) => {
          const row: RegistryRowForSync = {
            ...data,
            id: `newid-${data.model}`,
            description: data.description ?? data.model,
          };
          rows.push(row);
          created.push(data);
          return row as any;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const idx = rows.findIndex(r => r.id === where.id);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...data };
          updated.push({ where, data });
          return rows[idx] as any;
        }),
      },
    };

    return { prisma, providers, rows, created, updated };
  }

  function buildProviderManager(nameToProvider: Record<string, { discoverModels: () => Promise<any[]>; getModelDefaults?: any }>) {
    return {
      getProvider(name: string) { return nameToProvider[name] ?? null; },
    } as unknown as RegistrySyncProvider;
  }

  it('inserts new Ollama model on re-sync when discovery returns 1 more than Registry has', async () => {
    const { prisma, providers, rows, created } = buildFake();
    providers.push({ name: 'ollama-hal', provider_type: 'ollama', enabled: true, deleted_at: null });
    rows.push(mkExisting('gpt-oss', { provider: 'ollama-hal' }));
    rows.push(mkExisting('codellama', { provider: 'ollama-hal' }));
    // Discovery now returns 3 models (gpt-oss, codellama, and NEW llama-vision)
    const pm = buildProviderManager({
      'ollama-hal': { discoverModels: async () => [mkDiscovered('gpt-oss'), mkDiscovered('codellama'), mkDiscovered('llama-vision')] },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    const result = await job.syncAll();

    expect(created.map(c => c.model).sort()).toEqual(['llama-vision']);
    expect(result.perProvider['ollama-hal'].inserted).toBe(1);
    expect(result.perProvider['ollama-hal'].softDeleted).toBe(0);
  });

  it('does NOT re-enable an admin-disabled Ollama model across sync cycles', async () => {
    const { prisma, providers, rows, updated } = buildFake();
    providers.push({ name: 'ollama-hal', provider_type: 'ollama', enabled: true, deleted_at: null });
    rows.push(mkExisting('gpt-oss', { provider: 'ollama-hal', enabled: false, options: { admin_override: true, auto: false } }));
    const pm = buildProviderManager({
      'ollama-hal': { discoverModels: async () => [mkDiscovered('gpt-oss')] },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    await job.syncAll();

    // No update ever happened on the admin_override row
    expect(updated.filter(u => u.where.id === 'row-gpt-oss')).toHaveLength(0);
    expect(rows.find(r => r.id === 'row-gpt-oss')!.enabled).toBe(false);
  });

  it('AIF mirror: existing alpha+beta, discovery returns only beta → alpha gets enabled=false + sync_removed=true', async () => {
    const { prisma, providers, rows, updated } = buildFake();
    providers.push({ name: 'aif-east', provider_type: 'azure-ai-foundry', enabled: true, deleted_at: null });
    rows.push(mkExisting('alpha', { provider: 'aif-east' }));
    rows.push(mkExisting('beta', { provider: 'aif-east' }));
    const pm = buildProviderManager({
      'aif-east': { discoverModels: async () => [mkDiscovered('beta')] },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    await job.syncAll();

    const alphaPatches = updated.filter(u => u.where.id === 'row-alpha');
    expect(alphaPatches).toHaveLength(1);
    expect(alphaPatches[0].data.enabled).toBe(false);
    expect(alphaPatches[0].data.options.sync_removed).toBe(true);
    // beta should not be touched
    expect(updated.filter(u => u.where.id === 'row-beta')).toHaveLength(0);
  });

  it('does NOT hard-delete — soft-deleted rows remain in the DB for audit trail', async () => {
    const { prisma, providers, rows } = buildFake();
    providers.push({ name: 'aif-east', provider_type: 'azure-ai-foundry', enabled: true, deleted_at: null });
    rows.push(mkExisting('alpha', { provider: 'aif-east' }));
    const pm = buildProviderManager({
      'aif-east': { discoverModels: async () => [] },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    await job.syncAll();

    // Row still present (soft-deleted, not destroyed)
    expect(rows.find(r => r.id === 'row-alpha')).toBeDefined();
    expect(rows.find(r => r.id === 'row-alpha')!.enabled).toBe(false);
  });

  it('skips Bedrock providers entirely (sync must not run for explicit-add provider types)', async () => {
    const { prisma, providers, rows, created, updated } = buildFake();
    providers.push({ name: 'bedrock-prod', provider_type: 'aws-bedrock', enabled: true, deleted_at: null });
    // Pretend an admin manually added one row via the Add-Model UI
    rows.push(mkExisting('claude-sonnet', { provider: 'bedrock-prod' }));
    const pm = buildProviderManager({
      // Bedrock would report 117 models — but we should never call this
      'bedrock-prod': { discoverModels: async () => Array.from({ length: 117 }, (_, i) => mkDiscovered(`noise-${i}`)) },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    const result = await job.syncAll();

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(result.perProvider['bedrock-prod']).toBeUndefined(); // never touched
  });

  it('skips Vertex providers entirely', async () => {
    const { prisma, providers, rows, created, updated } = buildFake();
    providers.push({ name: 'vertex-prod', provider_type: 'vertex-ai', enabled: true, deleted_at: null });
    rows.push(mkExisting('gemini-2-pro', { provider: 'vertex-prod' }));
    const pm = buildProviderManager({
      'vertex-prod': { discoverModels: async () => [mkDiscovered('extra-preview')] },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    await job.syncAll();

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('skips disabled providers — re-syncing a disabled provider does nothing', async () => {
    const { prisma, providers, rows, created, updated } = buildFake();
    providers.push({ name: 'ollama-standby', provider_type: 'ollama', enabled: false, deleted_at: null });
    rows.push(mkExisting('will-not-be-synced', { provider: 'ollama-standby' }));
    const pm = buildProviderManager({
      'ollama-standby': { discoverModels: async () => [mkDiscovered('new-model')] },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    await job.syncAll();

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('tolerates provider.discoverModels throwing — other providers still sync', async () => {
    const { prisma, providers, rows, created } = buildFake();
    providers.push({ name: 'ollama-broken', provider_type: 'ollama', enabled: true, deleted_at: null });
    providers.push({ name: 'ollama-working', provider_type: 'ollama', enabled: true, deleted_at: null });
    const pm = buildProviderManager({
      'ollama-broken': { discoverModels: async () => { throw new Error('connection refused'); } },
      'ollama-working': { discoverModels: async () => [mkDiscovered('new-one')] },
    });

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    const result = await job.syncAll();

    expect(result.perProvider['ollama-broken'].error).toMatch(/connection refused/);
    expect(result.perProvider['ollama-working'].inserted).toBe(1);
    expect(created).toHaveLength(1);
  });

  it('returns no-op when providerManager has no live instance for a DB-enabled provider', async () => {
    const { prisma, providers, rows } = buildFake();
    providers.push({ name: 'ollama-orphan', provider_type: 'ollama', enabled: true, deleted_at: null });
    rows.push(mkExisting('something', { provider: 'ollama-orphan' }));
    const pm = buildProviderManager({}); // no providers registered

    const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger() });
    const result = await job.syncAll();

    expect(result.perProvider['ollama-orphan'].error).toMatch(/no live provider/i);
  });

  it('start() schedules periodic syncAll at the configured interval', async () => {
    vi.useFakeTimers();
    try {
      const { prisma, providers } = buildFake();
      providers.push({ name: 'ollama-hal', provider_type: 'ollama', enabled: true, deleted_at: null });
      const pm = buildProviderManager({
        'ollama-hal': { discoverModels: async () => [] },
      });
      const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger(), intervalMs: 1000 });
      const spy = vi.spyOn(job, 'syncAll');
      job.start();
      await vi.advanceTimersByTimeAsync(3500);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
      job.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() halts the scheduled loop — no further invocations after cancellation', async () => {
    vi.useFakeTimers();
    try {
      const { prisma, providers } = buildFake();
      providers.push({ name: 'ollama-hal', provider_type: 'ollama', enabled: true, deleted_at: null });
      const pm = buildProviderManager({
        'ollama-hal': { discoverModels: async () => [] },
      });
      const job = new RegistrySyncJob({ prisma, providerManager: pm, logger: mkLogger(), intervalMs: 1000 });
      const spy = vi.spyOn(job, 'syncAll');
      job.start();
      await vi.advanceTimersByTimeAsync(1500);
      const callsBefore = spy.mock.calls.length;
      job.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(spy.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});
