/**
 * Pin: tokenValidator's JWT_SECRET resolution policy (the multi-replica footgun fix).
 *
 * The secret is resolved at MODULE LOAD time, so these tests set env vars and
 * then `vi.resetModules()` + dynamic-`import()` the module fresh to observe the
 * load-time behavior.
 *
 *  - PRODUCTION + missing/placeholder JWT_SECRET  → THROW at module load
 *    (fail-fast). Booting with a random ephemeral per-replica secret causes
 *    cross-pod 401s and wipes sessions on restart, so we refuse to boot.
 *
 *  - PRODUCTION + real JWT_SECRET                 → loads fine.
 *
 *  - NON-PRODUCTION (dev/test) + missing/placeholder JWT_SECRET → loads with an
 *    ephemeral secret (convenience for a fresh local checkout); the [CRITICAL]
 *    log warns. This preserves the existing local-dev/test path.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

describe('tokenValidator — JWT_SECRET resolution policy', () => {
  afterEach(() => {
    // Undo any env stubs from the test body, then re-import fresh so a later
    // suite never sees a module instance loaded under a stubbed env.
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('PRODUCTION + missing JWT_SECRET → throws at module load (fail-fast)', async () => {
    // NOTE: src/test/setup.ts forces NODE_ENV='test' at global setup, so we
    // MUST stub the env BEFORE resetModules + the dynamic import for the
    // production branch to actually execute at module load.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', '');
    vi.resetModules();
    await expect(import('../tokenValidator.js')).rejects.toThrow(/JWT_SECRET/i);
  });

  it('PRODUCTION + placeholder JWT_SECRET → throws at module load (fail-fast)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'CHANGE_ME_placeholder_value');
    vi.resetModules();
    await expect(import('../tokenValidator.js')).rejects.toThrow(/JWT_SECRET/i);
  });

  it('PRODUCTION + real JWT_SECRET → loads fine', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'a-real-strong-production-secret-abcdef1234567890');
    vi.resetModules();
    const mod = await import('../tokenValidator.js');
    expect(typeof mod.validateAnyToken).toBe('function');
  });

  it('NON-PRODUCTION + missing JWT_SECRET → loads with ephemeral secret (local-dev path preserved)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', '');
    vi.resetModules();
    const mod = await import('../tokenValidator.js');
    expect(typeof mod.validateAnyToken).toBe('function');
  });

  it('NON-PRODUCTION (test) + placeholder JWT_SECRET → loads with ephemeral secret', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('JWT_SECRET', 'placeholder');
    vi.resetModules();
    const mod = await import('../tokenValidator.js');
    expect(typeof mod.validateAnyToken).toBe('function');
  });
});
