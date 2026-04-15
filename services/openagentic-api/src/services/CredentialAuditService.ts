/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * CredentialAuditService
 *
 * Dedicated audit trail for credential / LLM-provider CRUD operations.
 * Writes to the `credential_audit_log` table (CredentialAuditLog model)
 * and also logs to console for observability.
 *
 * Usage:
 *   import { credentialAuditService } from '../services/CredentialAuditService.js';
 *   await credentialAuditService.log({ ... });
 */

import { FastifyRequest } from 'fastify';
import { pino } from 'pino';
import { prisma } from '../utils/prisma.js';

const logger = pino({ name: 'credential-audit', level: process.env.LOG_LEVEL || 'info' });

function getPrisma() {
  return prisma;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialAuditEntry {
  userId: string;
  userEmail?: string;
  action: 'create' | 'update' | 'delete' | 'view' | 'enable' | 'disable';
  entityType: 'llm_provider' | 'mcp_server' | 'api_key';
  entityId: string;
  entityName?: string;
  /** For update actions, a diff of changed fields: { field: { old, new } } */
  changes?: Record<string, { old?: unknown; new?: unknown }>;
  /** Optionally pass the Fastify request to auto-extract IP + User-Agent */
  request?: FastifyRequest;
  ipAddress?: string;
  userAgent?: string;
}

export interface CredentialAuditQuery {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class CredentialAuditService {
  /**
   * Log a credential change event.
   * This never throws -- audit failures must not break the main operation.
   */
  async log(entry: CredentialAuditEntry): Promise<void> {
    try {
      const ip = entry.ipAddress || entry.request?.ip || null;
      const ua = entry.userAgent || entry.request?.headers['user-agent'] || null;

      await getPrisma().credentialAuditLog.create({
        data: {
          user_id: entry.userId,
          user_email: entry.userEmail || null,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          entity_name: entry.entityName || null,
          changes: entry.changes ? (entry.changes as any) : undefined,
          ip_address: ip || null,
          user_agent: ua || null,
        },
      });

      logger.info(
        {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          entityName: entry.entityName,
          userId: entry.userId,
          userEmail: entry.userEmail,
        },
        `Credential audit: ${entry.action} ${entry.entityType} "${entry.entityName || entry.entityId}"`,
      );
    } catch (error) {
      // Never throw -- audit logging failure must not disrupt the CRUD operation.
      logger.error({ error, entry }, 'Failed to write credential audit log');
    }
  }

  /**
   * Query credential audit logs with filtering and pagination.
   */
  async query(opts: CredentialAuditQuery): Promise<{ logs: any[]; total: number }> {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (opts.userId) where.user_id = opts.userId;
    if (opts.action) where.action = opts.action;
    if (opts.entityType) where.entity_type = opts.entityType;
    if (opts.entityId) where.entity_id = opts.entityId;

    // Date range
    if (opts.startDate || opts.endDate) {
      where.created_at = {};
      if (opts.startDate) where.created_at.gte = new Date(opts.startDate);
      if (opts.endDate) where.created_at.lte = new Date(opts.endDate);
    }

    // Free-text search across entity_name, user_email, action
    if (opts.search) {
      where.OR = [
        { entity_name: { contains: opts.search, mode: 'insensitive' } },
        { user_email: { contains: opts.search, mode: 'insensitive' } },
        { action: { contains: opts.search, mode: 'insensitive' } },
        { entity_type: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const db = getPrisma();

    const [logs, total] = await Promise.all([
      db.credentialAuditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip,
      }),
      db.credentialAuditLog.count({ where }),
    ]);

    return { logs, total };
  }
}

// Export a singleton
export const credentialAuditService = new CredentialAuditService();
export default credentialAuditService;
