/**
 * VaultService — LOCAL_ENCRYPTION_KEY validation (fail-fast, #13 LOW)
 *
 * Regression for the at-rest key fail-OPEN bug: a non-64-hex
 * LOCAL_ENCRYPTION_KEY used to silently degrade — `Buffer.from(<bad>, 'hex')`
 * quietly produces a wrong-length / truncated key, which weakens (or garbles)
 * every at-rest secret without any error. The constructor now fails FAST when
 * the key is SET but malformed. The valid-key and unset-key (auto-generate)
 * paths are unchanged.
 *
 * Acceptance:
 *   - SET but malformed (short / non-hex / wrong-length) → throws at construction
 *   - valid 64-hex key → does NOT throw + encrypt/decrypt round-trips
 *   - unset / empty key → does NOT throw (auto-generates a valid 32-byte key)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createLoggerMock } from '../../test/mocks/logger.js';

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { VaultService } from '../vault.service.js';

// A valid 32-byte key = exactly 64 hex characters.
const VALID_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const ORIGINAL = process.env.LOCAL_ENCRYPTION_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LOCAL_ENCRYPTION_KEY;
  else process.env.LOCAL_ENCRYPTION_KEY = ORIGINAL;
});

describe('VaultService — LOCAL_ENCRYPTION_KEY fail-fast (#13)', () => {
  it('THROWS at construction when the key is SET but too short', () => {
    process.env.LOCAL_ENCRYPTION_KEY = 'deadbeef';
    expect(() => new VaultService()).toThrow(/LOCAL_ENCRYPTION_KEY/);
  });

  it('THROWS when the key is 64 chars but contains non-hex characters', () => {
    process.env.LOCAL_ENCRYPTION_KEY = 'z'.repeat(64);
    expect(() => new VaultService()).toThrow(/LOCAL_ENCRYPTION_KEY/);
  });

  it('THROWS when the key is the wrong length (63 hex chars / not 32 bytes)', () => {
    process.env.LOCAL_ENCRYPTION_KEY = '0'.repeat(63);
    expect(() => new VaultService()).toThrow();
  });

  it('does NOT throw for a valid 64-hex key', () => {
    process.env.LOCAL_ENCRYPTION_KEY = VALID_KEY;
    expect(() => new VaultService()).not.toThrow();
  });

  it('does NOT throw when the key is UNSET (auto-generates a valid 32-byte key)', () => {
    delete process.env.LOCAL_ENCRYPTION_KEY;
    expect(() => new VaultService()).not.toThrow();
  });

  it('treats an EMPTY key like unset (no throw — auto-generates)', () => {
    process.env.LOCAL_ENCRYPTION_KEY = '';
    expect(() => new VaultService()).not.toThrow();
  });

  it('a valid key yields a working encrypt/decrypt round-trip', () => {
    process.env.LOCAL_ENCRYPTION_KEY = VALID_KEY;
    const v = new VaultService();
    const ct = v.encryptLocal('top-secret');
    expect(ct).toMatch(/^local2:/);
    expect(v.decryptLocal(ct)).toBe('top-secret');
  });
});
