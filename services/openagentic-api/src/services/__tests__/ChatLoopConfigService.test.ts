/**
 * ChatLoopConfigService — TDD spec.
 *
 * Knobs stored in SystemConfiguration table under namespaced keys
 * `chat_loop.*`. First knob is `max_turns` (the Sev-1 surfaced by the
 * 2026-05-11 multi-cloud capstone: gpt-5.4 hit `max-turns cap (12)`
 * during cascade discovery + 32-tool fanout).
 *
 * Pattern mirrors WebhookSecurityService — load on first access,
 * Redis-cache, fall back to DB, seed default on miss. The shape is
 * future-proofed so adding more knobs (per_tool_timeout_ms,
 * max_parallel_tools) later only requires extending the value bag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — prisma + redis
// ---------------------------------------------------------------------------

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { getRedisClient } from '../../utils/redis-client.js';
import {
  ChatLoopConfigService,
  CHAT_LOOP_CONFIG_DEFAULTS,
  resetChatLoopConfigServiceInstance,
} from '../ChatLoopConfigService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRedis(opts: { connected?: boolean; cached?: any } = {}) {
  const { connected = true, cached = null } = opts;
  return {
    isConnected: vi.fn().mockReturnValue(connected),
    get: vi.fn().mockResolvedValue(cached),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

beforeEach(() => {
  resetChatLoopConfigServiceInstance();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatLoopConfigService.getMaxTurns()', () => {
  it('1. returns seeded default when DB row is missing and seeds it', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue(null);
    (prisma.systemConfiguration.upsert as any).mockResolvedValue({});
    (getRedisClient as any).mockReturnValue(makeRedis());

    const service = new ChatLoopConfigService();
    const maxTurns = await service.getMaxTurns();

    expect(maxTurns).toBe(CHAT_LOOP_CONFIG_DEFAULTS.maxTurns);
    expect(maxTurns).toBe(24); // explicit floor lock — not 12 (the old hardcode)
    expect(prisma.systemConfiguration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'chat_loop' },
        create: expect.objectContaining({
          key: 'chat_loop',
          value: expect.objectContaining({ maxTurns: 24 }),
        }),
      }),
    );
  });

  it('2. returns DB-persisted value when row is present', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue({
      key: 'chat_loop',
      value: { maxTurns: 40 },
      is_active: true,
    });
    (getRedisClient as any).mockReturnValue(makeRedis());

    const service = new ChatLoopConfigService();
    expect(await service.getMaxTurns()).toBe(40);
  });

  it('3. cache hit — second call within TTL skips DB + Redis', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue({
      key: 'chat_loop',
      value: { maxTurns: 35 },
      is_active: true,
    });
    const redis = makeRedis();
    (getRedisClient as any).mockReturnValue(redis);

    const service = new ChatLoopConfigService();
    await service.getMaxTurns(); // first call — populates cache
    (prisma.systemConfiguration.findFirst as any).mockClear();
    redis.get.mockClear();

    const second = await service.getMaxTurns();
    expect(second).toBe(35);
    expect(prisma.systemConfiguration.findFirst).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('4. Redis cache hit short-circuits DB read', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue({
      key: 'chat_loop',
      value: { maxTurns: 999 }, // stale — Redis should win
      is_active: true,
    });
    (getRedisClient as any).mockReturnValue(
      makeRedis({ cached: { maxTurns: 48 } }),
    );

    const service = new ChatLoopConfigService();
    const maxTurns = await service.getMaxTurns();

    expect(maxTurns).toBe(48);
    expect(prisma.systemConfiguration.findFirst).not.toHaveBeenCalled();
  });

  it('5. survives DB error — falls back to defaults', async () => {
    (prisma.systemConfiguration.findFirst as any).mockRejectedValue(
      new Error('connection refused'),
    );
    (getRedisClient as any).mockReturnValue(makeRedis());

    const service = new ChatLoopConfigService();
    const maxTurns = await service.getMaxTurns();
    expect(maxTurns).toBe(CHAT_LOOP_CONFIG_DEFAULTS.maxTurns);
  });
});

describe('ChatLoopConfigService.setMaxTurns()', () => {
  it('6. persists valid value and invalidates cache', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue(null);
    (prisma.systemConfiguration.upsert as any).mockResolvedValue({});
    const redis = makeRedis();
    (getRedisClient as any).mockReturnValue(redis);

    const service = new ChatLoopConfigService();
    await service.setMaxTurns(50, 'admin@example.com');

    expect(prisma.systemConfiguration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'chat_loop' },
        update: expect.objectContaining({
          value: expect.objectContaining({ maxTurns: 50 }),
        }),
      }),
    );
    // Cache invalidation: Redis del MUST be called.
    expect(redis.del).toHaveBeenCalledWith('chat_loop_config');
  });

  it('7. rejects values below floor (4)', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue(null);
    (getRedisClient as any).mockReturnValue(makeRedis());
    const service = new ChatLoopConfigService();

    await expect(service.setMaxTurns(3, 'admin')).rejects.toThrow(/max_turns/i);
    await expect(service.setMaxTurns(0, 'admin')).rejects.toThrow(/max_turns/i);
    await expect(service.setMaxTurns(-5, 'admin')).rejects.toThrow(/max_turns/i);
  });

  it('8. rejects values above ceiling (100)', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue(null);
    (getRedisClient as any).mockReturnValue(makeRedis());
    const service = new ChatLoopConfigService();

    await expect(service.setMaxTurns(101, 'admin')).rejects.toThrow(/max_turns/i);
    await expect(service.setMaxTurns(500, 'admin')).rejects.toThrow(/max_turns/i);
  });

  it('9. rejects non-integer values', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue(null);
    (getRedisClient as any).mockReturnValue(makeRedis());
    const service = new ChatLoopConfigService();

    await expect(service.setMaxTurns(12.5 as any, 'admin')).rejects.toThrow(
      /max_turns/i,
    );
    await expect(service.setMaxTurns(NaN as any, 'admin')).rejects.toThrow(
      /max_turns/i,
    );
    await expect(
      service.setMaxTurns('abc' as any, 'admin'),
    ).rejects.toThrow(/max_turns/i);
  });

  it('10. accepts boundary values (4 and 100)', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue(null);
    (prisma.systemConfiguration.upsert as any).mockResolvedValue({});
    (getRedisClient as any).mockReturnValue(makeRedis());

    const service = new ChatLoopConfigService();
    await expect(service.setMaxTurns(4, 'admin')).resolves.toMatchObject({ maxTurns: 4 });
    await expect(service.setMaxTurns(100, 'admin')).resolves.toMatchObject({ maxTurns: 100 });
  });
});

describe('ChatLoopConfigService.getConfig()', () => {
  it('11. returns the full config bag (future-proofs new knobs)', async () => {
    (prisma.systemConfiguration.findFirst as any).mockResolvedValue({
      key: 'chat_loop',
      value: { maxTurns: 18 },
      is_active: true,
    });
    (getRedisClient as any).mockReturnValue(makeRedis());

    const service = new ChatLoopConfigService();
    const config = await service.getConfig();

    expect(config).toEqual(expect.objectContaining({ maxTurns: 18 }));
  });
});
