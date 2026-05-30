/**
 * V2 chat pipeline — OBO header plumb regression test
 *
 * LIVE failure caught 2026-04-30:
 *   - V1 chat (legacy `tool-execution.helper.ts:2375-2444`) POSTed to
 *     `/mcp/tool` with full auth headers: `Authorization: Bearer <azure-access-jwt>`
 *     for OBO, `X-Azure-ID-Token: <id-jwt>` for ARM token exchange,
 *     `X-AWS-ID-Token: <id-jwt>` for AWS Identity Center, `X-User-Id`,
 *     `X-User-Email`. All Azure / AWS / GCP MCP servers reach the user
 *     identity through these headers and OBO.
 *   - V2 chat (`buildChatV2Deps.makeExecuteMcpTool`) POSTed `/mcp/tool`
 *     with NO auth at all — just `Content-Type: application/json`. When
 *     the cascade fix landed and the model started calling `azure_*` tools
 *     directly, oap-azure-mcp returned `"No user token provided
 *     (expected 'userAccessToken'). User must be logged in via Azure AD
 *     SSO, not local auth."` — correctly refusing because no identity
 *     reached the MCP server.
 *
 * Fix: V2's executor must read auth context from `ctx.user` and inject
 * the same headers V1 used.
 *
 * Contract under test:
 *   1. Azure-AD user with valid JWT access token → Authorization: Bearer
 *      <accessToken>. NO internal HS256 JWT generated.
 *   2. Azure-AD user with idToken → both `X-Azure-ID-Token` AND
 *      `X-AWS-ID-Token` headers (mirrors V1 line 2431-2434).
 *   3. User context with userId/userEmail → `X-User-Id` / `X-User-Email`
 *      headers (mirrors V1 line 2439-2444).
 *   4. Local-auth user (no Azure JWT) → fallback internal HS256 JWT
 *      (mirrors V1 line 2400-2425).
 *   5. Anonymous / no auth ctx → fallback API_INTERNAL_KEY.
 *   6. ALWAYS sets Content-Type application/json.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// We import the function under test indirectly via buildChatV2Deps —
// makeExecuteMcpTool is private. Tests assert behavior via the resulting
// `executeMcpTool` callback returned from buildChatV2Deps.
import { buildChatV2Deps } from '../buildChatV2Deps.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeFetchSpy(opts: { responseBody?: any; status?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(opts.responseBody ?? { result: 'ok' }), {
      status: opts.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchSpy, calls };
}

function makeFakeJwt(payload: Record<string, any> = { sub: 'user', oid: 'azure-oid' }) {
  // 3-part JWT signed with a throwaway secret — content doesn't matter,
  // we only care about the shape (3 base64 dot-separated segments).
  return jwt.sign(payload, 'test-secret', { expiresIn: '1h' });
}

// Minimal deps stub for buildChatV2Deps — only fields the tests touch.
function makeMinimalOpts() {
  return {
    providerManager: undefined as any,
    getOrchestrator: () => null as any,
    prismaLike: undefined as any,
    chatStorage: undefined as any,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildChatV2Deps.makeExecuteMcpTool — OBO header plumb (LIVE 2026-04-30)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.JWT_SECRET = 'test-jwt-secret-for-internal-token-fallback';
    process.env.API_INTERNAL_KEY = 'test-api-internal-key';
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8080';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Azure-AD user with valid accessToken → Authorization: Bearer <accessToken>', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const deps = buildChatV2Deps(makeMinimalOpts());
    const accessToken = makeFakeJwt({ sub: 'user-1', oid: 'azure-oid-1' });
    const ctx = {
      user: {
        id: 'azure_abc123',
        email: 'mcp-tester@example.com',
        accessToken,
        authMethod: 'azure-ad',
      },
    };

    await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

    expect(calls).toHaveLength(1);
    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBe(`Bearer ${accessToken}`);
    // NO internal HS256 JWT — the Azure JWT IS the auth.
    expect(headers['Authorization']).not.toMatch(/test-jwt-secret-for-internal/);
  });

  it('Azure-AD user with idToken → BOTH X-Azure-ID-Token AND X-AWS-ID-Token headers (mirrors V1)', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const deps = buildChatV2Deps(makeMinimalOpts());
    const accessToken = makeFakeJwt();
    const idToken = makeFakeJwt({ aud: 'app-client-id', oid: 'azure-oid-1' });
    const ctx = {
      user: {
        id: 'azure_abc123',
        email: 'mcp-tester@example.com',
        accessToken,
        idToken,
        authMethod: 'azure-ad',
      },
    };

    await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['X-Azure-ID-Token']).toBe(idToken);
    expect(headers['X-AWS-ID-Token']).toBe(idToken);
  });

  it('User context with userId/userEmail → X-User-Id and X-User-Email headers', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const deps = buildChatV2Deps(makeMinimalOpts());
    const ctx = {
      user: {
        id: 'azure_abc123',
        email: 'mcp-tester@example.com',
        accessToken: makeFakeJwt(),
        authMethod: 'azure-ad',
      },
    };

    await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['X-User-Id']).toBe('azure_abc123');
    expect(headers['X-User-Email']).toBe('mcp-tester@example.com');
  });

  it('Non-Azure auth (api-key / local) with no accessToken → internal HS256 JWT in Authorization', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const deps = buildChatV2Deps(makeMinimalOpts());
    const ctx = {
      user: {
        id: 'local_user_42',
        email: 'local@example.com',
        authMethod: 'local',
        // NO accessToken
      },
    };

    await deps.executeMcpTool!(ctx, 'admin_system_postgres_health_check', {});

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    const auth = headers['Authorization'];
    expect(auth).toMatch(/^Bearer /);
    const token = auth.replace(/^Bearer /, '');
    // Internal token MUST be a valid HS256 JWT signed by our secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    expect(decoded.userId).toBe('local_user_42');
    expect(decoded.email).toBe('local@example.com');
    // No Azure ID token headers when no idToken in ctx
    expect(headers['X-Azure-ID-Token']).toBeUndefined();
    expect(headers['X-AWS-ID-Token']).toBeUndefined();
  });

  it('No user context (anonymous) → fallback to API_INTERNAL_KEY', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const deps = buildChatV2Deps(makeMinimalOpts());
    const ctx = {}; // No user

    await deps.executeMcpTool!(ctx, 'admin_system_postgres_health_check', {});

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBe(`Bearer ${process.env.API_INTERNAL_KEY}`);
  });

  it('always sets Content-Type: application/json', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const deps = buildChatV2Deps(makeMinimalOpts());
    await deps.executeMcpTool!(
      { user: { id: 'azure_x', accessToken: makeFakeJwt(), authMethod: 'azure-ad' } },
      'any_tool',
      {},
    );

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Content-Type']).toBe('application/json');
  });
});
