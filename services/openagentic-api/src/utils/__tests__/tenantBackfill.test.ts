/**
 * Theme A / S1-1: tenant_id backfill logic tests.
 *
 * The migration `20260425_backfill_tenant_id` is pure SQL, so we test the
 * derivation rules directly: each table's tenant_id must equal
 * User.azure_tenant_id reachable from `created_by` (or the parent
 * workflow / execution for child tables).
 */

import { describe, it, expect } from 'vitest';

interface UserRow {
  id: string;
  azure_tenant_id: string | null;
}

interface WorkflowRow {
  id: string;
  created_by: string;
  tenant_id: string | null;
}

interface ExecutionRow {
  id: string;
  workflow_id: string;
  started_by: string | null;
  tenant_id: string | null;
}

/** Pure-TS port of the backfill SQL — exercises the same join rules. */
function backfillWorkflows(workflows: WorkflowRow[], users: UserRow[]): WorkflowRow[] {
  const userMap = new Map(users.map((u) => [u.id, u]));
  return workflows.map((w) => {
    if (w.tenant_id) return w;
    const u = userMap.get(w.created_by);
    if (u?.azure_tenant_id) return { ...w, tenant_id: u.azure_tenant_id };
    return w;
  });
}

function backfillExecutions(
  executions: ExecutionRow[],
  workflows: WorkflowRow[],
  users: UserRow[],
): ExecutionRow[] {
  const userMap = new Map(users.map((u) => [u.id, u]));
  const wfMap = new Map(workflows.map((w) => [w.id, w]));
  return executions.map((e) => {
    if (e.tenant_id) return e;
    const u = e.started_by ? userMap.get(e.started_by) : null;
    const w = wfMap.get(e.workflow_id);
    const tenant = u?.azure_tenant_id ?? w?.tenant_id ?? null;
    if (tenant) return { ...e, tenant_id: tenant };
    return e;
  });
}

describe('backfill: workflows', () => {
  it('derives tenant_id from creator.azure_tenant_id', () => {
    const users: UserRow[] = [
      { id: 'u1', azure_tenant_id: 'tenant-A' },
      { id: 'u2', azure_tenant_id: 'tenant-B' },
    ];
    const workflows: WorkflowRow[] = [
      { id: 'w1', created_by: 'u1', tenant_id: null },
      { id: 'w2', created_by: 'u2', tenant_id: null },
    ];
    const out = backfillWorkflows(workflows, users);
    expect(out.find((w) => w.id === 'w1')!.tenant_id).toBe('tenant-A');
    expect(out.find((w) => w.id === 'w2')!.tenant_id).toBe('tenant-B');
  });

  it('leaves tenant_id NULL when creator has no azure_tenant_id (legacy local-auth users)', () => {
    const users: UserRow[] = [{ id: 'u1', azure_tenant_id: null }];
    const workflows: WorkflowRow[] = [
      { id: 'w1', created_by: 'u1', tenant_id: null },
    ];
    expect(backfillWorkflows(workflows, users)[0].tenant_id).toBeNull();
  });

  it('is idempotent — running twice does not overwrite existing values', () => {
    const users: UserRow[] = [{ id: 'u1', azure_tenant_id: 'tenant-A' }];
    const workflows: WorkflowRow[] = [
      { id: 'w1', created_by: 'u1', tenant_id: 'tenant-MANUAL' },
    ];
    expect(backfillWorkflows(workflows, users)[0].tenant_id).toBe('tenant-MANUAL');
  });
});

describe('backfill: executions (uses workflow fallback)', () => {
  it('prefers started_by.azure_tenant_id when available', () => {
    const users: UserRow[] = [
      { id: 'u1', azure_tenant_id: 'tenant-USER' },
    ];
    const workflows: WorkflowRow[] = [
      { id: 'w1', created_by: 'u-wf', tenant_id: 'tenant-WF' },
    ];
    const execs: ExecutionRow[] = [
      { id: 'e1', workflow_id: 'w1', started_by: 'u1', tenant_id: null },
    ];
    expect(backfillExecutions(execs, workflows, users)[0].tenant_id).toBe('tenant-USER');
  });

  it('falls back to parent workflow tenant when started_by is null', () => {
    const users: UserRow[] = [];
    const workflows: WorkflowRow[] = [
      { id: 'w1', created_by: 'u-wf', tenant_id: 'tenant-WF' },
    ];
    const execs: ExecutionRow[] = [
      { id: 'e1', workflow_id: 'w1', started_by: null, tenant_id: null },
    ];
    expect(backfillExecutions(execs, workflows, users)[0].tenant_id).toBe('tenant-WF');
  });
});
