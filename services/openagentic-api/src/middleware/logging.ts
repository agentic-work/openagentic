/**
 * Simplified Logging Middleware for Chat API
 * 
 * Handles request logging only - response logging would need to be at plugin level
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from './unifiedAuth.js';

export interface LoggingConfig {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  logBody?: boolean;
  logHeaders?: boolean;
  logQueries?: boolean;
  maxBodyLength?: number;
  includeUserInfo?: boolean;
}

/**
 * Request logging middleware
 */
export function requestLoggingMiddleware(config: LoggingConfig = {}) {
  const {
    logLevel = 'info',
    logBody = false,
    logHeaders = false,
    logQueries = true,
    maxBodyLength = 1000,
    includeUserInfo = true
  } = config;

  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Basic request log
    const requestLog: any = {
      requestId,
      method: request.method,
      url: request.url,
      timestamp: new Date().toISOString()
    };

    // Add user info if available
    if (includeUserInfo && request.user) {
      requestLog.user = {
        id: request.user.id,
        email: request.user.email,
        isAdmin: request.user.isAdmin
      };
    }

    // Add headers if enabled
    if (logHeaders) {
      requestLog.headers = request.headers;
    }

    // Add query parameters if enabled
    if (logQueries) {
      requestLog.query = request.query;
    }

    // Add body if enabled (for POST/PUT requests)
    if (logBody && request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      requestLog.body = sanitizeBody(request.body, maxBodyLength);
    }

    request.log[logLevel](requestLog, 'Incoming request');
  };
}

/**
 * Sanitize request body for logging
 */
function sanitizeBody(body: any, maxLength: number): any {
  if (!body) return body;
  
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  
  // Truncate if too long
  if (bodyStr.length > maxLength) {
    return bodyStr.substring(0, maxLength) + '... [truncated]';
  }

  // Remove sensitive fields
  if (typeof body === 'object') {
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
    
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
  
  return body;
}

/**
 * Structured logging plugin - simplified version
 */
export const loggingMiddlewarePlugin = async (fastify: any) => {
  // Add request ID decorator
  fastify.decorateRequest('requestId', null);
  
  // Add pre-handler hook for request logging
  fastify.addHook('preHandler', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    request.requestId = requestId;
    
    // Simple request logging
    request.log.info({
      requestId,
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
      timestamp: new Date().toISOString()
    }, 'Request started');
  });

  // Add response hook for completion logging  
  fastify.addHook('onResponse', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    const duration = Date.now() - (request as any).startTime || 0;
    
    request.log.info({
      requestId: request.requestId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
      timestamp: new Date().toISOString()
    }, 'Request completed');
  });
};