/**
 * SynthExecutorClient — TDD spec for Authorization-header behavior.
 *
 * synth-executor `/execute` requires Bearer service-JWT (aae7bb83). The api
 * client must mint + send it on every call. If SERVICE_JWT_KEY is absent the
 * client must refuse to send (better to surface mis-config than 401 every
 * upstream caller).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { SynthExecutorClient } from '../SynthExecutorClient.js';

const TEST_KEY = 'test-signing-key-not-for-production-but-not-dev-secret';

// jsonwebtoken-shaped header check helper
function jwtIsHs256(token: string): boolean {
  const [headerB64] = token.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  return header.alg === 'HS256';
}

describe('SynthExecutorClient — Authorization header (S2 service-JWT)', () => {
  const originalFetch = global.fetch;
  let logger: pino.Logger;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    process.env.SERVICE_JWT_KEY = TEST_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SERVICE_JWT_KEY;
    vi.restoreAllMocks();
  });

  it('sends Authorization: Bearer <jwt> on every /execute request', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        execution_id: 'exec-1',
        success: true,
        execution_time_ms: 1,
        code_hash: 'h',
        started_at: '',
        completed_at: '',
      }),
    });
    global.fetch = fetchSpy as any;

    const client = new SynthExecutorClient({ baseUrl: 'http://test', logger });
    await client.execute({
      executionId: 'exec-1',
      code: 'print(1)',
      intent: 'unit-test',
      userId: 'user-1',
      sessionId: 'session-1',
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Bearer ey/); // JWT compact form starts with `ey`
    const token = auth.replace(/^Bearer /, '');
    expect(jwtIsHs256(token)).toBe(true);
  });

  it('throws when SERVICE_JWT_KEY missing — does not silently fall back', async () => {
    delete process.env.SERVICE_JWT_KEY;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const client = new SynthExecutorClient({ baseUrl: 'http://test', logger });
    const result = await client.execute({
      executionId: 'exec-1',
      code: 'print(1)',
      intent: 'unit-test',
      userId: 'user-1',
      sessionId: 'session-1',
    });

    // The client catches and returns an error response (existing contract);
    // critical thing: fetch must NOT have been called with a missing-key
    // path that would 401 on the executor.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SERVICE_JWT_KEY/);
  });

  it('JWT carries sub=userId and sid=sessionId claims', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        execution_id: 'exec-1',
        success: true,
        execution_time_ms: 1,
        code_hash: 'h',
        started_at: '',
        completed_at: '',
      }),
    });
    global.fetch = fetchSpy as any;

    const client = new SynthExecutorClient({ baseUrl: 'http://test', logger });
    await client.execute({
      executionId: 'exec-1',
      code: 'print(1)',
      intent: 'unit-test',
      userId: 'aad-user-uuid',
      sessionId: 'session-abc-123',
    });

    const [, init] = fetchSpy.mock.calls[0];
    const token = (init.headers as Record<string, string>).Authorization.replace(/^Bearer /, '');
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    expect(payload.sub).toBe('aad-user-uuid');
    expect(payload.sid).toBe('session-abc-123');
    expect(payload.iss).toBe('openagentic-api');
    expect(payload.aud).toBe('synth-executor');
  });
});
