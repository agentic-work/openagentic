/**
 * Step 01 — secrets-load
 * RED-first: step file does not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoggerMock } from '../../test/mocks/logger.js';

vi.mock('../../config/secrets.config.js', () => ({
  getSecrets: vi.fn().mockReturnValue({ some: 'secret' }),
  logSecrets: vi.fn(),
  setAppSecrets: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { LOAD_SECRETS } from '../01-secrets.js';
import type { BootstrapDeps } from '../types.js';

const stubDeps = (): BootstrapDeps => ({
  server: {} as any,
  ctx: {} as any,
});

describe('LOAD_SECRETS step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name and critical=false', () => {
    expect(LOAD_SECRETS.name).toBe('secrets-load');
    expect(LOAD_SECRETS.critical).toBe(false);
  });

  it('sets (global as any).appSecrets on success', async () => {
    const { getSecrets, setAppSecrets } = await import('../../config/secrets.config.js');
    (getSecrets as ReturnType<typeof vi.fn>).mockReturnValue({ some: 'secret' });

    await LOAD_SECRETS.run(stubDeps());

    expect(setAppSecrets).toHaveBeenCalledWith({ some: 'secret' });
  });

  it('does NOT throw when getSecrets throws (non-critical)', async () => {
    const { getSecrets } = await import('../../config/secrets.config.js');
    (getSecrets as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('secrets unavailable');
    });

    await expect(LOAD_SECRETS.run(stubDeps())).resolves.toBeUndefined();
  });
});
