import { Logger } from 'pino';

export function createTestLogger(): Logger {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => noopLogger,
    level: 'silent'
  };

  return noopLogger as any;
}