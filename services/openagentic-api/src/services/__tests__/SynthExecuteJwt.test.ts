/**
 * SynthExecuteJwt — TDD spec for the api → synth-executor service-JWT minter.
 *
 * Pairs with synth-executor's verify_service_jwt middleware (commit aae7bb83
 * which requires { iss: 'openagentic-api', aud: 'synth-executor', sub, sid, exp }).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { mintSynthExecutorJwt } from '../SynthExecuteJwt.js';

const TEST_KEY = 'test-signing-key-not-for-production-but-not-dev-secret';

describe('mintSynthExecutorJwt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SERVICE_JWT_KEY;
  });

  it('throws when no signing key available', () => {
    delete process.env.SERVICE_JWT_KEY;
    expect(() => mintSynthExecutorJwt({ userId: 'u1', sessionId: 's1' }))
      .toThrow(/SERVICE_JWT_KEY required/);
  });

  it('throws on dev-secret literal', () => {
    expect(() =>
      mintSynthExecutorJwt({ userId: 'u1', sessionId: 's1' }, 'dev-secret-anything')
    ).toThrow(/dev-secret/);
  });

  it('mints valid JWT with required claims', () => {
    const token = mintSynthExecutorJwt({ userId: 'user-1', sessionId: 'session-1' }, TEST_KEY);
    const decoded = jwt.verify(token, TEST_KEY, {
      algorithms: ['HS256'],
      audience: 'synth-executor',
      issuer: 'openagentic-api',
    }) as any;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.sid).toBe('session-1');
    expect(decoded.iss).toBe('openagentic-api');
    expect(decoded.aud).toBe('synth-executor');
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
  });

  it('exp is exactly 5 minutes from now (not longer)', () => {
    const token = mintSynthExecutorJwt({ userId: 'u', sessionId: 's' }, TEST_KEY);
    const decoded = jwt.verify(token, TEST_KEY, {
      algorithms: ['HS256'],
      audience: 'synth-executor',
      issuer: 'openagentic-api',
    }) as any;
    const now = Math.floor(Date.now() / 1000);
    expect(decoded.exp).toBe(now + 300);
  });

  it('uses HS256 algorithm (not RS256/none)', () => {
    const token = mintSynthExecutorJwt({ userId: 'u', sessionId: 's' }, TEST_KEY);
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    expect(header.alg).toBe('HS256');
  });

  it('reads SERVICE_JWT_KEY env when no explicit key provided', () => {
    process.env.SERVICE_JWT_KEY = TEST_KEY;
    const token = mintSynthExecutorJwt({ userId: 'u', sessionId: 's' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });
});
