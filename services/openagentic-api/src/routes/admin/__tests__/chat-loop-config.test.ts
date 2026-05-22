/**
 * Chat Loop Config Admin Routes — TDD spec.
 *
 * Covers:
 *   1. GET /api/admin/chat-loop-config returns 200 with the current config
 *   2. PUT with valid maxTurns (4..100) returns 200 + invokes service.setMaxTurns
 *   3. PUT with maxTurns < floor (3) returns 400
 *   4. PUT with maxTurns > ceiling (101) returns 400
 *   5. PUT with non-integer maxTurns (12.5) returns 400
 *   6. PUT with no maxTurns field returns 400
 *   7. PUT by non-admin user returns 403
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../../services/ChatLoopConfigService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/ChatLoopConfigService.js')>();
  return {
    ...actual,
    getChatLoopConfigService: vi.fn(),
  };
});

vi.mock('../../../utils/prisma.js', () => ({ prisma: {} as any }));
vi.mock('../../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({
    isConnected: () => false,
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  }),
}));

import { getChatLoopConfigService } from '../../../services/ChatLoopConfigService.js';
const mockGetService = vi.mocked(getChatLoopConfigService);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildApp(opts: {
  isAdmin?: boolean;
  unauthenticated?: boolean;
  nonAdmin?: boolean;
} = {}): Promise<FastifyInstance> {
  const { isAdmin = true, unauthenticated = false, nonAdmin = false } = opts;
  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request: any, reply) => {
    if (unauthenticated) {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
    request.user = {
      id: 'user-test-id',
      email: 'admin@openagentic.io',
      isAdmin: !nonAdmin && isAdmin,
      role: !nonAdmin && isAdmin ? 'admin' : 'user',
    };
  });

  const { default: chatLoopConfigRoutes } = await import('../chat-loop-config.js');
  await app.register(chatLoopConfigRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chat Loop Config Admin Routes', () => {
  let getConfigMock: ReturnType<typeof vi.fn>;
  let getMaxTurnsMock: ReturnType<typeof vi.fn>;
  let setMaxTurnsMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock = vi.fn().mockResolvedValue({ maxTurns: 24 });
    getMaxTurnsMock = vi.fn().mockResolvedValue(24);
    setMaxTurnsMock = vi.fn().mockImplementation(async (value: number) => ({
      maxTurns: value,
    }));
    mockGetService.mockReturnValue({
      getConfig: getConfigMock,
      getMaxTurns: getMaxTurnsMock,
      setMaxTurns: setMaxTurnsMock,
    } as any);
  });

  it('1. GET returns 200 with the current maxTurns', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/chat-loop-config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.config?.maxTurns).toBe(24);
  });

  it('2. PUT with valid maxTurns returns 200 and persists', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/chat-loop-config',
      payload: { maxTurns: 40 },
    });
    expect(res.statusCode).toBe(200);
    expect(setMaxTurnsMock).toHaveBeenCalledWith(40, expect.any(String));
    expect(res.json().config?.maxTurns).toBe(40);
  });

  it('3. PUT with maxTurns below floor returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/chat-loop-config',
      payload: { maxTurns: 3 },
    });
    expect(res.statusCode).toBe(400);
    expect(setMaxTurnsMock).not.toHaveBeenCalled();
  });

  it('4. PUT with maxTurns above ceiling returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/chat-loop-config',
      payload: { maxTurns: 101 },
    });
    expect(res.statusCode).toBe(400);
    expect(setMaxTurnsMock).not.toHaveBeenCalled();
  });

  it('5. PUT with non-integer maxTurns returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/chat-loop-config',
      payload: { maxTurns: 12.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(setMaxTurnsMock).not.toHaveBeenCalled();
  });

  it('6. PUT with empty body returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/chat-loop-config',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(setMaxTurnsMock).not.toHaveBeenCalled();
  });

  it('7. PUT by non-admin returns 403', async () => {
    const app = await buildApp({ nonAdmin: true });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/chat-loop-config',
      payload: { maxTurns: 50 },
    });
    expect(res.statusCode).toBe(403);
    expect(setMaxTurnsMock).not.toHaveBeenCalled();
  });

  it('8. PUT accepts boundary values 4 and 100', async () => {
    const app = await buildApp();
    for (const v of [4, 100]) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/chat-loop-config',
        payload: { maxTurns: v },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
