/**
 * Integration Config Encryption Service (encryption-at-rest, SC-28)
 *
 * Envelope-encrypts the sensitive fields of `Integration.config` (Slack bot
 * token + signing secret, Teams app password) at rest. Before this, those
 * credentials were stored PLAINTEXT in Postgres (the `admin-integrations.ts`
 * create handler even carried a `// Should be encrypted` comment) — an
 * encryption-at-rest gap: a DB read, a failover read-replica, a backup, or a
 * credential-audit surface would expose a live Slack bot credential AND the
 * secret that gates every inbound dispatch.
 *
 * Reuses the platform's local AES-256-GCM envelope from VaultService
 * (`local2:` format: 12-byte IV + 16-byte auth tag). Encrypt at write (admin
 * POST/PUT), decrypt at read (the secret-consuming sites in
 * SlackIntegrationService / TeamsIntegrationService / webhooks / admin test
 * routes).
 *
 * MIGRATION-SAFE: a value is only decrypted when it carries the `local:` /
 * `local2:` envelope prefix; plaintext rows written before this change stay
 * readable and are transparently re-encrypted on the next save. A one-time
 * warning is logged when a plaintext secret is observed (never logging the
 * value itself).
 *
 * SECURITY: when LOCAL_ENCRYPTION_KEY changes, existing encrypted values become
 * unreadable. The key MUST be stable across deployments.
 */

import { vaultService } from './vault.service.js';
import { logger } from '../utils/logger.js';

/**
 * Sensitive fields in an Integration.config that must be encrypted at rest.
 * These are the genuine secrets carried by Slack/Teams integration configs.
 * `appId` is intentionally EXCLUDED — it is a public client_id (UUID), used
 * as `client_id` in the Teams OAuth token request, not a secret.
 */
const SENSITIVE_INTEGRATION_FIELDS = new Set<string>([
  'botToken', // Slack: workspace-wide send/read (also the Slack OAuth access_token)
  'signingSecret', // Slack: gates every inbound signature verification
  'appPassword', // Teams: bot framework client_secret
  // OAuth-callback write path may land delegated tokens:
  'accessToken', // Teams user-OAuth delegated access token
  'refreshToken', // Teams user-OAuth delegated refresh token
  // Defensive coverage for secret-bearing keys other providers may carry.
  'clientSecret',
  'apiKey',
  'token',
  'password',
  'webhookSecret',
]);

/**
 * A value is "already encrypted" when it carries the VaultService envelope
 * prefix. `local:` is the legacy v1 (AES-256-CBC) format; `local2:` is the
 * current v2 (AES-256-GCM) format. Both must be treated as encrypted so the
 * decrypt path runs and plaintext is never re-encrypted (idempotence) and never
 * forwarded as ciphertext.
 */
function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && (value.startsWith('local:') || value.startsWith('local2:'));
}

// One-time (per process) warning dedup, so an unmigrated plaintext row does not
// spam the logs on every inbound Slack event. The value is NEVER logged.
let warnedPlaintextOnce = false;

/**
 * Encrypt the sensitive fields of an Integration.config object.
 * Non-sensitive fields and already-encrypted values pass through unchanged
 * (idempotent — safe to call on an already-encrypted config).
 *
 * Generic over the input shape so the caller keeps its type; non-object inputs
 * (null / undefined / primitives) pass straight through.
 */
export function encryptIntegrationConfig<T>(config: T): T {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const source = config as Record<string, unknown>;
  const encrypted: Record<string, unknown> = { ...source };

  for (const [field, value] of Object.entries(encrypted)) {
    if (
      SENSITIVE_INTEGRATION_FIELDS.has(field) &&
      typeof value === 'string' &&
      value.length > 0 &&
      !isEncrypted(value)
    ) {
      try {
        encrypted[field] = vaultService.encryptLocal(value);
      } catch (err) {
        // Leave plaintext in place rather than losing the value; surface the
        // failure (without the value) so misconfiguration is visible.
        logger.error({ field, error: err }, '[IntegrationConfig] Failed to encrypt field');
      }
    }
  }

  return encrypted as T;
}

/**
 * Decrypt the sensitive fields of an Integration.config object.
 *
 * Plaintext-backcompat: values WITHOUT the envelope prefix are returned as-is
 * (a row written before this change). The first time a plaintext secret is
 * observed in a process, a one-time warning is logged (without the value) so
 * operators know a re-save will encrypt it.
 *
 * If a value carries the envelope prefix but fails to decrypt (LOCAL_ENCRYPTION_KEY
 * rotation, wiped Vault, etc.) the field is DELETED from the result so callers
 * fall through to "misconfigured" handling instead of forwarding ciphertext as a
 * credential (which Slack/Teams reject with confusing errors).
 */
export function decryptIntegrationConfig<T>(config: T): T {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const source = config as Record<string, unknown>;
  const decrypted: Record<string, unknown> = { ...source };
  let sawPlaintextSecret = false;

  for (const [field, value] of Object.entries(decrypted)) {
    if (!SENSITIVE_INTEGRATION_FIELDS.has(field)) continue;
    if (typeof value !== 'string' || value.length === 0) continue;

    if (isEncrypted(value)) {
      try {
        decrypted[field] = vaultService.decryptLocal(value);
      } catch (err) {
        logger.error(
          { field, error: err },
          '[IntegrationConfig] Failed to decrypt field — key may have changed; dropping so caller treats integration as misconfigured',
        );
        delete decrypted[field];
      }
    } else {
      // Plaintext secret on a not-yet-migrated row.
      sawPlaintextSecret = true;
    }
  }

  if (sawPlaintextSecret && !warnedPlaintextOnce) {
    warnedPlaintextOnce = true;
    logger.warn(
      { component: 'IntegrationConfig' },
      '[IntegrationConfig] Integration.config contains a PLAINTEXT secret at rest (pre-encryption row). ' +
        'It will be encrypted on the next save (PUT /api/admin/integrations/:id). Secret value not logged.',
    );
  }

  return decrypted as T;
}

/** Testing hook — reset the one-time-warning dedup flag. */
export function __resetIntegrationConfigWarnState(): void {
  warnedPlaintextOnce = false;
}
