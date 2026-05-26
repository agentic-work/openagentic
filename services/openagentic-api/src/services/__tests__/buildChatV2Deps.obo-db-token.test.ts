/**
 * Bug fix regression — buildMcpProxyHeaders must use the DB-persisted
 * Azure access_token (via AzureTokenService.getOrRefreshToken), NOT
 * the inbound bearer from ctx.user.accessToken.
 *
 * LIVE failure observed 2026-05-11 (chat-dev):
 *   - User invokes azure_list_subscriptions via chat
 *   - api forwards user's inbound bearer as `Authorization: Bearer ...` to mcp-proxy
 *   - mcp-proxy attempts OBO exchange: POST login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *       grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
 *       assertion=<inbound bearer>
 *       scope=https://management.azure.com/.default (and vault, graph, etc.)
 *   - Azure rejects: "AADSTS240002: Input id_token cannot be used as
 *     'urn:ietf:params:oauth:grant-type:jwt-bearer' grant."
 *   - The inbound bearer is an id_token (the SPA's session token from
 *     /api/auth/microsoft/login), not an access_token with audience=our-app.
 *   - The api ALREADY persists the proper Azure access_token in the
 *     `user_auth_token` table via AzureTokenService.storeUserAzureToken().
 *     It just wasn't being used in the chat-pipeline → mcp-proxy hop.
 *
 * Contract under test:
 *   1. For an Azure-AD user, when azureTokenService is wired into the
 *      deps, the Authorization header sent to mcp-proxy contains the
 *      DB-persisted access_token, NOT ctx.user.accessToken.
 *   2. azureTokenService.getOrRefreshToken is called with the user's id.
 *   3. If getOrRefreshToken returns null (e.g. token never stored), the
 *      function gracefully falls back to ctx.user.accessToken so the
 *      request isn't silently dropped — existing flows keep working.
 *   4. The non-Azure path (api-key, local, anonymous) is unchanged —
 *      no DB lookup is attempted (azureTokenService is not consulted).
 *
 * Per CLAUDE.md TDD discipline: this file is RED before the fix, GREEN after.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

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
  return jwt.sign(payload, 'test-secret', { expiresIn: '1h' });
}

function makeAzureTokenServiceStub(opts: {
  accessToken?: string | null;
  shouldThrow?: boolean;
}) {
  const calls: { userId: string }[] = [];
  return {
    calls,
    stub: {
      getOrRefreshToken: vi.fn(async (userId: string) => {
        calls.push({ userId });
        if (opts.shouldThrow) throw new Error('DB unavailable');
        if (opts.accessToken === null) return null;
        return {
          access_token: opts.accessToken ?? 'REAL_DB_PERSISTED_AZURE_ACCESS_TOKEN',
          id_token: undefined,
          expires_at: new Date(Date.now() + 3600 * 1000),
          is_expired: false,
        };
      }),
    },
  };
}

function makeMinimalOpts(extras: Record<string, any> = {}) {
  return {
    providerManager: undefined as any,
    getOrchestrator: () => null as any,
    prismaLike: undefined as any,
    chatStorage: undefined as any,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildChatV2Deps.makeExecuteMcpTool — DB-persisted access_token for OBO (LIVE 2026-05-11)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.API_INTERNAL_KEY = 'test-api-internal-key';
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8080';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('Azure-AD user → uses DB-persisted access_token from AzureTokenService, NOT inbound bearer', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const { calls: tokenSvcCalls, stub: tokenServiceStub } = makeAzureTokenServiceStub({});

    const deps = buildChatV2Deps(makeMinimalOpts({
      azureTokenService: tokenServiceStub,
    }));

    const inboundBearer = makeFakeJwt({ sub: 'user-1', oid: 'azure-oid-1', nonce: 'id-token-nonce' });
    const ctx = {
      user: {
        id: 'azure_abc123',
        email: 'mcp-tester@example.com',
        accessToken: inboundBearer,        // inbound bearer (probably an id_token)
        authMethod: 'azure-ad',
      },
    };

    await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

    // AzureTokenService MUST have been consulted with the user's id
    expect(tokenSvcCalls).toHaveLength(1);
    expect(tokenSvcCalls[0].userId).toBe('azure_abc123');

    // Authorization header MUST be the DB-persisted access_token,
    // NOT the inbound bearer.
    expect(calls).toHaveLength(1);
    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBe('Bearer REAL_DB_PERSISTED_AZURE_ACCESS_TOKEN');
    expect(headers['Authorization']).not.toBe(`Bearer ${inboundBearer}`);
  });

  it('Azure-AD user with NULL DB token → graceful fallback to ctx.user.accessToken (no silent drop)', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const { stub: tokenServiceStub } = makeAzureTokenServiceStub({ accessToken: null });

    const deps = buildChatV2Deps(makeMinimalOpts({
      azureTokenService: tokenServiceStub,
    }));

    const inboundBearer = makeFakeJwt();
    const ctx = {
      user: {
        id: 'azure_never_stored',
        email: 'new-user@example.com',
        accessToken: inboundBearer,
        authMethod: 'azure-ad',
      },
    };

    await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    // Falls back to inbound bearer rather than sending NO auth header.
    expect(headers['Authorization']).toBe(`Bearer ${inboundBearer}`);
  });

  it('Azure-AD user with DB lookup ERROR → graceful fallback to ctx.user.accessToken (no crash)', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const { stub: tokenServiceStub } = makeAzureTokenServiceStub({ shouldThrow: true });

    const deps = buildChatV2Deps(makeMinimalOpts({
      azureTokenService: tokenServiceStub,
    }));

    const inboundBearer = makeFakeJwt();
    const ctx = {
      user: {
        id: 'azure_abc123',
        email: 'mcp-tester@example.com',
        accessToken: inboundBearer,
        authMethod: 'azure-ad',
      },
    };

    // Must not throw
    await expect(
      deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {})
    ).resolves.toBeDefined();

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBe(`Bearer ${inboundBearer}`);
  });

  it('Non-Azure auth (api-key) → azureTokenService is NOT consulted, existing internal-JWT path unchanged', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const { calls: tokenSvcCalls, stub: tokenServiceStub } = makeAzureTokenServiceStub({});

    const deps = buildChatV2Deps(makeMinimalOpts({
      azureTokenService: tokenServiceStub,
    }));

    const ctx = {
      user: {
        id: 'local_user_42',
        email: 'local@example.com',
        authMethod: 'local',  // NOT azure-ad
        // no accessToken
      },
    };

    await deps.executeMcpTool!(ctx, 'admin_system_postgres_health_check', {});

    // azureTokenService not consulted
    expect(tokenSvcCalls).toHaveLength(0);

    // Existing internal-JWT fallback path used
    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toMatch(/^Bearer /);
    const token = (headers['Authorization'] ?? '').replace(/^Bearer /, '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    expect(decoded.userId).toBe('local_user_42');
  });

  it('Azure-AD user but NO azureTokenService wired → falls back to inbound bearer (legacy)', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    // No azureTokenService in opts — legacy code path
    const deps = buildChatV2Deps(makeMinimalOpts({}));

    const inboundBearer = makeFakeJwt();
    const ctx = {
      user: {
        id: 'azure_abc123',
        email: 'mcp-tester@example.com',
        accessToken: inboundBearer,
        authMethod: 'azure-ad',
      },
    };

    await deps.executeMcpTool!(ctx, 'azure_list_subscriptions', {});

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBe(`Bearer ${inboundBearer}`);
  });
});
