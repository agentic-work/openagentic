/**
 * AuditLogService — TDD spec (RED first, then GREEN).
 *
 * A1. write() inserts a row + dispatches to sink (fire-and-forget).
 * A2. Throws if action or target_type is empty.
 * A3. Sink failures NEVER block the DB write.
 * A4. Multiple rapid writes don't collide.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const createMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    flowAuditLog: {
      create: createMock,
    },
  },
}));

const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock('../AuditLogStreamingService.js', () => ({
  AuditLogStreamingService: vi.fn().mockImplementation(() => ({
    dispatch: dispatchMock,
  })),
}));

vi.mock('../../utils/logger.js', () => {
  const noop: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

import { AuditLogService } from '../AuditLogService.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditLogService', () => {
  let service: AuditLogService;
  const createdRow = {
    id: 'row-1',
    ts: new Date(),
    action: 'integration.create',
    target_type: 'integration',
    target_id: 'int-123',
    outcome: 'success',
    actor_user_id: 'user-1',
    actor_user_email: 'admin@example.com',
    actor_ip: '10.0.0.1',
    metadata: {},
  };

  beforeEach(() => {
    createMock.mockReset();
    dispatchMock.mockReset();
    createMock.mockResolvedValue(createdRow);
    dispatchMock.mockResolvedValue(undefined);
    service = new AuditLogService();
  });

  // A1 -----------------------------------------------------------------------
  it('A1: write() inserts a row via prisma.flowAuditLog.create', async () => {
    await service.write({
      action: 'integration.create',
      target_type: 'integration',
      target_id: 'int-123',
      outcome: 'success',
      actor: { userId: 'user-1', userEmail: 'admin@example.com', ip: '10.0.0.1' },
      metadata: { name: 'SlackBot' },
    });

    expect(createMock).toHaveBeenCalledOnce();
    const data = createMock.mock.calls[0][0].data;
    expect(data.action).toBe('integration.create');
    expect(data.target_type).toBe('integration');
    expect(data.target_id).toBe('int-123');
    expect(data.outcome).toBe('success');
    expect(data.actor_user_id).toBe('user-1');
    expect(data.actor_user_email).toBe('admin@example.com');
    expect(data.actor_ip).toBe('10.0.0.1');
  });

  it('A1: write() calls dispatch on the streaming sink after DB insert', async () => {
    await service.write({
      action: 'integration.create',
      target_type: 'integration',
      outcome: 'success',
    });

    // dispatch is fire-and-forget — give the microtask queue a tick
    await new Promise((r) => setImmediate(r));
    expect(dispatchMock).toHaveBeenCalledOnce();
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({ action: 'integration.create' });
  });

  // A2 -----------------------------------------------------------------------
  it('A2: throws if action is empty', async () => {
    await expect(
      service.write({ action: '', target_type: 'integration', outcome: 'success' }),
    ).rejects.toThrow(/action/i);
  });

  it('A2: throws if target_type is empty', async () => {
    await expect(
      service.write({ action: 'integration.create', target_type: '', outcome: 'success' }),
    ).rejects.toThrow(/target_type/i);
  });

  // A3 -----------------------------------------------------------------------
  it('A3: sink failure does NOT block the DB write and does not throw', async () => {
    dispatchMock.mockRejectedValue(new Error('network timeout'));

    // Should not throw even though sink fails
    await expect(
      service.write({
        action: 'secret.resolve',
        target_type: 'secret',
        outcome: 'success',
      }),
    ).resolves.not.toThrow();

    // DB write still happened
    expect(createMock).toHaveBeenCalledOnce();
  });

  // A4 -----------------------------------------------------------------------
  it('A4: concurrent writes all insert rows independently', async () => {
    const writes = Array.from({ length: 10 }).map((_, i) =>
      service.write({
        action: 'integration.test',
        target_type: 'integration',
        target_id: `int-${i}`,
        outcome: i % 2 === 0 ? 'success' : 'error',
      }),
    );
    await Promise.all(writes);

    expect(createMock).toHaveBeenCalledTimes(10);
  });

  // Extras -------------------------------------------------------------------
  it('write() stores metadata as JSON-safe object', async () => {
    await service.write({
      action: 'secret.acl_denied',
      target_type: 'secret',
      outcome: 'denied',
      metadata: { secretName: 'API_KEY', reason: 'node_type_mismatch' },
    });

    const data = createMock.mock.calls[0][0].data;
    expect(data.metadata).toMatchObject({ secretName: 'API_KEY', reason: 'node_type_mismatch' });
  });

  it('write() accepts undefined actor gracefully', async () => {
    await expect(
      service.write({
        action: 'flow.save',
        target_type: 'workflow',
        outcome: 'success',
      }),
    ).resolves.not.toThrow();

    const data = createMock.mock.calls[0][0].data;
    expect(data.actor_user_id).toBeNull();
    expect(data.actor_user_email).toBeNull();
    expect(data.actor_ip).toBeNull();
  });
});
