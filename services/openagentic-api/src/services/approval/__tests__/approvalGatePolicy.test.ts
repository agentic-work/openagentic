/**
 * Test D — resolveApprovalGatePolicy: DB overrides env; env is the default;
 * seeds-if-missing; DB-down falls back to env. Audit is always on (not part of
 * this policy). Prisma + featureFlags mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirstMock, createMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: {
      findFirst: findFirstMock,
      create: createMock,
    },
  },
}));

vi.mock('../../../config/featureFlags.js', () => ({
  featureFlags: { approvalGateMutating: true },
}));

import { resolveApprovalGatePolicy } from '../approvalGatePolicy.js';

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockResolvedValue({});
});

describe('resolveApprovalGatePolicy', () => {
  it('DB row overrides env (gateMutating:false wins over env default true)', async () => {
    findFirstMock.mockResolvedValue({ value: { gateMutating: false, timeoutMs: 120000 } });
    const policy = await resolveApprovalGatePolicy();
    expect(policy.gateMutating).toBe(false);
    expect(policy.timeoutMs).toBe(120000);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('parses a string-encoded JSON value', async () => {
    findFirstMock.mockResolvedValue({ value: JSON.stringify({ gateMutating: false }) });
    const policy = await resolveApprovalGatePolicy();
    expect(policy.gateMutating).toBe(false);
  });

  it('seeds the row when missing and returns env default (true) + 300000ms', async () => {
    findFirstMock.mockResolvedValue(null);
    const policy = await resolveApprovalGatePolicy();
    expect(policy.gateMutating).toBe(true);
    expect(policy.timeoutMs).toBe(300000);
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.data.key).toBe('approval_gate_policy');
  });

  it('falls back to env defaults when the DB throws (no throw)', async () => {
    findFirstMock.mockRejectedValue(new Error('DB down'));
    const policy = await resolveApprovalGatePolicy();
    expect(policy.gateMutating).toBe(true);
    expect(policy.timeoutMs).toBe(300000);
  });
});
