/**
 * Data Access Audit Service — 0.6.6 P5 (task #110)
 *
 * Append-only forensic log of every cross-user-sensitive data access:
 *   - Tool executions (who ran what, for whom, when)
 *   - RLS policy rejects (caught at Postgres layer; logged so we can
 *     distinguish stale-session bugs from probes)
 *   - Milvus wrapper calls (via MilvusAuditGuard events)
 *   - Admin-override reads (admin bypassing normal scope)
 *
 * Writes go to admin.data_access_audit, created by migration
 * 20260418_rls_expansion. Reads require admin context.
 *
 * Fire-and-forget semantics: a persist failure NEVER blocks the
 * request path. On DB outage we log a pino warning and move on —
 * the app is still safe (the structural isolation in RLS /
 * collection-naming / wrappers doesn't depend on the audit row
 * landing).
 */

import type { Logger } from 'pino';
import type { MilvusAuditEvent } from './MilvusAuditGuard.js';

export interface DataAccessAuditEntry {
  actorUserId: string;
  targetUserId?: string;
  action:
    | 'tool_exec'
    | 'query'
    | 'read'
    | 'write'
    | 'delete'
    | 'approval_decision'
    | 'cross_user_reject'
    | 'rls_reject'
    | 'admin_override'
    | 'milvus_search'
    | 'milvus_query'
    | 'milvus_insert'
    | 'milvus_upsert'
    | 'milvus_delete';
  resource: string;
  requestId?: string;
  route?: string;
  method?: string;
  clientIp?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

/**
 * Minimal persistence interface. The real implementation uses Prisma;
 * tests can swap in a pure in-memory sink.
 */
export interface AuditPersistence {
  write(entry: DataAccessAuditEntry & { ts: Date }): Promise<void>;
}

export class InMemoryAuditPersistence implements AuditPersistence {
  readonly rows: Array<DataAccessAuditEntry & { ts: Date }> = [];
  async write(entry: DataAccessAuditEntry & { ts: Date }): Promise<void> {
    this.rows.push(entry);
  }
}

export class DataAccessAuditService {
  private readonly logger: Logger;
  private readonly persistence: AuditPersistence;

  constructor(logger: Logger, persistence: AuditPersistence) {
    // Tolerate both pino and plain shim loggers — chat ctx.logger is a
    // plain {info,warn,error,debug} without .child(). Mirror the
    // PermissionService defensive pattern. Without this guard,
    // /api/chat/tool-approval/:requestId crashes when the singleton was
    // first seeded by a chat request (shim logger) and the HTTP route
    // tries to use it later (regression of #756).
    this.logger = typeof (logger as any)?.child === 'function'
      ? logger.child({ component: 'DataAccessAuditService' })
      : logger;
    this.persistence = persistence;
  }

  /**
   * Fire-and-forget: persist the audit row, swallow DB errors so the
   * caller's request path stays fast. Returns the promise for tests
   * that want to await it.
   */
  record(entry: DataAccessAuditEntry): Promise<void> {
    const row = { ...entry, ts: new Date() };
    return this.persistence.write(row).catch((err) => {
      this.logger.warn({
        err,
        actorUserId: entry.actorUserId,
        action: entry.action,
        resource: entry.resource,
      }, '[AUDIT] failed to persist data_access_audit row');
      // Swallow: never block the request.
    });
  }

  /**
   * Adapt a MilvusAuditEvent (emitted by MilvusAuditGuard) into the
   * audit action taxonomy and persist it.
   */
  recordMilvusEvent(event: MilvusAuditEvent, context?: {
    requestId?: string; route?: string; method?: string; clientIp?: string; userAgent?: string;
  }): Promise<void> {
    return this.record({
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId,
      action: mapMilvusAction(event.action),
      resource: event.resource,
      details: event.details,
      requestId: context?.requestId,
      route: context?.route,
      method: context?.method,
      clientIp: context?.clientIp,
      userAgent: context?.userAgent,
    });
  }

  /**
   * Dedicated entrypoint for cross-user rejects so the action field
   * is consistent regardless of which layer (Milvus wrapper, Postgres
   * RLS, application-layer guard) caught it.
   */
  recordCrossUserReject(params: {
    actorUserId: string;
    targetUserId: string;
    resource: string;
    reason: string;
    requestId?: string;
    route?: string;
    method?: string;
    clientIp?: string;
  }): Promise<void> {
    this.logger.warn({
      actorUserId: params.actorUserId,
      targetUserId: params.targetUserId,
      resource: params.resource,
      reason: params.reason,
    }, '[AUDIT] cross-user access rejected');
    return this.record({
      actorUserId: params.actorUserId,
      targetUserId: params.targetUserId,
      action: 'cross_user_reject',
      resource: params.resource,
      details: { reason: params.reason },
      requestId: params.requestId,
      route: params.route,
      method: params.method,
      clientIp: params.clientIp,
    });
  }

  /**
   * Record a Postgres RLS reject (SQLSTATE 42501 — insufficient
   * privilege). Called from Prisma middleware that translates the
   * Postgres error into an audit row so we can spot probe patterns.
   */
  recordRlsReject(params: {
    actorUserId: string;
    resource: string;
    pgErrorCode?: string;
    requestId?: string;
    route?: string;
  }): Promise<void> {
    return this.record({
      actorUserId: params.actorUserId,
      action: 'rls_reject',
      resource: params.resource,
      details: { pgErrorCode: params.pgErrorCode ?? '42501' },
      requestId: params.requestId,
      route: params.route,
    });
  }
}

function mapMilvusAction(action: MilvusAuditEvent['action']): DataAccessAuditEntry['action'] {
  switch (action) {
    case 'search': return 'milvus_search';
    case 'query':  return 'milvus_query';
    case 'insert': return 'milvus_insert';
    case 'upsert': return 'milvus_upsert';
    case 'delete': return 'milvus_delete';
    case 'cross_user_reject': return 'cross_user_reject';
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _instance: DataAccessAuditService | null = null;

/**
 * Lazy singleton for call sites that don't have DI. Prefers the real
 * Prisma-backed persistence when available; falls back to the in-memory
 * sink (primarily so unit tests and boot-up code can call record()
 * before the DB layer is ready without crashing).
 *
 * Production wiring replaces the persistence via
 * setDataAccessAuditServiceInstance() during server bootstrap once
 * Prisma is ready.
 */
export function getDataAccessAuditService(logger: Logger): DataAccessAuditService {
  if (_instance) return _instance;
  _instance = new DataAccessAuditService(logger, new InMemoryAuditPersistence());
  return _instance;
}

export function setDataAccessAuditServiceInstance(instance: DataAccessAuditService): void {
  _instance = instance;
}
