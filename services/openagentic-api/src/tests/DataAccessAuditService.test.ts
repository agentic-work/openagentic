import { describe, test, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import {
  DataAccessAuditService,
  InMemoryAuditPersistence,
  type AuditPersistence,
  type DataAccessAuditEntry,
} from '../services/DataAccessAuditService.js';
import { buildMilvusAuditEvent } from '../services/MilvusAuditGuard.js';

const logger = pino({ level: 'silent' });

describe('DataAccessAuditService — append-only forensic log (P5 task #110)', () => {
  let store: InMemoryAuditPersistence;
  let svc: DataAccessAuditService;

  beforeEach(() => {
    store = new InMemoryAuditPersistence();
    svc = new DataAccessAuditService(logger, store);
  });

  test('record() persists the entry with a generated ts', async () => {
    await svc.record({
      actorUserId: 'user-1',
      action: 'tool_exec',
      resource: 'tool:azure_list_resource_groups',
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].actorUserId).toBe('user-1');
    expect(store.rows[0].action).toBe('tool_exec');
    expect(store.rows[0].ts).toBeInstanceOf(Date);
  });

  test('record() is fire-and-forget: DB error does NOT throw to caller', async () => {
    const flaky: AuditPersistence = {
      write: vi.fn().mockRejectedValue(new Error('pg timeout')),
    };
    const flakySvc = new DataAccessAuditService(logger, flaky);
    // Must resolve normally, not reject
    await expect(flakySvc.record({
      actorUserId: 'user-1',
      action: 'read',
      resource: 'test',
    })).resolves.toBeUndefined();
    expect((flaky.write as any)).toHaveBeenCalledTimes(1);
  });

  test('recordMilvusEvent maps search → milvus_search', async () => {
    const event = buildMilvusAuditEvent({
      actorUserId: 'user-1',
      action: 'search',
      collection: 'memories_user_1',
      details: { topK: 5 },
    });
    await svc.recordMilvusEvent(event, { requestId: 'req-abc', route: '/api/chat/stream' });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].action).toBe('milvus_search');
    expect(store.rows[0].resource).toBe('milvus:memories_user_1');
    expect(store.rows[0].requestId).toBe('req-abc');
    expect(store.rows[0].details).toEqual({ topK: 5 });
  });

  test('recordMilvusEvent maps each SDK action to its audit counterpart', async () => {
    const actions = ['search', 'query', 'insert', 'upsert', 'delete'] as const;
    const expected: Record<typeof actions[number], DataAccessAuditEntry['action']> = {
      search: 'milvus_search',
      query:  'milvus_query',
      insert: 'milvus_insert',
      upsert: 'milvus_upsert',
      delete: 'milvus_delete',
    };
    for (const action of actions) {
      await svc.recordMilvusEvent(buildMilvusAuditEvent({
        actorUserId: 'user-1',
        action,
        collection: 'memories_user_1',
      }));
    }
    expect(store.rows).toHaveLength(actions.length);
    store.rows.forEach((row, i) => {
      expect(row.action).toBe(expected[actions[i]]);
    });
  });

  test('recordCrossUserReject fires a warn log + persists with reason', async () => {
    await svc.recordCrossUserReject({
      actorUserId: 'user-alpha',
      targetUserId: 'user-beta',
      resource: 'milvus:memories_user_beta',
      reason: 'mismatched userId between JWT and URL param',
      requestId: 'req-xyz',
    });
    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row.action).toBe('cross_user_reject');
    expect(row.actorUserId).toBe('user-alpha');
    expect(row.targetUserId).toBe('user-beta');
    expect(row.details).toEqual({ reason: 'mismatched userId between JWT and URL param' });
  });

  test('recordRlsReject defaults to pg error code 42501', async () => {
    await svc.recordRlsReject({
      actorUserId: 'user-1',
      resource: 'chat_sessions:sess-abc',
    });
    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row.action).toBe('rls_reject');
    expect(row.details).toEqual({ pgErrorCode: '42501' });
  });

  test('multiple records are ordered in insertion order', async () => {
    await svc.record({ actorUserId: 'u1', action: 'read', resource: 'r1' });
    await svc.record({ actorUserId: 'u1', action: 'write', resource: 'r1' });
    await svc.record({ actorUserId: 'u1', action: 'delete', resource: 'r1' });
    expect(store.rows.map(r => r.action)).toEqual(['read', 'write', 'delete']);
  });
});
