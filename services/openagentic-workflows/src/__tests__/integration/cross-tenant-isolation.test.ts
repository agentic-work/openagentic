/**
 * Task 1.7 (V3 Enterprise Chatmode design — substrate fix S5):
 * end-to-end cross-tenant isolation integration probe.
 *
 * Tasks 1.2-1.6 made the wrap pattern structurally airtight:
 *   - 1.2 tenantPrismaExtension fails CLOSED on bypass
 *   - 1.3 every route validates tenantId on the wire
 *   - 1.4 every route handler runs inside withTenant({ tenantId }, ...)
 *   - 1.5 WorkflowScheduler tick wraps per-active-tenant
 *   - 1.6 source-regression arch test pins the contract
 *
 * Task 1.7 is the BEHAVIOURAL proof. We boot the real
 * tenantPrismaExtension on top of an in-memory fake PrismaClient that
 * actually filters rows by the `where` clause the extension injects.
 * The test then drives the full call shape:
 *
 *   withTenant({ tenantId: 'A' }, () => prisma.workflow.findMany())
 *
 * and asserts that only tenant-A rows come back — never tenant-B's.
 *
 * Why an in-memory adapter (not a real Postgres):
 *   * The wrap pattern's correctness is a property of the extension —
 *     given a query with the injected `where`, does the underlying store
 *     return ONLY rows matching that where? A faithful in-memory filter
 *     is sufficient evidence: if the extension injects the right where,
 *     it isolates.
 *   * Postgres + migrated schema is not available in CI on this repo
 *     (no postgres docker compose for unit-test runs). The substrate
 *     wraps must be CI-runnable per the spec.
 *   * The extension's pure-injection functions (injectTenantWhere /
 *     injectTenantData) are already unit-tested. This test glues them
 *     together with the AsyncLocalStorage scope + a Prisma-shaped store
 *     to prove the extension is wired correctly end-to-end.
 *
 * Cross-checks performed:
 *   1. tenant-A scope sees ONLY tenant-A rows on findMany.
 *   2. tenant-B scope sees ONLY tenant-B rows on findMany.
 *   3. tenant-C scope (no rows) sees [].
 *   4. Outside any scope, the call throws TenantNotSetError (Task 1.2).
 *   5. Asking for a specific id from another tenant returns null
 *      (the cross-tenant impersonation guard).
 *   6. `create` inside withTenant({ tenantId: 'A' }) auto-stamps
 *      tenant_id = 'A' on the inserted row.
 *   7. `update` inside withTenant({ tenantId: 'A' }) cannot touch
 *      tenant-B's row (where-injection denies it).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  withTenant,
  withSystemTenant,
  TenantNotSetError,
  tenantOperationHandler,
  type TenantHandlerParams,
} from '../../utils/tenantPrismaExtension.js';

// ---------------------------------------------------------------------------
// In-memory store + Prisma-shaped fake.
//
// We record the args the extension passes through, then evaluate the
// `where` against an in-memory rows array using the small subset of
// Prisma `where` syntax the extension can produce:
//   { foo: 'bar' }                         — equality
//   { OR: [...], AND: [...] }              — boolean combinators
//   { tenant_id: { in: [...] } } / null    — used by other tests, not here
// ---------------------------------------------------------------------------

interface WorkflowRow {
  id: string;
  name: string;
  tenant_id: string | null;
}

interface Store {
  workflows: WorkflowRow[];
}

function evalWhere(row: WorkflowRow, where: any): boolean {
  if (!where || Object.keys(where).length === 0) return true;
  if (Array.isArray(where.AND)) {
    return where.AND.every((w: any) => evalWhere(row, w));
  }
  if (Array.isArray(where.OR)) {
    return where.OR.some((w: any) => evalWhere(row, w));
  }
  // Field equality (the only other shape the extension produces).
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND' || k === 'OR') continue;
    // null match
    if (v === null) {
      if ((row as any)[k] !== null) return false;
      continue;
    }
    if ((row as any)[k] !== v) return false;
  }
  return true;
}

/**
 * Build a Prisma-shaped fake whose `workflow.*` operations honour the
 * `where` clause the tenant extension injects.
 */
function makeFakePrisma(store: Store) {
  // Each method here is the "underlying query" the extension's
  // tenantOperationHandler wraps — the args it receives are the
  // tenant-injected args.
  return {
    workflow: {
      findMany: async (args: any = {}) => {
        return store.workflows.filter((r) => evalWhere(r, args.where));
      },
      findFirst: async (args: any = {}) => {
        return store.workflows.find((r) => evalWhere(r, args.where)) ?? null;
      },
      findUnique: async (args: any = {}) => {
        // findUnique uses `where: { id: ... }` shape — but the extension
        // wraps it AND-folded with the tenant predicate.
        return store.workflows.find((r) => evalWhere(r, args.where)) ?? null;
      },
      count: async (args: any = {}) => {
        return store.workflows.filter((r) => evalWhere(r, args.where)).length;
      },
      create: async (args: any) => {
        const row: WorkflowRow = {
          id: args.data.id,
          name: args.data.name,
          tenant_id: args.data.tenant_id ?? null,
        };
        store.workflows.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = store.workflows.find((r) => evalWhere(r, args.where));
        if (!row) {
          // Mirror Prisma's behaviour: throw on update-not-found.
          const err: any = new Error('Record to update not found.');
          err.code = 'P2025';
          throw err;
        }
        Object.assign(row, args.data);
        return row;
      },
      updateMany: async (args: any) => {
        const matched = store.workflows.filter((r) => evalWhere(r, args.where));
        for (const row of matched) Object.assign(row, args.data);
        return { count: matched.length };
      },
      delete: async (args: any) => {
        const idx = store.workflows.findIndex((r) => evalWhere(r, args.where));
        if (idx === -1) {
          const err: any = new Error('Record to delete does not exist.');
          err.code = 'P2025';
          throw err;
        }
        const [row] = store.workflows.splice(idx, 1);
        return row;
      },
    },
  };
}

/**
 * Drive a Prisma-shaped op through the real tenantOperationHandler. This
 * is what `applyTenantExtension(client)` would do in production, just
 * unwound so the test doesn't need a real PrismaClient instance to
 * `$extends` against.
 */
function viaExtension(
  fakePrisma: ReturnType<typeof makeFakePrisma>,
  model: 'Workflow',
  operation: keyof typeof fakePrisma.workflow,
  args: any,
): Promise<any> {
  const params: TenantHandlerParams = {
    model,
    operation,
    args,
    query: (a: any) => (fakePrisma.workflow as any)[operation](a),
    // Production wiring passes the unwrapped base PrismaClient so the
    // handler can run unique-key ownership pre-checks (Flows SEV-0 #2
    // fix, 2026-05-13). Mirror that here so integration tests exercise
    // the same code path.
    client: fakePrisma,
  };
  return tenantOperationHandler(params);
}

// ---------------------------------------------------------------------------
// Test fixture: tenant A has wf-A, tenant B has wf-B, tenant C has nothing.
// One legacy null-tenant row exists too — the extension's OR-folding lets
// it through to ANY tenant (the lazy-backfill cohort, by design).
// ---------------------------------------------------------------------------

let store: Store;
let fakePrisma: ReturnType<typeof makeFakePrisma>;

beforeEach(() => {
  store = {
    workflows: [
      { id: 'wf-A', name: 'Tenant A Workflow', tenant_id: 'tenant-A' },
      { id: 'wf-B', name: 'Tenant B Workflow', tenant_id: 'tenant-B' },
      // legacy null-tenant row (pre-backfill) — visible to all tenants
      // by the extension's documented "OR: tenant_id IS NULL" predicate.
      { id: 'wf-legacy', name: 'Legacy Pre-Tenant', tenant_id: null },
    ],
  };
  fakePrisma = makeFakePrisma(store);
});

// ---------------------------------------------------------------------------
// 1. Tenant scoping on findMany.
// ---------------------------------------------------------------------------

describe('Task 1.7 — cross-tenant isolation: findMany scope is enforced', () => {
  it('withTenant({ tenantId: A }) sees only A rows + legacy NULL — never B', async () => {
    const result: WorkflowRow[] = await withTenant({ tenantId: 'tenant-A' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'findMany', {}),
    );
    const ids = result.map((r) => r.id).sort();
    expect(ids).toEqual(['wf-A', 'wf-legacy']);
    expect(ids).not.toContain('wf-B');
  });

  it('withTenant({ tenantId: B }) sees only B rows + legacy NULL — never A', async () => {
    const result: WorkflowRow[] = await withTenant({ tenantId: 'tenant-B' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'findMany', {}),
    );
    const ids = result.map((r) => r.id).sort();
    expect(ids).toEqual(['wf-B', 'wf-legacy']);
    expect(ids).not.toContain('wf-A');
  });

  it('withTenant({ tenantId: C }) sees only legacy NULL row — no other tenant data', async () => {
    const result: WorkflowRow[] = await withTenant({ tenantId: 'tenant-C' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'findMany', {}),
    );
    const ids = result.map((r) => r.id).sort();
    // tenant-C has zero owned rows; legacy NULL row is shared (lazy backfill).
    expect(ids).toEqual(['wf-legacy']);
    expect(ids).not.toContain('wf-A');
    expect(ids).not.toContain('wf-B');
  });
});

// ---------------------------------------------------------------------------
// 2. The fail-CLOSED contract from Task 1.2 — the route MUST wrap, or boom.
// ---------------------------------------------------------------------------

describe('Task 1.7 — fail-CLOSED outside any tenant scope', () => {
  it('throws TenantNotSetError when prisma.workflow.findMany runs outside withTenant', async () => {
    await expect(
      viaExtension(fakePrisma, 'Workflow', 'findMany', {}),
    ).rejects.toBeInstanceOf(TenantNotSetError);
  });

  it('throws TenantNotSetError on update-by-id without scope (impersonation guard)', async () => {
    await expect(
      viaExtension(fakePrisma, 'Workflow', 'update', {
        where: { id: 'wf-A' },
        data: { name: 'pwn3d' },
      }),
    ).rejects.toBeInstanceOf(TenantNotSetError);
    // And the row is unchanged.
    expect(store.workflows.find((r) => r.id === 'wf-A')!.name).toBe('Tenant A Workflow');
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-tenant impersonation: tenant A asking for tenant B's id.
// ---------------------------------------------------------------------------

describe('Task 1.7 — cross-tenant impersonation guard', () => {
  it('tenant-A asking findUnique({ id: wf-B }) gets null (B is invisible to A)', async () => {
    const row = await withTenant({ tenantId: 'tenant-A' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'findUnique', { where: { id: 'wf-B' } }),
    );
    expect(row).toBeNull();
  });

  it('tenant-A asking findFirst({ id: wf-B }) gets null', async () => {
    const row = await withTenant({ tenantId: 'tenant-A' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'findFirst', { where: { id: 'wf-B' } }),
    );
    expect(row).toBeNull();
  });

  it('tenant-A update({ where: { id: wf-B }, data }) throws P2025 (cannot mutate B)', async () => {
    await expect(
      withTenant({ tenantId: 'tenant-A' }, () =>
        viaExtension(fakePrisma, 'Workflow', 'update', {
          where: { id: 'wf-B' },
          data: { name: 'A trying to rename B' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });
    // B's row is untouched.
    expect(store.workflows.find((r) => r.id === 'wf-B')!.name).toBe('Tenant B Workflow');
  });

  it('tenant-A updateMany({ where: {} }) does NOT touch B rows', async () => {
    await withTenant({ tenantId: 'tenant-A' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'updateMany', {
        where: {},
        data: { name: 'A-renamed' },
      }),
    );
    expect(store.workflows.find((r) => r.id === 'wf-B')!.name).toBe('Tenant B Workflow');
    expect(store.workflows.find((r) => r.id === 'wf-A')!.name).toBe('A-renamed');
    // legacy NULL row is in scope for A and gets renamed too — by design.
    expect(store.workflows.find((r) => r.id === 'wf-legacy')!.name).toBe('A-renamed');
  });

  it('tenant-A delete({ where: { id: wf-B } }) throws P2025 (cannot delete B)', async () => {
    await expect(
      withTenant({ tenantId: 'tenant-A' }, () =>
        viaExtension(fakePrisma, 'Workflow', 'delete', { where: { id: 'wf-B' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(store.workflows.find((r) => r.id === 'wf-B')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Auto-stamping on create.
// ---------------------------------------------------------------------------

describe('Task 1.7 — create auto-stamps tenant_id from scope', () => {
  it('create inside withTenant({ A }) stamps tenant_id = A on the new row', async () => {
    const row = await withTenant({ tenantId: 'tenant-A' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'create', {
        data: { id: 'wf-A2', name: 'A new A workflow' },
      }),
    );
    expect(row.tenant_id).toBe('tenant-A');
    // Then verify B can't see it.
    const fromB = await withTenant({ tenantId: 'tenant-B' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'findMany', {}),
    );
    expect(fromB.map((r: WorkflowRow) => r.id)).not.toContain('wf-A2');
  });

  it('create with explicit tenant_id wins (explicit override of injection)', async () => {
    // Caller wins per injectTenantData contract — useful for system-bypass tooling.
    const row = await withTenant({ tenantId: 'tenant-A' }, () =>
      viaExtension(fakePrisma, 'Workflow', 'create', {
        data: { id: 'wf-explicit', name: 'explicit', tenant_id: 'tenant-X' },
      }),
    );
    expect(row.tenant_id).toBe('tenant-X');
  });
});

// ---------------------------------------------------------------------------
// 5. System-bypass scope (used by background jobs that legitimately need
//    cross-tenant visibility — WorkflowScheduler's tick discovery query
//    runs inside withSystemTenant per Task 1.5).
// ---------------------------------------------------------------------------

describe('Task 1.7 — withSystemTenant escape hatch (for scheduler discovery)', () => {
  it('withSystemTenant() sees ALL rows across tenants — by design', async () => {
    const result: WorkflowRow[] = await withSystemTenant(() =>
      viaExtension(fakePrisma, 'Workflow', 'findMany', {}),
    );
    const ids = result.map((r) => r.id).sort();
    expect(ids).toEqual(['wf-A', 'wf-B', 'wf-legacy']);
  });
});

// ---------------------------------------------------------------------------
// 6. Receive-side wire validation (Task 1.3 contract is fast-path before
//    any wrap fires). Spot-checked here so the cross-tenant integration
//    test owns the full S5 substrate proof.
// ---------------------------------------------------------------------------

describe('Task 1.7 — wire validation before any wrap fires', () => {
  it('validateTenantId rejects empty body, never reaching the wrap', async () => {
    const { validateTenantId } = await import('../../middleware/validateTenantId.js');
    const captured: { code?: number; body?: unknown } = {};
    const reply: any = {
      code(c: number) { captured.code = c; return reply; },
      send(b: unknown) { captured.body = b; return reply; },
    };
    expect(validateTenantId({}, reply)).toBe(false);
    expect(captured.code).toBe(400);
    expect(captured.body).toEqual({ error: 'missing_tenant_id' });
  });

  it('validateTenantId accepts a non-empty tenantId', async () => {
    const { validateTenantId } = await import('../../middleware/validateTenantId.js');
    const reply: any = { code() { return reply; }, send() { return reply; } };
    expect(validateTenantId({ tenantId: 'tenant-A' }, reply)).toBe(true);
  });
});
