/**
 * OBO auth-header end-to-end wire-in (LIVE 2026-05-11).
 *
 * The user's question: "did we successfully get the required
 * AD User -> Azure Token -> use auth headers to run as the user 1-1?
 * Seeing logs that this wasnt put in new chatmode."
 *
 * This test PROVES the OBO contract is wired through the new chatmode:
 *
 *   AD User (SPA login)
 *     ↓ bearer in request
 *   stream.handler.ts:1226 → deps.getAzureTokenInfo(userId)
 *     ↓ DB-fresh access_token + id_token
 *   v2Ctx.user = { id, accessToken, idToken, authMethod: 'azure-ad' }
 *     ↓ runChat(v2Ctx, ...) → dispatchChatToolCall → deps.executeMcpTool(ctx, name, input)
 *   buildChatV2Deps.makeExecuteMcpToolWithResolver
 *     ↓ buildMcpProxyHeaders(ctx, azureTokenService)
 *   AzureTokenService.getOrRefreshToken(userId)  ← cred-drift guard
 *     ↓ DB row (preferred over inbound bearer; AAD rejects id_token as OBO grant)
 *   fetch(`${mcpProxyUrl}/mcp/tool`, {
 *     headers: {
 *       Authorization: `Bearer <DB-fresh-access-token>`,    ← 1-1 user identity
 *       X-Azure-ID-Token: '<idToken>',                       ← OBO assertion
 *       X-AWS-ID-Token: '<idToken>',                          ← AWS Identity Center
 *       X-User-Id: 'azure_xxx',
 *       X-User-Email: 'user@org.com',
 *     }
 *   })
 *     ↓
 *   oap-azure-mcp / oap-aws-mcp / oap-gcp-mcp execute against the user's
 *   subscriptions/accounts/projects (1-1 RBAC).
 *
 * The test is REAL — it intercepts global.fetch + stubs azureTokenService
 * but exercises the live buildChatV2Deps factory the chat plugin uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildChatV2Deps } from '../../services/buildChatV2Deps.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchSpy() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ result: { subscriptions: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchSpy, calls };
}

function makeJwt(payload: Record<string, unknown> = {}) {
  return jwt.sign({ sub: 'user', oid: 'azure-oid', ...payload }, 'test-secret', { expiresIn: '1h' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OBO auth-header end-to-end — new chatmode wire-in (2026-05-11)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.MCP_PROXY_URL = 'http://mcp-proxy.test:8080';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.API_INTERNAL_KEY = 'test-internal-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it(
    'AD user → MCP fetch carries Authorization (DB-fresh access_token, NOT inbound bearer) + X-Azure-ID-Token + X-AWS-ID-Token + X-User-Id + X-User-Email',
    async () => {
      const { fetchSpy, calls } = makeFetchSpy();
      globalThis.fetch = fetchSpy as any;

      const dbAccessToken = makeJwt({ oid: 'azure-oid-db' });
      const inboundIdToken = makeJwt({ aud: 'app-client-id', oid: 'azure-oid-db' });
      const inboundBearer = makeJwt({ oid: 'azure-oid-spa-session' }); // would be wrong for OBO

      // Stub AzureTokenService — proves the cred-drift guard prefers the DB token.
      const tokenServiceStub = {
        getOrRefreshToken: vi.fn(async (userId: string) => {
          expect(userId).toBe('azure_abc123'); // wired identity
          return { access_token: dbAccessToken };
        }),
      };

      // Build the real deps factory (no internal mocks) the chat plugin uses
      // in production at routes/chat/index.ts:316.
      const deps = buildChatV2Deps({
        providerManager: undefined as any, // not exercised by this test
        azureTokenService: tokenServiceStub as any,
      });

      // The ctx shape stream.handler.ts:1314-1323 builds before runChat dispatch.
      const ctx = {
        user: {
          id: 'azure_abc123',
          email: 'admin@example.onmicrosoft.com',
          name: 'MCP Tester',
          isAdmin: false,
          groups: [],
          authMethod: 'azure-ad',
          accessToken: inboundBearer, // SPA-session bearer — MUST be overridden by DB row
          idToken: inboundIdToken,
        },
        userId: 'azure_abc123',
        sessionId: 'sess-test',
      };

      // Dispatch the call the way runChat would — fall-through MCP route.
      const result = await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);

      const headers = (calls[0].init.headers as Record<string, string>) ?? {};

      // 1-1 identity: Authorization uses DB-fresh token, NOT the inbound bearer.
      expect(headers['Authorization']).toBe(`Bearer ${dbAccessToken}`);
      expect(headers['Authorization']).not.toBe(`Bearer ${inboundBearer}`);

      // OBO ID tokens for ARM + AWS Identity Center
      expect(headers['X-Azure-ID-Token']).toBe(inboundIdToken);
      expect(headers['X-AWS-ID-Token']).toBe(inboundIdToken);

      // Workspace isolation hints
      expect(headers['X-User-Id']).toBe('azure_abc123');
      expect(headers['X-User-Email']).toBe('admin@example.onmicrosoft.com');

      // POST shape: mcp-proxy infers server from tool name (no explicit `server` field).
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.tool).toBe('azure_list_subscriptions');

      // AzureTokenService consulted exactly once per dispatch (no leaks).
      expect(tokenServiceStub.getOrRefreshToken).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'Azure-AD user with NO DB-persisted token (refresh failed) → falls back to inbound bearer (degraded but not blocked)',
    async () => {
      const { fetchSpy, calls } = makeFetchSpy();
      globalThis.fetch = fetchSpy as any;

      const inboundBearer = makeJwt({ oid: 'azure-oid' });
      const tokenServiceStub = {
        getOrRefreshToken: vi.fn(async () => null), // DB miss / refresh failed
      };

      const deps = buildChatV2Deps({
        providerManager: undefined as any,
        azureTokenService: tokenServiceStub as any,
      });

      const ctx = {
        user: {
          id: 'azure_no_db',
          email: 'no-db@example.com',
          authMethod: 'azure-ad',
          accessToken: inboundBearer,
        },
      };

      await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

      const headers = (calls[0].init.headers as Record<string, string>) ?? {};
      // Degraded path: inbound bearer is forwarded so the request still has
      // SOME identity. MCP proxy will likely fail OBO with AADSTS240002 if
      // it's an id_token — but a clear error is better than a silent 401.
      expect(headers['Authorization']).toBe(`Bearer ${inboundBearer}`);
    },
  );

  it(
    'AzureTokenService throws → graceful fallback to inbound bearer (does NOT crash chat turn)',
    async () => {
      const { fetchSpy, calls } = makeFetchSpy();
      globalThis.fetch = fetchSpy as any;

      const inboundBearer = makeJwt({ oid: 'azure-oid' });
      const tokenServiceStub = {
        getOrRefreshToken: vi.fn(async () => {
          throw new Error('DB connection refused');
        }),
      };

      const deps = buildChatV2Deps({
        providerManager: undefined as any,
        azureTokenService: tokenServiceStub as any,
      });

      const ctx = {
        user: {
          id: 'azure_db_down',
          authMethod: 'azure-ad',
          accessToken: inboundBearer,
        },
      };

      const result = await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

      // Chat turn did NOT crash on the DB outage.
      expect(result.ok).toBe(true);
      const headers = (calls[0].init.headers as Record<string, string>) ?? {};
      expect(headers['Authorization']).toBe(`Bearer ${inboundBearer}`);
    },
  );

  it(
    'Non-Azure auth (api-key / local) → azureTokenService is NOT consulted; internal HS256 JWT is used',
    async () => {
      const { fetchSpy, calls } = makeFetchSpy();
      globalThis.fetch = fetchSpy as any;

      const tokenServiceStub = {
        getOrRefreshToken: vi.fn(async () => ({ access_token: 'should-not-be-used' })),
      };

      const deps = buildChatV2Deps({
        providerManager: undefined as any,
        azureTokenService: tokenServiceStub as any,
      });

      const ctx = {
        user: {
          id: 'local_42',
          email: 'local@example.com',
          authMethod: 'local',
        },
      };

      await deps.executeMcpTool!(ctx, 'admin_system_postgres_health_check', {});

      const headers = (calls[0].init.headers as Record<string, string>) ?? {};
      const auth = headers['Authorization'] ?? '';
      expect(auth).toMatch(/^Bearer /);
      const token = auth.replace(/^Bearer /, '');
      // Internal HS256 JWT, NOT the Azure token (which is irrelevant for non-Azure auth).
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      expect(decoded.userId).toBe('local_42');
      expect(tokenServiceStub.getOrRefreshToken).not.toHaveBeenCalled();
    },
  );
});

describe('OBO auth-header — wire-in source-regression (architecture cage)', () => {
  it('chat/index.ts wires `azureTokenService` into buildChatV2Deps', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexPath = join(__dirname, '..', '..', 'routes', 'chat', 'index.ts');
    const src = readFileSync(indexPath, 'utf8');

    // Pin: the factory call must include the azureTokenService param.
    const factoryCallIdx = src.indexOf('buildChatV2Deps({');
    expect(factoryCallIdx, 'chat/index.ts must call buildChatV2Deps with options').toBeGreaterThan(-1);
    const closeIdx = src.indexOf('});', factoryCallIdx);
    expect(closeIdx, 'buildChatV2Deps options block must close').toBeGreaterThan(-1);
    const block = src.slice(factoryCallIdx, closeIdx);
    expect(block).toMatch(/azureTokenService/);

    // Pin: streamHandlerDeps exposes getAzureTokenInfo so stream.handler can
    // load the DB token at the per-request boundary.
    expect(src).toMatch(/getAzureTokenInfo:\s*async/);
    expect(src).toMatch(/services\.auth\.getAzureTokenInfo/);
  });

  it('stream.handler.ts builds ctx.user with accessToken+idToken from deps.getAzureTokenInfo', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const handlerPath = join(__dirname, '..', '..', 'routes', 'chat', 'handlers', 'stream.handler.ts');
    const src = readFileSync(handlerPath, 'utf8');

    // Pin: at the request boundary, the handler loads Azure tokens.
    expect(src).toMatch(/deps\.getAzureTokenInfo\(v2UserId\)/);
    // Pin: the loaded tokens populate the ctx.user shape buildChatV2Deps reads.
    expect(src).toMatch(/accessToken:\s*azureAccessToken/);
    expect(src).toMatch(/idToken:\s*azureIdToken/);
    expect(src).toMatch(/authMethod:\s*resolvedAuthMethod/);
  });
});
