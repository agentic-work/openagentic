/**
 * Input Validation and Sanitization Utilities
 * Prevents injection attacks and ensures data integrity
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { pino } from 'pino';

const logger = pino({
  name: 'validation',
  level: process.env.LOG_LEVEL || 'info'
});

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(public field: string, public message: string) {
    super(`Validation failed for ${field}: ${message}`);
    this.name = 'ValidationError';
  }
}

/**
 * String validation and sanitization
 */
export const StringValidator = {
  /**
   * Sanitize string to prevent XSS
   */
  sanitize(value: any): string {
    if (typeof value !== 'string') return '';
    
    return value
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  },

  /**
   * Validate email format
   */
  isEmail(value: string): boolean {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(value);
  },

  /**
   * Validate UUID format
   */
  isUUID(value: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  },

  /**
   * Validate alphanumeric with underscores (for identifiers)
   */
  isIdentifier(value: string): boolean {
    const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return identifierRegex.test(value);
  },

  /**
   * Validate max length
   */
  maxLength(value: string, max: number): boolean {
    return value.length <= max;
  },

  /**
   * Validate min length
   */
  minLength(value: string, min: number): boolean {
    return value.length >= min;
  }
};

/**
 * Number validation
 */
export const NumberValidator = {
  /**
   * Validate integer
   */
  isInteger(value: any): boolean {
    return Number.isInteger(value);
  },

  /**
   * Validate positive number
   */
  isPositive(value: number): boolean {
    return value > 0;
  },

  /**
   * Validate range
   */
  inRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  }
};

/**
 * SQL injection prevention for dynamic queries
 */
export const SQLValidator = {
  /**
   * Validate table/column name
   */
  isValidIdentifier(name: string): boolean {
    // Only allow alphanumeric, underscore, and dot (for schema.table)
    return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(name);
  },

  /**
   * Validate ORDER BY direction
   */
  isValidDirection(direction: string): boolean {
    return ['ASC', 'DESC', 'asc', 'desc'].includes(direction);
  },

  /**
   * Escape special characters for LIKE queries
   */
  escapeLike(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
  }
};

/**
 * Request body validation schemas
 */
export const Schemas = {
  /**
   * Validate prompt template creation
   */
  promptTemplate: {
    name: { required: true, type: 'string', maxLength: 255 },
    description: { required: false, type: 'string', maxLength: 1000 },
    content: { required: true, type: 'string', maxLength: 10000 },
    category: { required: false, type: 'string', maxLength: 50 },
    tags: { required: false, type: 'array' },
    isPublic: { required: false, type: 'boolean' }
  },

  /**
   * Validate user update
   */
  userUpdate: {
    email: { required: false, type: 'string', validator: StringValidator.isEmail },
    isAdmin: { required: false, type: 'boolean' },
    groups: { required: false, type: 'array' }
  },

  /**
   * Validate session creation
   */
  sessionCreate: {
    title: { required: false, type: 'string', maxLength: 255 },
    model: { required: false, type: 'string', maxLength: 50 }
  }
};

/**
 * Validate request body against schema
 */
export function validateBody(
  body: any,
  schema: Record<string, any>
): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = body[field];

    // Check required
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(new ValidationError(field, 'Field is required'));
      continue;
    }

    // Skip optional empty fields
    if (!rules.required && (value === undefined || value === null)) {
      continue;
    }

    // Check type
    if (rules.type && typeof value !== rules.type) {
      errors.push(new ValidationError(field, `Expected ${rules.type} but got ${typeof value}`));
      continue;
    }

    // Check string validations
    if (rules.type === 'string') {
      if (rules.maxLength && !StringValidator.maxLength(value, rules.maxLength)) {
        errors.push(new ValidationError(field, `Maximum length is ${rules.maxLength}`));
      }
      if (rules.minLength && !StringValidator.minLength(value, rules.minLength)) {
        errors.push(new ValidationError(field, `Minimum length is ${rules.minLength}`));
      }
      if (rules.validator && !rules.validator(value)) {
        errors.push(new ValidationError(field, 'Invalid format'));
      }
    }

    // Check number validations
    if (rules.type === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        errors.push(new ValidationError(field, `Minimum value is ${rules.min}`));
      }
      if (rules.max !== undefined && value > rules.max) {
        errors.push(new ValidationError(field, `Maximum value is ${rules.max}`));
      }
    }

    // Check array validations
    if (rules.type === 'array' && !Array.isArray(value)) {
      errors.push(new ValidationError(field, 'Expected an array'));
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validation middleware factory
 */
export function validateRequest(schema: Record<string, any>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { valid, errors } = validateBody(request.body, schema);
    
    if (!valid) {
      logger.warn({ errors }, 'Validation failed');
      await reply.status(400).send({
        error: 'Validation failed',
        details: errors.map(e => ({ field: e.field, message: e.message }))
      });
      return;
    }
    // Continue to next handler if validation passes
  };
}

/**
 * Sanitize all string fields in an object
 */
export function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return StringValidator.sanitize(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Prevent path traversal attacks
 */
export function sanitizePath(path: string): string {
  return path
    .replace(/\.\./g, '') // Remove parent directory references
    .replace(/[^\w\s\-./]/g, '') // Remove special characters
    .replace(/\/+/g, '/'); // Normalize multiple slashes
}