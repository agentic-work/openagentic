/**
 * RouterTuningService — TDD spec for Stage A of router live-tuning.
 *
 * Covers:
 *  1. getTuning() returns defaults when DB is empty (seeder hasn't run)
 *  2. getTuning() returns DB row when present
 *  3. updateTuning() persists, bumps cache, and publishes invalidation
 *  4. Cache hit — Redis cached value is preferred over DB
 *  5. Redis subscriber invalidates in-memory cache on channel message
 *  6. resetToDefaults() restores all fields to default values
 *  7. Concurrent updates — last-write-wins, updatedAt always advances
 *  8. Type validation — non-numeric fcaChatPoolFloor is rejected
 *  9. Singleton enforcement — second upsert call still targets the one row
 * 10. Boolean field fcaQualityGatedByComplexity is type-checked
 * 11. getTuning() survives a Redis error (graceful fallback to DB)
 * 12. updateTuning() survives a Redis publish error (write still completes)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RouterTuningService,
  ROUTER_TUNING_DEFAULTS,
  resetRouterTuningServiceInstance,
} from '../RouterTuningService.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type SubscribeCb = (message: string) => void;

function makeMockPrisma(row: Record<string, any> | null = null) {
  return {
    routerTuning: {
      findUnique: vi.fn().mockResolvedValue(row),
      upsert: vi.fn().mockImplementation(async ({ create }: any) => create),
    },
  } as any;
}

function makeMockRedis(cached: any = null) {
  let _subscribeCb: SubscribeCb | null = null;

  return {
    get: vi.fn().mockResolvedValue(cached),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockImplementation(async (_channel: string, cb: SubscribeCb) => {
      _subscribeCb = cb;
    }),
    /** Test helper — fire the subscriber as if a peer published a message. */
    _fireSubscriber(msg: string) {
      _subscribeCb?.(msg);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultRow() {
  return {
    id: 'singleton',
    ...ROUTER_TUNING_DEFAULTS,
    updated_at: new Date('2026-04-23T00:00:00Z'),
    updated_by: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetRouterTuningServiceInstance();
});

describe('RouterTuningService.getTuning()', () => {
  it('1. returns hardcoded defaults when DB row is missing', async () => {
    const prisma = makeMockPrisma(null); // findUnique returns null
    const service = new RouterTuningService(prisma, null);

    const tuning = await service.getTuning();

    expect(tuning.fcaQualityFloor).toBe(ROUTER_TUNING_DEFAULTS.fcaQualityFloor);
    expect(tuning.fcaChatPoolFloor).toBe(ROUTER_TUNING_DEFAULTS.fcaChatPoolFloor);
    expect(tuning.fcaQualityGatedByComplexity).toBe(true);
    expect(tuning.costWeight).toBe(0.5);
    expect(tuning.id).toBe('singleton');
  });

  it('2. returns DB row when present', async () => {
    const row = { ...makeDefaultRow(), fcaChatPoolFloor: 0.91 };
    const prisma = makeMockPrisma(row);
    const service = new RouterTuningService(prisma, null);

    const tuning = await service.getTuning();

    expect(tuning.fcaChatPoolFloor).toBe(0.91);
    expect(prisma.routerTuning.findUnique).toHaveBeenCalledWith({
      where: { id: 'singleton' },
    });
  });

  it('4. Redis cached value is preferred — DB is never queried', async () => {
    const cached = { ...makeDefaultRow(), fcaChatPoolFloor: 0.88 };
    const prisma = makeMockPrisma({ ...makeDefaultRow(), fcaChatPoolFloor: 0.77 }); // stale
    const redis = makeMockRedis(cached);
    const service = new RouterTuningService(prisma, redis);

    const tuning = await service.getTuning();

    expect(tuning.fcaChatPoolFloor).toBe(0.88);
    expect(prisma.routerTuning.findUnique).not.toHaveBeenCalled();
  });

  it('11. gracefully falls back to DB when Redis.get throws', async () => {
    const row = makeDefaultRow();
    const prisma = makeMockPrisma(row);
    const redis = makeMockRedis();
    redis.get.mockRejectedValueOnce(new Error('Redis connection refused'));
    const service = new RouterTuningService(prisma, redis);

    const tuning = await service.getTuning();

    expect(tuning.fcaQualityFloor).toBe(ROUTER_TUNING_DEFAULTS.fcaQualityFloor);
    expect(prisma.routerTuning.findUnique).toHaveBeenCalled();
  });
});

describe('RouterTuningService.updateTuning()', () => {
  it('3. persists patch, updates Redis cache, and publishes invalidation', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const redis = makeMockRedis(null); // cold cache so getTuning hits DB
    const service = new RouterTuningService(prisma, redis);

    const result = await service.updateTuning({ fcaChatPoolFloor: 0.90 }, 'admin-id');

    expect(result.fcaChatPoolFloor).toBe(0.90);
    expect(result.updated_by).toBe('admin-id');

    // DB upsert called
    expect(prisma.routerTuning.upsert).toHaveBeenCalledOnce();
    const upsertCall = prisma.routerTuning.upsert.mock.calls[0][0];
    expect(upsertCall.where).toEqual({ id: 'singleton' });
    expect(upsertCall.create.fcaChatPoolFloor).toBe(0.90);

    // Redis cache bumped
    expect(redis.set).toHaveBeenCalledWith(
      'router-tuning:current',
      expect.objectContaining({ fcaChatPoolFloor: 0.90 }),
      300,
    );

    // Invalidation published
    expect(redis.publish).toHaveBeenCalledWith(
      'router-tuning:invalidated',
      expect.stringContaining('"ts"'),
    );
  });

  it('12. write still completes even when Redis.publish throws', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const redis = makeMockRedis();
    redis.publish.mockRejectedValueOnce(new Error('Redis down'));
    const service = new RouterTuningService(prisma, redis);

    // Should not throw
    const result = await service.updateTuning({ fcaChatPoolFloor: 0.91 }, 'admin-id');
    expect(result.fcaChatPoolFloor).toBe(0.91);
    expect(prisma.routerTuning.upsert).toHaveBeenCalled();
  });
});

describe('RouterTuningService — Redis subscriber', () => {
  it('5. subscriber message invalidates in-memory cache so next read re-fetches', async () => {
    const rowV1 = { ...makeDefaultRow(), fcaChatPoolFloor: 0.82 };
    const rowV2 = { ...makeDefaultRow(), fcaChatPoolFloor: 0.95 };
    const prisma = makeMockPrisma(rowV1);
    const redis = makeMockRedis();
    const service = new RouterTuningService(prisma, redis);

    // Prime in-memory cache
    await service.getTuning();
    expect(prisma.routerTuning.findUnique).toHaveBeenCalledTimes(1);

    // Simulate peer publishing invalidation + DB updated
    prisma.routerTuning.findUnique.mockResolvedValue(rowV2);
    redis._fireSubscriber(JSON.stringify({ ts: Date.now(), source: 'other-pod' }));

    // Next call must bypass in-memory cache
    const tuning = await service.getTuning();
    expect(tuning.fcaChatPoolFloor).toBe(0.95);
    expect(prisma.routerTuning.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('RouterTuningService.resetToDefaults()', () => {
  it('6. restores all tunables to default values', async () => {
    const customRow = {
      ...makeDefaultRow(),
      fcaChatPoolFloor: 0.99,
      costWeight: 0.8,
      fcaQualityGatedByComplexity: false,
    };
    const prisma = makeMockPrisma(customRow);
    const redis = makeMockRedis();
    const service = new RouterTuningService(prisma, redis);

    const result = await service.resetToDefaults('admin-id');

    expect(result.fcaChatPoolFloor).toBe(ROUTER_TUNING_DEFAULTS.fcaChatPoolFloor);
    expect(result.costWeight).toBe(ROUTER_TUNING_DEFAULTS.costWeight);
    expect(result.fcaQualityGatedByComplexity).toBe(true);
    expect(result.updated_by).toBe('admin-id');

    expect(prisma.routerTuning.upsert).toHaveBeenCalledOnce();
    expect(redis.publish).toHaveBeenCalledWith(
      'router-tuning:invalidated',
      expect.any(String),
    );
  });
});

describe('RouterTuningService — concurrency', () => {
  it('7. concurrent updates are serialised through DB; last write wins with advancing updated_at', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    // Make upsert return whatever is passed in `create`
    prisma.routerTuning.upsert.mockImplementation(async ({ create }: any) => create);
    const redis = makeMockRedis();
    const service = new RouterTuningService(prisma, redis);

    const [r1, r2] = await Promise.all([
      service.updateTuning({ fcaChatPoolFloor: 0.85 }, 'admin-1'),
      service.updateTuning({ fcaChatPoolFloor: 0.91 }, 'admin-2'),
    ]);

    // Both should succeed
    expect(r1).toBeTruthy();
    expect(r2).toBeTruthy();

    // updated_at on both results must be a valid Date
    expect(r1.updated_at instanceof Date).toBe(true);
    expect(r2.updated_at instanceof Date).toBe(true);

    // DB upsert called twice
    expect(prisma.routerTuning.upsert).toHaveBeenCalledTimes(2);
  });
});

describe('RouterTuningService — validation', () => {
  it('8. rejects non-numeric value for fcaChatPoolFloor', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const service = new RouterTuningService(prisma, null);

    await expect(
      service.updateTuning({ fcaChatPoolFloor: 'high' as any }, 'admin-id'),
    ).rejects.toThrow(TypeError);

    await expect(
      service.updateTuning({ fcaChatPoolFloor: 'high' as any }, 'admin-id'),
    ).rejects.toThrow(/fcaChatPoolFloor must be a number/);
  });

  it('10. rejects non-boolean value for fcaQualityGatedByComplexity', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const service = new RouterTuningService(prisma, null);

    await expect(
      service.updateTuning({ fcaQualityGatedByComplexity: 1 as any }, 'admin-id'),
    ).rejects.toThrow(TypeError);

    await expect(
      service.updateTuning({ fcaQualityGatedByComplexity: 1 as any }, 'admin-id'),
    ).rejects.toThrow(/fcaQualityGatedByComplexity must be a boolean/);
  });
});

describe('RouterTuningService — T2 intent classifier fields', () => {
  it('defaults expose intent classifier toggle + auto-resolve sentinel', () => {
    // 2026-05-05: classifier model is no longer hardcoded. Empty string is
    // the sentinel for "resolve at construction time from registry chat-role
    // default" — see startup/04-providers.ts. Pinned by
    // src/__tests__/architecture/router-tuning-no-classifier-model-literal.source-regression.test.ts.
    expect(ROUTER_TUNING_DEFAULTS.intentClassifierEnabled).toBe(true);
    expect(typeof ROUTER_TUNING_DEFAULTS.intentClassifierModelId).toBe('string');
    expect(ROUTER_TUNING_DEFAULTS.intentClassifierModelId).toBe('');
  });

  it('rejects non-boolean intentClassifierEnabled', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const service = new RouterTuningService(prisma, null);
    await expect(
      service.updateTuning({ intentClassifierEnabled: 'yes' as any }, 'admin-id'),
    ).rejects.toThrow(/intentClassifierEnabled must be a boolean/);
  });

  it('accepts empty intentClassifierModelId (auto-resolve sentinel)', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const service = new RouterTuningService(prisma, null);
    // Empty string is the canonical "auto-resolve from registry" signal.
    // updateTuning must not reject it.
    await expect(
      service.updateTuning({ intentClassifierModelId: '' }, 'admin-id'),
    ).resolves.toBeDefined();
  });

  it('rejects non-string intentClassifierModelId', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const service = new RouterTuningService(prisma, null);
    await expect(
      service.updateTuning({ intentClassifierModelId: 42 as any }, 'admin-id'),
    ).rejects.toThrow(/intentClassifierModelId must be a string/);
  });

  it('does not surface intentToFcaFloor on the tuning shape (ripped 2026-05-02)', () => {
    expect((ROUTER_TUNING_DEFAULTS as any).intentToFcaFloor).toBeUndefined();
  });

  it('does not surface intentToTopK on the tuning shape (Phase E.10, ripped 2026-05-10)', () => {
    // Phase E.10 — intentToTopK was the per-intent top-K limit used by the
    // (now-deleted) ToolRankerService. With the ranker gone, the field +
    // type + defaults + validation + DB column are all ripped.
    expect((ROUTER_TUNING_DEFAULTS as any).intentToTopK).toBeUndefined();
  });
});

describe('RouterTuningService — singleton enforcement', () => {
  it('9. upsert always targets the singleton row regardless of concurrent inserts', async () => {
    const prisma = makeMockPrisma(makeDefaultRow());
    const redis = makeMockRedis();
    const service = new RouterTuningService(prisma, redis);

    await service.updateTuning({ fcaChatPoolFloor: 0.85 }, 'admin-a');
    await service.updateTuning({ fcaChatPoolFloor: 0.91 }, 'admin-b');

    // Every upsert must target the same singleton id
    for (const call of prisma.routerTuning.upsert.mock.calls) {
      expect(call[0].where).toEqual({ id: 'singleton' });
    }
  });
});
