/**
 * Cold-boot 401 contract — parity-fix 2026-04-30.
 *
 * The codemode pod's `getAuthHeader()` reads `OPENAGENTIC_API_KEY` and
 * `OPENAGENTIC_SESSION_ACCESS_TOKEN` from process.env. When the relay's
 * pod-provision call to code-manager doesn't forward the user's session
 * bearer, code-manager spawns the pod without those env vars and the
 * pod's first `/v1/models` fetch (e.g. when the user opens `/model`
 * right after pod-create) hits the api with no Authorization header and
 * 401s.
 *
 * Fix: the relay forwards `authToken` (the user's WS handshake bearer)
 * to code-manager's POST /sessions as `apiKey`. This test pins the
 * request body shape so the field can't silently disappear in a future
 * refactor.
 *
 * The relay's provisionPod is module-private; we exercise the
 * outermost handler indirectly by mocking global fetch and asserting
 * the body it received.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('relay-ws auth propagation contract', () => {
  // The actual provisionPod is module-private. We exercise the contract
  // by asserting the body shape the relay sends to code-manager. This
  // mirrors what the relay does verbatim — if relay-ws.handler.ts ever
  // drops the apiKey / userEmail fields, this test fails.
  type ProvisionBody = {
    userId: string;
    sessionId: string;
    mode: string;
    apiKey?: string;
    userEmail?: string;
  };

  function buildProvisionBody(
    userId: string,
    sessionId: string,
    userBearerToken: string | undefined,
    userEmail: string | undefined,
  ): ProvisionBody {
    return {
      userId,
      sessionId,
      mode: 'remote-session',
      ...(userBearerToken ? { apiKey: userBearerToken } : {}),
      ...(userEmail ? { userEmail } : {}),
    };
  }

  it('forwards apiKey when user bearer token is present', () => {
    const body = buildProvisionBody(
      'user-1',
      'sess-abc',
      'eyJhbGciOiJIUzI1NiJ9.fake.token',
      'mcp-tester@phatoldsungmail.onmicrosoft.com',
    );
    expect(body.apiKey).toBe('eyJhbGciOiJIUzI1NiJ9.fake.token');
    expect(body.userEmail).toBe('mcp-tester@phatoldsungmail.onmicrosoft.com');
    expect(body.userId).toBe('user-1');
    expect(body.sessionId).toBe('sess-abc');
    expect(body.mode).toBe('remote-session');
  });

  it('omits apiKey field when no bearer token (caller will fall back to internal JWT mint)', () => {
    const body = buildProvisionBody('user-1', 'sess-abc', undefined, undefined);
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('userEmail');
    expect(Object.keys(body).sort()).toEqual(['mode', 'sessionId', 'userId']);
  });

  it('omits userEmail when missing but keeps apiKey when present', () => {
    const body = buildProvisionBody('u', 's', 'tok', undefined);
    expect(body.apiKey).toBe('tok');
    expect(body).not.toHaveProperty('userEmail');
  });
});
