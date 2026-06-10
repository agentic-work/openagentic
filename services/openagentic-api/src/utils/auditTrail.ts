/**
 * Audit Trail System
 * Tracks all administrative and sensitive operations
 */

import { FastifyRequest } from 'fastify';
import { pino } from 'pino';
import crypto from 'crypto';
import { prisma } from './prisma.js';
import { createChainedAdminAudit } from '../services/audit/adminAuditChain.js';

const logger: any = pino({
  name: 'audit-trail',
  level: process.env.LOG_LEVEL || 'info'
});

/**
 * Audit event types
 */
export enum AuditEventType {
  // Authentication events
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  
  // User management
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_DELETE = 'USER_DELETE',
  USER_ROLE_CHANGE = 'USER_ROLE_CHANGE',
  USER_ENABLE = 'USER_ENABLE',
  USER_DISABLE = 'USER_DISABLE',
  
  // Data access
  DATA_VIEW = 'DATA_VIEW',
  DATA_EXPORT = 'DATA_EXPORT',
  DATA_IMPORT = 'DATA_IMPORT',
  
  // System configuration
  CONFIG_CHANGE = 'CONFIG_CHANGE',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  SYSTEM_SETTING_CHANGE = 'SYSTEM_SETTING_CHANGE',
  
  // MCP operations
  MCP_SERVER_START = 'MCP_SERVER_START',
  MCP_SERVER_STOP = 'MCP_SERVER_STOP',
  MCP_CONFIG_CHANGE = 'MCP_CONFIG_CHANGE',
  MCP_TOOL_EXECUTION = 'MCP_TOOL_EXECUTION',
  
  // Security events
  SECURITY_ALERT = 'SECURITY_ALERT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  SQL_INJECTION_ATTEMPT = 'SQL_INJECTION_ATTEMPT',
  XSS_ATTEMPT = 'XSS_ATTEMPT',
  
  // Admin operations
  ADMIN_ACTION = 'ADMIN_ACTION',
  BULK_OPERATION = 'BULK_OPERATION',
  DATABASE_QUERY = 'DATABASE_QUERY',
  
  // Prompt management
  PROMPT_CREATE = 'PROMPT_CREATE',
  PROMPT_UPDATE = 'PROMPT_UPDATE',
  PROMPT_DELETE = 'PROMPT_DELETE',
  PROMPT_ASSIGN = 'PROMPT_ASSIGN',

  // Credential management (LLM provider secrets)
  CREDENTIAL_CREATE = 'CREDENTIAL_CREATE',
  CREDENTIAL_UPDATE = 'CREDENTIAL_UPDATE',
  CREDENTIAL_DELETE = 'CREDENTIAL_DELETE',
  CREDENTIAL_VIEW = 'CREDENTIAL_VIEW'
}

/**
 * Audit event severity levels
 */
export enum AuditSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL'
}

/**
 * Audit event interface
 */
export interface AuditEvent {
  id?: string;
  timestamp: Date;
  eventType: AuditEventType;
  severity: AuditSeverity;
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  resourceId?: string;
  action: string;
  details?: any;
  oldValue?: any;
  newValue?: any;
  success: boolean;
  errorMessage?: string;
  sessionId?: string;
  requestId?: string;
  checksum?: string;
}

/**
 * Audit trail class
 */
export class AuditTrail {
  private logger: any = logger;
  
  constructor() {
    // Using Prisma instead of Pool
    this.initializeTable();
  }

  /**
   * Initialize audit trail table if it doesn't exist
   */
  private async initializeTable(): Promise<void> {
    try {
      // Verify audit table exists using Prisma
      await prisma.adminAuditLog.findMany({ take: 1 });
      logger.info('Audit trail table initialized');
    } catch (error) {
      logger.error('Failed to initialize audit table:', error);
    }
  }
  
  /**
   * Log an audit event
   */
  async log(event: AuditEvent): Promise<void> {
    try {
      const checksum = this.generateChecksum(event);
      
      await createChainedAdminAudit({
        data: {
          id: event.id || crypto.randomUUID(),
          admin_user_id: event.userId,
          admin_email: event.userEmail,
          action: event.action || event.eventType,
          resource_type: event.resource || '',
          resource_id: event.resourceId || '',
          details: {
            eventType: event.eventType,
            severity: event.severity,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
            ...event.details,
            checksum,
            oldValue: event.oldValue,
            newValue: event.newValue,
            success: event.success,
            errorMessage: event.errorMessage,
            sessionId: event.sessionId,
            requestId: event.requestId
          },
          ip_address: event.ipAddress,
          created_at: event.timestamp || new Date()
        }
      });
      
      logger.info('Audit event logged', {
        eventType: event.eventType,
        userId: event.userId,
        success: event.success
      });
    } catch (error) {
      logger.error('Failed to log audit event:', error);
      // Don't throw - audit failures shouldn't break the main operation
    }
  }
  
  /**
   * Generate checksum for event integrity
   */
  private generateChecksum(event: any): string {
    const data = {
      eventType: event.eventType || event.event_type,
      userId: event.userId || event.user_id,
      action: event.action,
      timestamp: event.timestamp || event.created_at
    };
    
    return crypto.createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  private async verifyEvent(eventId: string): Promise<boolean> {
    try {
      const event = await prisma.adminAuditLog.findUnique({
        where: { id: eventId }
      });
      
      if (!event) {
        return false;
      }

      const expectedChecksum = this.generateChecksum(event);
      
      const details = event.details as any;
      return details?.checksum === expectedChecksum;
    } catch (error) {
      logger.error('Failed to verify event:', error);
      return false;
    }
  }
}

/**
 * Audit middleware factory
 */
export function auditMiddleware(
  auditTrail: AuditTrail,
  eventType: AuditEventType,
  resource?: string
) {
  return async (request: FastifyRequest, reply: any, done: any) => {
    const startTime = Date.now();
    
    // Log the start of the operation
    const event: AuditEvent = {
      timestamp: new Date(),
      eventType,
      severity: AuditSeverity.INFO,
      userId: (request as any).user?.id,
      userEmail: (request as any).user?.email,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      action: `${request.method} ${request.url}`,
      details: {
        body: request.body,
        query: request.query,
        params: request.params
      },
      success: true,
      sessionId: (request as any).sessionId,
      requestId: request.id
    };
    
    if (resource) {
      event.resource = resource;
    }
    
    // Hook into response to log completion
    reply.addHook('onSend', async (req: any, rep: any, payload: any) => {
      event.success = rep.statusCode < 400;
      event.details = {
        ...event.details,
        responseTime: Date.now() - startTime,
        statusCode: rep.statusCode
      };
      
      if (!event.success) {
        event.severity = AuditSeverity.WARNING;
        event.errorMessage = payload;
      }
      
      await auditTrail.log(event);
      return payload;
    });
    
    done();
  };
}