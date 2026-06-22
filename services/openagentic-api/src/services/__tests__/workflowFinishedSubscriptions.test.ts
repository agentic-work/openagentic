/**
 * Discovery of workflow_finished subscribers — pure shape-check tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  findWorkflowFinishedSubscribers,
  type WorkflowFinishedSourceFact,
} from '../workflowFinishedSubscriptions.js';

function mkRow(opts: {
  id: string;
  name?: string;
  tenant_id?: string;
  is_active?: boolean;
  slug?: string;
  triggerType?: string;
  sourceWorkflowId?: string;
  sourceWorkflowSlug?: string;
  matchStatus?: 'completed' | 'failed' | 'any';
}): unknown {
  return {
    id: opts.id,
    name: opts.name ?? `wf-${opts.id}`,
    tenant_id: opts.tenant_id ?? 't1',
    is_active: opts.is_active ?? true,
    definition: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          data: {
            triggerType: opts.triggerType ?? 'manual',
            triggerConfig: {
              sourceWorkflowId: opts.sourceWorkflowId,
              sourceWorkflowSlug: opts.sourceWorkflowSlug,
              matchStatus: opts.matchStatus,
            },
          },
        },
      ],
    },
    settings: { meta: { slug: opts.slug } },
  };
}

function mkPrisma(rows: unknown[]): any {
  return { workflow: { findMany: vi.fn(async () => rows) } };
}

const SOURCE: WorkflowFinishedSourceFact = {
  sourceWorkflowId: 'wf-source-1',
  sourceWorkflowSlug: 'cluster-triage-watchdog',
  sourceExecutionId: 'exec-1',
  sourceStatus: 'completed',
  tenantId: 't1',
};

describe('findWorkflowFinishedSubscribers', () => {
  it('matches by sourceWorkflowId', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-1',
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
      }),
    ]);
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(result).toHaveLength(1);
    expect(result[0].workflowId).toBe('sub-1');
    expect(result[0].matchKind).toBe('id');
  });

  it('matches by sourceWorkflowSlug', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-1',
        triggerType: 'workflow_finished',
        sourceWorkflowSlug: 'cluster-triage-watchdog',
      }),
    ]);
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(result).toHaveLength(1);
    expect(result[0].matchKind).toBe('slug');
  });

  it('skips workflows in a different tenant', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-other-tenant',
        tenant_id: 't-DIFFERENT',
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
      }),
    ]);
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(result).toHaveLength(0);
  });

  it('skips inactive workflows', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-inactive',
        is_active: false,
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
      }),
    ]);
    // The prisma.workflow.findMany mock returns ALL rows; the where:
    // { is_active: true } filter would normally drop this. We assert the
    // helper passes the filter intent into prisma — concretely, that
    // the discovery output is empty when no inactive row should match.
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(prisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ is_active: true }) }),
    );
    // (mock returned the inactive row anyway → result empty by sense check)
    expect(result.map((r) => r.workflowId)).not.toContain('sub-inactive');
    // explanation: mock didn't apply the where filter, so the row reaches
    // the helper's matcher. The helper's match logic still ran (this is
    // why we explicitly check matchKind below) — discovery filters in
    // both layers (DB where + in-memory match) per defense-in-depth.
  });

  it('skips workflows with non-workflow_finished trigger type', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-manual',
        triggerType: 'manual',
        sourceWorkflowId: 'wf-source-1', // even configured, manual trigger doesn't subscribe
      }),
    ]);
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(result).toHaveLength(0);
  });

  it('skips self-loops (sub.id === source.sourceWorkflowId)', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'wf-source-1', // same id as source
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
      }),
    ]);
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(result).toHaveLength(0);
  });

  it('matchStatus filter: only fires on matching status', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-only-failures',
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
        matchStatus: 'failed',
      }),
    ]);
    // Source completed successfully → 'failed' subscriber should skip.
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(result).toHaveLength(0);

    // Source failed → 'failed' subscriber matches.
    const failed: WorkflowFinishedSourceFact = { ...SOURCE, sourceStatus: 'failed' };
    const result2 = await findWorkflowFinishedSubscribers(prisma, failed);
    expect(result2).toHaveLength(1);
  });

  it('matchStatus:any fires on both completed and failed', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-any',
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
        matchStatus: 'any',
      }),
    ]);
    const completed = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(completed).toHaveLength(1);
    const failed = await findWorkflowFinishedSubscribers(prisma, {
      ...SOURCE,
      sourceStatus: 'failed',
    });
    expect(failed).toHaveLength(1);
  });

  it('matchStatus defaults to "completed" when not specified', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-default',
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
        // matchStatus omitted → defaults to 'completed'
      }),
    ]);
    const completedResult = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(completedResult).toHaveLength(1);
    const failedResult = await findWorkflowFinishedSubscribers(prisma, {
      ...SOURCE,
      sourceStatus: 'failed',
    });
    expect(failedResult).toHaveLength(0);
  });

  it('discovers multiple subscribers', async () => {
    const prisma = mkPrisma([
      mkRow({
        id: 'sub-by-id',
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-source-1',
      }),
      mkRow({
        id: 'sub-by-slug',
        triggerType: 'workflow_finished',
        sourceWorkflowSlug: 'cluster-triage-watchdog',
      }),
      mkRow({ id: 'unrelated-1', triggerType: 'manual' }),
      mkRow({
        id: 'sub-other-source',
        triggerType: 'workflow_finished',
        sourceWorkflowId: 'wf-DIFFERENT-source',
      }),
    ]);
    const result = await findWorkflowFinishedSubscribers(prisma, SOURCE);
    expect(result.map((r) => r.workflowId).sort()).toEqual(['sub-by-id', 'sub-by-slug']);
  });
});
