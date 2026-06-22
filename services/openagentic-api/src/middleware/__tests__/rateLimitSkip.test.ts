/**
 * Pin: the internal-service rate-limit exemption requires a VALID X-Internal-Secret,
 * not just the x-request-from header.
 *
 * SECURITY REGRESSION (legitimacy red-team 2026-06-21): the allowList used to
 * treat any request with `x-request-from: internal|mcp-proxy|openagentic-proxy|
 * workflows` as exempt with NO secret check — so any external client could add
 * one header to skip ALL rate limiting and brute-force the unauthenticated
 * /api/auth/local/login (which has no account lockout). middleware/security now
 * requires the timing-safe secret (same gate as middleware/unifiedAuth) and
 * fails closed. This pin proves the header alone no longer skips.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { isTrustedInternalRequest, rateLimitOptions } from '../security.js';

const SECRET = 'test-internal-secret-0123456789';

beforeAll(() => {
  process.env.INTERNAL_SERVICE_SECRET = SECRET;
});

const req = (headers: Record<string, string>, url = '/api/agents/resolve') =>
  ({ headers, ip: '10.42.6.176', url } as any);

describe('isTrustedInternalRequest — exemption requires the secret', () => {
  it('trusts a recognized internal service WITH the valid secret', () => {
    for (const from of ['openagentic-proxy', 'mcp-proxy', 'workflows', 'internal']) {
      expect(isTrustedInternalRequest(req({ 'x-request-from': from, 'x-internal-secret': SECRET }))).toBe(true);
    }
  });

  it('is case-insensitive on x-request-from (with the secret)', () => {
    expect(isTrustedInternalRequest(req({ 'x-request-from': 'MCP-PROXY', 'x-internal-secret': SECRET }))).toBe(true);
  });

  // THE FIX — the spoofable header alone must NOT grant the exemption.
  it('does NOT trust x-request-from WITHOUT the secret', () => {
    expect(isTrustedInternalRequest(req({ 'x-request-from': 'openagentic-proxy' }))).toBe(false);
  });

  it('does NOT trust a WRONG secret', () => {
    expect(isTrustedInternalRequest(req({ 'x-request-from': 'mcp-proxy', 'x-internal-secret': 'wrong-secret' }))).toBe(false);
  });

  it('does NOT trust a browser caller (no headers)', () => {
    expect(isTrustedInternalRequest(req({}))).toBe(false);
  });

  it('does NOT trust an unrecognized from even WITH the secret', () => {
    expect(isTrustedInternalRequest(req({ 'x-request-from': 'attacker', 'x-internal-secret': SECRET }))).toBe(false);
  });
});

describe('rateLimitOptions.skip', () => {
  it('skips a secret-authenticated internal caller', () => {
    expect(rateLimitOptions.skip(req({ 'x-request-from': 'mcp-proxy', 'x-internal-secret': SECRET }))).toBe(true);
  });

  it('does NOT skip the x-request-from header alone', () => {
    expect(rateLimitOptions.skip(req({ 'x-request-from': 'mcp-proxy' }))).toBe(false);
  });

  it('skips health probes and websocket upgrades', () => {
    expect(rateLimitOptions.skip({ headers: {}, url: '/api/health' } as any)).toBe(true);
    expect(rateLimitOptions.skip({ headers: { upgrade: 'websocket' }, url: '/api/x' } as any)).toBe(true);
  });

  it('does NOT skip a normal browser request', () => {
    expect(rateLimitOptions.skip(req({}))).toBe(false);
  });
});
