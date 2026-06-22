/**
 * Pin: unifiedAuth's internal-service-secret branch (x-request-from).
 *
 * Two semantics are pinned here:
 *
 *  1. MATCH — when x-request-from names an internal service AND x-internal-secret
 *     matches the configured INTERNAL_SERVICE_SECRET (timing-safe), the request
 *     is authenticated as that internal service identity (request.user.id ===
 *     `service-<name>`) and the hook short-circuits (returns) without requiring
 *     a bearer/API-key token.
 *
 *  2. MISMATCH (the truthful-log fix) — when x-request-from is present but the
 *     internal secret is missing/wrong, the x-request-from identity claim is
 *     REJECTED but the hook does NOT short-circuit: control FALLS THROUGH to the
 *     normal token path. With no token present, that path throws
 *     "No authentication token provided" and request.user is never set to a
 *     service identity.
 *
 *     This is the correctness fix: the old log said "[AUTH] BLOCKED: ..." which
 *     was a LIE — nothing was blocked, control fell through. The log now states
 *     the truth ("...impersonation rejected ...; falling back to normal token
 *     auth"). The AUTH FLOW is intentionally unchanged — only the log is made
 *     honest — so this test pins the fall-through behavior so a future "fix" that
 *     silently starts blocking (or, worse, starts auth'ing on mismatch) trips it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unifiedAuthHook } from '../unifiedAuth.js';

const SECRET = 'super-secret-internal-value-1234567890';

function makeReq(headers: Record<string, string>): any {
  return {
    headers,
    query: {},
    ip: '10.0.0.5',
    url: '/api/whatever',
    method: 'GET',
  };
}

describe('unifiedAuth — internal-service secret branch', () => {
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.INTERNAL_SERVICE_SECRET;
    process.env.INTERNAL_SERVICE_SECRET = SECRET;
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = prevSecret;
  });

  it('MATCH: authenticates as the internal-service identity and short-circuits (no token needed)', async () => {
    const req = makeReq({
      'x-request-from': 'mcp-proxy',
      'x-internal-secret': SECRET,
    });
    await expect(unifiedAuthHook(req)).resolves.toBeUndefined();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('service-mcp-proxy');
    expect(req.user.userId).toBe('service-mcp-proxy');
    expect(req.user.isAdmin).toBe(false);
  });

  it('MISMATCH (wrong secret): rejects the x-request-from claim and FALLS THROUGH to normal token auth', async () => {
    // No bearer/API-key token present, so the normal token path throws.
    const req = makeReq({
      'x-request-from': 'mcp-proxy',
      'x-internal-secret': 'this-is-the-wrong-secret-value-9999999',
    });
    await expect(unifiedAuthHook(req)).rejects.toThrow('No authentication token provided');
    // Critically: it must NOT have been granted the internal-service identity.
    expect(req.user).toBeUndefined();
  });

  it('MISSING secret header: rejects the x-request-from claim and FALLS THROUGH (does not impersonate)', async () => {
    const req = makeReq({
      'x-request-from': 'openagentic-proxy',
      // no x-internal-secret at all
    });
    await expect(unifiedAuthHook(req)).rejects.toThrow('No authentication token provided');
    expect(req.user).toBeUndefined();
  });

  it('truthful log: the mismatch warn message does NOT claim it BLOCKED, and says it falls back', async () => {
    // Capture the warn payload to prove the log text matches the (fall-through) behavior.
    const { loggers } = await import('../../utils/logger.js');
    const calls: any[] = [];
    const orig = loggers.auth.warn;
    (loggers.auth as any).warn = (...args: any[]) => { calls.push(args); };
    try {
      const req = makeReq({
        'x-request-from': 'mcp-proxy',
        'x-internal-secret': 'wrong-secret-aaaaaaaaaaaaaaaaaaaaaaaa',
      });
      await expect(unifiedAuthHook(req)).rejects.toThrow('No authentication token provided');
    } finally {
      (loggers.auth as any).warn = orig;
    }

    const messages = calls.map((c) => c[c.length - 1]).filter((m) => typeof m === 'string');
    const rejectionMsg = messages.find((m) => m.includes('x-request-from'));
    expect(rejectionMsg).toBeDefined();
    // The old message lied ("BLOCKED"); the new one tells the truth.
    expect(rejectionMsg).not.toMatch(/BLOCKED/);
    expect(rejectionMsg!.toLowerCase()).toContain('rejected');
    expect(rejectionMsg!.toLowerCase()).toContain('falling back');
  });
});
