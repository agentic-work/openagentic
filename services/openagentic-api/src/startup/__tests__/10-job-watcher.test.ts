/**
 * Step 10 — job-watcher-start
 * RED-first: step file does not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppContext } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

const mockStart = vi.fn();
const mockOn = vi.fn();
const MockJobCompletionWatcher = vi.fn().mockImplementation(() => ({
  start: mockStart,
  on: mockOn,
}));

vi.mock('../../services/JobCompletionWatcher.js', () => ({
  JobCompletionWatcher: MockJobCompletionWatcher,
}));

const mockIsConnected = vi.fn().mockReturnValue(true);
vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({
    isConnected: mockIsConnected,
  }),
  initializeRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { START_JOB_WATCHER } from '../10-job-watcher.js';
import type { BootstrapDeps } from '../types.js';

function makeCtx() {
  return new AppContext({ prisma: {} as any, logger: {} as any });
}

const stubDeps = (ctx = makeCtx()): BootstrapDeps => ({
  server: {} as any,
  ctx,
});

describe('START_JOB_WATCHER step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
  });

  it('has correct name and critical=false', () => {
    expect(START_JOB_WATCHER.name).toBe('job-watcher-start');
    expect(START_JOB_WATCHER.critical).toBe(false);
  });

  it('sets ctx.jobCompletionWatcher and calls start() when Redis is connected', async () => {
    const ctx = makeCtx();
    await START_JOB_WATCHER.run(stubDeps(ctx));
    expect(ctx.jobCompletionWatcher).toBeDefined();
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it('does NOT set ctx.jobCompletionWatcher when Redis is not connected', async () => {
    mockIsConnected.mockReturnValue(false);
    const ctx = makeCtx();
    await START_JOB_WATCHER.run(stubDeps(ctx));
    expect(ctx.jobCompletionWatcher).toBeUndefined();
  });

  it('does NOT throw on failure (non-critical)', async () => {
    mockStart.mockImplementationOnce(() => { throw new Error('watcher failed'); });
    const ctx = makeCtx();
    await expect(START_JOB_WATCHER.run(stubDeps(ctx))).resolves.toBeUndefined();
  });
});
