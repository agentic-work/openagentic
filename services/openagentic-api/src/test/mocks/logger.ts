/**
 * Shared logger mock factory for test files.
 *
 * Matches the full public surface of utils/logger.ts:
 *   - default export (pino-like logger with .info/.warn/.error/.debug/.fatal/.child/.bindings)
 *   - loggers.{server, auth, chat, mcp, database, admin, routes, middleware, services, pipeline, storage, prompt}
 *     each a full logger with .child() returning itself (recursive)
 *   - logger alias (same reference as default)
 *   - logServiceStartup, logServiceShutdown, logError as vi.fn() stubs
 *   - createChildLogger as vi.fn() stub
 *
 * Usage in test files (vi.mock must be at module scope before any import):
 *
 *   import { createLoggerMock } from '../../test/mocks/logger.js';
 *   vi.mock('../../utils/logger.js', () => createLoggerMock());
 *
 * The path depth ('../../' prefix) may vary — adjust to match relative distance
 * from the test file to utils/logger.js.
 */

import { vi } from 'vitest';

/** All category names that appear in the real loggers object. */
const LOGGER_CATEGORIES = [
  'server',
  'auth',
  'chat',
  'mcp',
  'database',
  'admin',
  'routes',
  'middleware',
  'services',
  'pipeline',
  'storage',
  'prompt',
] as const;

type LoggerCategory = (typeof LOGGER_CATEGORIES)[number];

/** Shape of a single mock logger instance. */
export interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  child: (bindings?: Record<string, unknown>) => MockLogger;
  bindings: () => { service: string };
}

/** Return value of createLoggerMock() — matches utils/logger.ts named exports. */
export interface LoggerMock {
  default: MockLogger;
  logger: MockLogger;
  loggers: Record<LoggerCategory, MockLogger>;
  logServiceStartup: ReturnType<typeof vi.fn>;
  logServiceShutdown: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
  createChildLogger: ReturnType<typeof vi.fn>;
}

/** Build one mock logger instance whose .child() returns itself. */
function makeLogger(): MockLogger {
  const inst: MockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child(_bindings?: Record<string, unknown>) { return inst; },
    bindings() { return { service: 'test' }; },
  };
  return inst;
}

/**
 * Returns a fresh module-mock shape each time it is called.
 * Pass this as the factory to vi.mock():
 *
 *   vi.mock('../../utils/logger.js', () => createLoggerMock());
 */
export function createLoggerMock(): LoggerMock {
  const base = makeLogger();

  const loggers = {} as Record<LoggerCategory, MockLogger>;
  for (const cat of LOGGER_CATEGORIES) {
    loggers[cat] = makeLogger();
  }

  return {
    default: base,
    logger: base,
    loggers,
    logServiceStartup: vi.fn(),
    logServiceShutdown: vi.fn(),
    logError: vi.fn(),
    createChildLogger: vi.fn().mockImplementation((_parent: unknown, _ctx: unknown) => makeLogger()),
  };
}
