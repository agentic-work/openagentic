/**
 * S0-13 — Teams JWT signature verification (JWKS)
 *
 * TDD test suite covering the verifyToken security fix.
 * Tests run in RED order first (proving the old code's flaws), then
 * GREEN order (proving the new implementation is correct).
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { TeamsIntegrationService } from '../services/TeamsIntegrationService.js';

// ---------------------------------------------------------------------------
// Test RSA key pair — used to simulate real JWKS keys
// ---------------------------------------------------------------------------
let privateKey: string;
let publicKey: string;

// A second "attacker" key pair — different from the legit one
let attackerPrivateKey: string;
let attackerPublicKey: string;

beforeAll(() => {
  const legit = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = legit.privateKey;
  publicKey = legit.publicKey;

  const attacker = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  attackerPrivateKey = attacker.privateKey;
  attackerPublicKey = attacker.publicKey;
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
function makeMockJwks(pubKey: () => string) {
  return {
    getSigningKey: vi.fn().mockImplementation((_kid: string) =>
      Promise.resolve({
        getPublicKey: () => pubKey(),
        publicKey: pubKey(),
      })
    ),
  };
}

function makePrisma() {
  return {} as any;
}

/**
 * Build a valid Bot Framework JWT signed with the given private key.
 * kid is "legit-key-1" to match what our mock JWKS returns.
 */
function makeToken(
  overrides: Partial<{
    iss: string;
    aud: string;
    iat: number;
    nbf: number;
    exp: number;
    privateKey: string;
    algorithm: jwt.Algorithm;
    kid: string;
  }> = {}
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: overrides.iss ?? 'https://api.botframework.com',
    aud: overrides.aud ?? 'test-app-id',
    iat: overrides.iat ?? now - 60,
    nbf: overrides.nbf ?? now - 60,
    exp: overrides.exp ?? now + 3600,
    ver: '2.0',
  };
  return jwt.sign(payload, overrides.privateKey ?? privateKey, {
    algorithm: overrides.algorithm ?? 'RS256',
    keyid: overrides.kid ?? 'legit-key-1',
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('TeamsIntegrationService.verifyToken', () => {
  // -------------------------------------------------------------------------
  // T1 — RED (bug fix): forged HS256 token with valid iss → must return false
  // Before fix: jwt.decode accepted HS256 and issuer prefix-matched → true
  // After fix: only RS256 from JWKS is accepted
  // -------------------------------------------------------------------------
  it('T1: rejects forged HS256 token with valid iss claim', async () => {
    const forgedToken = jwt.sign(
      {
        iss: 'https://api.botframework.com',
        aud: 'test-app-id',
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      'attacker-hs256-secret',
      { algorithm: 'HS256' }
    );

    // Mock JWKS returns the legit RSA public key, but the token is HS256-signed
    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${forgedToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T2 — characterization (expected to stay PASS): no "Bearer " prefix
  // -------------------------------------------------------------------------
  it('T2: rejects authHeader without Bearer prefix', async () => {
    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    expect(await svc.verifyToken('')).toBe(false);
    expect(await svc.verifyToken('Basic abc')).toBe(false);
    expect(await svc.verifyToken('bearer abc')).toBe(false); // case-sensitive
  });

  // -------------------------------------------------------------------------
  // T3 — RED (bug fix): malformed token string → false, no throw
  // -------------------------------------------------------------------------
  it('T3: malformed token returns false without throwing', async () => {
    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    await expect(svc.verifyToken('Bearer not-a-jwt')).resolves.toBe(false);
    await expect(svc.verifyToken('Bearer a.b')).resolves.toBe(false);
    await expect(svc.verifyToken('Bearer ')).resolves.toBe(false);
  });

  // -------------------------------------------------------------------------
  // T4 — RED (bug fix): token signed with wrong RSA key → false
  // JWKS returns legit public key; token was signed with attacker's private key
  // Before fix: jwt.decode doesn't check signature → passes issuer check → true
  // -------------------------------------------------------------------------
  it('T4: rejects token signed with wrong RSA key despite valid iss', async () => {
    const forgedToken = makeToken({ privateKey: attackerPrivateKey });

    // JWKS serves the LEGIT public key — so signature check will fail
    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${forgedToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T5 — RED (bug fix): expired token with valid signature → false
  // Before fix: expiry not checked (jwt.decode ignores exp)
  // -------------------------------------------------------------------------
  it('T5: rejects expired token even with valid signature and iss', async () => {
    const expiredToken = makeToken({
      iat: Math.floor(Date.now() / 1000) - 7200,
      nbf: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600, // expired 1h ago
    });

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${expiredToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T6 — RED (bug fix): valid signature but wrong issuer → false
  // -------------------------------------------------------------------------
  it('T6: rejects token with wrong issuer even with valid signature', async () => {
    const wrongIssToken = makeToken({ iss: 'https://attacker.com' });

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${wrongIssToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T7 — GREEN (happy path): valid RS256 token → true
  // -------------------------------------------------------------------------
  it('T7: accepts valid RS256 token signed by JWKS key with correct iss', async () => {
    const validToken = makeToken();

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${validToken}`);
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T8 — GREEN: JWKS endpoint unreachable → fail-closed (false), no throw
  // -------------------------------------------------------------------------
  it('T8: fails closed when JWKS endpoint is unreachable', async () => {
    const validToken = makeToken();

    const networkErrorJwks = {
      getSigningKey: vi.fn().mockRejectedValue(new Error('Network error: ECONNREFUSED')),
    };
    const svc = new TeamsIntegrationService(makePrisma(), networkErrorJwks as any);

    const result = await svc.verifyToken(`Bearer ${validToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T9 — GREEN: algorithm=none JWT → false (algorithm whitelist)
  // -------------------------------------------------------------------------
  it('T9: rejects alg:none tokens', async () => {
    // jwt.sign does not support 'none' algorithm directly — craft the token manually
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://api.botframework.com',
        aud: 'test-app-id',
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${noneToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T10 — GREEN: issuer prefix-trick → false
  // e.g. 'https://api.botframework.com.evil.com' looks like it starts with
  // 'https://api.botframework.com' under the old prefix-match logic
  // -------------------------------------------------------------------------
  it('T10: rejects issuer that only prefix-matches but is not an exact valid issuer', async () => {
    const prefixTrickToken = makeToken({ iss: 'https://api.botframework.com.evil.com' });

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${prefixTrickToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T11 — test gap: empty kid header (falsy) → false
  // -------------------------------------------------------------------------
  it('T11: rejects token with empty kid header', async () => {
    const tokenNoKid = makeToken({ kid: '' });

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${tokenNoKid}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T12 — test gap: nbf in the future → false
  // -------------------------------------------------------------------------
  it('T12: rejects token with nbf in the future', async () => {
    const now = Math.floor(Date.now() / 1000);
    const futureNbfToken = makeToken({
      nbf: now + 3600, // not valid for another hour
      exp: now + 7200,
    });

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${futureNbfToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T13 — test gap: missing iss claim → false
  // -------------------------------------------------------------------------
  it('T13: rejects token without iss claim', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Sign a token payload without an iss field at all
    const noIssPayload = {
      aud: 'test-app-id',
      iat: now - 60,
      nbf: now - 60,
      exp: now + 3600,
      ver: '2.0',
    };
    const noIssToken = jwt.sign(noIssPayload, privateKey, {
      algorithm: 'RS256',
      keyid: 'legit-key-1',
    });

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${noIssToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T14 — Issue #2: audience configured + wrong audience in token → false
  // -------------------------------------------------------------------------
  it('T14: rejects token with wrong audience when expectedAudience is configured', async () => {
    // Token has aud: 'wrong-app-id', but service expects 'correct-app-id'
    const wrongAudToken = makeToken({ aud: 'wrong-app-id' });

    const mockJwks = makeMockJwks(() => publicKey);
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any, 'correct-app-id');

    const result = await svc.verifyToken(`Bearer ${wrongAudToken}`);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T15 — Issue #2: audience NOT configured → token accepted regardless of aud
  // (graceful migration: existing deployments without appId still work)
  // -------------------------------------------------------------------------
  it('T15: accepts valid token when expectedAudience is not configured (graceful default)', async () => {
    // makeToken() includes aud: 'test-app-id' but no audience check configured
    const validToken = makeToken();

    const mockJwks = makeMockJwks(() => publicKey);
    // No expectedAudience arg → no audience check
    const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

    const result = await svc.verifyToken(`Bearer ${validToken}`);
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T16 — Issue #3: token expired by 4 min is accepted within clockTolerance
  // Uses fake timers so we don't race with wall clock
  // -------------------------------------------------------------------------
  it('T16: accepts token expired by 4 minutes when clockTolerance is 300s', async () => {
    vi.useFakeTimers();
    try {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Build a token valid at baseTime
      const now = Math.floor(baseTime / 1000);
      const token = makeToken({
        iat: now - 60,
        nbf: now - 60,
        exp: now + 60, // expires 60s from now
      });

      // Advance time so token is now 4 minutes past expiry (240s)
      vi.setSystemTime(baseTime + (60 + 240) * 1000);

      const mockJwks = makeMockJwks(() => publicKey);
      const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

      const result = await svc.verifyToken(`Bearer ${token}`);
      expect(result).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------------
  // T17 — Issue #3: token expired by 6 min is rejected (beyond clockTolerance)
  // -------------------------------------------------------------------------
  it('T17: rejects token expired by 6 minutes (beyond 300s clockTolerance)', async () => {
    vi.useFakeTimers();
    try {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      const now = Math.floor(baseTime / 1000);
      const token = makeToken({
        iat: now - 60,
        nbf: now - 60,
        exp: now + 60, // expires 60s from now
      });

      // Advance time so token is now 6 minutes past expiry (360s)
      vi.setSystemTime(baseTime + (60 + 360) * 1000);

      const mockJwks = makeMockJwks(() => publicKey);
      const svc = new TeamsIntegrationService(makePrisma(), mockJwks as any);

      const result = await svc.verifyToken(`Bearer ${token}`);
      expect(result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// S0-14 — Teams executeWorkflow real implementation
// ---------------------------------------------------------------------------

/**
 * Helper: build an SSE body string from an array of event objects.
 */
function makeSse(events: object[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/**
 * Helper: create a mock JWKS that returns a public key (reuses publicKey from beforeAll).
 * Returns a minimal object castable to JwksClient.
 */
function makeSimpleJwks() {
  return {
    getSigningKey: vi.fn().mockResolvedValue({
      getPublicKey: () => publicKey,
      publicKey,
    }),
  };
}

describe('S0-14 — executeWorkflow real implementation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.INTERNAL_SERVICE_SECRET;
    delete process.env.WORKFLOW_SERVICE_URL;
    delete process.env.OPENAGENTIC_API_URL;
  });

  // AC-1: successful SSE execution — execution_start + node_complete + execution_complete
  it('AC-1: returns { summary, executionId, status:"completed", outputs } from SSE', async () => {
    const sseBody = makeSse([
      { type: 'execution_start', executionId: 'exec-abc' },
      { type: 'node_complete', nodeId: 'n1', nodeLabel: 'LLM', output: 'Hello from Teams workflow' },
      { type: 'execution_complete', output: 'Final answer here' },
    ]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    const result = await (svc as any).executeWorkflow('wf-123', { trigger: 'teams' });

    expect(result.executionId).toBe('exec-abc');
    expect(result.status).toBe('completed');
    expect(result.summary).toBeTruthy();
    expect(typeof result.summary).toBe('string');
    expect(result.outputs).toBeTruthy();
  });

  // AC-2: HTTP 4xx/5xx throws Error with status + truncated body
  it('AC-2: throws Error when workflow API returns non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error detail', { status: 500 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    await expect((svc as any).executeWorkflow('wf-bad', {})).rejects.toThrow(/500/);
  });

  it('AC-2b: error message includes truncated body text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized access denied', { status: 401 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    await expect((svc as any).executeWorkflow('wf-bad', {})).rejects.toThrow(/Workflow API error/);
  });

  // AC-3: execution_error event → status 'failed', error preserved in outputs
  it('AC-3: execution_error event yields status "failed" with error in outputs', async () => {
    const sseBody = makeSse([
      { type: 'execution_start', executionId: 'exec-err' },
      { type: 'execution_error', error: 'Node timeout after 30s' },
    ]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    const result = await (svc as any).executeWorkflow('wf-err', {});

    expect(result.status).toBe('failed');
    expect(result.executionId).toBe('exec-err');
    // outputs should contain the error field
    expect(result.outputs).toHaveProperty('error');
    expect(result.outputs.error).toMatch(/timeout/i);
  });

  // AC-4: multiple node_complete events are collected and represented in summary
  it('AC-4: multiple node_complete events are collected into summary', async () => {
    const sseBody = makeSse([
      { type: 'execution_start', executionId: 'exec-multi' },
      { type: 'node_complete', nodeId: 'n1', nodeLabel: 'Step1', output: 'First node output that is long enough to pass the length check' },
      { type: 'node_complete', nodeId: 'n2', nodeLabel: 'Step2', output: 'Second node output that is also long enough to pass the length check' },
      { type: 'execution_complete', output: null },
    ]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    const result = await (svc as any).executeWorkflow('wf-multi', {});

    expect(result.executionId).toBe('exec-multi');
    // The summary should contain content from one or both node outputs
    expect(result.summary).toBeTruthy();
    expect(result.summary.length).toBeGreaterThan(0);
  });

  // AC-5: INTERNAL_SERVICE_SECRET header is sent when env var is set
  it('AC-5: sends X-Internal-Secret header when INTERNAL_SERVICE_SECRET is set', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'super-secret-value';

    const sseBody = makeSse([
      { type: 'execution_complete', executionId: 'exec-hdr', output: 'done' },
    ]);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    await (svc as any).executeWorkflow('wf-hdr', {});

    const [, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((fetchOpts.headers as Record<string, string>)['X-Internal-Secret']).toBe('super-secret-value');
  });

  // AC-6: request body contains input + trigger_type:'teams'
  it('AC-6: POSTs with input:context and trigger_type:"teams"', async () => {
    const sseBody = makeSse([{ type: 'execution_complete', output: 'done' }]);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }) as any
    );

    const ctx = { trigger: 'teams', message: 'hello', channelId: 'ch-1' };
    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    await (svc as any).executeWorkflow('wf-body', ctx);

    const [, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(fetchOpts.body as string);
    expect(body.input).toEqual(ctx);
    expect(body.trigger_type).toBe('teams');
  });

  // AC-7: URL resolution uses WORKFLOW_SERVICE_URL > OPENAGENTIC_API_URL > localhost:8000
  it('AC-7a: uses WORKFLOW_SERVICE_URL when set', async () => {
    process.env.WORKFLOW_SERVICE_URL = 'http://workflow-svc:9000';
    const sseBody = makeSse([{ type: 'execution_complete', output: 'done' }]);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    await (svc as any).executeWorkflow('wf-url', {});

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/workflow-svc:9000\/api\/workflows\/wf-url\/execute$/);
  });

  it('AC-7b: falls back to OPENAGENTIC_API_URL when WORKFLOW_SERVICE_URL unset', async () => {
    process.env.OPENAGENTIC_API_URL = 'http://api-svc:8080';
    const sseBody = makeSse([{ type: 'execution_complete', output: 'done' }]);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    await (svc as any).executeWorkflow('wf-url2', {});

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/api-svc:8080\/api\/workflows\/wf-url2\/execute$/);
  });

  it('AC-7c: defaults to localhost:8000 when no URL env vars set', async () => {
    const sseBody = makeSse([{ type: 'execution_complete', output: 'done' }]);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }) as any
    );

    const svc = new TeamsIntegrationService(makePrisma(), makeSimpleJwks() as any);
    await (svc as any).executeWorkflow('wf-default', {});

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/localhost:8000\/api\/workflows\/wf-default\/execute$/);
  });
});
