/**
 * Cold-boot 401 fix 2026-04-30 — verify the /sessions handler mints an
 * internal JWT when the relay forwards no apiKey.
 *
 * Live bug: when the codemode relay's pod-provision request to
 * code-manager omits the apiKey field (early relay builds, or a relay
 * version that hasn't shipped the field yet), code-manager passed
 * `undefined` straight through to k8sSessionManager → pod env had no
 * OPENAGENTIC_API_KEY → first /v1/models call from inside the pod
 * 401'd. Pod's getAuthHeader() reads exactly that env var.
 *
 * Fix: in /sessions POST, if `apiKey` is missing, mint a 7-day internal
 * HS256 JWT for the user (same scheme the events-WS path already uses)
 * and feed THAT into k8sSessionManager. Pod env now carries a token the
 * api's tokenValidator accepts.
 *
 * This suite exercises the mint helper indirectly by asserting the
 * exact JWT shape the route produces. We don't spin up the full express
 * app — the JWT generation is the hot path; the rest is plumbing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateInternalJwt, parseJwtExp } from '../internalJwt';

describe('cold-boot internal JWT mint contract', () => {
  const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-for-cold-boot';
  });

  afterEach(() => {
    if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  });

  it('mints a JWT carrying the userId in the sub claim', () => {
    const jwt = generateInternalJwt({ userId: 'cold-boot-user' });
    expect(jwt.split('.').length).toBe(3);
    const [, payload] = jwt.split('.');
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    expect(decoded.sub).toBe('cold-boot-user');
    expect(decoded.userId).toBe('cold-boot-user');
  });

  it('embeds the userEmail when provided (so api tokenValidator can extract it)', () => {
    const jwt = generateInternalJwt({
      userId: 'u-1',
      email: 'mcp-tester@phatoldsungmail.onmicrosoft.com',
    });
    const [, payload] = jwt.split('.');
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    expect(decoded.email).toBe('mcp-tester@phatoldsungmail.onmicrosoft.com');
  });

  it('exp is 7 days out so the pod is not stranded by short TTL', () => {
    const before = Math.floor(Date.now() / 1000);
    const jwt = generateInternalJwt({ userId: 'u-1' });
    const exp = parseJwtExp(jwt);
    expect(exp).not.toBeNull();
    const sevenDays = 7 * 24 * 60 * 60;
    expect(exp! - before).toBeGreaterThanOrEqual(sevenDays - 5);
    expect(exp! - before).toBeLessThanOrEqual(sevenDays + 5);
  });

  it('returns empty string when JWT_SECRET is unset (caller logs warning, pod will 401)', () => {
    delete process.env.JWT_SECRET;
    const jwt = generateInternalJwt({ userId: 'u-1' });
    expect(jwt).toBe('');
  });
});
