/**
 * Step 02 — vault-init
 * RED-first: step file does not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoggerMock } from '../../test/mocks/logger.js';

const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockSetVaultService = vi.fn();
const MockVaultInitService = vi.fn().mockImplementation(() => ({
  initialize: mockInitialize,
}));

vi.mock('../../services/VaultInitService.js', () => ({
  VaultInitService: MockVaultInitService,
  setVaultService: mockSetVaultService,
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { INIT_VAULT } from '../02-vault.js';
import type { BootstrapDeps } from '../types.js';

const stubDeps = (): BootstrapDeps => ({
  server: {} as any,
  ctx: {} as any,
});

describe('INIT_VAULT step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name and critical=false', () => {
    expect(INIT_VAULT.name).toBe('vault-init');
    expect(INIT_VAULT.critical).toBe(false);
  });

  it('calls VaultInitService.initialize() and stores globally', async () => {
    await INIT_VAULT.run(stubDeps());
    expect(mockInitialize).toHaveBeenCalledOnce();
    expect(mockSetVaultService).toHaveBeenCalledOnce();
  });

  it('does NOT throw when VaultInitService.initialize() throws (non-critical)', async () => {
    mockInitialize.mockRejectedValueOnce(new Error('vault unavailable'));
    await expect(INIT_VAULT.run(stubDeps())).resolves.toBeUndefined();
  });
});
