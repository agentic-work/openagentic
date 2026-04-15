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
 * Logger configuration for openagenticchat-ui service
 * 
 * Browser-compatible logger with console output
 * Uses structured logging similar to pino for consistency
 */

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogContext {
  service?: string;
  component?: string;
  [key: string]: any;
}

interface LoggerOptions {
  service: string;
  component?: string;
  level?: LogLevel;
}

class BrowserLogger {
  private service: string;
  private component?: string;
  private level: LogLevel;
  private context: LogContext;

  constructor(options: LoggerOptions) {
    this.service = options.service;
    this.component = options.component;
    // Simplified to two environments only
    // Production: info level (less verbose)
    // Development: debug level (very verbose console logs)
    const isProduction = (typeof import.meta !== 'undefined' && import.meta.env?.PROD) || false;
    this.level = options.level || (isProduction ? 'info' : 'debug');
    this.context = {
      service: this.service,
      component: this.component,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level.toUpperCase()} ${this.service}`;
    const componentPrefix = this.component ? ` | ${this.component}` : '';
    return `${prefix}${componentPrefix} | ${message}`;
  }

  private getConsoleMethod(level: LogLevel): 'log' | 'info' | 'warn' | 'error' {
    switch (level) {
      case 'trace':
      case 'debug':
        return 'log';
      case 'info':
        return 'info';
      case 'warn':
        return 'warn';
      case 'error':
      case 'fatal':
        return 'error';
      default:
        return 'log';
    }
  }

  private log(level: LogLevel, messageOrData: string | any, data?: any) {
    if (!this.shouldLog(level)) return;

    let message: string;
    let logData: any;

    if (typeof messageOrData === 'string') {
      message = messageOrData;
      logData = data;
    } else {
      message = messageOrData.msg || messageOrData.message || 'Log entry';
      logData = messageOrData;
    }

    const formattedMessage = this.formatMessage(level, message, logData);
    const method = this.getConsoleMethod(level);

    // Suppress ALL console output in production to prevent users from seeing errors
    const isProduction = import.meta.env.PROD || import.meta.env.NODE_ENV === 'production';

    if (!isProduction) {
      if (logData) {
        // Filter out sensitive data
        const sanitizedData = this.sanitizeData(logData);
        console[method](formattedMessage, sanitizedData);
      } else {
        console[method](formattedMessage);
      }
    }

    // Send to server in production (if configured)
    if (isProduction && (level === 'error' || level === 'fatal')) {
      this.sendToServer(level, message, logData);
    }
  }

  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const sensitiveFields = [
      'password',
      'passwordHash',
      'accessToken',
      'refreshToken',
      'idToken',
      'authorization',
      'apiKey',
      'cookie',
    ];

    const sanitized = { ...data };

    // Recursively sanitize nested objects
    const sanitizeObject = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      
      const result: any = Array.isArray(obj) ? [] : {};
      
      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
          result[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          result[key] = sanitizeObject(obj[key]);
        } else {
          result[key] = obj[key];
        }
      }
      
      return result;
    };

    return sanitizeObject(sanitized);
  }

  private sendToServer(level: LogLevel, message: string, data?: any) {
    // This would send logs to a server endpoint
    // Implementation depends on your logging infrastructure
    // For now, this is a placeholder
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        service: this.service,
        component: this.component,
        message,
        data: this.sanitizeData(data),
        userAgent: navigator.userAgent,
        url: window.location.href,
      };

      // Example: Send to logging endpoint
      // fetch('/logs', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(logEntry),
      // }).catch(() => {
      //   // Silently fail to avoid infinite loops
      // });
    } catch (e) {
      // Silently fail
    }
  }

  trace(messageOrData: string | any, data?: any) {
    this.log('trace', messageOrData, data);
  }

  debug(messageOrData: string | any, data?: any) {
    this.log('debug', messageOrData, data);
  }

  info(messageOrData: string | any, data?: any) {
    this.log('info', messageOrData, data);
  }

  warn(messageOrData: string | any, data?: any) {
    this.log('warn', messageOrData, data);
  }

  error(messageOrData: string | any, data?: any) {
    this.log('error', messageOrData, data);
  }

  fatal(messageOrData: string | any, data?: any) {
    this.log('fatal', messageOrData, data);
  }

  child(context: LogContext): BrowserLogger {
    const childLogger = new BrowserLogger({
      service: this.service,
      component: context.component || this.component,
      level: this.level,
    });
    childLogger.context = { ...this.context, ...context };
    return childLogger;
  }
}

// Create logger factory function
function createLogger(options: LoggerOptions): BrowserLogger {
  return new BrowserLogger(options);
}

// Create the main logger for this service
export const logger = createLogger({
  service: 'openagentic-ui',
});

// Helper functions
export function createChildLogger(parent: BrowserLogger, context: LogContext): BrowserLogger {
  return parent.child(context);
}

export function logError(
  logger: BrowserLogger,
  error: Error | any,
  message: string,
  context?: LogContext
) {
  logger.error({
    err: error,
    errorMessage: error?.message || String(error),
    errorStack: error?.stack,
    errorCode: error?.code,
    ...context,
  }, message);
}

// Service-specific logger categories
export const loggers = {
  app: createChildLogger(logger, { component: 'app' }),
  auth: createChildLogger(logger, { component: 'auth' }),
  chat: createChildLogger(logger, { component: 'chat' }),
  api: createChildLogger(logger, { component: 'api' }),
  mcp: createChildLogger(logger, { component: 'mcp' }),
  ui: createChildLogger(logger, { component: 'ui' }),
  hooks: createChildLogger(logger, { component: 'hooks' }),
  services: createChildLogger(logger, { component: 'services' }),
  admin: createChildLogger(logger, { component: 'admin' }),
  router: createChildLogger(logger, { component: 'router' }),
};

// Set up global error handlers for browser
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    logError(logger, event.error, 'Uncaught error', {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logError(logger, event.reason, 'Unhandled promise rejection');
  });
}

export type Logger = BrowserLogger;

export default logger;