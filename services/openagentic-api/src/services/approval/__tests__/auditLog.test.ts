/**
 * Test C — auditLog service: the ONLY writer. INSERT + single guarded
 * pending→decided UPDATE. No delete path. Prisma mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMock, updateManyMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    toolCallAuditLog: {
      create: createMock,
      updateMany: updateManyMock,
    },
  },
}));

import * as auditLogModule from '../auditLog.js';
import { insertAuditRow, decideAuditRow, makePreview } from '../auditLog.js';

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockResolvedValue({ id: 'a1' });
});

describe('insertAuditRow', () => {
  it('returns the new row id and calls create with snake_case fields + preview', async () => {
    const id = await insertAuditRow({
      toolName: 'kubectl_delete_pod',
      serverName: 'kubernetes',
      args: { pod: 'web-0' },
      classification: 'MUTATING',
      decision: 'pending',
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      origin: 'chat',
    });
    expect(id).toBe('a1');
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.data.tool_name).toBe('kubectl_delete_pod');
    expect(arg.data.server_name).toBe('kubernetes');
    expect(arg.data.classification).toBe('MUTATING');
    expect(arg.data.decision).toBe('pending');
    expect(arg.data.user_id).toBe('u1');
    expect(arg.data.session_id).toBe('s1');
    expect(arg.data.message_id).toBe('m1');
    expect(arg.data.origin).toBe('chat');
    expect(typeof arg.data.preview).toBe('string');
    expect(arg.data.preview).toContain('web-0');
  });

  it('inserts an auto decision for READ calls', async () => {
    await insertAuditRow({
      toolName: 'list_pods',
      args: {},
      classification: 'READ',
      decision: 'auto',
    });
    const arg = createMock.mock.calls[0][0];
    expect(arg.data.decision).toBe('auto');
    expect(arg.data.classification).toBe('READ');
  });
});

describe('makePreview', () => {
  it('truncates >500 chars and appends an ellipsis', () => {
    const big = { blob: 'x'.repeat(2000) };
    const preview = makePreview(big);
    expect(preview.length).toBeLessThanOrEqual(501);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('serializes small args fully', () => {
    expect(makePreview({ a: 1 })).toBe('{"a":1}');
  });

  it('handles undefined args', () => {
    expect(makePreview(undefined)).toBe('{}');
  });
});

describe('decideAuditRow — single guarded transition', () => {
  it('returns true when updateMany affects exactly one pending row', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    const ok = await decideAuditRow('a1', 'approved', 'u1');
    expect(ok).toBe(true);
    const arg = updateManyMock.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'a1', decision: 'pending' });
    expect(arg.data.decision).toBe('approved');
    expect(arg.data.decided_by).toBe('u1');
    expect(arg.data.decided_at).toBeInstanceOf(Date);
  });

  it('returns false when the row was already decided/raced (count 0)', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    const ok = await decideAuditRow('a1', 'denied', 'u2');
    expect(ok).toBe(false);
  });

  it('accepts timed_out as a terminal decision', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    const ok = await decideAuditRow('a1', 'timed_out', null);
    expect(ok).toBe(true);
    const arg = updateManyMock.mock.calls[0][0];
    expect(arg.data.decision).toBe('timed_out');
    expect(arg.data.decided_by).toBeNull();
  });
});

describe('immutability — no delete export', () => {
  it('does NOT export any delete path', () => {
    expect((auditLogModule as any).deleteAuditRow).toBeUndefined();
    expect((auditLogModule as any).deleteAuditRows).toBeUndefined();
    expect((auditLogModule as any).removeAuditRow).toBeUndefined();
  });
});
