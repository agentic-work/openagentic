/**
 * RegistryWriter — single write source-of-truth for the model registry.
 *
 * Spec: docs/superpowers/specs/2026-04-29-provider-model-registry-fedramp-overhaul.md
 *   §5.2 lifecycle state machine
 *   §5.3 single writer contract
 *   §5.6 audit semantics (signature deferred to Phase 8)
 *
 * Replaces the six diffuse write paths (admin Models page, Add-Model wizard,
 * LLMProviderSeeder, fold-model-config-to-registry script, model_registry
 * migration backfill, provider catalog scrape) with ONE class. Every method
 * writes an audit-log row inside the same prisma.$transaction as the registry
 * mutation, so the audit trail can never drift from the row state.
 *
 * Design rules:
 *   1. Every method runs inside a single $transaction. Audit row + registry
 *      row commit atomically.
 *   2. State transitions are enforced. Illegal moves throw
 *      IllegalStateTransitionError before any write happens.
 *   3. propose+approve enforces separation of duty (FedRAMP AC-5).
 *   4. The audit-log table is APPEND-ONLY at the DB level (Phase 1 migration
 *      REVOKE-d UPDATE,DELETE). We only INSERT.
 *   5. signature column stays null — Phase 8 integrity hashing will populate.
 *   6. CI architectural test (Phase 3.5) will reject any source file outside
 *      services/model-registry/ that imports prisma.modelRoleAssignment.{create,
 *      update,delete} or prisma.modelRegistryAuditLog.* directly.
 *
 * Reject-state choice (documented):
 *   The Phase 1 enum has no `rejected` value but the spec §5.2 diagram says
 *   reject leads to "(deleted)". We resolve this by setting state to `disposed`
 *   on reject + populating rejected_by/rejected_at/rejection_reason. The audit
 *   log captures the REJECT action distinctly from a normal DISPOSE so admin
 *   UI can render the right label. The row stays in the table for audit
 *   retention and the nightly purge job can sweep it after the grace window.
 */

import {
  ModelRecord,
  RegistryRowNotFoundError,
} from './RegistryReader.js';

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when a method is called against a row in a state that disallows the
 *  requested transition. Detail message names the from/to states + action. */
export class IllegalStateTransitionError extends Error {
  constructor(action: string, from: string, allowedFrom: string[]) {
    super(
      `Illegal state transition: cannot ${action} a row in state="${from}". ` +
      `Allowed source states: [${allowedFrom.join(', ')}].`,
    );
    this.name = 'IllegalStateTransitionError';
  }
}

/** Thrown when the user proposing a row tries to also approve it.
 *  FedRAMP AC-5 separation of duty. */
export class SeparationOfDutyViolationError extends Error {
  constructor(userId: string) {
    super(
      `Separation-of-duty violation: user "${userId}" cannot approve a row ` +
      `they themselves proposed (FedRAMP AC-5).`,
    );
    this.name = 'SeparationOfDutyViolationError';
  }
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface ProposeInput {
  tenant_id: string;
  provider_id: string;
  model: string;
  role: string;
  requested_by: string;
  reason: string;
  // Optional capability/cost hints carried over from the Add-Model wizard.
  capabilities?: Record<string, any>;
  description?: string;
  priority?: number;
  cost_per_input_token_usd?: string;
  cost_per_output_token_usd?: string;
  pricing_source?: string;
}

export interface CostUpdate {
  cost_per_input_token_usd?: string;
  cost_per_output_token_usd?: string;
  cost_per_cache_read_usd?: string;
  cost_per_cache_write_usd?: string;
  cost_per_thinking_token_usd?: string;
  cost_per_embedding_token_usd?: string;
  pricing_source?: string;
}

export interface CatalogEntry {
  model: string;
  role: string;
  capabilities?: Record<string, any>;
  cost_per_input_token_usd?: string;
  cost_per_output_token_usd?: string;
  pricing_source?: string;
  description?: string;
}

export interface ReconcileResult {
  inserted: number;
  updated: number;
  deprecated: number;
}

// ─── State machine ──────────────────────────────────────────────────────────

const STATE_PROPOSED = 'proposed';
const STATE_APPROVED = 'approved';
const STATE_ACTIVE = 'active';
const STATE_DEPRECATED = 'deprecated';
const STATE_DISPOSED = 'disposed';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Snapshot of a row used in before_state/after_state audit fields. We pass
 *  the whole row JSON (Prisma serializes Date/Decimal naturally). */
function snapshot(row: any): Record<string, any> {
  if (!row) return null as any;
  // JSON.parse(JSON.stringify(...)) coerces Date → string, Decimal → string,
  // dropping any class identity for a pure-JSON snapshot. Keeps audit reads
  // deterministic across DB driver versions.
  return JSON.parse(JSON.stringify(row));
}

/** Compute a shallow {field: {from, to}} delta between two row snapshots. */
function diff(before: any, after: any): Record<string, any> {
  if (!before) return { _kind: 'create', after: snapshot(after) };
  if (!after) return { _kind: 'delete', before: snapshot(before) };
  const out: Record<string, any> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out[k] = { from: b ?? null, to: a ?? null };
    }
  }
  return out;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Class ──────────────────────────────────────────────────────────────────

export class RegistryWriter {
  // ─────────────────────────────────────────────────────────────────────────
  // propose — admin (or seeder) proposes a model. Row inserted in PROPOSED
  // state with enabled=false. Caller then needs a different user to approve.
  // ─────────────────────────────────────────────────────────────────────────
  async propose(input: ProposeInput): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');

    // Pre-check provider liveness OUTSIDE the tx so we fail fast without
    // burning a tx slot on a missing provider.
    const provider = await prisma.lLMProvider.findUnique({
      where: { id: input.provider_id },
    });
    if (!provider) {
      throw new Error(`provider not found: ${input.provider_id}`);
    }
    if (provider.deleted_at) {
      throw new Error(
        `provider is soft-deleted: ${input.provider_id} (deleted_at=${provider.deleted_at}). Cannot propose new rows against a retired provider.`,
      );
    }

    return prisma.$transaction(async (tx: any) => {
      // Belt-and-braces: the unique constraint catches duplicates, but we
      // surface a friendlier error if a row already exists for this triple.
      const existing = await tx.modelRoleAssignment.findFirst({
        where: {
          provider_id: input.provider_id,
          model: input.model,
          role: input.role,
        },
      });
      if (existing) {
        throw new Error(
          `Duplicate registry row: (provider_id=${input.provider_id}, model=${input.model}, role=${input.role}) already exists in state="${(existing as any).state}".`,
        );
      }

      const row = await tx.modelRoleAssignment.create({
        data: {
          role: input.role,
          model: input.model,
          provider: provider.name,
          provider_id: input.provider_id,
          state: STATE_PROPOSED,
          enabled: false,
          priority: input.priority ?? 100,
          capabilities: input.capabilities ?? {},
          description: input.description,
          proposed_by: input.requested_by,
          proposed_at: new Date(),
          approval_reason: input.reason, // carry-over rationale
          current_revision: 1,
          created_by: input.requested_by,
          cost_per_input_token_usd: input.cost_per_input_token_usd,
          cost_per_output_token_usd: input.cost_per_output_token_usd,
          pricing_source: input.pricing_source,
        } as any,
      });

      await tx.modelRegistryAuditLog.create({
        data: {
          registry_id: (row as any).id,
          tenant_id: input.tenant_id,
          user_id: input.requested_by,
          action: 'PROPOSE' as any,
          before_state: null,
          after_state: snapshot(row),
          diff: diff(null, row),
          reason: input.reason,
          signature: null, // Phase 8
        } as any,
      });

      return row as unknown as ModelRecord;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // approve — PROPOSED → APPROVED. Separation of duty enforced.
  // ─────────────────────────────────────────────────────────────────────────
  async approve(id: string, approved_by: string, reason: string): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const before = await prisma.modelRoleAssignment.findUnique({ where: { id } });
    if (!before) throw new RegistryRowNotFoundError(id);
    if ((before as any).state !== STATE_PROPOSED) {
      throw new IllegalStateTransitionError('approve', (before as any).state, [STATE_PROPOSED]);
    }
    if ((before as any).proposed_by && (before as any).proposed_by === approved_by) {
      throw new SeparationOfDutyViolationError(approved_by);
    }

    return prisma.$transaction(async (tx: any) => {
      const after = await tx.modelRoleAssignment.update({
        where: { id },
        data: {
          state: STATE_APPROVED,
          approved_by,
          approved_at: new Date(),
          approval_reason: reason,
        } as any,
      });

      await tx.modelRegistryAuditLog.create({
        data: {
          registry_id: id,
          tenant_id: null,
          user_id: approved_by,
          action: 'APPROVE' as any,
          before_state: snapshot(before),
          after_state: snapshot(after),
          diff: diff(before, after),
          reason,
          signature: null,
        } as any,
      });

      return after as unknown as ModelRecord;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // reject — PROPOSED → DISPOSED (audit chain captures REJECT distinctly).
  // ─────────────────────────────────────────────────────────────────────────
  async reject(id: string, rejected_by: string, reason: string): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const before = await prisma.modelRoleAssignment.findUnique({ where: { id } });
    if (!before) throw new RegistryRowNotFoundError(id);
    if ((before as any).state !== STATE_PROPOSED) {
      throw new IllegalStateTransitionError('reject', (before as any).state, [STATE_PROPOSED]);
    }

    return prisma.$transaction(async (tx: any) => {
      const after = await tx.modelRoleAssignment.update({
        where: { id },
        data: {
          state: STATE_DISPOSED,
          rejected_by,
          rejected_at: new Date(),
          rejection_reason: reason,
          disposed_at: new Date(),
          enabled: false,
        } as any,
      });

      await tx.modelRegistryAuditLog.create({
        data: {
          registry_id: id,
          tenant_id: null,
          user_id: rejected_by,
          action: 'REJECT' as any,
          before_state: snapshot(before),
          after_state: snapshot(after),
          diff: diff(before, after),
          reason,
          signature: null,
        } as any,
      });

      return after as unknown as ModelRecord;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // enable — sets enabled=true on (approved | active) row. Logs ENABLE.
  // ─────────────────────────────────────────────────────────────────────────
  async enable(id: string, by: string, reason?: string): Promise<ModelRecord> {
    return this.toggleEnabled(id, true, by, reason);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // disable — sets enabled=false on (approved | active) row. Logs DISABLE.
  // ─────────────────────────────────────────────────────────────────────────
  async disable(id: string, by: string, reason: string): Promise<ModelRecord> {
    return this.toggleEnabled(id, false, by, reason);
  }

  private async toggleEnabled(
    id: string,
    enabled: boolean,
    by: string,
    reason?: string,
  ): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const before = await prisma.modelRoleAssignment.findUnique({ where: { id } });
    if (!before) throw new RegistryRowNotFoundError(id);
    const allowed = [STATE_APPROVED, STATE_ACTIVE];
    if (!allowed.includes((before as any).state)) {
      throw new IllegalStateTransitionError(
        enabled ? 'enable' : 'disable',
        (before as any).state,
        allowed,
      );
    }

    return prisma.$transaction(async (tx: any) => {
      const after = await tx.modelRoleAssignment.update({
        where: { id },
        data: { enabled } as any,
      });

      await tx.modelRegistryAuditLog.create({
        data: {
          registry_id: id,
          tenant_id: null,
          user_id: by,
          action: (enabled ? 'ENABLE' : 'DISABLE') as any,
          before_state: snapshot(before),
          after_state: snapshot(after),
          diff: diff(before, after),
          reason: reason ?? null,
          signature: null,
        } as any,
      });

      return after as unknown as ModelRecord;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // deprecate — ACTIVE → DEPRECATED. Sets retention_until = +90d (FedRAMP AU-11).
  // ─────────────────────────────────────────────────────────────────────────
  async deprecate(id: string, by: string, reason: string): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const before = await prisma.modelRoleAssignment.findUnique({ where: { id } });
    if (!before) throw new RegistryRowNotFoundError(id);
    if ((before as any).state !== STATE_ACTIVE) {
      throw new IllegalStateTransitionError('deprecate', (before as any).state, [STATE_ACTIVE]);
    }

    const now = new Date();
    const retention = new Date(now.getTime() + NINETY_DAYS_MS);

    return prisma.$transaction(async (tx: any) => {
      const after = await tx.modelRoleAssignment.update({
        where: { id },
        data: {
          state: STATE_DEPRECATED,
          deprecated_at: now,
          deprecation_reason: reason,
          retention_until: retention,
          enabled: false, // a deprecated model never serves traffic
        } as any,
      });

      await tx.modelRegistryAuditLog.create({
        data: {
          registry_id: id,
          tenant_id: null,
          user_id: by,
          action: 'DEPRECATE' as any,
          before_state: snapshot(before),
          after_state: snapshot(after),
          diff: diff(before, after),
          reason,
          signature: null,
        } as any,
      });

      return after as unknown as ModelRecord;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // dispose — admin override of retention. any → DISPOSED (except already-disposed).
  // ─────────────────────────────────────────────────────────────────────────
  async dispose(id: string, by: string, reason: string): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const before = await prisma.modelRoleAssignment.findUnique({ where: { id } });
    if (!before) throw new RegistryRowNotFoundError(id);
    if ((before as any).state === STATE_DISPOSED) {
      throw new IllegalStateTransitionError(
        'dispose',
        (before as any).state,
        [STATE_PROPOSED, STATE_APPROVED, STATE_ACTIVE, STATE_DEPRECATED],
      );
    }

    return prisma.$transaction(async (tx: any) => {
      const after = await tx.modelRoleAssignment.update({
        where: { id },
        data: {
          state: STATE_DISPOSED,
          disposed_at: new Date(),
          enabled: false,
        } as any,
      });

      await tx.modelRegistryAuditLog.create({
        data: {
          registry_id: id,
          tenant_id: null,
          user_id: by,
          action: 'DISPOSE' as any,
          before_state: snapshot(before),
          after_state: snapshot(after),
          diff: diff(before, after),
          reason,
          signature: null,
        } as any,
      });

      return after as unknown as ModelRecord;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // updateCapabilities — bumps current_revision, logs UPDATE_CAPABILITIES.
  // ─────────────────────────────────────────────────────────────────────────
  async updateCapabilities(
    id: string,
    newCaps: Record<string, any>,
    by: string,
    reason: string,
  ): Promise<ModelRecord> {
    return this.metadataUpdate(id, by, reason, 'UPDATE_CAPABILITIES', {
      capabilities: newCaps,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // updateCost — bumps revision, sets pricing_fetched_at, logs UPDATE_COST.
  // ─────────────────────────────────────────────────────────────────────────
  async updateCost(
    id: string,
    cost: CostUpdate,
    by: string,
    reason: string,
  ): Promise<ModelRecord> {
    return this.metadataUpdate(id, by, reason, 'UPDATE_COST', {
      ...cost,
      pricing_fetched_at: new Date(),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // updatePriority — single-field update. Logs UPDATE_PRIORITY.
  // ─────────────────────────────────────────────────────────────────────────
  async updatePriority(
    id: string,
    newPriority: number,
    by: string,
    reason: string,
  ): Promise<ModelRecord> {
    return this.metadataUpdate(id, by, reason, 'UPDATE_PRIORITY', {
      priority: newPriority,
    });
  }

  /** Shared body for the three metadata updaters. Allowed when state in
   *  (approved, active). Bumps current_revision atomically. */
  private async metadataUpdate(
    id: string,
    by: string,
    reason: string,
    action: 'UPDATE_CAPABILITIES' | 'UPDATE_COST' | 'UPDATE_PRIORITY',
    fields: Record<string, any>,
  ): Promise<ModelRecord> {
    const { prisma } = await import('../../utils/prisma.js');
    const before = await prisma.modelRoleAssignment.findUnique({ where: { id } });
    if (!before) throw new RegistryRowNotFoundError(id);
    const allowed = [STATE_APPROVED, STATE_ACTIVE];
    if (!allowed.includes((before as any).state)) {
      throw new IllegalStateTransitionError(action, (before as any).state, allowed);
    }

    return prisma.$transaction(async (tx: any) => {
      const after = await tx.modelRoleAssignment.update({
        where: { id },
        data: {
          ...fields,
          current_revision: { increment: 1 },
        } as any,
      });

      await tx.modelRegistryAuditLog.create({
        data: {
          registry_id: id,
          tenant_id: null,
          user_id: by,
          action: action as any,
          before_state: snapshot(before),
          after_state: snapshot(after),
          diff: diff(before, after),
          reason,
          signature: null,
        } as any,
      });

      return after as unknown as ModelRecord;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // reconcileFromProvider — discovery-driven sync. For each model in the
  // catalog: insert if missing, update if differs. For each row in registry
  // not in catalog: deprecate. Each delta writes a RECONCILE audit row.
  // ─────────────────────────────────────────────────────────────────────────
  async reconcileFromProvider(
    provider_id: string,
    catalog: CatalogEntry[],
    by: string,
  ): Promise<ReconcileResult> {
    const { prisma } = await import('../../utils/prisma.js');
    const provider = await prisma.lLMProvider.findUnique({ where: { id: provider_id } });
    if (!provider) {
      throw new Error(`provider not found: ${provider_id}`);
    }
    if (provider.deleted_at) {
      throw new Error(
        `provider is soft-deleted: ${provider_id}. Reconcile is not allowed against retired providers.`,
      );
    }

    const counters: ReconcileResult = { inserted: 0, updated: 0, deprecated: 0 };

    return prisma.$transaction(async (tx: any) => {
      // Existing rows for this provider in non-disposed states.
      const existing: any[] = await tx.modelRoleAssignment.findMany({
        where: {
          provider_id,
          state: { in: [STATE_PROPOSED, STATE_APPROVED, STATE_ACTIVE, STATE_DEPRECATED] } as any,
        },
      });

      // Index existing by (model, role) for O(1) lookup.
      const key = (model: string, role: string) => `${model} ${role}`;
      const existingByKey = new Map<string, any>();
      for (const row of existing) {
        existingByKey.set(key(row.model, row.role), row);
      }

      // Pass 1: catalog entries.
      const seen = new Set<string>();
      for (const entry of catalog) {
        seen.add(key(entry.model, entry.role));
        const match = existingByKey.get(key(entry.model, entry.role));

        if (!match) {
          // Insert as active (discovery-driven; the provider says it exists).
          const created = await tx.modelRoleAssignment.create({
            data: {
              role: entry.role,
              model: entry.model,
              provider: provider.name,
              provider_id,
              state: STATE_ACTIVE,
              enabled: true,
              priority: 100,
              capabilities: entry.capabilities ?? {},
              description: entry.description,
              proposed_by: by,
              proposed_at: new Date(),
              approved_by: by,
              approved_at: new Date(),
              approval_reason: 'Auto-approved via reconcileFromProvider (discovery)',
              current_revision: 1,
              created_by: by,
              cost_per_input_token_usd: entry.cost_per_input_token_usd,
              cost_per_output_token_usd: entry.cost_per_output_token_usd,
              pricing_source: entry.pricing_source,
            } as any,
          });

          await tx.modelRegistryAuditLog.create({
            data: {
              registry_id: created.id,
              tenant_id: null,
              user_id: by,
              action: 'RECONCILE' as any,
              before_state: null,
              after_state: snapshot(created),
              diff: diff(null, created),
              reason: 'Insert: model present in provider catalog, missing from registry',
              signature: null,
            } as any,
          });
          counters.inserted++;
        } else {
          // Compare capabilities + cost; update if drift detected.
          const drift =
            JSON.stringify(match.capabilities ?? {}) !==
              JSON.stringify(entry.capabilities ?? {}) ||
            (entry.cost_per_input_token_usd != null &&
              String(match.cost_per_input_token_usd ?? '') !==
                String(entry.cost_per_input_token_usd)) ||
            (entry.cost_per_output_token_usd != null &&
              String(match.cost_per_output_token_usd ?? '') !==
                String(entry.cost_per_output_token_usd));
          if (drift) {
            const after = await tx.modelRoleAssignment.update({
              where: { id: match.id },
              data: {
                capabilities: entry.capabilities ?? match.capabilities,
                cost_per_input_token_usd:
                  entry.cost_per_input_token_usd ?? match.cost_per_input_token_usd,
                cost_per_output_token_usd:
                  entry.cost_per_output_token_usd ?? match.cost_per_output_token_usd,
                pricing_source: entry.pricing_source ?? match.pricing_source,
                pricing_fetched_at: new Date(),
                current_revision: { increment: 1 },
              } as any,
            });

            await tx.modelRegistryAuditLog.create({
              data: {
                registry_id: match.id,
                tenant_id: null,
                user_id: by,
                action: 'RECONCILE' as any,
                before_state: snapshot(match),
                after_state: snapshot(after),
                diff: diff(match, after),
                reason: 'Update: provider catalog drift detected',
                signature: null,
              } as any,
            });
            counters.updated++;
          }
        }
      }

      // Pass 2: rows in registry but not in catalog → deprecate.
      const now = new Date();
      const retention = new Date(now.getTime() + NINETY_DAYS_MS);
      for (const row of existing) {
        if (seen.has(key(row.model, row.role))) continue;
        if (row.state === STATE_DEPRECATED) continue; // already deprecated, skip
        const after = await tx.modelRoleAssignment.update({
          where: { id: row.id },
          data: {
            state: STATE_DEPRECATED,
            deprecated_at: now,
            retention_until: retention,
            deprecation_reason: 'Reconcile: model removed from provider catalog',
            enabled: false,
          } as any,
        });

        await tx.modelRegistryAuditLog.create({
          data: {
            registry_id: row.id,
            tenant_id: null,
            user_id: by,
            action: 'RECONCILE' as any,
            before_state: snapshot(row),
            after_state: snapshot(after),
            diff: diff(row, after),
            reason: 'Deprecate: model removed from provider catalog',
            signature: null,
          } as any,
        });
        counters.deprecated++;
      }

      return counters;
    });
  }
}
