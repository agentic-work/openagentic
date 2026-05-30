import { describe, it, expect, vi } from 'vitest';
import { createApprovalRecord, type ApprovalRecordPayload } from './approvalRecord.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPrisma(impl?: Partial<{ create: (args: any) => Promise<any> }>) {
  return {
    workflowApproval: {
      create: vi.fn(impl?.create ?? (() => Promise.resolve(makeRow())))
    }
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval-1',
    execution_id: 'exec-1',
    node_id: 'node-approval',
    required_approvers: ['alice', 'bob'],
    required_count: 1,
    timeout_seconds: 3600,
    timeout_action: 'reject',
    status: 'pending',
    message: 'Approval required for workflow step: node-approval',
    context_data: {},
    notification_channels: ['in_app'],
    timeout_at: new Date(),
    created_at: new Date(),
    ...overrides
  };
}

function makePayload(overrides: Partial<ApprovalRecordPayload> = {}): ApprovalRecordPayload {
  return {
    executionId: 'exec-1',
    nodeId: 'node-approval',
    approvers: ['alice', 'bob'],
    requiredCount: 1,
    timeoutSeconds: 3600,
    timeoutAction: 'reject',
    message: 'Approval required for workflow step: node-approval',
    contextData: { input: {}, nodeResults: {}, notificationChannels: ['in_app'] },
    notificationChannels: ['in_app'],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('createApprovalRecord', () => {
  it('returns the persisted row when create succeeds', async () => {
    const row = makeRow();
    const prisma = makeMockPrisma({ create: () => Promise.resolve(row) });
    const result = await createApprovalRecord(prisma as any, makePayload());
    expect(result).toBe(row);
  });

  it('calls prisma.workflowApproval.create with the correct payload shape', async () => {
    const prisma = makeMockPrisma();
    const payload = makePayload();
    await createApprovalRecord(prisma as any, payload);

    const callArg = (prisma.workflowApproval.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = callArg.data;

    expect(data.execution_id).toBe(payload.executionId);
    expect(data.node_id).toBe(payload.nodeId);
    expect(data.required_approvers).toEqual(payload.approvers);
    expect(data.required_count).toBe(payload.requiredCount);
    expect(data.timeout_seconds).toBe(payload.timeoutSeconds);
    expect(data.timeout_action).toBe(payload.timeoutAction);
    expect(data.status).toBe('pending');
    expect(data.message).toBe(payload.message);
    expect(data.context_data).toEqual(payload.contextData);
    expect(data.notification_channels).toEqual(payload.notificationChannels);
    expect(data.timeout_at).toBeInstanceOf(Date);
  });

  it('timeout_at is computed from timeoutSeconds relative to now', async () => {
    const before = Date.now();
    const prisma = makeMockPrisma();
    await createApprovalRecord(prisma as any, makePayload({ timeoutSeconds: 100 }));
    const after = Date.now();

    const callArg = (prisma.workflowApproval.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const timeoutAt: Date = callArg.data.timeout_at;

    // timeout_at should be within [before + 100_000, after + 100_000 + a tiny buffer]
    expect(timeoutAt.getTime()).toBeGreaterThanOrEqual(before + 100_000);
    expect(timeoutAt.getTime()).toBeLessThanOrEqual(after + 100_000 + 500);
  });

  it('throws when prisma.workflowApproval.create rejects', async () => {
    const dbError = new Error('Connection refused');
    const prisma = makeMockPrisma({ create: () => Promise.reject(dbError) });
    await expect(createApprovalRecord(prisma as any, makePayload())).rejects.toThrow('Connection refused');
  });

  // Issue #4 fix (Approach A): single assertion that helper cannot return on failure path.
  it('rejects and never resolves when DB create fails', async () => {
    const dbError = new Error('DB unavailable');
    const prisma = makeMockPrisma({ create: () => Promise.reject(dbError) });
    await expect(createApprovalRecord(prisma as any, makePayload())).rejects.toThrow();
  });

  // Issue #4 fix: success-path shape check — returned value is the Prisma row, not a sentinel.
  it('success-path: returned row is from Prisma, not an auto-approval sentinel', async () => {
    const row = makeRow({ status: 'pending' });
    const prisma = makeMockPrisma({ create: () => Promise.resolve(row) });
    const result = await createApprovalRecord(prisma as any, makePayload());
    expect(result).toBe(row);
    expect((result as any).status).not.toBe('approved');
    expect((result as any).autoApproved).toBeUndefined();
  });

  // Issue #5 fix: accept ONLY identity equality or cause — remove message-substring fallback.
  it('preserves the original error instance (direct rethrow)', async () => {
    const originalError = new Error('Unique DB error: deadlock detected');
    const prisma = makeMockPrisma({ create: () => Promise.reject(originalError) });
    const thrown: unknown = await createApprovalRecord(prisma as any, makePayload()).catch((e) => e);
    // Accept only identity (rethrow as-is) or cause wrapping — not message substring.
    const isOriginal = thrown === originalError;
    const hasCause = (thrown as any)?.cause === originalError;
    expect(isOriginal || hasCause).toBe(true);
  });

  it('throws for any error type — not just Error instances', async () => {
    const prisma = makeMockPrisma({ create: () => Promise.reject('raw string error') });
    await expect(createApprovalRecord(prisma as any, makePayload())).rejects.toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Issue #1: timeoutSeconds validation (RED → GREEN after guard is added)
  // ---------------------------------------------------------------------------

  it('throws RangeError for NaN timeoutSeconds without calling create', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createApprovalRecord(prisma as any, makePayload({ timeoutSeconds: NaN }))
    ).rejects.toThrow(RangeError);
    expect(prisma.workflowApproval.create).not.toHaveBeenCalled();
  });

  it('throws RangeError for negative timeoutSeconds without calling create', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createApprovalRecord(prisma as any, makePayload({ timeoutSeconds: -1 }))
    ).rejects.toThrow(RangeError);
    expect(prisma.workflowApproval.create).not.toHaveBeenCalled();
  });

  it('throws RangeError for Infinity timeoutSeconds without calling create', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createApprovalRecord(prisma as any, makePayload({ timeoutSeconds: Infinity }))
    ).rejects.toThrow(RangeError);
    expect(prisma.workflowApproval.create).not.toHaveBeenCalled();
  });

  it('allows timeoutSeconds: 0 (zero-second timeout is degenerate but valid)', async () => {
    const prisma = makeMockPrisma();
    await expect(
      createApprovalRecord(prisma as any, makePayload({ timeoutSeconds: 0 }))
    ).resolves.toBeDefined();
    expect(prisma.workflowApproval.create).toHaveBeenCalledOnce();
  });
});
