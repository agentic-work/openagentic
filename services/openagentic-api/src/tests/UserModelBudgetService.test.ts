/**
 * Tests for UserModelBudgetService (2026-04-19 slider-replacement).
 *
 * Invariants the tests lock in:
 *   - uncapped users pass freely (capCents === null)
 *   - exhausted caps produce ALLOWED=false with reason + suggested
 *     alternative registered models ordered by remaining headroom desc
 *   - cap of 0 explicitly blocks (no "unlimited == 0" footgun)
 *   - read-side failures fail OPEN (treat as $0 spend) so a transient
 *     DB outage can't accidentally block every request
 *   - write-side creates or updates the user_permissions row correctly
 *   - period windows are calendar months anchored to the 1st
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { UserModelBudgetService } from '../services/UserModelBudgetService';

const silentLogger = pino({ level: 'silent' });

function fakePrisma() {
  const state: {
    perms: { user_id: string; metadata: any } | null;
    // mirrors the real LLMUsageAggregate schema: snake_case columns,
    // total_cost is dollars (Decimal in prod; number here).
    usage: Array<{
      user_id: string;
      model: string;
      period_start: Date;
      total_cost: number;
    }>;
  } = { perms: null, usage: [] };

  const prisma = {
    userPermissions: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (state.perms && state.perms.user_id === where.user_id) {
          return state.perms;
        }
        return null;
      }),
      update: vi.fn(async ({ data }: any) => {
        if (state.perms) state.perms = { ...state.perms, ...data };
        return state.perms;
      }),
      create: vi.fn(async ({ data }: any) => {
        state.perms = { user_id: data.user_id, metadata: data.metadata };
        return state.perms;
      }),
    },
    lLMUsageAggregate: {
      findMany: vi.fn(async ({ where }: any) => {
        return state.usage
          .filter(
            (u) =>
              u.user_id === where.user_id &&
              u.model === where.model &&
              u.period_start >= where.period_start.gte,
          )
          .map((u) => ({ total_cost: u.total_cost }));
      }),
    },
  } as any;

  return { prisma, state };
}

describe('UserModelBudgetService.getAllBudgetsForUser', () => {
  it('returns empty list when no user_permissions row exists', async () => {
    const { prisma } = fakePrisma();
    const svc = new UserModelBudgetService(prisma, silentLogger);
    expect(await svc.getAllBudgetsForUser('u1')).toEqual([]);
  });

  it('returns empty list when metadata is null', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = { user_id: 'u1', metadata: null };
    const svc = new UserModelBudgetService(prisma, silentLogger);
    expect(await svc.getAllBudgetsForUser('u1')).toEqual([]);
  });

  it('unwraps per-model caps from metadata.modelBudgets', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = {
      user_id: 'u1',
      metadata: { modelBudgets: { 'model-a': 10000, 'model-b': null, 'model-c': 0 } },
    };
    const svc = new UserModelBudgetService(prisma, silentLogger);
    const rows = await svc.getAllBudgetsForUser('u1');
    expect(rows).toEqual(
      expect.arrayContaining([
        { model_id: 'model-a', monthly_cap_cents: 10000 },
        { model_id: 'model-b', monthly_cap_cents: null },
        { model_id: 'model-c', monthly_cap_cents: 0 },
      ]),
    );
    expect(rows.length).toBe(3);
  });

  it('fails-open (empty list) when Prisma throws', async () => {
    const { prisma } = fakePrisma();
    prisma.userPermissions.findUnique.mockRejectedValueOnce(new Error('db down'));
    const svc = new UserModelBudgetService(prisma, silentLogger);
    expect(await svc.getAllBudgetsForUser('u1')).toEqual([]);
  });
});

describe('UserModelBudgetService.getSpendForModel', () => {
  it('sums matching LLMUsageAggregate rows for the period (dollars → cents on read)', async () => {
    const { prisma, state } = fakePrisma();
    const periodStart = new Date(2026, 3, 1);
    // total_cost stored as dollars in prod; service converts to cents.
    state.usage.push(
      { user_id: 'u1', model: 'claude', period_start: new Date(2026, 3, 5), total_cost: 12.0 },
      { user_id: 'u1', model: 'claude', period_start: new Date(2026, 3, 10), total_cost: 3.0 },
      { user_id: 'u1', model: 'gpt', period_start: new Date(2026, 3, 6), total_cost: 99.99 },
      { user_id: 'u2', model: 'claude', period_start: new Date(2026, 3, 6), total_cost: 99.99 },
    );
    const svc = new UserModelBudgetService(prisma, silentLogger);
    expect(await svc.getSpendForModel('u1', 'claude', periodStart)).toBe(1500);
  });

  it('returns 0 (fail-open) when Prisma throws on read', async () => {
    const { prisma } = fakePrisma();
    prisma.lLMUsageAggregate.findMany.mockRejectedValueOnce(new Error('db transient'));
    const svc = new UserModelBudgetService(prisma, silentLogger);
    expect(await svc.getSpendForModel('u1', 'm', new Date())).toBe(0);
  });
});

describe('UserModelBudgetService.getCurrentPeriodStart / getCurrentPeriodEnd', () => {
  it('anchors to the 1st of the calendar month', () => {
    const svc = new UserModelBudgetService(fakePrisma().prisma, silentLogger);
    const anchor = new Date(2026, 3, 19, 14, 30, 0); // Apr 19 2026 14:30
    const start = svc.getCurrentPeriodStart(anchor);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    const end = svc.getCurrentPeriodEnd(start);
    expect(end.getMonth()).toBe(4);
    expect(end.getDate()).toBe(1);
  });
});

describe('UserModelBudgetService.check', () => {
  it('allows an uncapped user', async () => {
    const { prisma } = fakePrisma();
    const svc = new UserModelBudgetService(prisma, silentLogger);
    const out = await svc.check('u1', 'claude');
    expect(out.allowed).toBe(true);
    expect(out.status.capCents).toBeNull();
  });

  it('allows a user with cap but spend < cap', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = { user_id: 'u1', metadata: { modelBudgets: { claude: 10000 } } };
    state.usage.push({
      user_id: 'u1',
      model: 'claude',
      period_start: new Date(),
      total_cost: 30.0,
    });
    const svc = new UserModelBudgetService(prisma, silentLogger);
    const out = await svc.check('u1', 'claude');
    expect(out.allowed).toBe(true);
    expect(out.status.exhausted).toBe(false);
    expect(out.status.remainingCents).toBe(7000);
  });

  it('denies when spend meets or exceeds cap, suggests alternatives with headroom', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = {
      user_id: 'u1',
      metadata: {
        modelBudgets: {
          claude: 1000,
          gpt: 5000,
          haiku: null, // unlimited
          qwen: 500,
        },
      },
    };
    state.usage.push(
      { user_id: 'u1', model: 'claude', period_start: new Date(), total_cost: 12.0 }, // over
      { user_id: 'u1', model: 'gpt', period_start: new Date(), total_cost: 1.0 }, // plenty
      { user_id: 'u1', model: 'qwen', period_start: new Date(), total_cost: 4.0 }, // little
    );
    const svc = new UserModelBudgetService(prisma, silentLogger);
    const out = await svc.check('u1', 'claude');
    expect(out.allowed).toBe(false);
    expect(out.status.exhausted).toBe(true);
    // Haiku (unlimited) ranks first, gpt ($49 left) next, qwen ($1 left) last.
    expect(out.alternatives).toEqual(['haiku', 'gpt', 'qwen']);
    expect(out.reason).toContain('Monthly budget exhausted');
  });

  it('treats a 0 cap as explicitly blocked', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = { user_id: 'u1', metadata: { modelBudgets: { claude: 0 } } };
    const svc = new UserModelBudgetService(prisma, silentLogger);
    const out = await svc.check('u1', 'claude');
    expect(out.allowed).toBe(false);
  });

  it('excludes a 0-cap sibling from the alternatives list', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = {
      user_id: 'u1',
      metadata: { modelBudgets: { claude: 100, gpt: 0, haiku: 5000 } },
    };
    state.usage.push({
      user_id: 'u1',
      model: 'claude',
      period_start: new Date(),
      total_cost: 1.0,
    });
    const svc = new UserModelBudgetService(prisma, silentLogger);
    const out = await svc.check('u1', 'claude');
    expect(out.allowed).toBe(false);
    expect(out.alternatives).not.toContain('gpt');
    expect(out.alternatives).toContain('haiku');
  });
});

describe('UserModelBudgetService.setBudget', () => {
  it('creates a user_permissions row when none exists', async () => {
    const { prisma, state } = fakePrisma();
    const svc = new UserModelBudgetService(prisma, silentLogger);
    await svc.setBudget('u1', 'claude', 10000);
    expect(state.perms).not.toBeNull();
    expect((state.perms as any).metadata.modelBudgets.claude).toBe(10000);
  });

  it('merges with existing modelBudgets instead of overwriting siblings', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = { user_id: 'u1', metadata: { modelBudgets: { gpt: 2000 } } };
    const svc = new UserModelBudgetService(prisma, silentLogger);
    await svc.setBudget('u1', 'claude', 5000);
    expect((state.perms as any).metadata.modelBudgets).toEqual({
      gpt: 2000,
      claude: 5000,
    });
  });

  it('supports explicit unlimited via null', async () => {
    const { prisma, state } = fakePrisma();
    state.perms = { user_id: 'u1', metadata: { modelBudgets: { claude: 100 } } };
    const svc = new UserModelBudgetService(prisma, silentLogger);
    await svc.setBudget('u1', 'claude', null);
    expect((state.perms as any).metadata.modelBudgets.claude).toBeNull();
  });
});
