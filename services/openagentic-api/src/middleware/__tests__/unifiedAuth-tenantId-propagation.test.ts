/**
 * SEV-0 Flows-fix-A1: unifiedAuth must propagate `tenantId` from the
 * validated UserContext onto `request.user`, so that
 * `defaultTenantExtractor` in tenantContext.ts can resolve it.
 *
 * The pre-fix bug: `validateAnyToken` returns a `UserContext` with a
 * populated `tenantId` field (Azure AD: `decoded.tid`, local: `'local'`,
 * google: hosted-domain, api-key: `'api-key'`). But unifiedAuthHook
 * built `request.user` field-by-field and silently DROPPED `tenantId`.
 *
 * Downstream effect: every request had `request.tenantId === null`,
 * which meant every workflows-svc /execute POST shipped `tenantId:null`,
 * workflows-svc's `validateTenantId` 400-rejected, and no Flow ever
 * executed end-to-end. Audit 2026-05-13.
 *
 * This pin replays the field-copy logic the same way unifiedAuth does
 * and asserts the resulting `request.user` carries `tenantId`. Replaces
 * a Bun-unfriendly full-Fastify integration test (the Fastify-v5
 * raw.writableEnded quirk makes authenticated route tests 404 in the
 * Bun vitest runtime — same reason workflows-integration.test.ts marks
 * all 8 tests as it.todo).
 */

import { describe, it, expect } from 'vitest';
// SUT: production helper exported from unifiedAuth.ts. Built as a pure
// function so we can pin its field-copy behavior without spinning up
// Fastify (which has the Bun raw.writableEnded quirk anyway).
import { buildRequestUser } from '../unifiedAuth.js';

describe('unifiedAuth — tenantId propagation (SEV-0 Flows-fix-A1)', () => {
  it('Azure AD token: request.user.tenantId equals decoded.tid', () => {
    const validatedUser = {
      userId: 'azure_oid-1234',
      email: 'mcp-tester@phatoldsungmail.onmicrosoft.com',
      name: 'MCP Tester',
      isAdmin: false,
      groups: [],
      tenantId: '2b8e2e84-2222-4444-8888-aaaaaaaaaaaa', // <— this is decoded.tid
      oid: 'oid-1234',
    };

    const requestUser = buildRequestUser(validatedUser, 'azure-ad', 'eyJ...token');

    expect(requestUser.tenantId).toBe('2b8e2e84-2222-4444-8888-aaaaaaaaaaaa');
    expect(requestUser.tenantId).not.toBeNull();
    expect(typeof requestUser.tenantId).toBe('string');
  });

  it('Local JWT: request.user.tenantId equals the literal "local"', () => {
    const validatedUser = {
      userId: 'local-user-1',
      email: 'admin@openagentic.io',
      name: 'Admin',
      isAdmin: true,
      groups: ['admin'],
      tenantId: 'local',
    };

    const requestUser = buildRequestUser(validatedUser, 'local', 'jwt-token');

    expect(requestUser.tenantId).toBe('local');
    expect(requestUser.tenantId).not.toBeNull();
  });

  it('API key: request.user.tenantId equals the literal "api-key"', () => {
    const validatedUser = {
      userId: 'api-key-user',
      email: 'svc@openagentic.io',
      name: 'Service Account',
      isAdmin: false,
      groups: [],
      tenantId: 'api-key',
    };

    const requestUser = buildRequestUser(validatedUser, 'api-key', 'awc_xxxxxxxx');

    expect(requestUser.tenantId).toBe('api-key');
  });

  it('Google token: request.user.tenantId equals the hosted domain', () => {
    const validatedUser = {
      userId: 'google_abc',
      email: 'user@openagentic.io',
      name: 'User',
      isAdmin: false,
      groups: [],
      tenantId: 'openagentic.io',
    };

    const requestUser = buildRequestUser(validatedUser, 'google', 'google-id-token');

    expect(requestUser.tenantId).toBe('openagentic.io');
  });

  it('REGRESSION GUARD: tenantId is never accidentally undefined/missing on request.user', () => {
    // Even when the validated user has no tenantId for some reason,
    // request.user must have the field present (null is acceptable; absent is not,
    // because defaultTenantExtractor relies on the field existing for type-safe access).
    const validatedUser = {
      userId: 'edge-case',
      email: 'edge@test.io',
      name: 'Edge',
      isAdmin: false,
      groups: [],
    };

    const requestUser = buildRequestUser(validatedUser as any, 'local', 't');

    expect('tenantId' in requestUser).toBe(true);
    expect(requestUser.tenantId).toBeNull();
  });
});

// Integration with defaultTenantExtractor: prove that once unifiedAuth
// puts tenantId on request.user, tenantContext's extractor finds it.
import { defaultTenantExtractor } from '../tenantContext.js';

describe('unifiedAuth + tenantContext integration (SEV-0 Flows-fix-A1)', () => {
  it('defaultTenantExtractor reads tenantId stamped by unifiedAuth (Azure AD)', () => {
    const validatedUser = {
      userId: 'azure_oid-9999',
      email: 'mcp-tester@phatoldsungmail.onmicrosoft.com',
      name: 'MCP Tester',
      isAdmin: false,
      groups: [],
      tenantId: 'azure-tenant-xyz',
      oid: 'oid-9999',
    };
    const requestUser = buildRequestUser(validatedUser, 'azure-ad', 't');

    const fakeRequest: any = { user: requestUser };
    expect(defaultTenantExtractor(fakeRequest)).toBe('azure-tenant-xyz');
  });

  it('PRE-FIX BUG: if unifiedAuth had not propagated tenantId, extractor returns null', () => {
    // Simulate the pre-fix shape — same as the live observed state on chat-dev
    // where every authenticated request had request.tenantId === null.
    const requestUserMissingTenant: any = {
      id: 'u', userId: 'u', email: 'e@e.io', name: 'N',
      groups: [], isAdmin: false, localAccount: false,
      accessToken: 't', authMethod: 'azure-ad',
      // INTENTIONALLY missing: tenantId
    };

    const fakeRequest: any = { user: requestUserMissingTenant };
    expect(defaultTenantExtractor(fakeRequest)).toBeNull();
  });
});
