/**
 * Theme A / S1-1: tenant context middleware tests.
 *
 * Verifies the request-side resolution path: JWT claim or User row to
 * `request.tenantId`, and the AsyncLocalStorage scope wrapping.
 */

import { describe, it, expect } from 'vitest';
import {
  defaultTenantExtractor,
  resolveTenant,
  runWithTenantContext,
  requireTenant,
  TenantRequiredError,
} from '../tenantContext.js';
import { getCurrentTenant } from '../../utils/tenantPrismaExtension.js';

function makeRequest(user: any): any {
  return { user };
}

describe('defaultTenantExtractor', () => {
  it('returns null when there is no user', () => {
    expect(defaultTenantExtractor(makeRequest(undefined))).toBeNull();
  });

  it('prefers user.tenantId (Microsoft Identity claim shape)', () => {
    expect(
      defaultTenantExtractor(makeRequest({ tenantId: 'tenant-A', azure_tenant_id: 'tenant-B' })),
    ).toBe('tenant-A');
  });

  it('falls back to user.azure_tenant_id when tenantId is absent', () => {
    expect(
      defaultTenantExtractor(makeRequest({ azure_tenant_id: 'tenant-B' })),
    ).toBe('tenant-B');
  });

  it('falls back to user.tid (raw JWT claim) as the last resort', () => {
    expect(defaultTenantExtractor(makeRequest({ tid: 'tenant-C' }))).toBe('tenant-C');
  });
});

describe('resolveTenant', () => {
  it('stamps tenantId on the request', () => {
    const req = makeRequest({ tenantId: 'tenant-A' });
    const result = resolveTenant(req);
    expect(result).toBe('tenant-A');
    expect(req.tenantId).toBe('tenant-A');
  });

  it('stamps null when no tenant is resolvable', () => {
    const req = makeRequest(undefined);
    expect(resolveTenant(req)).toBeNull();
    expect(req.tenantId).toBeNull();
  });

  it('honours a custom extractor', () => {
    const req: any = { customField: 'tenant-X' };
    const result = resolveTenant(req, (r: any) => r.customField);
    expect(result).toBe('tenant-X');
  });
});

describe('runWithTenantContext', () => {
  it('enters an AsyncLocalStorage scope visible to nested awaits', async () => {
    const req = makeRequest({ tenantId: 'tenant-A' });
    resolveTenant(req);
    let observed: string | null | undefined;
    await runWithTenantContext(req, async () => {
      await Promise.resolve();
      observed = getCurrentTenant()?.tenantId;
    });
    expect(observed).toBe('tenant-A');
  });

  it('forwards override flags (e.g. onLegacyRead)', async () => {
    const req = makeRequest({ tenantId: 'tenant-A' });
    resolveTenant(req);
    const onLegacy = (model: string, op: string) => `${model}.${op}`;
    let captured: any;
    await runWithTenantContext(req, async () => {
      captured = getCurrentTenant()?.onLegacyRead;
    }, { onLegacyRead: onLegacy });
    expect(captured).toBe(onLegacy);
  });
});

describe('requireTenant', () => {
  it('returns the tenant id when present', () => {
    const req: any = { tenantId: 'tenant-A' };
    expect(requireTenant(req)).toBe('tenant-A');
  });

  it('throws TenantRequiredError when missing', () => {
    const req: any = {};
    expect(() => requireTenant(req)).toThrowError(TenantRequiredError);
  });

  it('TenantRequiredError carries 401 statusCode + TENANT_REQUIRED code', () => {
    const err = new TenantRequiredError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('TENANT_REQUIRED');
  });
});
