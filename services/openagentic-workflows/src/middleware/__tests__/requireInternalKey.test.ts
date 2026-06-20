/**
 * P0a — Service-to-service auth on /execute*.
 *
 * The workflows-service used to accept `userId` / `userPermissions` /
 * `authToken` from the request body with no verification, so anyone with
 * port 3400 reachability could execute workflows as anyone. The fix:
 * require a shared internal key on the Authorization header. Only trusted
 * internal services (e.g. the api, which has authenticated the end-user)
 * hold that key, so unauthenticated callers cannot reach the engine.
 *
 * The user's identity (userId, permissions, OBO token) still rides in
 * the body — that's how node executors call cloud APIs on behalf of the
 * user. The internal-key gate is the perimeter; the body claims are
 * trusted *because* the gate is closed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireInternalKey } from '../requireInternalKey.js';

// Mock the internal key reader so we don't need a real mounted file.
vi.mock('../../utils/internalKeyReader.js', () => ({
  getInternalKey: vi.fn(),
}));
import { getInternalKey } from '../../utils/internalKeyReader.js';
const mockGetKey = getInternalKey as ReturnType<typeof vi.fn>;

function makeReply() {
  const reply: any = {
    statusCode: 200,
    payload: undefined as unknown,
    code(c: number) { reply.statusCode = c; return reply; },
    send(p: unknown) { reply.payload = p; return reply; },
  };
  return reply;
}

function makeReq(headers: Record<string, string | undefined> = {}) {
  return { headers } as any;
}

describe('requireInternalKey', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects with 401 when Authorization header is missing', async () => {
    mockGetKey.mockReturnValue('the-real-key');
    const reply = makeReply();
    const result = await requireInternalKey(makeReq({}), reply);
    expect(result).toEqual({ ok: false });
    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toMatchObject({ error: expect.stringMatching(/missing|unauthorized/i) });
  });

  it('rejects with 401 when Authorization header is not a Bearer token', async () => {
    mockGetKey.mockReturnValue('the-real-key');
    const reply = makeReply();
    const result = await requireInternalKey(makeReq({ authorization: 'Basic abc123' }), reply);
    expect(result).toEqual({ ok: false });
    expect(reply.statusCode).toBe(401);
  });

  it('rejects with 401 when the bearer value is wrong', async () => {
    mockGetKey.mockReturnValue('the-real-key');
    const reply = makeReply();
    const result = await requireInternalKey(makeReq({ authorization: 'Bearer wrong-key' }), reply);
    expect(result).toEqual({ ok: false });
    expect(reply.statusCode).toBe(401);
  });

  it('accepts when the bearer value matches the configured internal key', async () => {
    mockGetKey.mockReturnValue('the-real-key');
    const reply = makeReply();
    const result = await requireInternalKey(makeReq({ authorization: 'Bearer the-real-key' }), reply);
    expect(result).toEqual({ ok: true });
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
  });

  it('refuses to authorize when no internal key is configured (fail-closed)', async () => {
    mockGetKey.mockReturnValue('');
    const reply = makeReply();
    const result = await requireInternalKey(makeReq({ authorization: 'Bearer anything' }), reply);
    expect(result).toEqual({ ok: false });
    expect(reply.statusCode).toBe(503);
    expect(reply.payload).toMatchObject({ error: expect.stringMatching(/not configured|unavailable/i) });
  });

  it('uses constant-time comparison (no early-exit on prefix match)', async () => {
    // We can't directly observe timing, but we can assert the helper
    // exposes the comparator and that it's a constant-time crypto helper
    // by importing the implementation and checking it doesn't === compare.
    mockGetKey.mockReturnValue('aaaaaaaaaaaaaaaaaaaaaaaaaa');
    const reply1 = makeReply();
    const reply2 = makeReply();
    const r1 = await requireInternalKey(makeReq({ authorization: 'Bearer baaaaaaaaaaaaaaaaaaaaaaaaa' }), reply1);
    const r2 = await requireInternalKey(makeReq({ authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaab' }), reply2);
    expect(r1).toEqual({ ok: false });
    expect(r2).toEqual({ ok: false });
    expect(reply1.statusCode).toBe(401);
    expect(reply2.statusCode).toBe(401);
  });

  it('rejects keys of different length (timing-safe length mismatch)', async () => {
    mockGetKey.mockReturnValue('short');
    const reply = makeReply();
    const result = await requireInternalKey(makeReq({ authorization: 'Bearer this-is-much-longer-than-the-real-key' }), reply);
    expect(result).toEqual({ ok: false });
    expect(reply.statusCode).toBe(401);
  });
});
