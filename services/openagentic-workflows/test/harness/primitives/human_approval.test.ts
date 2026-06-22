/**
 * human_approval node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - Resolves the message template against input.
 *   - Persists an approval row via the engine's ctx.pauseForApproval hook.
 *   - Returns `{ status: 'awaiting_approval', approvalId, message,
 *     approvers, expiresAt }`.
 *
 * The auto-approve gate (approvalGate.ts) requires:
 *   1. input.autoApprove truthy
 *   2. triggerType === 'test'
 *   3. caller has `flows:test:auto-approve` permission
 *
 * We exercise the PAUSE path (no auto-approve) — the run completes with
 * the awaiting-approval result captured on outputs[nodeId], and the
 * engine emits `execution_paused` for the node. We override
 * prisma.workflowApproval.create to return a deterministic row.
 */

import { describe, it, expect, vi } from 'vitest';

import { runFlow } from '../runFlow.js';
import { prisma } from '../../../src/utils/prisma.js';

describe('human_approval node — pause + resume contract', () => {
  it('persists an approval row and emits execution_paused on the node', async () => {
    const fakeApproval = {
      id: 'approval-harness-1',
      status: 'pending',
      message: 'Approve harness step?',
      timeout_at: new Date(Date.now() + 86400 * 1000).toISOString(),
    };
    const createSpy = vi
      .spyOn(
        prisma.workflowApproval as unknown as { create: typeof prisma.workflowApproval.create },
        'create',
      )
      .mockResolvedValue(fakeApproval as any);

    try {
      const result = await runFlow({
        flow: {
          nodes: [
            { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
            {
              id: 'approve',
              type: 'human_approval',
              data: {
                approvers: ['alice@example.com'],
                requiredCount: 1,
                timeout: 86400,
                message: 'Approve deploy of {{input.service}}?',
              },
            },
          ],
          edges: [{ id: 'e1', source: 'trigger', target: 'approve' }],
        },
        input: { service: 'openagentic-api' },
      });

      // The run completes successfully — the engine's pause flow returns
      // cleanly from the branch without throwing. Status === 'completed'
      // because the parent execution does not error out; it just halts.
      expect(result.status).toBe('completed');

      const out = result.outputs.approve as {
        status: string;
        approvalId: string;
        message: string;
        approvers: string[];
      };
      expect(out.status).toBe('awaiting_approval');
      expect(out.approvalId).toBe('approval-harness-1');
      expect(out.message).toBe('Approve deploy of openagentic-api?');
      expect(out.approvers).toEqual(['alice@example.com']);

      const paused = result.frames.filter(
        f => f.type === 'execution_paused' && f.nodeId === 'approve',
      );
      expect(paused).toHaveLength(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
    } finally {
      createSpy.mockRestore();
    }
  });
});
