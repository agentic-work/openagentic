/**
 * AuditLogService
 *
 * SOC 2 CC6/CC7 compliance — append-only flow governance event trail.
 *
 * Rules enforced at the application layer:
 *   - NEVER update or delete FlowAuditLog rows.
 *   - Every governance event produces exactly one INSERT.
 *   - Streaming sink dispatch is fire-and-forget: sink failures
 *     MUST NOT prevent the DB write from completing.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { AuditLogStreamingService } from './AuditLogStreamingService.js';

const logger = loggers.services.child({ component: 'AuditLogService' });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuditActor {
  userId?: string;
  userEmail?: string;
  ip?: string;
}

export interface WriteAuditLogInput {
  /** e.g. 'integration.create' | 'secret.resolve' | 'share.grant' */
  action: string;
  /** e.g. 'integration' | 'workflow' | 'secret' | 'share' | 'execution' */
  target_type: string;
  target_id?: string;
  /** 'success' | 'denied' | 'error' */
  outcome: string;
  actor?: AuditActor;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuditLogService {
  private readonly sink: AuditLogStreamingService;

  constructor() {
    this.sink = new AuditLogStreamingService();
  }

  /**
   * Write a governance event row.
   *
   * Validates required fields, inserts into `flow_audit_log`, then
   * dispatches to the configured streaming sink (fire-and-forget).
   *
   * @throws {Error} if action or target_type is empty.
   */
  async write(input: WriteAuditLogInput): Promise<void> {
    // A2 — guard required fields
    if (!input.action || input.action.trim() === '') {
      throw new Error('AuditLogService.write: action is required');
    }
    if (!input.target_type || input.target_type.trim() === '') {
      throw new Error('AuditLogService.write: target_type is required');
    }

    const row = await prisma.flowAuditLog.create({
      data: {
        action: input.action,
        target_type: input.target_type,
        target_id: input.target_id ?? null,
        outcome: input.outcome,
        actor_user_id: input.actor?.userId ?? null,
        actor_user_email: input.actor?.userEmail ?? null,
        actor_ip: input.actor?.ip ?? null,
        metadata: (input.metadata ?? {}) as any,
      },
    });

    // A3 — fire-and-forget: sink errors MUST NOT surface to caller
    this.sink.dispatch(row).catch((err) => {
      logger.warn({ err, auditLogId: row.id }, '[AuditLog] Sink dispatch failed — row is safely persisted in DB');
    });
  }
}

// Singleton
export const auditLogService = new AuditLogService();
