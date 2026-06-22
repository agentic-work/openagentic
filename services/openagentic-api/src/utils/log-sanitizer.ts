/**
 * Log sanitizer utility for sensitive data obfuscation
 */

import type { Logger } from 'pino';

export interface SanitizeOptions {
  showPartial?: boolean;  // Show partial values (first/last few chars)
  customPatterns?: RegExp[];  // Additional patterns to sanitize
}

/**
 * Obfuscate sensitive string values
 */
export function obfuscateValue(value: any, type: 'token' | 'email' | 'uuid' | 'default' = 'default'): string {
  if (!value) return value;
  const str = String(value);
  
  switch (type) {
    case 'token':
      // Show first 10 and last 5 chars for tokens
      if (str.length > 20) {
        return `${str.substring(0, 10)}...${str.substring(str.length - 5)}`;
      }
      return '[SHORT_TOKEN]';
      
    case 'email':
      const emailParts = str.split('@');
      if (emailParts.length === 2) {
        const localPart = emailParts[0];
        const domain = emailParts[1];
        if (localPart.length > 3) {
          return `${localPart.substring(0, 3)}***@${domain}`;
        }
        return `***@${domain}`;
      }
      return '[INVALID_EMAIL]';
      
    case 'uuid':
      // Show first 8 chars of UUID (standard prefix)
      const uuidMatch = str.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      if (uuidMatch) {
        return `${str.substring(0, 8)}-****-****-****-************`;
      }
      return '[INVALID_UUID]';
      
    default:
      // Default: show first 4 and last 2 chars
      if (str.length > 10) {
        return `${str.substring(0, 4)}...${str.substring(str.length - 2)}`;
      }
      return '[REDACTED]';
  }
}

/**
 * Detect the type of sensitive data
 */
export function detectSensitiveType(key: string, value: any): 'token' | 'email' | 'uuid' | 'default' | null {
  const keyLower = key.toLowerCase();
  
  // Token detection
  if (keyLower.includes('token') || keyLower.includes('bearer') || keyLower === 'authorization') {
    return 'token';
  }
  
  // Email detection
  if (keyLower.includes('email') || keyLower.includes('upn') || keyLower.includes('userprincipalname')) {
    return 'email';
  }
  
  // UUID detection (Azure IDs)
  if (keyLower.includes('tenantid') || keyLower.includes('subscriptionid') || 
      keyLower.includes('objectid') || keyLower.includes('clientid')) {
    return 'uuid';
  }
  
  // Value-based detection
  if (typeof value === 'string') {
    // Check if it looks like an email
    if (value.includes('@') && value.includes('.')) {
      return 'email';
    }
    
    // Check if it looks like a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return 'uuid';
    }
    
    // Check if it looks like a JWT token
    if (value.startsWith('eyJ') && value.split('.').length === 3) {
      return 'token';
    }
  }
  
  return null;
}

/**
 * Deep sanitize an object, replacing sensitive values
 */
export function sanitizeObject(obj: any, options: SanitizeOptions = {}): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, options));
  }
  
  // Handle objects
  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    
    // Keys that should be completely redacted
    const completeRedactKeys = [
      'password', 'passwordhash', 'secret', 'clientsecret', 'jwtsecret',
      'signingsecret', 'apikey', 'api_key', 'x-api-key', 'connectionstring',
      'databaseurl', 'database_url'
    ];
    
    if (completeRedactKeys.some(k => keyLower.includes(k))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    // Keys that should be partially shown
    const partialShowKeys = [
      'token', 'accesstoken', 'refreshtoken', 'idtoken', 'bearertoken',
      'authorization', 'email', 'upn', 'userprincipalname',
      'tenantid', 'tenant_id', 'subscriptionid', 'subscription_id',
      'objectid', 'aadobjectid', 'clientid', 'client_id'
    ];
    
    if (partialShowKeys.some(k => keyLower.includes(k))) {
      const type = detectSensitiveType(key, value);
      if (type && options.showPartial !== false) {
        sanitized[key] = obfuscateValue(value, type);
      } else {
        sanitized[key] = '[REDACTED]';
      }
      continue;
    }
    
    // Check custom patterns
    if (options.customPatterns) {
      let isCustomSensitive = false;
      for (const pattern of options.customPatterns) {
        if (pattern.test(key) || (typeof value === 'string' && pattern.test(value))) {
          sanitized[key] = '[REDACTED]';
          isCustomSensitive = true;
          break;
        }
      }
      if (isCustomSensitive) continue;
    }
    
    // Recursively sanitize nested objects
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, options);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Create a safe logger wrapper that automatically sanitizes all logs
 */
export function createSafeLogger(logger: any, options: SanitizeOptions = {}): any {
  // During Docker builds, skip sanitization to avoid type issues
  if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_LOG_SANITIZATION) {
    return logger;
  }
  
  const logMethods = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const safeLogger: any = Object.create(Object.getPrototypeOf(logger));
  
  // Copy all properties and methods from original logger
  for (const key of Object.getOwnPropertyNames(logger)) {
    if (typeof logger[key] === 'function' && logMethods.includes(key)) {
      // Wrap log methods with sanitization
      safeLogger[key] = function(this: any, ...args: any[]) {
        const sanitizedArgs = args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            return sanitizeObject(arg, options);
          }
          return arg;
        });
        
        return logger[key].apply(this, sanitizedArgs);
      };
    } else if (key === 'child') {
      // Handle child logger creation
      safeLogger[key] = function(this: any, bindings: any) {
        const sanitizedBindings = sanitizeObject(bindings, options);
        return createSafeLogger(logger.child(sanitizedBindings) as Logger, options);
      };
    } else {
      // Copy other properties/methods as-is
      safeLogger[key] = logger[key];
    }
  }
  
  // Preserve prototype chain
  Object.setPrototypeOf(safeLogger, Object.getPrototypeOf(logger));
  
  return safeLogger;
}

/**
 * Express/Fastify request sanitizer middleware
 */
export function sanitizeRequest(req: any): any {
  return {
    method: req.method,
    url: req.url,
    headers: sanitizeObject(req.headers, { showPartial: true }),
    query: sanitizeObject(req.query, { showPartial: true }),
    params: sanitizeObject(req.params, { showPartial: true }),
    body: sanitizeObject(req.body, { showPartial: true }),
    user: req.user ? {
      id: req.user.id,
      email: obfuscateValue(req.user.email, 'email'),
      username: req.user.username,
      isAdmin: req.user.isAdmin,
      groups: req.user.groups
    } : undefined
  };
}

/**
 * Sanitize error objects
 */
export function sanitizeError(error: any): any {
  if (!error) return error;
  
  const sanitized: any = {
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    type: error.constructor?.name || 'Error'
  };
  
  // Sanitize stack traces to remove sensitive file paths
  if (error.stack) {
    sanitized.stack = error.stack
      .split('\n')
      .map((line: string) => {
        // Remove absolute paths, keep relative ones
        return line.replace(/\/[^\s]+\/openagentic\//g, './');
      })
      .join('\n');
  }
  
  // Sanitize any additional properties
  for (const [key, value] of Object.entries(error)) {
    if (!['message', 'code', 'statusCode', 'stack', 'name'].includes(key)) {
      sanitized[key] = sanitizeObject(value, { showPartial: true });
    }
  }
  
  return sanitized;
}