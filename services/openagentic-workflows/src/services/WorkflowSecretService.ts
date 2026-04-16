/**
 * WorkflowSecretService
 *
 * Manages workflow secrets with AES-256-GCM encryption for the fallback
 * (dev-only) encrypted_value path.  In production, secrets are expected to
 * use ESO (External Secrets Operator) and the encrypted_value column is
 * unused.
 *
 * Resolution order for resolveSecretValue():
 *   1. workflow-scoped secret  (scope='workflow', matching workflow_id)
 *   2. group-scoped secret     (scope='group', matching group_id)
 *   3. global-scoped secret    (scope='global')
 *
 * Encryption uses AES-256-GCM via Node.js crypto.  The key is derived
 * from the WORKFLOW_SECRET_KEY env var using scrypt if it is not already
 * exactly 32 bytes.
 */

import crypto from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services;

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;         // 128-bit IV for GCM
const AUTH_TAG_LENGTH = 16;   // 128-bit auth tag

/** Derive (or use directly) a 32-byte encryption key from the env var. */
function deriveKey(): Buffer {
  const raw = process.env.WORKFLOW_SECRET_KEY;
  if (!raw) {
    throw new Error(
      'WORKFLOW_SECRET_KEY environment variable is not set. ' +
      'Cannot encrypt/decrypt workflow secrets.'
    );
  }

  // If it is already exactly 32 bytes, use it directly.
  const buf = Buffer.from(raw, 'utf-8');
  if (buf.length === 32) {
    return buf;
  }

  // Otherwise derive a 32-byte key via scrypt with a fixed salt so the
  // same env-var always produces the same key.
  const salt = 'openagentic-workflow-secrets-v1';
  return crypto.scryptSync(raw, salt, 32);
}

/** Encrypt a plaintext string.  Returns { ciphertext, iv, authTag } as hex. */
function encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/** Decrypt a ciphertext (hex) given iv and authTag (hex). */
function decrypt(ciphertext: string, ivHex: string, authTagHex: string): string {
  const key = deriveKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

// ---------------------------------------------------------------------------
// Internal helpers for packed encrypted_value format
// ---------------------------------------------------------------------------

/**
 * The Prisma model stores a single `encrypted_value` column (nullable).
 * We pack iv, authTag, and ciphertext into one string separated by `:`.
 *     iv_hex:authTag_hex:ciphertext_hex
 */
function packEncrypted(enc: { ciphertext: string; iv: string; authTag: string }): string {
  return `${enc.iv}:${enc.authTag}:${enc.ciphertext}`;
}

function unpackEncrypted(packed: string): { ciphertext: string; iv: string; authTag: string } {
  const parts = packed.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted_value format: expected iv:authTag:ciphertext');
  }
  return { iv: parts[0], authTag: parts[1], ciphertext: parts[2] };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateSecretInput {
  name: string;
  description?: string;
  value: string;               // plaintext - will be encrypted
  scope: 'global' | 'group' | 'workflow';
  workflowId?: string;
  groupId?: string;
  allowedNodeTypes?: string[];
  allowedUsers?: string[];
  allowedGroups?: string[];
  esoEnabled?: boolean;
  esoSecretStore?: string;
  esoSecretStoreKind?: string;
  esoRemoteRef?: Record<string, any>;
  k8sSecretName?: string;
  k8sSecretNamespace?: string;
  k8sSecretKey?: string;
  rotationSchedule?: string;
  expiresAt?: Date;
  createdBy?: string;
}

export interface UpdateSecretInput {
  name?: string;
  description?: string;
  value?: string;              // new plaintext - will be re-encrypted
  scope?: 'global' | 'group' | 'workflow';
  workflowId?: string;
  groupId?: string;
  allowedNodeTypes?: string[];
  allowedUsers?: string[];
  allowedGroups?: string[];
  esoEnabled?: boolean;
  esoSecretStore?: string;
  esoSecretStoreKind?: string;
  esoRemoteRef?: Record<string, any>;
  k8sSecretName?: string;
  k8sSecretNamespace?: string;
  k8sSecretKey?: string;
  rotationSchedule?: string;
  expiresAt?: Date;
}

export interface SecretListFilter {
  scope?: string;
  workflowId?: string;
  groupId?: string;
  search?: string;
}

export interface ResolveContext {
  workflowId?: string;
  groupId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WorkflowSecretService {

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /** List secrets (metadata only -- never returns the encrypted value). */
  async list(filter: SecretListFilter = {}): Promise<any[]> {
    const where: Record<string, any> = {};
    if (filter.scope) where.scope = filter.scope;
    if (filter.workflowId) where.workflow_id = filter.workflowId;
    if (filter.groupId) where.group_id = filter.groupId;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const secrets = await prisma.workflowSecret.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        creator: { select: { email: true, name: true } },
        workflow: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });

    return secrets.map((s) => this.sanitize(s));
  }

  /** Get a single secret by id (metadata only). */
  async getById(id: string): Promise<any | null> {
    const secret = await prisma.workflowSecret.findUnique({
      where: { id },
      include: {
        creator: { select: { email: true, name: true } },
        workflow: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });
    if (!secret) return null;
    return this.sanitize(secret);
  }

  /** Create a new secret; encrypts the provided value. */
  async create(input: CreateSecretInput): Promise<any> {
    // Encrypt the plaintext value
    const enc = encrypt(input.value);
    const packed = packEncrypted(enc);

    const secret = await prisma.workflowSecret.create({
      data: {
        name: input.name,
        description: input.description || null,
        scope: input.scope,
        group_id: input.groupId || null,
        workflow_id: input.workflowId || null,
        encrypted_value: packed,
        encryption_key_id: 'env:WORKFLOW_SECRET_KEY',
        eso_enabled: input.esoEnabled ?? false,
        eso_secret_store: input.esoSecretStore ?? 'openagentic-secrets',
        eso_secret_store_kind: input.esoSecretStoreKind ?? 'ClusterSecretStore',
        eso_remote_ref: input.esoRemoteRef ?? {},
        k8s_secret_name: input.k8sSecretName || null,
        k8s_secret_namespace: input.k8sSecretNamespace ?? 'openagentic',
        k8s_secret_key: input.k8sSecretKey ?? 'value',
        allowed_node_types: input.allowedNodeTypes ?? [],
        allowed_users: input.allowedUsers ?? [],
        allowed_groups: input.allowedGroups ?? [],
        rotation_schedule: input.rotationSchedule || null,
        expires_at: input.expiresAt || null,
        created_by: input.createdBy || null,
      },
      include: {
        creator: { select: { email: true, name: true } },
        workflow: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });

    logger.info({ secretId: secret.id, name: secret.name, scope: secret.scope }, '[WorkflowSecrets] Secret created');
    return this.sanitize(secret);
  }

  /** Update a secret; optionally re-encrypts if a new value is provided. */
  async update(id: string, input: UpdateSecretInput, updatedBy?: string): Promise<any | null> {
    const existing = await prisma.workflowSecret.findUnique({ where: { id } });
    if (!existing) return null;

    const data: Record<string, any> = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.scope !== undefined) data.scope = input.scope;
    if (input.workflowId !== undefined) data.workflow_id = input.workflowId || null;
    if (input.groupId !== undefined) data.group_id = input.groupId || null;
    if (input.allowedNodeTypes !== undefined) data.allowed_node_types = input.allowedNodeTypes;
    if (input.allowedUsers !== undefined) data.allowed_users = input.allowedUsers;
    if (input.allowedGroups !== undefined) data.allowed_groups = input.allowedGroups;
    if (input.esoEnabled !== undefined) data.eso_enabled = input.esoEnabled;
    if (input.esoSecretStore !== undefined) data.eso_secret_store = input.esoSecretStore;
    if (input.esoSecretStoreKind !== undefined) data.eso_secret_store_kind = input.esoSecretStoreKind;
    if (input.esoRemoteRef !== undefined) data.eso_remote_ref = input.esoRemoteRef;
    if (input.k8sSecretName !== undefined) data.k8s_secret_name = input.k8sSecretName || null;
    if (input.k8sSecretNamespace !== undefined) data.k8s_secret_namespace = input.k8sSecretNamespace;
    if (input.k8sSecretKey !== undefined) data.k8s_secret_key = input.k8sSecretKey;
    if (input.rotationSchedule !== undefined) data.rotation_schedule = input.rotationSchedule || null;
    if (input.expiresAt !== undefined) data.expires_at = input.expiresAt || null;

    // Re-encrypt if a new value was supplied.
    if (input.value !== undefined) {
      const enc = encrypt(input.value);
      data.encrypted_value = packEncrypted(enc);
      data.encryption_key_id = 'env:WORKFLOW_SECRET_KEY';
      data.last_rotated_at = new Date();
      data.version = (existing.version ?? 1) + 1;
    }

    const updated = await prisma.workflowSecret.update({
      where: { id },
      data,
      include: {
        creator: { select: { email: true, name: true } },
        workflow: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });

    logger.info({ secretId: id, name: updated.name }, '[WorkflowSecrets] Secret updated');
    return this.sanitize(updated);
  }

  /** Delete a secret by id. */
  async delete(id: string): Promise<boolean> {
    const existing = await prisma.workflowSecret.findUnique({ where: { id } });
    if (!existing) return false;

    await prisma.workflowSecret.delete({ where: { id } });
    logger.info({ secretId: id, name: existing.name }, '[WorkflowSecrets] Secret deleted');
    return true;
  }

  // -----------------------------------------------------------------------
  // Resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a secret by name using the scoping hierarchy:
   *   workflow > group > global
   *
   * Returns the decrypted value or null if not found / not decryptable.
   */
  async resolveSecretValue(name: string, context: ResolveContext = {}): Promise<string | null> {
    // 1. Workflow-scoped
    if (context.workflowId) {
      const secret = await prisma.workflowSecret.findFirst({
        where: { name, scope: 'workflow', workflow_id: context.workflowId },
      });
      if (secret) return this.decryptSecret(secret);
    }

    // 2. Group-scoped
    if (context.groupId) {
      const secret = await prisma.workflowSecret.findFirst({
        where: { name, scope: 'group', group_id: context.groupId },
      });
      if (secret) return this.decryptSecret(secret);
    }

    // 3. Global
    const globalSecret = await prisma.workflowSecret.findFirst({
      where: { name, scope: 'global' },
    });
    if (globalSecret) return this.decryptSecret(globalSecret);

    return null;
  }

  // -----------------------------------------------------------------------
  // Test
  // -----------------------------------------------------------------------

  /**
   * Test that a secret resolves to a non-empty value.
   * Returns { success, message, scope? } without exposing the actual value.
   */
  async testSecret(
    id: string,
    context: ResolveContext = {}
  ): Promise<{ success: boolean; message: string; scope?: string }> {
    const secret = await prisma.workflowSecret.findUnique({ where: { id } });
    if (!secret) {
      return { success: false, message: 'Secret not found' };
    }

    // Record the access attempt
    await prisma.workflowSecret.update({
      where: { id },
      data: {
        access_count: (secret.access_count ?? 0) + 1,
        last_accessed_at: new Date(),
      },
    });

    // If ESO-managed and no fallback encrypted_value, we cannot test locally
    if (secret.eso_enabled && !secret.encrypted_value) {
      return {
        success: true,
        message: 'Secret is ESO-managed. Local decryption test skipped; K8s secret sync must be verified in-cluster.',
        scope: secret.scope,
      };
    }

    // Try to resolve via the normal hierarchy using the secret's name
    try {
      const value = await this.resolveSecretValue(secret.name, {
        workflowId: context.workflowId || secret.workflow_id || undefined,
        groupId: context.groupId || secret.group_id || undefined,
      });

      if (value && value.length > 0) {
        return {
          success: true,
          message: `Secret resolves successfully (${value.length} characters)`,
          scope: secret.scope,
        };
      }

      return {
        success: false,
        message: 'Secret resolved but value is empty',
        scope: secret.scope,
      };
    } catch (err: any) {
      logger.warn({ secretId: id, error: err.message }, '[WorkflowSecrets] Test decryption failed');
      return {
        success: false,
        message: `Decryption failed: ${err.message}`,
        scope: secret.scope,
      };
    }
  }

  // -----------------------------------------------------------------------
  // ESO Stores
  // -----------------------------------------------------------------------

  /** List all configured ESO secret stores. */
  async listESOStores(): Promise<any[]> {
    const stores = await prisma.eSOSecretStore.findMany({
      orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
    });
    return stores.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      provider: s.provider,
      providerConfig: s.provider_config,
      healthStatus: s.health_status,
      healthMessage: s.health_message,
      lastHealthCheck: s.last_health_check?.toISOString() || null,
      secretsCount: s.secrets_count,
      lastSyncAt: s.last_sync_at?.toISOString() || null,
      isDefault: s.is_default,
      isActive: s.is_active,
      createdAt: s.created_at.toISOString(),
      updatedAt: s.updated_at.toISOString(),
    }));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Attempt to decrypt a secret record. Returns null on failure. */
  private async decryptSecret(secret: any): Promise<string | null> {
    if (!secret.encrypted_value) return null;

    try {
      const { ciphertext, iv, authTag } = unpackEncrypted(secret.encrypted_value);
      const value = decrypt(ciphertext, iv, authTag);

      // Bump access metrics (fire-and-forget)
      prisma.workflowSecret.update({
        where: { id: secret.id },
        data: {
          access_count: (secret.access_count ?? 0) + 1,
          last_accessed_at: new Date(),
        },
      }).catch((err) => {
        logger.warn({ secretId: secret.id, error: err.message }, '[WorkflowSecrets] Failed to update access metrics');
      });

      return value;
    } catch (err: any) {
      logger.error({ secretId: secret.id, error: err.message }, '[WorkflowSecrets] Decryption failed');
      return null;
    }
  }

  /**
   * Strip sensitive fields from a secret record before returning to the
   * caller.  The encrypted_value, encryption_key_id, and raw ESO remote
   * ref credentials are never exposed via the API.
   */
  private sanitize(secret: any): any {
    return {
      id: secret.id,
      name: secret.name,
      description: secret.description,
      scope: secret.scope,
      groupId: secret.group_id,
      workflowId: secret.workflow_id,
      hasValue: !!secret.encrypted_value,
      esoEnabled: secret.eso_enabled,
      esoSecretStore: secret.eso_secret_store,
      esoSecretStoreKind: secret.eso_secret_store_kind,
      k8sSecretName: secret.k8s_secret_name,
      k8sSecretNamespace: secret.k8s_secret_namespace,
      k8sSecretKey: secret.k8s_secret_key,
      allowedNodeTypes: secret.allowed_node_types ?? [],
      allowedUsers: secret.allowed_users ?? [],
      allowedGroups: secret.allowed_groups ?? [],
      version: secret.version,
      lastRotatedAt: secret.last_rotated_at?.toISOString() || null,
      expiresAt: secret.expires_at?.toISOString() || null,
      rotationSchedule: secret.rotation_schedule,
      lastAccessedAt: secret.last_accessed_at?.toISOString() || null,
      accessCount: secret.access_count ?? 0,
      createdBy: secret.created_by,
      creatorEmail: secret.creator?.email || null,
      creatorName: secret.creator?.name || null,
      workflowName: secret.workflow?.name || null,
      groupName: secret.group?.name || null,
      createdAt: secret.created_at.toISOString(),
      updatedAt: secret.updated_at.toISOString(),
    };
  }
}

// Singleton export
export const workflowSecretService = new WorkflowSecretService();

export default WorkflowSecretService;
