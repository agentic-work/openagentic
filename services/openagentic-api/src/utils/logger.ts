/**
 * Logger configuration for openagentic-api service
 * 
 * Standardized logger using pino with pretty printing in dev and JSON in prod
 */

import pino, { stdTimeFunctions, stdSerializers } from 'pino';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';
import { createSafeLogger, sanitizeError, sanitizeRequest } from './log-sanitizer.js';

// Export Pino's Logger type
export type Logger = PinoLogger;

// JSON output by default (for Promtail/Loki/Splunk ingestion)
// Set LOG_PRETTY=true for human-readable local dev output
const usePretty = process.env.LOG_PRETTY === 'true';

const level = process.env.LOG_LEVEL || 'info';

// Create logger with appropriate configuration
function createLogger(options: { service: string; component?: string }): PinoLogger {
  const baseConfig: LoggerOptions = {
    level,
    name: options.service,
    timestamp: stdTimeFunctions.isoTime,
    base: {
      service: options.service,
      component: options.component,
      pid: process.pid,
      hostname: process.env.HOSTNAME,
    },
    // Redact sensitive fields
    redact: {
      paths: [
        // Passwords and hashes
        'password',
        'passwordHash',
        '*.password',
        '*.passwordHash',
        
        // Tokens
        'accessToken',
        'refreshToken',
        'idToken',
        'token',
        'bearerToken',
        '*.accessToken',
        '*.refreshToken',
        '*.idToken',
        '*.token',
        '*.bearerToken',
        
        // Azure AD specific
        'clientSecret',
        'client_secret',
        'tenantId',
        'tenant_id',
        'subscriptionId',
        'subscription_id',
        'aadObjectId',
        'objectId',
        'upn',
        'userPrincipalName',
        '*.clientSecret',
        '*.client_secret',
        '*.tenantId',
        '*.tenant_id',
        '*.subscriptionId',
        '*.subscription_id',
        '*.aadObjectId',
        '*.objectId',
        
        // Headers
        'authorization',
        'Authorization',
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-ms-token-aad-access-token"]',
        'req.headers["x-ms-token-aad-refresh-token"]',
        'req.headers["x-ms-token-aad-id-token"]',
        'res.headers["set-cookie"]',
        
        // API Keys
        'apiKey',
        'api_key',
        '*.apiKey',
        '*.api_key',
        
        // Database
        'connectionString',
        'databaseUrl',
        'DATABASE_URL',
        '*.connectionString',
        '*.databaseUrl',
        
        // Azure OpenAI
        'azureOpenAIKey',
        'AZURE_OPENAI_API_KEY',
        '*.azureOpenAIKey',
        
        // JWT secrets
        'jwtSecret',
        'JWT_SECRET',
        'signingSecret',
        'SIGNING_SECRET',
        '*.jwtSecret',
        '*.signingSecret'
      ],
      censor: '[REDACTED]',
    },
    // Serializers for common objects
    serializers: {
      req: stdSerializers.req,
      res: stdSerializers.res,
      err: stdSerializers.err,
      error: stdSerializers.err,
    },
  };

  // Pretty print only when explicitly requested (LOG_PRETTY=true)
  if (usePretty) {
    try {
      require.resolve('pino-pretty');
      return pino({
        ...baseConfig,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            messageFormat: '{service} | {component} | {msg}',
            errorLikeObjectKeys: ['err', 'error'],
            singleLine: false
          },
        },
      });
    } catch {
      // pino-pretty not installed, fall back to JSON
    }
  }

  // Default: JSON output (for Promtail/Loki/Splunk)
  return pino(baseConfig);
}

// Create the main logger for this service
export const logger: any = createLogger({
  service: 'openagentic-api',
});

// Helper functions
export function createChildLogger(parent: PinoLogger, context: Record<string, any>): PinoLogger {
  return parent.child(context) as PinoLogger;
}

export function logError(
  logger: PinoLogger,
  error: Error | any,
  message: string,
  context?: Record<string, any>
) {
  logger.error({
    err: error,
    errorMessage: error?.message || String(error),
    errorStack: error?.stack,
    errorCode: error?.code,
    ...context,
  }, message);
}

export function logServiceStartup(logger: PinoLogger, port?: number | string) {
  const startupInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    env: process.env.NODE_ENV,
    port,
  };

  logger.info(startupInfo, `${logger.bindings().service} service started`);
}

export function logServiceShutdown(logger: PinoLogger, reason?: string) {
  logger.info({ reason }, `${logger.bindings().service} service shutting down`);
}

// Service-specific logger categories
export const loggers: any = {
  server: logger.child({ component: 'server' }),
  auth: logger.child({ component: 'auth' }),
  chat: logger.child({ component: 'chat' }),
  mcp: logger.child({ component: 'mcp' }),
  database: logger.child({ component: 'database' }),
  admin: logger.child({ component: 'admin' }),
  routes: logger.child({ component: 'routes' }),
  middleware: logger.child({ component: 'middleware' }),
  services: logger.child({ component: 'services' }),
  pipeline: logger.child({ component: 'pipeline' }),
  storage: logger.child({ component: 'storage' }),
  prompt: logger.child({ component: 'prompt' }),
};

// Set up global error handlers
function setupGlobalErrorHandlers(logger: PinoLogger) {
  process.on('uncaughtException', (error) => {
    logError(logger, error, 'Uncaught exception', { fatal: true });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logError(logger, reason as Error, 'Unhandled rejection', {
      promise: String(promise),
    });
  });

  process.on('SIGTERM', () => {
    logServiceShutdown(logger, 'SIGTERM received');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logServiceShutdown(logger, 'SIGINT received');
    process.exit(0);
  });
}

setupGlobalErrorHandlers(logger);

export default logger;