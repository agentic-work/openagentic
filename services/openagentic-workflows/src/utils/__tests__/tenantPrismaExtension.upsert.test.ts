/**
 * Flows SEV-0 #2 — tenant extension must NOT inject AND/OR into a
 * `WhereUniqueInput`. The previous handler folded the tenant predicate
 * into every WRITE_WHERE_OPS `where`, which is invalid for `upsert`,
 * `update`, `delete`, `findUnique`, and `findUniqueOrThrow`. Result:
 * workflows-svc status upsert threw silently and execution rows were
 * stuck at status:pending forever even when compute succeeded.
 *
 * Contract enforced here:
 *   1. For unique-key ops the handler MUST pass `where` to Prisma in a
 *      shape Prisma can accept as `WhereUniqueInput` (no AND/OR keys).
 *   2. Tenant ownership MUST still be enforced — cross-tenant upserts
 *      and updates are refused before any write reaches the row.
 *   3. The happy path (same tenant) must complete and the update payload
 *      must reach Prisma intact.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  tenantOperationHandler,
  withTenant,
} from '../tenantPrismaExtension.js';

// Build a fake base-client whose model.findFirst can be programmed
// per-test. The extension calls findFirst as the tenant ownership
// pre-check before the real unique-key op fires.
function makeFakeClient(opts: {
  findFirstResult?: any;
}): any {
  const findFirst = vi.fn().mockResolvedValue(opts.findFirstResult ?? null);
  return {
    workflowExecution: { findFirst },
  };
}

describe('tenantPrismaExtension upsert (Flows SEV-0 #2)', () => {
  it('passes a valid WhereUniqueInput to Prisma — no AND/OR keys', async () => {
    const fakeClient = makeFakeClient({
      findFirstResult: { id: 'exec-1', tenant_id: 'local' },
    });
    const seen: any[] = [];
    const query = async (a: any) => {
      seen.push(a);
      return { id: 'exec-1', tenant_id: 'local', status: 'completed' };
    };

    await withTenant({ tenantId: 'local' }, () =>
      tenantOperationHandler({
        model: 'WorkflowExecution',
        operation: 'upsert',
        args: {
          where: { id: 'exec-1' },
          update: { status: 'completed' },
          create: { id: 'exec-1', workflow_id: 'wf1', trigger_type: 'manual', input: {}, status: 'completed' },
        },
        query,
        client: fakeClient,
      } as any),
    );

    expect(seen).toHaveLength(1);
    // The where that hits Prisma must be a bare unique key.
    expect(seen[0].where).toEqual({ id: 'exec-1' });
    expect('AND' in seen[0].where).toBe(false);
    expect('OR' in seen[0].where).toBe(false);
  });

  it('refuses cross-tenant upsert (existing row owned by another tenant)', async () => {
    const fakeClient = makeFakeClient({
      findFirstResult: null, // ownership pre-check returns nothing for tenant B
    });
    // BUT the row exists owned by tenant A — we need a second probe to
    // detect that the row is alive somewhere else. Use a separate fake.
    const findFirst = vi.fn();
    findFirst.mockResolvedValueOnce(null); // scoped (tenant=B) — not found
    findFirst.mockResolvedValueOnce({ id: 'exec-1', tenant_id: 'A' }); // unscoped — exists for tenant A
    const fakeClient2: any = {
      workflowExecution: { findFirst },
    };
    const query = vi.fn();

    await expect(
      withTenant({ tenantId: 'B' }, () =>
        tenantOperationHandler({
          model: 'WorkflowExecution',
          operation: 'upsert',
          args: {
            where: { id: 'exec-1' },
            update: { status: 'completed' },
            create: { id: 'exec-1', workflow_id: 'wf1', trigger_type: 'manual', input: {}, status: 'completed' },
          },
          query,
          client: fakeClient2,
        } as any),
      ),
    ).rejects.toThrow(/cross-tenant|tenant/i);

    // Prisma's real upsert MUST NOT have been called — no write touched the row.
    expect(query).not.toHaveBeenCalled();
  });

  it('happy-path upsert reaches Prisma with the update payload intact', async () => {
    const fakeClient = makeFakeClient({
      findFirstResult: { id: 'exec-1', tenant_id: 'local' },
    });
    const seen: any[] = [];
    const query = async (a: any) => {
      seen.push(a);
      return { id: 'exec-1', tenant_id: 'local', status: 'completed', output: { ok: true } };
    };

    const result = await withTenant({ tenantId: 'local' }, () =>
      tenantOperationHandler({
        model: 'WorkflowExecution',
        operation: 'upsert',
        args: {
          where: { id: 'exec-1' },
          update: { status: 'completed', output: { ok: true } },
          create: { id: 'exec-1', workflow_id: 'wf1', trigger_type: 'manual', input: {}, status: 'completed' },
        },
        query,
        client: fakeClient,
      } as any),
    );

    expect(seen[0].update).toEqual({ status: 'completed', output: { ok: true } });
    expect(seen[0].where).toEqual({ id: 'exec-1' });
    expect(result).toMatchObject({ id: 'exec-1', status: 'completed' });
  });

  it('NULL-tenant legacy rows are claimable by the current tenant (lazy backfill)', async () => {
    // A row exists with tenant_id=null (legacy). The current tenant should
    // be able to upsert into it — the ownership pre-check OR-includes null.
    const fakeClient = makeFakeClient({
      findFirstResult: { id: 'exec-legacy', tenant_id: null },
    });
    const seen: any[] = [];
    const query = async (a: any) => {
      seen.push(a);
      return { id: 'exec-legacy', tenant_id: null, status: 'completed' };
    };

    await withTenant({ tenantId: 'local' }, () =>
      tenantOperationHandler({
        model: 'WorkflowExecution',
        operation: 'upsert',
        args: {
          where: { id: 'exec-legacy' },
          update: { status: 'completed' },
          create: { id: 'exec-legacy', workflow_id: 'wf1', trigger_type: 'manual', input: {}, status: 'completed' },
        },
        query,
        client: fakeClient,
      } as any),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].where).toEqual({ id: 'exec-legacy' });
  });

  it('non-existent row: upsert allows the create branch (no findFirst → upsert with bare unique key)', async () => {
    const fakeClient = makeFakeClient({
      findFirstResult: null, // no row at all
    });
    const seen: any[] = [];
    const query = async (a: any) => {
      seen.push(a);
      return { id: 'exec-new', tenant_id: 'local', status: 'completed' };
    };

    await withTenant({ tenantId: 'local' }, () =>
      tenantOperationHandler({
        model: 'WorkflowExecution',
        operation: 'upsert',
        args: {
          where: { id: 'exec-new' },
          update: { status: 'completed' },
          create: { id: 'exec-new', workflow_id: 'wf1', trigger_type: 'manual', input: {}, status: 'completed' },
        },
        query,
        client: fakeClient,
      } as any),
    );

    expect(seen[0].where).toEqual({ id: 'exec-new' });
    // tenant_id auto-injected into create payload by injectTenantData
    expect(seen[0].create.tenant_id).toBe('local');
  });
});

describe('tenantPrismaExtension update/delete/findUnique (same WhereUniqueInput rule)', () => {
  it('update passes valid WhereUniqueInput — no AND/OR', async () => {
    const fakeClient = makeFakeClient({
      findFirstResult: { id: 'wf1', tenant_id: 'local' },
    });
    const seen: any[] = [];
    const query = async (a: any) => {
      seen.push(a);
      return { id: 'wf1', tenant_id: 'local', name: 'renamed' };
    };

    await withTenant({ tenantId: 'local' }, () =>
      tenantOperationHandler({
        model: 'Workflow',
        operation: 'update',
        args: { where: { id: 'wf1' }, data: { name: 'renamed' } },
        query,
        client: fakeClient,
      } as any),
    );

    expect(seen[0].where).toEqual({ id: 'wf1' });
  });

  it('delete refuses cross-tenant ownership', async () => {
    const findFirst = vi.fn();
    findFirst.mockResolvedValueOnce(null); // scoped lookup misses
    findFirst.mockResolvedValueOnce({ id: 'wf1', tenant_id: 'A' }); // unscoped probe finds foreign row
    const fakeClient: any = { workflow: { findFirst } };
    const query = vi.fn();

    await expect(
      withTenant({ tenantId: 'B' }, () =>
        tenantOperationHandler({
          model: 'Workflow',
          operation: 'delete',
          args: { where: { id: 'wf1' } },
          query,
          client: fakeClient,
        } as any),
      ),
    ).rejects.toThrow(/cross-tenant|tenant/i);

    expect(query).not.toHaveBeenCalled();
  });

  it('findUnique returns null when row owned by another tenant', async () => {
    const findFirst = vi.fn();
    findFirst.mockResolvedValueOnce(null); // scoped lookup misses
    findFirst.mockResolvedValueOnce({ id: 'wf1', tenant_id: 'A' }); // foreign owner
    const fakeClient: any = { workflow: { findFirst } };
    const query = vi.fn();

    const result = await withTenant({ tenantId: 'B' }, () =>
      tenantOperationHandler({
        model: 'Workflow',
        operation: 'findUnique',
        args: { where: { id: 'wf1' } },
        query,
        client: fakeClient,
      } as any),
    );

    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('findUnique returns the row when owned by current tenant', async () => {
    const fakeClient = makeFakeClient({
      findFirstResult: { id: 'wf1', tenant_id: 'local' },
    });
    const query = async (a: any) => {
      expect(a.where).toEqual({ id: 'wf1' });
      return { id: 'wf1', tenant_id: 'local', name: 'demo' };
    };

    const result = await withTenant({ tenantId: 'local' }, () =>
      tenantOperationHandler({
        model: 'Workflow',
        operation: 'findUnique',
        args: { where: { id: 'wf1' } },
        query,
        client: fakeClient,
      } as any),
    );

    expect(result).toMatchObject({ id: 'wf1' });
  });
});
