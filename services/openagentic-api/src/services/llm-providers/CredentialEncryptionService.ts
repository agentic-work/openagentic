/**
 * Credential Encryption Service
 *
 * Encrypts/decrypts sensitive fields in LLM provider auth_config JSON.
 * Uses VaultService's local AES-256-CBC encryption (local:iv:ciphertext format).
 *
 * SECURITY: When LOCAL_ENCRYPTION_KEY changes, all encrypted auth_config values
 * become unreadable. The key MUST be stable across deployments.
 */

import { vaultService } from '../vault.service.js';
import { logger } from '../../utils/logger.js';

/** Fields that contain sensitive credential data and must be encrypted */
const SENSITIVE_FIELDS = new Set([
  'apiKey',
  'key',
  'clientSecret',
  'secretAccessKey',
  'credentials',
  'accessKeyId',
  'password',
  'token',
]);

/**
 * Check if a value is already encrypted. VaultService emits `local:` for the
 * v1 format and `local2:` for the v2 AES-256-GCM format. Both must be
 * treated as encrypted so decryptAuthConfig runs the right path.
 *
 * Prior bug: this only matched `local:`. DB values in `local2:` format
 * were treated as plaintext → decrypt never ran → the ciphertext blob got
 * sent upstream as a client secret → AADSTS7000215 invalid_client.
 */
function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && (value.startsWith('local:') || value.startsWith('local2:'));
}

/**
 * Encrypt sensitive fields in an auth_config object.
 * Non-sensitive fields and already-encrypted values are passed through unchanged.
 */
export function encryptAuthConfig(authConfig: any): any {
  if (!authConfig || typeof authConfig !== 'object') {
    return authConfig;
  }

  const encrypted = { ...authConfig };

  for (const [field, value] of Object.entries(encrypted)) {
    if (SENSITIVE_FIELDS.has(field) && typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
      try {
        encrypted[field] = vaultService.encryptLocal(value);
      } catch (err) {
        logger.error({ field, error: err }, '[CredentialEncryption] Failed to encrypt field');
        // Leave plaintext in place rather than losing the value
      }
    }
  }

  return encrypted;
}

/**
 * Decrypt sensitive fields in an auth_config object.
 * Values without the local:/local2: prefix are returned as-is (plaintext or not yet migrated).
 * Fields that fail to decrypt (LOCAL_ENCRYPTION_KEY rotation, orphaned ciphertext from a
 * wiped Vault, etc.) are DELETED from the result so callers fall through to env-var
 * fallbacks instead of forwarding ciphertext as a credential (which upstream APIs
 * reject with confusing errors — e.g. Entra AADSTS7000215 "invalid_client" when the
 * caller is AzureAIFoundryProvider sending the bare local2: blob as clientSecret).
 */
export function decryptAuthConfig(authConfig: any): any {
  if (!authConfig || typeof authConfig !== 'object') {
    return authConfig;
  }

  const decrypted = { ...authConfig };

  for (const [field, value] of Object.entries(decrypted)) {
    if (typeof value === 'string' && isEncrypted(value)) {
      try {
        decrypted[field] = vaultService.decryptLocal(value);
      } catch (err) {
        logger.error(
          { field, error: err },
          '[CredentialEncryption] Failed to decrypt field - key may have changed; dropping so env-var fallback applies',
        );
        delete decrypted[field];
      }
    }
  }

  return decrypted;
}
