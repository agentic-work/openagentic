/**
 * Theme A / S1-1: Tenant-injection Prisma extension tests.
 *
 * RED-first: each test should fail without the extension's pure-function
 * helpers, then pass once the extension is wired up.
 *
 * Pure-function tests — no live Prisma client. The integration that
 * threads through PrismaClient.$extends is exercised by the cross-tenant
 * isolation suite separately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('tenantPrismaExtension - injectTenantWhere', () => {
  it('returns the original where untouched when tenantId is null', () => {
    expect(injectTenantWhere({ id: 'wf1' }, null)).toEqual({ id: 'wf1' });
  });

  it('returns just the tenant predicate when where is empty', () => {
    expect(injectTenantWhere({}, 'tenant-A')).toEqual({
      OR: [{ tenant_id: 'tenant-A' }, { tenant_id: null }],
    });
  });

  it('returns just the tenant predicate when where is undefined', () => {
    expect(injectTenantWhere(undefined, 'tenant-A')).toEqual({
      OR: [{ tenant_id: 'tenant-A' }, { tenant_id: null }],
    });
  });

  it('AND-folds tenant predicate into existing where', () => {
    const result = injectTenantWhere({ id: 'wf1', is_active: true }, 'tenant-A');
    expect(result).toEqual({
      AND: [
        { id: 'wf1', is_active: true },
        { OR: [{ tenant_id: 'tenant-A' }, { tenant_id: null }] },
      ],
    });
  });

  it('respects an explicit tenant_id in the caller-supplied where (system bypass tooling)', () => {
    const result = injectTenantWhere({ tenant_id: 'tenant-OTHER' }, 'tenant-A');
    expect(result).toEqual({ tenant_id: 'tenant-OTHER' });
  });
});

describe('tenantPrismaExtension - injectTenantData', () => {
  it('adds tenant_id to a single create row', () => {
    const result = injectTenantData({ name: 'wf1' }, 'tenant-A');
    expect(result).toEqual({ name: 'wf1', tenant_id: 'tenant-A' });
  });

  it('adds tenant_id to every row of a createMany batch', () => {
    const result = injectTenantData(
      [{ name: 'a' }, { name: 'b' }],
      'tenant-A',
    );
    expect(result).toEqual([
      { name: 'a', tenant_id: 'tenant-A' },
      { name: 'b', tenant_id: 'tenant-A' },
    ]);
  });

  it('preserves caller-supplied tenant_id', () => {
    const result = injectTenantData(
      { name: 'wf1', tenant_id: 'tenant-EXPLICIT' },
      'tenant-A',
    );
    expect(result).toEqual({ name: 'wf1', tenant_id: 'tenant-EXPLICIT' });
  });

  it('returns the data unchanged when tenantId is null', () => {
    expect(injectTenantData({ name: 'wf1' }, null)).toEqual({ name: 'wf1' });
  });

  it('returns undefined when data is undefined', () => {
    expect(injectTenantData(undefined, 'tenant-A')).toBeUndefined();
  });
});

describe('tenantPrismaExtension - tagged models registry', () => {
  it('includes every required workflow-domain model', () => {
    const required = [
      'Workflow',
      'WorkflowVersion',
      'WorkflowExecution',
      'WorkflowApproval',
      'WorkflowExecutionLog',
      'WorkflowWebhook',
      'WorkflowSchedule',
      'WorkflowTest',
      'WorkflowTemplate',
      'WorkflowShare',
      'WorkflowSecret',
      'DataSource',
      'IdempotencyKey',
      'FlowAuditLog',
      'Integration',
      'IntegrationLog',
    ];
    for (const m of required) {
      expect(TENANTED_MODELS.has(m)).toBe(true);
    }
  });

  it('does NOT include unrelated models (User, ChatSession, etc.)', () => {
    expect(TENANTED_MODELS.has('User')).toBe(false);
    expect(TENANTED_MODELS.has('ChatSession')).toBe(false);
    expect(TENANTED_MODELS.has('LLMRequestLog')).toBe(false);
  });
});

describe('tenantPrismaExtension - AsyncLocalStorage scope', () => {
  beforeEach(() => {
    // No-op; AsyncLocalStorage is per-call.
  });

  it('withTenant exposes the context to nested awaits', async () => {
    let observed: string | null | undefined;
    await withTenant({ tenantId: 'tenant-A' }, async () => {
      await Promise.resolve();
      observed = getCurrentTenant()?.tenantId;
    });
    expect(observed).toBe('tenant-A');
  });

  it('contexts are isolated between concurrent calls', async () => {
    const seen: string[] = [];
    await Promise.all([
      withTenant({ tenantId: 'tenant-A' }, async () => {
        await Promise.resolve();
        seen.push(getCurrentTenant()!.tenantId!);
      }),
      withTenant({ tenantId: 'tenant-B' }, async () => {
        await Promise.resolve();
        seen.push(getCurrentTenant()!.tenantId!);
      }),
    ]);
    expect(seen.sort()).toEqual(['tenant-A', 'tenant-B']);
  });

  it('withSystemTenant marks the context as bypass', async () => {
    let bypass: boolean | undefined;
    await withSystemTenant(async () => {
      bypass = getCurrentTenant()?.bypass;
    });
    expect(bypass).toBe(true);
  });

  it('outside any scope, getCurrentTenant returns undefined', () => {
    expect(getCurrentTenant()).toBeUndefined();
  });
});

describe('tenantPrismaExtension - extension wraps PrismaClient query layer', () => {
  // Import locally so the mock-friendly path is exercised.
  it('createTenantExtension returns a defineExtension result', async () => {
    const { createTenantExtension } = await import('../tenantPrismaExtension.js');
    const ext = createTenantExtension();
    // defineExtension returns either a function or an object depending on
    // Prisma version; both are truthy and have a `name`.
    expect(ext).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// S5.b — fail-loud on bypass.
// The extension MUST throw when a tenanted-model query runs outside any
// withTenant() / withSystemTenant() scope. Silent passthrough was the old
// "Strategy A fail-open in dev" stance; per 2026-05-09 user direction
// (always do what is BEST long term) the contract tightens to fail-CLOSED.
//
// Mirrors the workflows-side suite — same 7 cases, same expectations.
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
