/**
 * Phase 3.2 — integrations routes plugin smoke tests.
 *
 * Spins up an isolated Fastify instance, decorates a stubbed AppContext via
 * decorateApp(), registers integrationsRoutesPlugin, then asserts that each
 * sub-route is mounted at the correct prefix using inject()-based assertions
 * (per Phase 3.1 lesson #2: prefer inject() over printRoutes() substring matching
 * to avoid brittle radix-tree format issues).
 *
 * Sub-routes covered:
 *  1. azureADSyncRoutes        — POST /api/auth/azure/sync (no prefix passed)
 *  2. accountLinkingRoutes     — endpoints under no extra prefix (registers with
 *                                 its own full paths inside)
 *  3. azureIntegrationPlugin   — registered at /api/azure
 *
 * Smoke-test honesty:
 *  - azureADSyncRoutes hits Prisma at module-load. We can't easily stub Prisma
 *    at the module level without a heavier mock. That route is exercised by a
 *    presence check (400 missing body), not a happy-path call.
 *  - accountLinkingRoutes imports AzureOBOService which requires env vars. We
 *    assert a 400/401/404 to confirm the route IS mounted.
 *  - azureIntegrationPlugin sub-routes make external calls. We verify a 401
 *    response (auth guard fires, meaning the route IS mounted).
 *
 * Bun-compatibility rules:
 *  - vi.fn() factories captured BEFORE any import factory (no module-scope
 *    vi.mocked() calls).
 *  - Dynamic import inside beforeAll so stubs are in place first.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppContext, decorateApp } from '../../context/AppContext.js';

// ---------------------------------------------------------------------------
// Stub deps — minimal surface to satisfy plugin instantiation
// ---------------------------------------------------------------------------

const stubPrisma = { _stub: true } as any;
const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: function () { return this; },
} as any;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('integrationsRoutesPlugin — Phase 3.2 smoke tests', () => {
  it.todo(
    'accountLinkingRoutes — /link-accounts and /linked-status/:userId are NOT ' +
    'exercised end-to-end here because the route module imports AzureOBOService ' +
    'which requires JWT_SECRET + Azure env vars to be set. The presence assertions ' +
    'below (400/404 from unknown paths) confirm registration. ' +
    'Follow-up: add an integration test with full env stubs.'
  );

  let server: FastifyInstance;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Provide minimum env vars required by module-level guards in the sub-routes:
    //  - account-linking.ts:  throws if JWT_SECRET/SIGNING_SECRET absent
    //  - azure-integration/auth.ts: throws if JWT_SECRET absent AND MSAL is
    //    instantiated with empty clientSecret
    savedEnv.JWT_SECRET = process.env.JWT_SECRET;
    savedEnv.SIGNING_SECRET = process.env.SIGNING_SECRET;
    savedEnv.AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
    savedEnv.AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
    savedEnv.AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
    process.env.JWT_SECRET = 'test-jwt-secret-phase32';
    // Provide stub Azure creds so MSAL ConfidentialClientApplication does not
    // throw "client credential must not be empty" during azureAuthRoutes init.
    process.env.AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || 'stub-client-id';
    process.env.AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || 'stub-client-secret';
    process.env.AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || 'stub-tenant-id';

    server = Fastify({ logger: false });

    // Wire a stubbed AppContext (matches what server.ts does via decorateApp).
    const ctx = new AppContext({ prisma: stubPrisma, logger: stubLogger });
    decorateApp(server, ctx);

    // Import the plugin AFTER stubs are in place.
    const { integrationsRoutesPlugin } = await import('../integrations.plugin.js');

    await server.register(integrationsRoutesPlugin, {});

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    // Restore env.
    if (savedEnv.JWT_SECRET === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = savedEnv.JWT_SECRET;
    }
    if (savedEnv.SIGNING_SECRET === undefined) {
      delete process.env.SIGNING_SECRET;
    } else {
      process.env.SIGNING_SECRET = savedEnv.SIGNING_SECRET;
    }
    if (savedEnv.AZURE_CLIENT_ID === undefined) {
      delete process.env.AZURE_CLIENT_ID;
    } else {
      process.env.AZURE_CLIENT_ID = savedEnv.AZURE_CLIENT_ID;
    }
    if (savedEnv.AZURE_CLIENT_SECRET === undefined) {
      delete process.env.AZURE_CLIENT_SECRET;
    } else {
      process.env.AZURE_CLIENT_SECRET = savedEnv.AZURE_CLIENT_SECRET;
    }
    if (savedEnv.AZURE_TENANT_ID === undefined) {
      delete process.env.AZURE_TENANT_ID;
    } else {
      process.env.AZURE_TENANT_ID = savedEnv.AZURE_TENANT_ID;
    }
  });

  // ── 1. azureADSyncRoutes ─────────────────────────────────────────────────
  // Route registers at /api/auth/azure/sync (absolute path, no prefix needed).

  it('POST /api/auth/azure/sync returns 400 on missing body (route IS mounted)', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/auth/azure/sync',
      headers: { 'content-type': 'application/json' },
      payload: {},  // missing required oid + email
    });
    // 400 = the route is mounted and the handler ran (rejected bad input).
    // 404 would mean the route was NOT registered — that's the failure we're guarding against.
    expect(resp.statusCode).toBe(400);
  });

  it('GET /api/auth/azure/user/:oid returns non-404 (route IS mounted)', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/api/auth/azure/user/test-oid-probe',
    });
    // Any non-404 (400/401/500) confirms the route is present.
    expect(resp.statusCode).not.toBe(404);
  });

  // ── 2. accountLinkingRoutes ──────────────────────────────────────────────
  // Routes register at /link-accounts, /linked-status/:userId, /unlink/:userId,
  // /accounts/linked-azure, /accounts/unlink-azure (no prefix, absolute paths).

  it('POST /link-accounts returns non-404 (route IS mounted)', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/link-accounts',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    // 400 (bad body) or 401 (unauth) means the handler ran — not 404.
    expect(resp.statusCode).not.toBe(404);
  });

  it('GET /accounts/linked-azure returns non-404 (route IS mounted)', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/accounts/linked-azure',
    });
    // Auth guard fires → 401/403, or handler returns something — not 404.
    expect(resp.statusCode).not.toBe(404);
  });

  // ── 3. azureIntegrationPlugin ────────────────────────────────────────────
  // Registered at prefix /api/azure. Sub-routes include /auth/status, /admin/azure, etc.

  it('GET /api/azure/auth/status returns non-404 (azureIntegrationPlugin IS mounted)', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/api/azure/auth/status',
    });
    // The route exists — 401 (auth check) or any non-404 is a pass.
    expect(resp.statusCode).not.toBe(404);
  });

  it('POST /api/azure/auth/link returns non-404 (azureIntegrationPlugin IS mounted)', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/azure/auth/link',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    // Handler exists — auth or validation rejects, but route IS mounted.
    expect(resp.statusCode).not.toBe(404);
  });
});
