/**
 * Secure Error Handler
 * Prevents information leakage in error responses
 */

import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { pino } from 'pino';

const logger = pino({
  name: 'error-handler',
  level: process.env.LOG_LEVEL || 'info'
});

/**
 * Error types that are safe to expose to clients
 */
export enum SafeErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT = 'RATE_LIMIT',
  BAD_REQUEST = 'BAD_REQUEST',
  CONFLICT = 'CONFLICT'
}

/**
 * Custom error class for controlled error responses
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public type: SafeErrorType,
    public message: string,
    public details?: any,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Sanitize error details to prevent information leakage
 */
function sanitizeError(error: any): {
  statusCode: number;
  error: string;
  message: string;
  details?: any;
} {
  // Known safe errors
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      error: error.type,
      message: error.message,
      details: error.details
    };
  }

  // Database errors - hide details
  if (error.code && error.code.startsWith('P')) {
    // PostgreSQL error codes
    logger.error({ error }, 'Database error occurred');
    return {
      statusCode: 500,
      error: 'DATABASE_ERROR',
      message: 'A database error occurred. Please try again later.'
    };
  }

  // Validation errors
  if (error.validation) {
    return {
      statusCode: 400,
      error: SafeErrorType.VALIDATION_ERROR,
      message: 'Validation failed',
      details: error.validation
    };
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return {
      statusCode: 401,
      error: SafeErrorType.AUTHENTICATION_ERROR,
      message: 'Invalid authentication token'
    };
  }

  if (error.name === 'TokenExpiredError') {
    return {
      statusCode: 401,
      error: SafeErrorType.AUTHENTICATION_ERROR,
      message: 'Authentication token has expired'
    };
  }

  // Rate limit errors
  if (error.statusCode === 429) {
    return {
      statusCode: 429,
      error: SafeErrorType.RATE_LIMIT,
      message: error.message || 'Too many requests'
    };
  }

  // Default error - hide all details
  logger.error({ error }, 'Unhandled error occurred');
  
  // In production, hide error details
  if (process.env.NODE_ENV === 'production') {
    return {
      statusCode: error.statusCode || 500,
      error: 'INTERNAL_ERROR',
      message: 'An internal error occurred. Please try again later.'
    };
  }

  // In development, show more details (but still sanitized)
  return {
    statusCode: error.statusCode || 500,
    error: 'INTERNAL_ERROR',
    message: error.message || 'An internal error occurred',
    details: process.env.NODE_ENV === 'development' ? {
      type: error.name,
      // Don't expose stack traces even in dev
      hint: 'Check server logs for details'
    } : undefined
  };
}

/**
 * Global error handler for Fastify
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  // Log error with context
  const errorContext = {
    method: request.method,
    url: request.url,
    ip: request.ip,
    userId: (request as any).user?.id,
    error: {
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
      statusCode: (error as any).statusCode || error.statusCode
    }
  };

  // Log based on error severity
  if (error.statusCode && error.statusCode < 500) {
    logger.warn(errorContext, 'Client error occurred');
  } else {
    logger.error(errorContext, 'Server error occurred');
  }

  // Send sanitized error response
  const sanitized = sanitizeError(error);
  reply.status(sanitized.statusCode).send(sanitized);
}

/**
 * Not found handler
 */
export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  logger.warn({
    method: request.method,
    url: request.url,
    ip: request.ip
  }, 'Route not found');

  reply.status(404).send({
    statusCode: 404,
    error: SafeErrorType.NOT_FOUND,
    message: 'The requested resource was not found'
  });
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(
  fn: (request: FastifyRequest, reply: FastifyReply) => Promise<any>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await fn(request, reply);
    } catch (error) {
      // Let the global error handler deal with it
      throw error;
    }
  };
}

/**
 * Create standardized error responses
 */
export const ErrorResponses = {
  unauthorized: () => new AppError(
    401,
    SafeErrorType.AUTHENTICATION_ERROR,
    'Authentication required'
  ),

  forbidden: () => new AppError(
    403,
    SafeErrorType.AUTHORIZATION_ERROR,
    'You do not have permission to perform this action'
  ),

  notFound: (resource: string) => new AppError(
    404,
    SafeErrorType.NOT_FOUND,
    `${resource} not found`
  ),

  badRequest: (message: string) => new AppError(
    400,
    SafeErrorType.BAD_REQUEST,
    message
  ),

  validation: (errors: any[]) => new AppError(
    400,
    SafeErrorType.VALIDATION_ERROR,
    'Validation failed',
    errors
  ),

  conflict: (message: string) => new AppError(
    409,
    SafeErrorType.CONFLICT,
    message
  ),

  rateLimit: () => new AppError(
    429,
    SafeErrorType.RATE_LIMIT,
    'Too many requests. Please try again later.'
  )
};

/**
 * Error monitoring and alerting
 */
export function monitorError(error: any, context: any): void {
  // Track error metrics
  const errorType = error.name || 'UnknownError';
  const statusCode = error.statusCode || 500;

  // Log to monitoring system (implement based on your monitoring solution)
  logger.error({
    error: {
      type: errorType,
      message: error.message,
      statusCode,
      stack: error.stack
    },
    context,
    timestamp: new Date().toISOString()
  }, 'Error monitoring event');

  // Send alerts for critical errors
  if (statusCode >= 500) {
    // Implement alerting logic here (e.g., send to Slack, PagerDuty, etc.)
    logger.error({ errorType, context }, 'CRITICAL: Server error detected');
  }
}