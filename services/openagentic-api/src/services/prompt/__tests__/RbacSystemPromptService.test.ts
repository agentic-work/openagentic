/**
 * P-Live-1 RED→GREEN: DB-backed RBAC system prompt resolver + seeder.
 *
 * Layer-1 of chatmode three-layer prompt arch — the role-keyed RBAC base
 * template moves from filesystem (services/openagentic-api/prompts/*.md)
 * into the `rbac_system_prompts` table so admins can edit prompts LIVE
 * via /admin#prompt-templates without rebuilding the container.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-prompts-db-editable.md
 * State: docs/superpowers/state/db-prompts-rip-state.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RbacSystemPromptService,
  RBAC_PROMPT_INVALIDATE_CHANNEL,
  __resetRbacPromptCacheForTests,
  type RbacRedisLike,
} from '../RbacSystemPromptService.js';
import { seedRbacSystemPromptsFromFiles } from '../seedRbacSystemPrompts.js';

function makeMockRedis(): RbacRedisLike & {
  publishCalls: Array<{ channel: string; message: string }>;
  subscribers: Map<string, Array<(message: string) => void | Promise<void>>>;
  emit: (channel: string, message: string) => Promise<void>;
} {
  const publishCalls: Array<{ channel: string; message: string }> = [];
  const subscribers = new Map<string, Array<(message: string) => void | Promise<void>>>();
  return {
    async publish(channel: string, message: string) {
      publishCalls.push({ channel, message });
      return 1;
    },
    async subscribe(channel, callback) {
      const list = subscribers.get(channel) ?? [];
      list.push(callback);
      subscribers.set(channel, list);
    },
    async emit(channel: string, message: string) {
      for (const cb of subscribers.get(channel) ?? []) {
        await cb(message);
      }
    },
    publishCalls,
    subscribers,
  };
}

// In-memory mock prisma — only the methods the service+seeder touch.
function makeMockPrisma() {
  const rows: Array<{
    id: string;
    role_key: string;
    body: string;
    version: number;
    is_active: boolean;
    description?: string | null;
    created_at: Date;
    updated_at: Date;
  }> = [];
  const audits: Array<{
    id: string;
    prompt_id: string;
    role_key: string;
    action: string;
    before_body: string | null;
    after_body: string;
    before_version: number | null;
    after_version: number;
    actor_user_id: string | null;
    reason: string | null;
    created_at: Date;
  }> = [];
  let idCounter = 0;
  const nextId = () => `mock-${++idCounter}`;

  const rbacSystemPrompt = {
    findFirst: vi.fn(async (args: any) => {
      const where = args?.where ?? {};
      const matches = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      );
      if (args?.orderBy?.version === 'desc') {
        matches.sort((a, b) => b.version - a.version);
      }
      return matches[0] ?? null;
    }),
    findMany: vi.fn(async (args: any) => {
      const where = args?.where ?? {};
      let matches = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      );
      if (args?.orderBy?.version === 'desc') {
        matches = [...matches].sort((a, b) => b.version - a.version);
      }
      return matches;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: nextId(),
        role_key: data.role_key,
        body: data.body,
        version: data.version ?? 1,
        is_active: data.is_active ?? true,
        description: data.description ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) {
        if (Object.entries(where).every(([k, v]) => (r as any)[k] === v)) {
          Object.assign(r, data, { updated_at: new Date() });
          count++;
        }
      }
      return { count };
    }),
  };

  const rbacSystemPromptAudit = {
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: nextId(),
        prompt_id: data.prompt_id,
        role_key: data.role_key,
        action: data.action,
        before_body: data.before_body ?? null,
        after_body: data.after_body,
        before_version: data.before_version ?? null,
        after_version: data.after_version,
        actor_user_id: data.actor_user_id ?? null,
        reason: data.reason ?? null,
        created_at: new Date(),
      };
      audits.push(row);
      return row;
    }),
    findMany: vi.fn(async (args: any) => {
      const where = args?.where ?? {};
      return audits.filter((a) =>
        Object.entries(where).every(([k, v]) => (a as any)[k] === v),
      );
    }),
  };

  return {
    rbacSystemPrompt,
    rbacSystemPromptAudit,
    $transaction: async (fn: (tx: any) => Promise<any>) =>
      fn({ rbacSystemPrompt, rbacSystemPromptAudit }),
    __rows: rows,
    __audits: audits,
  };
}

describe('RbacSystemPromptService — DB-backed RBAC system prompts', () => {
  beforeEach(() => __resetRbacPromptCacheForTests());

  describe('getActiveTemplate', () => {
    it('queries by role_key + is_active=true and returns the highest-version row body', async () => {
      const mock = makeMockPrisma();
      mock.__rows.push(
        {
          id: 'a-1',
          role_key: 'admin',
          body: 'old admin body',
          version: 1,
          is_active: false,
          description: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'a-2',
          role_key: 'admin',
          body: 'current admin body',
          version: 2,
          is_active: true,
          description: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      );

      const svc = new RbacSystemPromptService(mock as any);
      const body = await svc.getActiveTemplate('admin');

      expect(body).toBe('current admin body');
      expect(mock.rbacSystemPrompt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role_key: 'admin', is_active: true },
          orderBy: { version: 'desc' },
        }),
      );
    });

    it('throws when no active row exists for the role', async () => {
      const mock = makeMockPrisma();
      const svc = new RbacSystemPromptService(mock as any);
      await expect(svc.getActiveTemplate('admin')).rejects.toThrow(
        /no active rbac_system_prompt for role/i,
      );
    });

    it('rejects unknown roles', async () => {
      const mock = makeMockPrisma();
      const svc = new RbacSystemPromptService(mock as any);
      await expect(
        // @ts-expect-error — runtime guard test
        svc.getActiveTemplate('superuser'),
      ).rejects.toThrow(/unknown role/i);
    });

    it('caches the body in-process so repeated reads hit memory not DB', async () => {
      const mock = makeMockPrisma();
      mock.__rows.push({
        id: 'a-1',
        role_key: 'admin',
        body: 'cached body',
        version: 1,
        is_active: true,
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const svc = new RbacSystemPromptService(mock as any);

      await svc.getActiveTemplate('admin');
      await svc.getActiveTemplate('admin');
      await svc.getActiveTemplate('admin');

      expect(mock.rbacSystemPrompt.findFirst).toHaveBeenCalledTimes(1);
    });

    it('invalidate(role) drops the cached entry so the next read hits DB', async () => {
      const mock = makeMockPrisma();
      mock.__rows.push({
        id: 'a-1',
        role_key: 'admin',
        body: 'first',
        version: 1,
        is_active: true,
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const svc = new RbacSystemPromptService(mock as any);

      await svc.getActiveTemplate('admin');
      svc.invalidate('admin');
      await svc.getActiveTemplate('admin');

      expect(mock.rbacSystemPrompt.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('setActiveTemplate', () => {
    it('on first save: creates v1 row + audit row with action=create', async () => {
      const mock = makeMockPrisma();
      const svc = new RbacSystemPromptService(mock as any);

      await svc.setActiveTemplate('admin', 'first body', {
        actorUserId: 'user-1',
        reason: 'initial seed',
      });

      expect(mock.__rows).toHaveLength(1);
      expect(mock.__rows[0]).toMatchObject({
        role_key: 'admin',
        body: 'first body',
        version: 1,
        is_active: true,
      });
      expect(mock.__audits).toHaveLength(1);
      expect(mock.__audits[0]).toMatchObject({
        role_key: 'admin',
        action: 'create',
        after_body: 'first body',
        after_version: 1,
        actor_user_id: 'user-1',
        reason: 'initial seed',
        before_body: null,
        before_version: null,
      });
    });

    it('on subsequent save: deactivates prior, inserts v+1, writes update audit with before/after', async () => {
      const mock = makeMockPrisma();
      const svc = new RbacSystemPromptService(mock as any);

      await svc.setActiveTemplate('admin', 'v1 body', { actorUserId: 'user-1' });
      svc.invalidate('admin');
      await svc.setActiveTemplate('admin', 'v2 body', {
        actorUserId: 'user-2',
        reason: 'tightened tool-use directive',
      });

      const sorted = [...mock.__rows].sort((a, b) => a.version - b.version);
      expect(sorted).toHaveLength(2);
      expect(sorted[0]).toMatchObject({ version: 1, is_active: false });
      expect(sorted[1]).toMatchObject({ version: 2, is_active: true, body: 'v2 body' });

      expect(mock.__audits).toHaveLength(2);
      expect(mock.__audits[1]).toMatchObject({
        action: 'update',
        before_body: 'v1 body',
        after_body: 'v2 body',
        before_version: 1,
        after_version: 2,
        actor_user_id: 'user-2',
        reason: 'tightened tool-use directive',
      });
    });

    it('busts the cache so the next getActiveTemplate sees the new body', async () => {
      const mock = makeMockPrisma();
      const svc = new RbacSystemPromptService(mock as any);

      await svc.setActiveTemplate('admin', 'v1', { actorUserId: 'u' });
      const before = await svc.getActiveTemplate('admin');
      await svc.setActiveTemplate('admin', 'v2', { actorUserId: 'u' });
      const after = await svc.getActiveTemplate('admin');

      expect(before).toBe('v1');
      expect(after).toBe('v2');
    });
  });

  describe('listVersions / rollback', () => {
    it('listVersions returns all rows for the role ordered desc', async () => {
      const mock = makeMockPrisma();
      const svc = new RbacSystemPromptService(mock as any);
      await svc.setActiveTemplate('admin', 'v1', { actorUserId: 'u' });
      svc.invalidate('admin');
      await svc.setActiveTemplate('admin', 'v2', { actorUserId: 'u' });

      const versions = await svc.listVersions('admin');
      expect(versions.map((v) => v.version)).toEqual([2, 1]);
      expect(versions[0]).toMatchObject({ is_active: true });
      expect(versions[1]).toMatchObject({ is_active: false });
    });

    it('rollback(role, targetVersion) deactivates current, reactivates target, writes rollback audit', async () => {
      const mock = makeMockPrisma();
      const svc = new RbacSystemPromptService(mock as any);
      await svc.setActiveTemplate('admin', 'v1', { actorUserId: 'u' });
      svc.invalidate('admin');
      await svc.setActiveTemplate('admin', 'v2', { actorUserId: 'u' });

      await svc.rollback('admin', 1, { actorUserId: 'u', reason: 'regression' });

      const v1 = mock.__rows.find((r) => r.version === 1)!;
      const v2 = mock.__rows.find((r) => r.version === 2)!;
      expect(v1.is_active).toBe(true);
      expect(v2.is_active).toBe(false);

      const last = mock.__audits[mock.__audits.length - 1];
      expect(last).toMatchObject({
        action: 'rollback',
        before_version: 2,
        after_version: 1,
        before_body: 'v2',
        after_body: 'v1',
        reason: 'regression',
      });
    });
  });
});

describe('Redis pubsub invalidation (P-Live-3)', () => {
  beforeEach(() => __resetRbacPromptCacheForTests());

  it('setActiveTemplate publishes a JSON {role_key, ts} payload on the prompt:invalidate channel after success', async () => {
    const mockPrisma = makeMockPrisma();
    const mockRedis = makeMockRedis();
    const svc = new RbacSystemPromptService(mockPrisma as any, mockRedis);

    await svc.setActiveTemplate('admin', 'first body', { actorUserId: 'u' });

    expect(mockRedis.publishCalls).toHaveLength(1);
    expect(mockRedis.publishCalls[0].channel).toBe(RBAC_PROMPT_INVALIDATE_CHANNEL);
    const payload = JSON.parse(mockRedis.publishCalls[0].message);
    expect(payload.role_key).toBe('admin');
    expect(typeof payload.ts).toBe('number');
  });

  it('rollback publishes invalidation on the same channel', async () => {
    const mockPrisma = makeMockPrisma();
    const mockRedis = makeMockRedis();
    const svc = new RbacSystemPromptService(mockPrisma as any, mockRedis);

    await svc.setActiveTemplate('admin', 'v1', { actorUserId: 'u' });
    svc.invalidate('admin');
    await svc.setActiveTemplate('admin', 'v2', { actorUserId: 'u' });
    mockRedis.publishCalls.length = 0;
    await svc.rollback('admin', 1, { actorUserId: 'u', reason: 'regression' });

    expect(mockRedis.publishCalls.length).toBeGreaterThanOrEqual(1);
    expect(mockRedis.publishCalls[0].channel).toBe(RBAC_PROMPT_INVALIDATE_CHANNEL);
    expect(JSON.parse(mockRedis.publishCalls[0].message).role_key).toBe('admin');
  });

  it('subscribeInvalidations registers a handler and incoming role_key=admin payload busts the cache', async () => {
    const mockPrisma = makeMockPrisma();
    const mockRedis = makeMockRedis();
    mockPrisma.__rows.push({
      id: 'a',
      role_key: 'admin',
      body: 'cached',
      version: 1,
      is_active: true,
      description: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const svc = new RbacSystemPromptService(mockPrisma as any, mockRedis);

    await svc.subscribeInvalidations();
    await svc.getActiveTemplate('admin');
    expect(mockPrisma.rbacSystemPrompt.findFirst).toHaveBeenCalledTimes(1);

    await mockRedis.emit(
      RBAC_PROMPT_INVALIDATE_CHANNEL,
      JSON.stringify({ role_key: 'admin', ts: Date.now() }),
    );

    await svc.getActiveTemplate('admin');
    expect(mockPrisma.rbacSystemPrompt.findFirst).toHaveBeenCalledTimes(2);
  });

  it('subscribeInvalidations ignores malformed payloads without throwing', async () => {
    const mockPrisma = makeMockPrisma();
    const mockRedis = makeMockRedis();
    const svc = new RbacSystemPromptService(mockPrisma as any, mockRedis);

    await svc.subscribeInvalidations();

    await expect(mockRedis.emit(RBAC_PROMPT_INVALIDATE_CHANNEL, 'not-json')).resolves.toBeUndefined();
    await expect(
      mockRedis.emit(RBAC_PROMPT_INVALIDATE_CHANNEL, JSON.stringify({ wrong_key: 'x' })),
    ).resolves.toBeUndefined();
    await expect(
      mockRedis.emit(RBAC_PROMPT_INVALIDATE_CHANNEL, JSON.stringify({ role_key: 'pirate' })),
    ).resolves.toBeUndefined();
  });

  it('publish failure does not break setActiveTemplate (cache is fall-back via TTL)', async () => {
    const mockPrisma = makeMockPrisma();
    const flakyRedis: RbacRedisLike = {
      async publish() {
        throw new Error('redis down');
      },
      async subscribe() {
        // noop
      },
    };
    const svc = new RbacSystemPromptService(mockPrisma as any, flakyRedis);

    await expect(
      svc.setActiveTemplate('admin', 'body', { actorUserId: 'u' }),
    ).resolves.toBeDefined();
    expect(mockPrisma.__rows).toHaveLength(1);
  });

  it('without redis dependency: setActiveTemplate works (single-replica deploys)', async () => {
    const mockPrisma = makeMockPrisma();
    const svc = new RbacSystemPromptService(mockPrisma as any);

    await expect(
      svc.setActiveTemplate('admin', 'body', { actorUserId: 'u' }),
    ).resolves.toBeDefined();
  });
});

describe('seedRbacSystemPromptsFromFiles', () => {
  it('on empty DB: reads chat-system-admin.md + chat-system-member.md and inserts both as v1 active', async () => {
    const mock = makeMockPrisma();

    const result = await seedRbacSystemPromptsFromFiles(mock as any);

    expect(result.created).toEqual(['admin', 'member']);
    expect(result.skipped).toEqual([]);
    expect(mock.__rows).toHaveLength(2);

    const admin = mock.__rows.find((r) => r.role_key === 'admin')!;
    const member = mock.__rows.find((r) => r.role_key === 'member')!;
    expect(admin.version).toBe(1);
    expect(admin.is_active).toBe(true);
    // The seeded admin body is the verbatim content of chat-system-admin.md.
    expect(admin.body).toMatch(/^You are OpenAgentic.*platform administrator/);
    expect(admin.body.length).toBeGreaterThan(500);
    expect(member.body).toMatch(/^You are OpenAgentic/);
    expect(member.body).not.toBe(admin.body);
  });

  it('idempotent: already-seeded role is skipped, not duplicated', async () => {
    const mock = makeMockPrisma();
    mock.__rows.push({
      id: 'a-1',
      role_key: 'admin',
      body: 'pre-existing admin body',
      version: 1,
      is_active: true,
      description: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const result = await seedRbacSystemPromptsFromFiles(mock as any);

    expect(result.skipped).toContain('admin');
    expect(result.created).toContain('member');
    expect(mock.__rows.filter((r) => r.role_key === 'admin')).toHaveLength(1);
    expect(mock.__rows.find((r) => r.role_key === 'admin')!.body).toBe(
      'pre-existing admin body',
    );
  });

  it('writes a create-audit row for each freshly seeded role', async () => {
    const mock = makeMockPrisma();

    await seedRbacSystemPromptsFromFiles(mock as any);

    expect(mock.__audits).toHaveLength(2);
    expect(mock.__audits.map((a) => a.role_key).sort()).toEqual(['admin', 'member']);
    expect(mock.__audits.every((a) => a.action === 'create')).toBe(true);
    expect(mock.__audits.every((a) => a.actor_user_id === null)).toBe(true);
    expect(mock.__audits.every((a) => a.reason === 'bootstrap-from-file')).toBe(true);
  });
});
