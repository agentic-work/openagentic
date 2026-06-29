/**
 * TDD RED-first: asserts createLoggerMock() returns a complete logger stub
 * matching the real utils/logger.ts surface.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLoggerMock } from '../logger.js';

describe('createLoggerMock()', () => {
  it('returns an object', () => {
    const m = createLoggerMock();
    expect(m).toBeDefined();
    expect(typeof m).toBe('object');
  });

  it('has a default export with logger methods', () => {
    const m = createLoggerMock();
    expect(typeof m.default.info).toBe('function');
    expect(typeof m.default.warn).toBe('function');
    expect(typeof m.default.error).toBe('function');
    expect(typeof m.default.debug).toBe('function');
    expect(typeof m.default.fatal).toBe('function');
    expect(typeof m.default.child).toBe('function');
  });

  it('default.child() returns a logger with the same methods (recursive)', () => {
    const m = createLoggerMock();
    const child = m.default.child({});
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
  });

  it('has a logger alias equal to default', () => {
    const m = createLoggerMock();
    expect(m.logger).toBe(m.default);
  });

  it('has loggers.server with info and child', () => {
    const m = createLoggerMock();
    expect(typeof m.loggers.server.info).toBe('function');
    expect(typeof m.loggers.server.child).toBe('function');
  });

  it('has loggers.services with info and child', () => {
    const m = createLoggerMock();
    expect(typeof m.loggers.services.info).toBe('function');
    expect(typeof m.loggers.services.child).toBe('function');
  });

  it('has loggers.routes with info and child', () => {
    const m = createLoggerMock();
    expect(typeof m.loggers.routes.info).toBe('function');
    expect(typeof m.loggers.routes.child).toBe('function');
  });

  it('has loggers.database with info and child', () => {
    const m = createLoggerMock();
    expect(typeof m.loggers.database.info).toBe('function');
    expect(typeof m.loggers.database.child).toBe('function');
  });

  it('has all 12 loggers categories', () => {
    const m = createLoggerMock();
    const expected = ['server', 'auth', 'chat', 'mcp', 'database', 'admin', 'routes', 'middleware', 'services', 'pipeline', 'storage', 'prompt'];
    for (const cat of expected) {
      expect(m.loggers[cat], `loggers.${cat} missing`).toBeDefined();
      expect(typeof m.loggers[cat].info, `loggers.${cat}.info not a function`).toBe('function');
      expect(typeof m.loggers[cat].child, `loggers.${cat}.child not a function`).toBe('function');
    }
  });

  it('has logServiceStartup and logServiceShutdown as vi.fn()', () => {
    const m = createLoggerMock();
    expect(typeof m.logServiceStartup).toBe('function');
    expect(typeof m.logServiceShutdown).toBe('function');
    // Should be vi.fn() stubs — they should be callable
    m.logServiceStartup({} as any);
    m.logServiceShutdown({} as any);
  });

  it('has logError as a function', () => {
    const m = createLoggerMock();
    expect(typeof m.logError).toBe('function');
  });

  it('each call to createLoggerMock() returns fresh vi.fn() instances', () => {
    const m1 = createLoggerMock();
    const m2 = createLoggerMock();
    // Different instances — not the same reference
    expect(m1.default.info).not.toBe(m2.default.info);
  });
});
