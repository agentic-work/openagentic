/**
 * Theme A / S1-1 (workflows mirror): pure-function tests for the
 * tenant-injection Prisma extension.
 *
 * Mirror of the api-side suite — same source file, same expectations.
 * Lives here so the workflows package's vitest run independently
 * verifies the extension when this service is built/tested in isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  injectTenantWhere,
  injectTenantData,
  TENANTED_MODELS,
  withTenant,
  withSystemTenant,
  getCurrentTenant,
  TenantNotSetError,
  tenantOperationHandler,
} from '../tenantPrismaExtension.js';

describe('workflows.tenantPrismaExtension - injectTenantWhere', () => {
  it('returns tenant predicate when where empty', () => {
    expect(injectTenantWhere({}, 'tenant-A')).toEqual({
      OR: [{ tenant_id: 'tenant-A' }, { tenant_id: null }],
    });
  });

  it('AND-folds tenant predicate into existing where', () => {
    expect(injectTenantWhere({ id: 'wf1' }, 'tenant-A')).toEqual({
      AND: [
        { id: 'wf1' },
        { OR: [{ tenant_id: 'tenant-A' }, { tenant_id: null }] },
      ],
    });
  });

  it('returns where unchanged when tenantId null', () => {
    expect(injectTenantWhere({ id: 'wf1' }, null)).toEqual({ id: 'wf1' });
  });
});

describe('workflows.tenantPrismaExtension - injectTenantData', () => {
  it('adds tenant_id to single create', () => {
    expect(injectTenantData({ name: 'wf' }, 'tenant-A')).toEqual({
      name: 'wf',
      tenant_id: 'tenant-A',
    });
  });

  it('adds tenant_id to each row of createMany', () => {
    expect(
      injectTenantData([{ name: 'a' }, { name: 'b' }], 'tenant-A'),
    ).toEqual([
      { name: 'a', tenant_id: 'tenant-A' },
      { name: 'b', tenant_id: 'tenant-A' },
    ]);
  });
});

describe('workflows.tenantPrismaExtension - tagged models', () => {
  it('IdempotencyKey is tenant-scoped on the workflows side', () => {
    expect(TENANTED_MODELS.has('IdempotencyKey')).toBe(true);
  });
});

describe('workflows.tenantPrismaExtension - AsyncLocalStorage', () => {
  it('withTenant scope visible to nested awaits', async () => {
    let observed: string | null | undefined;
    await withTenant({ tenantId: 'tenant-A' }, async () => {
      await Promise.resolve();
      observed = getCurrentTenant()?.tenantId;
    });
    expect(observed).toBe('tenant-A');
  });
});

// ---------------------------------------------------------------------------
// S5.b — fail-loud on bypass.
// The extension MUST throw when a tenanted-model query runs outside any
// withTenant() / withSystemTenant() scope. Silent passthrough was the old
// "Strategy A fail-open in dev" stance; per 2026-05-09 user direction
// (always do what is BEST long term) the contract tightens to fail-CLOSED.
// ---------------------------------------------------------------------------

describe('tenantPrismaExtension — fail-loud on bypass (S5.b)', () => {
  it('TenantNotSetError exported from the module', () => {
    expect(typeof TenantNotSetError).toBe('function');
    const err = new TenantNotSetError('Workflow', 'findMany');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TenantNotSetError');
    expect(err.message).toMatch(/Workflow/);
    expect(err.message).toMatch(/findMany/);
    expect(err.message).toMatch(/withTenant/);
  });

  it('throws TenantNotSetError when prisma query on a tenanted model runs outside withTenant scope', async () => {
    const query = async (_a: any) => ({ id: 'should-not-reach' });

    // Invoke OUTSIDE any AsyncLocalStorage scope — ctx is undefined.
    await expect(
      tenantOperationHandler({
        model: 'Workflow',
        operation: 'findMany',
        args: { where: {} },
        query,
      }),
    ).rejects.toBeInstanceOf(TenantNotSetError);
  });

  it('throws TenantNotSetError when ctx is set but tenantId is missing (and not bypass)', async () => {
    const query = async (_a: any) => ({ id: 'should-not-reach' });

    // Inside a withTenant({ tenantId: null }) scope but NOT a system bypass.
    // This is the "anonymous request hit a tenanted model" case.
    await expect(
      withTenant({ tenantId: null }, () =>
        tenantOperationHandler({
          model: 'Workflow',
          operation: 'findMany',
          args: { where: {} },
          query,
        }),
      ),
    ).rejects.toBeInstanceOf(TenantNotSetError);
  });

  it('does NOT throw when withTenant({ tenantId }) wrapped — happy path', async () => {
    const seen: any[] = [];
    const query = async (a: any) => {
      seen.push(a);
      return [{ id: 'wf1', tenant_id: 'tenant-x' }];
    };

    const result = await withTenant({ tenantId: 'tenant-x' }, () =>
      tenantOperationHandler({
        model: 'Workflow',
        operation: 'findMany',
        args: { where: { name: 'demo' } },
        query,
      }),
    );

    expect(result).toEqual([{ id: 'wf1', tenant_id: 'tenant-x' }]);
    // The injected where should AND-fold the tenant predicate in.
    expect(seen).toHaveLength(1);
    expect(seen[0].where).toEqual({
      AND: [
        { name: 'demo' },
        { OR: [{ tenant_id: 'tenant-x' }, { tenant_id: null }] },
      ],
    });
  });

  it('does NOT throw when withSystemTenant() wrapped — system path', async () => {
    const query = async (_a: any) => ({ ok: true });

    const result = await withSystemTenant(() =>
      tenantOperationHandler({
        model: 'Workflow',
        operation: 'findMany',
        args: { where: {} },
        query,
      }),
    );

    expect(result).toEqual({ ok: true });
  });

  it('does NOT throw on non-tenanted models even outside withTenant scope', async () => {
    const query = async (_a: any) => ({ ok: true });

    const nonTenantedModel = 'SomeModelNotInTenantedSet';
    expect(TENANTED_MODELS.has(nonTenantedModel)).toBe(false);

    const result = await tenantOperationHandler({
      model: nonTenantedModel,
      operation: 'findMany',
      args: { where: {} },
      query,
    });

    expect(result).toEqual({ ok: true });
  });

  it('does NOT throw when model is undefined (e.g. raw query) — passthrough', async () => {
    const query = async (_a: any) => 1;
    const result = await tenantOperationHandler({
      model: undefined,
      operation: 'queryRaw',
      args: [],
      query,
    });
    expect(result).toBe(1);
  });
});
