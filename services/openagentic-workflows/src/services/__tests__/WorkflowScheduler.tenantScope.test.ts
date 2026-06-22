/**
 * Flows SEV-0 #3 (A3) — WorkflowScheduler tenant scoping (RED→GREEN)
 *
 * Regression test for the bug where WorkflowScheduler.pollAndExecute() called
 * prisma.workflowSchedule.findMany() in a way that lost the
 * withTenant() / withSystemTenant() scope, causing the tenantPrismaExtension
 * fail-closed gate to throw TenantNotSetError on every 30-second tick. Cron
 * triggers were entirely non-functional for ~24h.
 *
 * Two compounding root causes:
 *   1) The findMany was originally NOT wrapped at all (fixed in commit
 *      10ea80a0).
 *   2) Even after wrapping, the wrap used a non-async arrow:
 *        withSystemTenant(() => prisma.workflowSchedule.findMany(...))
 *      PrismaPromise is lazy — the arrow returns the un-started promise,
 *      tenantStorage.run() exits, and only THEN does the prisma `.then()`
 *      kick off the actual extension handler. By that point ALS is gone
 *      and the fail-closed gate throws. Fix: `async () => await prisma...`
 *      so execution begins while the ALS frame is still on the stack.
 *
 * Both methods are private; we drive the public surface (start/stop) under
 * a stubbed Prisma client that asserts the fail-closed contract identically
 * to production (i.e. throws if context is missing).
 *
 * GREEN proof: when start() runs, neither tick path throws. The stub
 * findMany callbacks observe an AsyncLocalStorage context with bypass:true
 * (system scope) for the cross-tenant enumeration. For schedules that have
 * a tenant_id, executeSchedule rewraps in withTenant({ tenantId }) so the
 * dispatched executeWorkflow call carries that tenant.
 *
 * Note: the unit-test mock invokes findMany synchronously inside the run()
 * frame, so it cannot reproduce the PrismaPromise-laziness bug in isolation
 * — that needed a live in-pod node -e repro (captured in the commit body).
 * This suite still proves the wrap-and-tenant-propagation contract; the
 * arrow-is-async constraint is documented above the scheduler's findMany.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentTenant } from '../../utils/tenantPrismaExtension.js';

// Mock the prisma client used inside WorkflowScheduler so we can assert
// the tenant context at the time each operation fires.
const observedContexts: Array<{ op: string; ctx: any; args?: any }> = [];

vi.mock('../../utils/prisma.js', () => {
  const fakeOp = (op: string) =>
    vi.fn(async (args?: any) => {
      observedContexts.push({ op, ctx: getCurrentTenant(), args });
      // Mirror production: tenanted models without ctx must reject. The
      // real extension does this; our stub mirrors it so the test fails
      // RED if pollAndExecute forgets to wrap.
      if (!getCurrentTenant()) {
        const err: any = new Error(
          `Prisma operation '${op}' on tenanted model 'WorkflowSchedule' attempted outside withTenant() scope.`,
        );
        err.name = 'TenantNotSetError';
        throw err;
      }
      if (op === 'workflowSchedule.findMany.due') {
        // pollAndExecute due-schedules query
        return [];
      }
      if (op === 'workflowSchedule.findMany.uninit') {
        // initializeSchedules uninitialised-rows query
        return [];
      }
      return [];
    });

  // Distinguish the two findMany call sites by their `where` shape.
  const findManyDispatch = vi.fn(async (args?: any) => {
    const isDue = !!(args?.where?.next_run_at && args.where.is_active === true);
    const isUninit = args?.where?.next_run_at === null;
    const opLabel = isDue
      ? 'workflowSchedule.findMany.due'
      : isUninit
        ? 'workflowSchedule.findMany.uninit'
        : 'workflowSchedule.findMany.other';
    observedContexts.push({ op: opLabel, ctx: getCurrentTenant(), args });
    if (!getCurrentTenant()) {
      const err: any = new Error(
        `Prisma operation 'findMany' on tenanted model 'WorkflowSchedule' attempted outside withTenant() scope.`,
      );
      err.name = 'TenantNotSetError';
      throw err;
    }
    return [];
  });

  // workflowExecution.create must return a row with .id so the scheduler
  // can hand it to executeWorkflow.
  const createOp = vi.fn(async (args?: any) => {
    observedContexts.push({ op: 'workflowExecution.create', ctx: getCurrentTenant(), args });
    if (!getCurrentTenant()) {
      const err: any = new Error('TenantNotSetError on create');
      err.name = 'TenantNotSetError';
      throw err;
    }
    return { id: 'exec-1', status: 'pending' };
  });

  return {
    prisma: {
      workflowSchedule: {
        findMany: findManyDispatch,
        update: fakeOp('workflowSchedule.update'),
      },
      workflowExecution: {
        create: createOp,
      },
      workflow: {
        update: fakeOp('workflow.update'),
      },
    },
  };
});

// Stub out the deeper engine and the idempotency sweep — irrelevant to
// the tenant-scope contract under test. WorkflowCompiler is stubbed so
// the per-schedule compile always succeeds with a runnable shape and the
// dispatch path reaches executeWorkflow.
const executeWorkflowSpy = vi.fn(async () => ({ success: true }));
vi.mock('../WorkflowExecutionEngine.js', () => ({
  executeWorkflow: executeWorkflowSpy,
}));
vi.mock('../IdempotencyService.js', () => ({
  sweepExpiredKeys: vi.fn(async () => {}),
}));
vi.mock('../WorkflowCompiler.js', () => ({
  WorkflowCompiler: class {
    compile() {
      return { valid: true, errors: [] };
    }
  },
}));

describe('WorkflowScheduler — tenant scoping (Flows SEV-0 A3)', () => {
  beforeEach(() => {
    observedContexts.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializeSchedules + first pollAndExecute do not throw TenantNotSetError', async () => {
    const { WorkflowScheduler } = await import('../WorkflowScheduler.js');
    const scheduler = WorkflowScheduler.getInstance();

    let threw: unknown = null;
    try {
      await scheduler.start();
      // start() kicks off the initial pollAndExecute via .catch — allow it
      // to settle before we inspect.
      await new Promise((r) => setTimeout(r, 50));
    } catch (e) {
      threw = e;
    } finally {
      scheduler.stop();
    }

    expect(threw, `start() threw: ${threw}`).toBeNull();

    // Every findMany observation must have a non-null context with
    // bypass:true (cross-tenant enumeration goes through withSystemTenant).
    const findManyObs = observedContexts.filter((o) =>
      o.op.startsWith('workflowSchedule.findMany'),
    );
    expect(findManyObs.length, 'expected ≥1 findMany invocation').toBeGreaterThan(0);
    for (const o of findManyObs) {
      expect(o.ctx, `findMany at ${o.op} ran with no tenant context`).toBeTruthy();
      expect(o.ctx?.bypass, `${o.op} must run inside withSystemTenant (bypass:true)`).toBe(true);
    }
  });

  it('dispatched execution carries workflow tenant_id via withTenant', async () => {
    const { WorkflowScheduler } = await import('../WorkflowScheduler.js');
    const prismaMod = await import('../../utils/prisma.js');

    // Reset all singletons so this test's mock takes hold cleanly.
    (WorkflowScheduler as any).instance = null;
    executeWorkflowSpy.mockClear();

    // Make findMany return one due schedule owned by tenant-X.
    const dueSchedule = {
      id: 'sched-1',
      tenant_id: 'tenant-X',
      workflow_id: 'wf-1',
      cron_expression: '* * * * *',
      timezone: 'UTC',
      is_active: true,
      next_run_at: new Date(Date.now() - 1000),
      input_template: { foo: 'bar' },
      workflow: {
        id: 'wf-1',
        name: 'demo',
        is_active: true,
        deleted_at: null,
        created_by: 'user-1',
        definition: { nodes: [{ id: 'n1', type: 'noop' }], edges: [] },
        versions: [],
      },
    };

    let pollCallCount = 0;
    (prismaMod.prisma.workflowSchedule.findMany as any).mockImplementation(
      async (args: any) => {
        const ctx = getCurrentTenant();
        const isDue = !!(args?.where?.next_run_at && args.where.is_active === true);
        const isUninit = args?.where?.next_run_at === null;
        const opLabel = isDue
          ? 'workflowSchedule.findMany.due'
          : isUninit
            ? 'workflowSchedule.findMany.uninit'
            : 'workflowSchedule.findMany.other';
        observedContexts.push({ op: opLabel, ctx, args });
        if (!ctx) {
          const err: any = new Error('TenantNotSetError on findMany');
          err.name = 'TenantNotSetError';
          throw err;
        }
        if (isDue) {
          pollCallCount += 1;
          // Return one due schedule on the very first poll only.
          return pollCallCount === 1 ? [dueSchedule] : [];
        }
        return [];
      },
    );

    const scheduler = WorkflowScheduler.getInstance();
    await scheduler.start();
    // initial pollAndExecute is fire-and-forget — wait for it to drain.
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    // executeWorkflow must have been called for the due schedule and the
    // call site must have happened under a withTenant({ tenantId: 'tenant-X' })
    // scope — proven by observing workflowExecution.create / workflowSchedule.update
    // contexts carrying that tenantId.
    const tenantedOps = observedContexts.filter(
      (o) => o.op === 'workflowExecution.create' || o.op === 'workflowSchedule.update',
    );
    expect(tenantedOps.length, 'expected per-tenant writes during executeSchedule').toBeGreaterThan(
      0,
    );
    for (const o of tenantedOps) {
      expect(o.ctx?.tenantId, `${o.op} must carry tenant-X scope`).toBe('tenant-X');
    }

    // The fire-and-forget executeWorkflow call must also have fired for wf-1
    // under the tenant-X scope (asserts on the dispatch entry path).
    expect(executeWorkflowSpy).toHaveBeenCalledWith(
      'wf-1',
      expect.any(String),
      expect.objectContaining({ nodes: expect.any(Array) }),
      expect.objectContaining({ foo: 'bar' }),
      'user-1',
      undefined,
    );
  });
});
