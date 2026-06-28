/**
 * TDD — IntegrationConfigService (G1: encryption-at-rest, SC-28)
 *
 * RED-first. Written before the service exists.
 *
 * Acceptance:
 *   R1  encrypt → decrypt round-trip restores the original secret values
 *   R2  encrypt only touches the sensitive fields; non-secrets pass through
 *   R3  encrypted values carry the vault envelope prefix and are NOT the plaintext
 *   R4  encrypt is idempotent (an already-encrypted config is not double-encrypted)
 *   R5  PLAINTEXT-PASSTHROUGH backcompat: a pre-encryption (plaintext) config still
 *       decrypts/reads, and a one-time warning is logged
 *   R6  drop-or-warn on decrypt failure: an envelope value that fails to decrypt is
 *       dropped (so callers treat the integration as misconfigured), with an error log
 *   R7  null / non-object inputs pass straight through
 *
 * Uses the REAL vaultService (local AES-256-GCM, no network) with a fixed
 * LOCAL_ENCRYPTION_KEY for deterministic round-trips. Logger is mocked so the
 * warn/error paths can be asserted.
 */

// Fix the local encryption key BEFORE the service (and its vaultService
// singleton) load — the singleton reads LOCAL_ENCRYPTION_KEY at construction.
process.env.LOCAL_ENCRYPTION_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createLoggerMock } from '../../test/mocks/logger.js';

vi.mock('../../utils/logger.js', () => createLoggerMock());

type IntegrationConfigModule =
  typeof import('../IntegrationConfigService.js');
let svc: IntegrationConfigModule;
let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  svc = await import('../IntegrationConfigService.js');
  const loggerMod = await import('../../utils/logger.js');
  logger = (loggerMod as unknown as { logger: typeof logger }).logger;
});

beforeEach(() => {
  vi.clearAllMocks();
  svc.__resetIntegrationConfigWarnState();
});

describe('IntegrationConfigService — encryption-at-rest', () => {
  // R1 + R2 + R3
  it('R1/R2/R3: encrypt → decrypt round-trips secrets; non-secrets untouched; ciphertext is enveloped', () => {
    const original = {
      botToken: 'xoxb-1234567890-abcdefghijk',
      signingSecret: 'abcdef1234567890abcdef1234567890',
      appPassword: 'super-secret-app-password',
      appId: '550e8400-e29b-41d4-a716-446655440000', // public client_id — not secret
      channel: 'C0123456789',
    };

    const encrypted = svc.encryptIntegrationConfig(original);

    // R3: secrets are enveloped + not equal to plaintext
    expect(encrypted.botToken).toMatch(/^local2:/);
    expect(encrypted.botToken).not.toBe(original.botToken);
    expect(encrypted.signingSecret).toMatch(/^local2:/);
    expect(encrypted.appPassword).toMatch(/^local2:/);

    // R2: non-secret fields pass through unchanged
    expect(encrypted.appId).toBe(original.appId);
    expect(encrypted.channel).toBe(original.channel);

    // R1: decrypt restores the originals
    const decrypted = svc.decryptIntegrationConfig(encrypted);
    expect(decrypted.botToken).toBe(original.botToken);
    expect(decrypted.signingSecret).toBe(original.signingSecret);
    expect(decrypted.appPassword).toBe(original.appPassword);
    expect(decrypted.appId).toBe(original.appId);
    expect(decrypted.channel).toBe(original.channel);
  });

  // R4
  it('R4: encrypt is idempotent — an already-encrypted config is not double-encrypted', () => {
    const original = { botToken: 'xoxb-abc-def', signingSecret: 'ssecret' };
    const once = svc.encryptIntegrationConfig(original);
    const twice = svc.encryptIntegrationConfig(once);

    expect(twice.botToken).toBe(once.botToken); // unchanged on second pass
    expect(twice.signingSecret).toBe(once.signingSecret);
    // And it still decrypts back to the original
    const decrypted = svc.decryptIntegrationConfig(twice);
    expect(decrypted.botToken).toBe(original.botToken);
    expect(decrypted.signingSecret).toBe(original.signingSecret);
  });

  // R5 — plaintext-passthrough backcompat
  it('R5: a pre-encryption (plaintext) config still reads, and warns once', () => {
    const legacyPlaintext = {
      botToken: 'xoxb-plaintext-legacy',
      signingSecret: 'plaintext-signing-secret',
      appId: 'A0123456789',
    };

    const decrypted = svc.decryptIntegrationConfig(legacyPlaintext);

    // Values still readable (passed through unchanged)
    expect(decrypted.botToken).toBe('xoxb-plaintext-legacy');
    expect(decrypted.signingSecret).toBe('plaintext-signing-secret');
    expect(decrypted.appId).toBe('A0123456789');

    // One-time plaintext warning emitted (never logging the value itself)
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Second read does NOT warn again (deduped per process)
    svc.decryptIntegrationConfig(legacyPlaintext);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  // R6 — drop-or-warn on decrypt failure
  it('R6: an envelope value that fails to decrypt is dropped with an error log', () => {
    const tampered = {
      botToken: 'local2:deadbeef:deadbeef:deadbeefdeadbeef', // valid prefix, bad bytes
      appId: 'A0123456789',
    };

    const decrypted = svc.decryptIntegrationConfig(tampered);

    // Field dropped so the caller treats the integration as misconfigured
    expect(decrypted.botToken).toBeUndefined();
    expect('botToken' in decrypted).toBe(false);
    // Non-secret survives
    expect(decrypted.appId).toBe('A0123456789');
    // Error logged
    expect(logger.error).toHaveBeenCalled();
  });

  // R7 — null / non-object passthrough
  it('R7: null / non-object inputs pass through unchanged', () => {
    expect(svc.encryptIntegrationConfig(null)).toBeNull();
    expect(svc.decryptIntegrationConfig(null)).toBeNull();
    expect(svc.encryptIntegrationConfig(undefined)).toBeUndefined();
    expect(svc.decryptIntegrationConfig(undefined)).toBeUndefined();
  });

  it('does not encrypt empty-string secrets', () => {
    const cfg = { botToken: '', signingSecret: '' };
    const encrypted = svc.encryptIntegrationConfig(cfg);
    expect(encrypted.botToken).toBe('');
    expect(encrypted.signingSecret).toBe('');
  });
});
