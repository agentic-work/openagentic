/**
 * CredentialEncryptionService round-trip tests.
 *
 * Phase A guard for the runtime IDP registry: the IdentityDirectory model stores
 * its IdP `clientSecret` inside the encrypted `auth_config` JSON and relies on
 * 'clientSecret' already being a member of SENSITIVE_FIELDS so it encrypts/decrypts
 * for free (no new crypto code). These tests pin that contract.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Stable hex key so the singleton vaultService encrypts/decrypts deterministically.
beforeAll(() => {
  process.env.LOCAL_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('CredentialEncryptionService — clientSecret round-trip', () => {
  it('round-trips an IdP clientSecret through encrypt → decrypt', async () => {
    const { encryptAuthConfig, decryptAuthConfig } = await import('../CredentialEncryptionService.js');

    const plaintext = 'super-secret-idp-value';
    const encrypted = encryptAuthConfig({ clientId: 'app-123', clientSecret: plaintext });

    // clientSecret must be encrypted (local:/local2: prefix), not stored as plaintext.
    expect(typeof encrypted.clientSecret).toBe('string');
    expect(encrypted.clientSecret).not.toBe(plaintext);
    expect(encrypted.clientSecret.startsWith('local2:') || encrypted.clientSecret.startsWith('local:')).toBe(true);

    // clientId is NOT sensitive → passes through unchanged.
    expect(encrypted.clientId).toBe('app-123');

    // Decrypting restores the original plaintext.
    const decrypted = decryptAuthConfig(encrypted);
    expect(decrypted.clientSecret).toBe(plaintext);
    expect(decrypted.clientId).toBe('app-123');
  });

  it("treats 'clientSecret' as a SENSITIVE_FIELD (encryption actually fires)", async () => {
    const { encryptAuthConfig } = await import('../CredentialEncryptionService.js');

    const encrypted = encryptAuthConfig({ clientSecret: 'x' });
    // If clientSecret were not in SENSITIVE_FIELDS it would pass through as the literal 'x'.
    expect(encrypted.clientSecret).not.toBe('x');
  });

  it('is idempotent — re-encrypting an already-encrypted clientSecret is a no-op', async () => {
    const { encryptAuthConfig } = await import('../CredentialEncryptionService.js');

    const once = encryptAuthConfig({ clientSecret: 'rotate-me' });
    const twice = encryptAuthConfig(once);
    expect(twice.clientSecret).toBe(once.clientSecret);
  });
});
