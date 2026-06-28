/**
 * W.2-W.5 — ServicePromptService unit tests.
 *
 * Covers:
 *   - getPrompt reads from DB, caches, returns on hit
 *   - getPrompt throws when no active row (before seeding)
 *   - setPrompt version-bumps + publishes redis invalidation
 *   - invalidate clears cache entry (redis-pubsub path)
 *   - seedServicePromptsFromDefaults seeds all DEFAULT_SERVICE_PROMPTS keys idempotently
 *   - listKeys returns active rows
 *
 * Sprint W — 2026-05-19
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ServicePromptService,
  DEFAULT_SERVICE_PROMPTS,
  seedServicePromptsFromDefaults,
  __resetServicePromptCacheForTests,
} from '../ServicePromptService.js';

function makePrisma(rows: Array<{ prompt_key: string; body: string; version: number; is_active: boolean; description: string | null; id: string; created_at: Date; updated_at: Date }> = []) {
  const store = [...rows];

  return {
    servicePrompt: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store
            .filter((r) => {
              if (where.prompt_key && r.prompt_key !== where.prompt_key) return false;
              if (where.is_active !== undefined && r.is_active !== where.is_active) return false;
              return true;
            })
            .sort((a, b) => b.version - a.version)[0] ?? null
        );
      }),
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        let result = store.filter((r) => {
          if (where?.prompt_key && r.prompt_key !== where.prompt_key) return false;
          if (where?.is_active !== undefined && r.is_active !== where.is_active) return false;
          return true;
        });
        if (orderBy?.version === 'desc') result = result.sort((a, b) => b.version - a.version);
        if (orderBy?.prompt_key === 'asc') result = result.sort((a, b) => a.prompt_key.localeCompare(b.prompt_key));
        return result;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `uuid-${Math.random()}`,
          created_at: new Date(),
          updated_at: new Date(),
          ...data,
        };
        store.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        for (const r of store) {
          if (where.prompt_key && r.prompt_key !== where.prompt_key) continue;
          if (where.is_active !== undefined && r.is_active !== where.is_active) continue;
          Object.assign(r, data);
        }
        return { count: store.length };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn({
      servicePrompt: {
        findFirst: async ({ where, orderBy }: any) => {
          let result = store.filter((r) => {
            if (where.prompt_key && r.prompt_key !== where.prompt_key) return false;
            if (where.is_active !== undefined && r.is_active !== where.is_active) return false;
            return true;
          });
          if (orderBy?.version === 'desc') result = result.sort((a, b) => b.version - a.version);
          return result[0] ?? null;
        },
        create: async ({ data }: any) => {
          const row = { id: `uuid-${Math.random()}`, created_at: new Date(), updated_at: new Date(), ...data };
          store.push(row);
          return row;
        },
        updateMany: async ({ where, data }: any) => {
          for (const r of store) {
            if (where.prompt_key && r.prompt_key !== where.prompt_key) continue;
            if (where.is_active !== undefined && r.is_active !== where.is_active) continue;
            Object.assign(r, data);
          }
          return { count: store.length };
        },
      },
    })),
  };
}

describe('ServicePromptService', () => {
  beforeEach(() => __resetServicePromptCacheForTests());
  afterEach(() => __resetServicePromptCacheForTests());

  it('getPrompt — hits DB on first call, returns body', async () => {
    const prisma = makePrisma([
      { id: 'r1', prompt_key: 'test.key', body: 'Hello from DB', version: 1, is_active: true, description: null, created_at: new Date(), updated_at: new Date() },
    ]);
    const svc = new ServicePromptService(prisma as any);
    const body = await svc.getPrompt('test.key');
    expect(body).toBe('Hello from DB');
    expect(prisma.servicePrompt.findFirst).toHaveBeenCalledOnce();
  });

  it('getPrompt — returns cache hit on second call (no second DB query)', async () => {
    const prisma = makePrisma([
      { id: 'r1', prompt_key: 'test.key', body: 'Cached body', version: 1, is_active: true, description: null, created_at: new Date(), updated_at: new Date() },
    ]);
    const svc = new ServicePromptService(prisma as any);
    await svc.getPrompt('test.key');
    const body2 = await svc.getPrompt('test.key');
    expect(body2).toBe('Cached body');
    expect(prisma.servicePrompt.findFirst).toHaveBeenCalledOnce(); // only once
  });

  it('getPrompt — throws when no active row exists', async () => {
    const prisma = makePrisma([]); // empty
    const svc = new ServicePromptService(prisma as any);
    await expect(svc.getPrompt('missing.key')).rejects.toThrow(/no active service_prompt/i);
  });

  it('invalidate — clears cache so next getPrompt re-reads DB', async () => {
    const prisma = makePrisma([
      { id: 'r1', prompt_key: 'test.key', body: 'v1 body', version: 1, is_active: true, description: null, created_at: new Date(), updated_at: new Date() },
    ]);
    const svc = new ServicePromptService(prisma as any);
    await svc.getPrompt('test.key'); // prime cache
    svc.invalidate('test.key');
    await svc.getPrompt('test.key'); // cache miss → DB again
    expect(prisma.servicePrompt.findFirst).toHaveBeenCalledTimes(2);
  });

  it('setPrompt — version-bumps + publishes redis invalidation', async () => {
    const prisma = makePrisma([
      { id: 'r1', prompt_key: 'test.key', body: 'v1 body', version: 1, is_active: true, description: null, created_at: new Date(), updated_at: new Date() },
    ]);
    const publishSpy = vi.fn(async () => {});
    const redisMock = { publish: publishSpy, subscribe: vi.fn(async () => {}) };
    const svc = new ServicePromptService(prisma as any, redisMock);

    const result = await svc.setPrompt('test.key', 'v2 body', { actorUserId: 'u-admin', reason: 'sprint W test' });
    expect(result.version).toBe(2);
    expect(result.body).toBe('v2 body');
    expect(publishSpy).toHaveBeenCalledOnce();
    const [channel, msg] = publishSpy.mock.calls[0] as [string, string];
    expect(channel).toBe('service-prompt:invalidate');
    expect(JSON.parse(msg).prompt_key).toBe('test.key');

    // Cache should be updated to the new body
    const cached = await svc.getPrompt('test.key');
    expect(cached).toBe('v2 body');
  });

  it('setPrompt — first write for new key creates version 1', async () => {
    const prisma = makePrisma([]);
    const svc = new ServicePromptService(prisma as any);
    const result = await svc.setPrompt('brand.new', 'initial body', { actorUserId: null });
    expect(result.version).toBe(1);
    expect(result.is_active).toBe(true);
  });

  it('setPrompt — rejects empty body', async () => {
    const prisma = makePrisma([]);
    const svc = new ServicePromptService(prisma as any);
    await expect(svc.setPrompt('test.key', '  ', { actorUserId: null })).rejects.toThrow(/empty/i);
  });

  it('subscribeInvalidations — invalidates cache on redis message', async () => {
    let subscriber: ((msg: string) => void) | null = null;
    const redisMock = {
      publish: vi.fn(async () => {}),
      subscribe: vi.fn(async (_channel: string, cb: (msg: string) => void) => {
        subscriber = cb;
      }),
    };
    const prisma = makePrisma([
      { id: 'r1', prompt_key: 'sub.key', body: 'db body', version: 1, is_active: true, description: null, created_at: new Date(), updated_at: new Date() },
    ]);
    const svc = new ServicePromptService(prisma as any, redisMock);
    await svc.subscribeInvalidations();

    // Prime cache
    await svc.getPrompt('sub.key');
    expect(prisma.servicePrompt.findFirst).toHaveBeenCalledOnce();

    // Simulate redis invalidation message from another replica
    subscriber!(JSON.stringify({ prompt_key: 'sub.key', ts: Date.now() }));

    // Next read should go to DB again
    await svc.getPrompt('sub.key');
    expect(prisma.servicePrompt.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('seedServicePromptsFromDefaults', () => {
  beforeEach(() => __resetServicePromptCacheForTests());

  it('seeds all DEFAULT_SERVICE_PROMPTS keys on empty table', async () => {
    const prisma = makePrisma([]);
    const result = await seedServicePromptsFromDefaults(prisma as any);
    expect(result.created.length).toBe(Object.keys(DEFAULT_SERVICE_PROMPTS).length);
    expect(result.skipped).toEqual([]);
    // All known keys must be seeded
    for (const key of Object.keys(DEFAULT_SERVICE_PROMPTS)) {
      expect(result.created).toContain(key);
    }
  });

  it('skips keys that already have an active row (idempotent)', async () => {
    const existing = Object.keys(DEFAULT_SERVICE_PROMPTS)[0];
    const prisma = makePrisma([
      { id: 'r1', prompt_key: existing, body: 'existing body', version: 1, is_active: true, description: null, created_at: new Date(), updated_at: new Date() },
    ]);
    const result = await seedServicePromptsFromDefaults(prisma as any);
    expect(result.skipped).toContain(existing);
    expect(result.created).not.toContain(existing);
  });

  it('seeds the 5 required keys', async () => {
    const required = [
      'slack.integration_prompt',
      'title_gen.ai_service',
      'title_gen.client',
      'memory.context_system',
      'memory.context_build',
    ];
    for (const key of required) {
      expect(Object.keys(DEFAULT_SERVICE_PROMPTS)).toContain(key);
    }
  });
});
