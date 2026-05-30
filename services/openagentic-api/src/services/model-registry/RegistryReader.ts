/**
 * RegistryReader — single read source-of-truth for model availability.
 *
 * Spec: docs/superpowers/specs/2026-04-29-provider-model-registry-fedramp-overhaul.md (#508 §5.3)
 *
 * Replaces the disparate read paths in:
 *   - ModelConfigurationService.getDefaultChatModel
 *   - ModelConfigurationService.getDefaultCodeModel
 *   - /api/chat/models
 *   - /api/v1/models
 *   - Smart Router scoring
 *   - Codemode default lookup
 *   - Add-Model wizard picker
 *
 * Design rules:
 *   1. Single read path. All callers go through this class.
 *   2. NO fallback to llm_providers.model_config — that was the #504 anti-pattern.
 *      The Phase 1 cascade trigger guarantees the registry can never go empty
 *      while a provider exists. RegistryEmptyError is the actionable signal.
 *   3. Filter is hardcoded: state='active' AND enabled=true AND
 *      provider.deleted_at IS NULL AND provider.enabled=true.
 *   4. Order is hardcoded: priority asc.
 *   5. CI architectural test (added in a follow-up) rejects any source file
 *      outside services/model-registry/ that imports
 *      `prisma.modelRoleAssignment` directly.
 */

import type { Prisma } from '@prisma/client';

// Local type — matches the Prisma row shape this service exposes.
// Kept narrow on purpose: callers should only consume what's documented here.
export interface ModelRecord {
  id: string;
  model: string;
  provider: string;
  role: string;
  priority: number;
  enabled: boolean;
  state: string;
  capabilities: Record<string, any>;
  description?: string | null;
  max_tokens?: number | null;
  temperature?: number | null;
  options?: Record<string, any> | null;
}

export interface SearchFilter {
  role?: string;
  state?: string;
  provider?: string;
}

/** Thrown when no row matches an active+enabled+role query. */
export class RegistryEmptyError extends Error {
  constructor(role: string) {
    super(
      `No active enabled row in model_registry for role="${role}". ` +
      `Admin must add a model via Provider Management → Model Registry.`,
    );
    this.name = 'RegistryEmptyError';
  }
}

/** Thrown by RegistryReader.get when an id is unknown. */
export class RegistryRowNotFoundError extends Error {
  constructor(id: string) {
    super(`Registry row not found: ${id}`);
    this.name = 'RegistryRowNotFoundError';
  }
}

/**
 * Common WHERE clause for "currently usable" rows.
 * The provider join filters out soft-deleted and disabled providers — these
 * are the conditions that produced the zombie rows on chat-dev (live evidence
 * 2026-04-29).
 */
function activeUsableWhere(role: string): Prisma.ModelRoleAssignmentWhereInput {
  return {
    role,
    enabled: true,
    state: 'active',
    // Phase 1 schema introduces the FK + relation field; this clause requires
    // the join. RegistryReader is built against the Phase 1 schema by design.
    provider_ref: {
      deleted_at: null,
      enabled: true,
    },
  } as any;
}

export class RegistryReader {
  /**
   * Highest-priority active enabled row for the role. Throws RegistryEmptyError
   * if nothing matches. NEVER falls back to llm_providers.model_config.
   */
  async getDefaultModel(role: string): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const row = await prisma.modelRoleAssignment.findFirst({
      where: activeUsableWhere(role),
      orderBy: { priority: 'asc' },
    });
    if (!row) {
      throw new RegistryEmptyError(role);
    }
    return row as unknown as ModelRecord;
  }

  /**
   * All active enabled rows for the role, ordered by priority asc.
   * Empty array (no throw) is a valid result — callers decide whether
   * empty is an error in their context.
   */
  async listAvailable(role: string): Promise<ModelRecord[]> {
    const { prisma } = await import('../../utils/prisma.js');
    const rows = await prisma.modelRoleAssignment.findMany({
      where: activeUsableWhere(role),
      orderBy: { priority: 'asc' },
    });
    return rows as unknown as ModelRecord[];
  }

  /**
   * Lookup by id. Admin-facing — returns rows in any state including
   * deprecated and disposed. Throws RegistryRowNotFoundError when missing.
   */
  async get(id: string): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const row = await prisma.modelRoleAssignment.findUnique({ where: { id } });
    if (!row) {
      throw new RegistryRowNotFoundError(id);
    }
    return row as unknown as ModelRecord;
  }

  /**
   * Admin search. Returns rows in any state. Used by the admin Models page
   * with state filters (active / deprecated / disposed).
   */
  async search(filter: SearchFilter): Promise<ModelRecord[]> {
    const { prisma } = await import('../../utils/prisma.js');
    const where: Prisma.ModelRoleAssignmentWhereInput = {};
    if (filter.role) where.role = filter.role;
    if (filter.state) (where as any).state = filter.state;
    if (filter.provider) where.provider = filter.provider;
    const rows = await prisma.modelRoleAssignment.findMany({ where });
    return rows as unknown as ModelRecord[];
  }
}
