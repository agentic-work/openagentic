/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
 * Check if a value is already encrypted (has local: prefix from VaultService)
 */
function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('local:');
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
 * Values without the local: prefix are returned as-is (plaintext or not yet migrated).
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
        logger.error({ field, error: err }, '[CredentialEncryption] Failed to decrypt field - key may have changed');
        // Return the encrypted value rather than crashing; caller will get an unusable credential
        // which is safer than silently failing
      }
    }
  }

  return decrypted;
}
