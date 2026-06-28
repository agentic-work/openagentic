/**
 * Step 03 — database-init
 * RED-first: step file does not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoggerMock } from '../../test/mocks/logger.js';

const mockInitialize = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/DatabaseService.js', () => ({
  DatabaseService: {
    initialize: mockInitialize,
  },
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { INIT_DATABASE } from '../03-database.js';
import type { BootstrapDeps } from '../types.js';

const stubDeps = (): BootstrapDeps => ({
  server: {} as any,
  ctx: {} as any,
});

describe('INIT_DATABASE step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name and critical=true', () => {
    expect(INIT_DATABASE.name).toBe('database-init');
    expect(INIT_DATABASE.critical).toBe(true);
  });

  it('calls DatabaseService.initialize() once', async () => {
    await INIT_DATABASE.run(stubDeps());
    expect(mockInitialize).toHaveBeenCalledOnce();
  });

  it('propagates error when DatabaseService.initialize() throws (critical)', async () => {
    mockInitialize.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(INIT_DATABASE.run(stubDeps())).rejects.toThrow('db unavailable');
  });
});
