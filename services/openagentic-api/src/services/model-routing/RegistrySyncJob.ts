/**
 * RegistrySyncJob — continuous mirror of curated-upstream providers
 * (Ollama hosts, Azure AI Foundry deployments) into the Model Registry.
 *
 * Task #311 (2026-04-22). Companion to RegistryUpsertService, which handles
 * the one-shot upsert on provider-create. This job picks up changes that
 * happen AFTER provider creation:
 *
 *   - Operator runs `ollama pull new-model` on the host → next sync adds it.
 *   - Azure admin creates a new AIF deployment → next sync adds it.
 *   - Operator runs `ollama rm old-model` / deletes AIF deployment →
 *     next sync marks it `enabled=false, options.sync_removed=true`
 *     (audit trail; never hard-deleted).
 *   - Admin disables a row via the Models UI → sync NEVER re-enables it,
 *     regardless of whether discovery still reports that model. The admin
 *     override (options.admin_override=true OR options.auto=false) is a
 *     one-way latch that only the admin can reset.
 *
 * Only runs for provider types that belong to the "auto-sync allowlist"
 * (see registryAutoSyncPolicy.ts). Bedrock / Vertex / OpenAI / Anthropic /
 * Azure OpenAI are curated via the explicit "Add Model" UI and must never
 * flow through this job.
 *
 * Wired into server.ts boot after ProviderManager is initialized:
 *   const syncJob = new RegistrySyncJob({ prisma, providerManager, logger });
 *   syncJob.start();  // runs every 30 s
 */

import type { Logger } from 'pino';
import type { DiscoveredModel } from '../llm-providers/ILLMProvider.js';
import { AUTO_SYNC_PROVIDER_TYPES } from './registryAutoSyncPolicy.js';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_PRIORITY = 100;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * System user used as `created_by` when the sync job inserts rows.
 * Matches services/InitializationService.ts SYSTEM_USER_ID — the user is
 * seeded at boot and exists in every environment. Falls back to a fresh
 * `prisma.user.findFirst` lookup in tests / unseeded envs.
 */
const SYSTEM_USER_ID = 'system-00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Narrow shape of a row that the sync diff cares about. Matches the relevant
 * columns on admin.model_role_assignments.
 */
export interface RegistryRowForSync {
  id: string;
  role: string;
  model: string;
  provider: string;
  priority: number;
  enabled: boolean;
  temperature: number | null;
  max_tokens: number | null;
  capabilities: Record<string, any> | null;
  options: Record<string, any> | null;
  description: string | null;
  created_by: string;
}

/**
 * Prisma surface the job consumes. Narrow by design to make unit tests
 * tolerable; pass a real PrismaClient cast to this type in production.
 */
export interface RegistrySyncPrismaLike {
  lLMProvider: {
    findMany(args: { where: { enabled: boolean; deleted_at: null } }): Promise<Array<{
      name: string;
      provider_type: string;
      enabled: boolean;
      deleted_at: Date | null;
    }>>;
  };
  modelRoleAssignment: {
    findMany(args: { where: { provider: string } }): Promise<RegistryRowForSync[]>;
    create(args: { data: any }): Promise<any>;
    update(args: { where: { id: string }; data: any }): Promise<any>;
  };
}

/**
 * Narrow surface of ProviderManager used by the job. The real
 * ProviderManager's `getProvider(name)` returns a live initialized
 * provider instance (or null) — we only need `discoverModels()` off of it.
 */
export interface RegistrySyncProvider {
  getProvider(name: string): { discoverModels(): Promise<DiscoveredModel[]> } | null | undefined;
}

export interface RegistrySyncOptions {
  prisma: RegistrySyncPrismaLike;
  providerManager: RegistrySyncProvider;
  logger: Logger;
  /** Defaults to 30_000 ms. Set lower (e.g. 1_000) in tests. */
  intervalMs?: number;
  /** `created_by` attributed to rows the job inserts. Defaults to 'sync-job'. */
  createdBy?: string;
}

export interface SyncPlan {
  /** Brand-new rows to INSERT into Registry. */
  inserts: Array<Omit<RegistryRowForSync, 'id'>>;
  /**
   * Rows that already exist but are no longer discovered — flip
   * `enabled=false` + stamp `options.sync_removed=true`.
   */
  softDeletes: Array<{ id: string; patch: { enabled: false; options: Record<string, any> } }>;
  /**
   * Rows that were previously soft-deleted by a sync (sync_removed=true)
   * but have reappeared in discovery — flip `enabled=true` + clear
   * `sync_removed`.
   */
  reenables: Array<{ id: string; patch: { enabled: true; options: Record<string, any> } }>;
  /**
   * Rows the job chose NOT to touch (either admin-owned or already in sync).
   * Useful for logging + test assertions; no DB mutation.
   */
  preserved: Array<{ id: string; reason: 'admin_override' | 'in_sync' }>;
}

export interface SyncPlanInput {
  providerName: string;
  discovered: DiscoveredModel[];
  existing: RegistryRowForSync[];
  createdBy: string;
  now?: () => Date;
}

export interface SyncResult {
  perProvider: Record<string, {
    inserted: number;
    softDeleted: number;
    reenabled: number;
    preserved: number;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Pure diff planner (unit-tested without DB)
// ---------------------------------------------------------------------------

/**
 * Returns `true` if a row is admin-owned — meaning the sync job must NEVER
 * modify it regardless of discovery state. Both conventions supported:
 *   - `options.admin_override === true` (explicit, set by Add-Model UI)
 *   - `options.auto === false` (legacy, set when admin edits via PATCH)
 */
function isAdminOwned(options: Record<string, any> | null | undefined): boolean {
  if (!options || typeof options !== 'object') return false;
  if (options.admin_override === true) return true;
  if (options.auto === false) return true;
  return false;
}

/**
 * Pick the role for a discovered model. Mirrors RegistryUpsertService.
 */
function pickRole(capabilities?: DiscoveredModel['capabilities']): string {
  return capabilities?.embeddings ? 'embeddings' : 'chat';
}

/**
 * Pure diff planner. Takes the discovered list + existing Registry rows
 * for a single provider and returns a plan the executor can apply.
 *
 * Exported for direct unit testing; also called from `RegistrySyncJob.syncAll`.
 */
export function planRegistrySync(input: SyncPlanInput): SyncPlan {
  const { providerName, discovered, existing, createdBy, now = () => new Date() } = input;

  const existingByModel = new Map<string, RegistryRowForSync>();
  for (const row of existing) {
    if (row.provider !== providerName) continue;
    existingByModel.set(row.model, row);
  }

  const discoveredIds = new Set<string>();
  const plan: SyncPlan = {
    inserts: [],
    softDeletes: [],
    reenables: [],
    preserved: [],
  };

  // Pass 1 — walk discovery set
  for (const d of discovered) {
    discoveredIds.add(d.id);
    const row = existingByModel.get(d.id);
    const role = pickRole(d.capabilities);
    const caps = d.capabilities ?? {};

    if (!row) {
      // Brand-new model on host / in AIF deployment list → INSERT enabled
      plan.inserts.push({
        role,
        model: d.id,
        provider: providerName,
        priority: DEFAULT_PRIORITY,
        enabled: true,
        temperature: DEFAULT_TEMPERATURE,
        max_tokens: d.maxOutputTokens ?? null,
        capabilities: caps as Record<string, any>,
        options: { auto: true, discoveredAt: now().toISOString() },
        description: d.name || d.id,
        created_by: createdBy,
      });
      continue;
    }

    // Row exists. Decide based on admin-ownership + current state.
    if (isAdminOwned(row.options)) {
      plan.preserved.push({ id: row.id, reason: 'admin_override' });
      continue;
    }

    // Previously soft-deleted by sync but now rediscovered → re-enable
    if (row.enabled === false && row.options?.sync_removed === true) {
      plan.reenables.push({
        id: row.id,
        patch: {
          enabled: true,
          options: { ...row.options, sync_removed: false, rediscoveredAt: now().toISOString() },
        },
      });
      continue;
    }

    plan.preserved.push({ id: row.id, reason: 'in_sync' });
  }

  // Pass 2 — walk existing rows looking for missing ones (soft-delete)
  for (const row of existing) {
    if (row.provider !== providerName) continue;
    if (discoveredIds.has(row.model)) continue;

    // Admin-owned → never soft-delete; audit trail lives in the admin's
    // own deliberate action. Flagging the row would be noise.
    if (isAdminOwned(row.options)) {
      // Already counted as preserved above if it was in discovery set;
      // here it is NOT in discovery, so we still preserve explicitly.
      if (!plan.preserved.find(p => p.id === row.id)) {
        plan.preserved.push({ id: row.id, reason: 'admin_override' });
      }
      continue;
    }

    // Already marked sync_removed? Don't re-mark on every cycle (idempotent).
    if (row.enabled === false && row.options?.sync_removed === true) {
      plan.preserved.push({ id: row.id, reason: 'in_sync' });
      continue;
    }

    plan.softDeletes.push({
      id: row.id,
      patch: {
        enabled: false,
        options: { ...(row.options ?? {}), sync_removed: true, removedAt: now().toISOString() },
      },
    });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Executor class
// ---------------------------------------------------------------------------

export class RegistrySyncJob {
  private readonly prisma: RegistrySyncPrismaLike;
  private readonly providerManager: RegistrySyncProvider;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly createdBy: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RegistrySyncOptions) {
    this.prisma = opts.prisma;
    this.providerManager = opts.providerManager;
    this.logger = opts.logger;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    // Default to the SYSTEM_USER_ID that InitializationService seeds at boot.
    // The model_role_assignments table FK-constrains created_by → users.id,
    // so a literal string like 'sync-job' fails with a FK violation — hence
    // we must attribute sync-job inserts to a real user row.
    this.createdBy = opts.createdBy ?? SYSTEM_USER_ID;
  }

  /**
   * Start the periodic sync loop. Safe to call when already started —
   * subsequent calls are no-ops.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.syncAll().catch(err => {
        this.logger.warn({ err: err?.message }, '[RegistrySync] loop iteration failed (non-fatal)');
      });
    }, this.intervalMs);
    // Do NOT unref — we want the loop to keep the process alive like any
    // other background worker. Server shutdown path calls stop() explicitly.
    this.logger.info({ intervalMs: this.intervalMs }, '[RegistrySync] scheduled');
  }

  /**
   * Stop the periodic sync loop. Safe to call when not started.
   */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.logger.info('[RegistrySync] stopped');
  }

  /**
   * Run one sync cycle across every enabled auto-sync-eligible provider.
   * Idempotent; multiple concurrent calls are safe in the sense that each
   * runs its own diff against a snapshot of the DB.
   */
  async syncAll(): Promise<SyncResult> {
    const result: SyncResult = { perProvider: {} };

    const eligible = await this.prisma.lLMProvider.findMany({
      where: { enabled: true, deleted_at: null },
    });

    const autoSyncProviders = eligible.filter(p =>
      AUTO_SYNC_PROVIDER_TYPES.includes(p.provider_type)
    );

    for (const p of autoSyncProviders) {
      result.perProvider[p.name] = await this.syncOne(p.name);
    }

    return result;
  }

  /**
   * Run one sync cycle for a single provider. Returns a per-provider result
   * including an `error` message when the sync failed (discovery threw,
   * provider not live, etc.) — error cases do NOT abort the broader loop.
   */
  async syncOne(providerName: string): Promise<SyncResult['perProvider'][string]> {
    const out = { inserted: 0, softDeleted: 0, reenabled: 0, preserved: 0 } as SyncResult['perProvider'][string];

    const live = this.providerManager.getProvider(providerName);
    if (!live || typeof (live as any).discoverModels !== 'function') {
      out.error = 'no live provider instance in ProviderManager (skipping)';
      this.logger.debug({ providerName }, '[RegistrySync] no live provider');
      return out;
    }

    let discovered: DiscoveredModel[] = [];
    try {
      discovered = await live.discoverModels();
    } catch (err: any) {
      out.error = err?.message || 'discoverModels threw';
      this.logger.warn({ providerName, err: out.error }, '[RegistrySync] discovery failed');
      return out;
    }

    let existing: RegistryRowForSync[] = [];
    try {
      existing = await this.prisma.modelRoleAssignment.findMany({ where: { provider: providerName } });
    } catch (err: any) {
      out.error = err?.message || 'findMany threw';
      return out;
    }

    const plan = planRegistrySync({
      providerName,
      discovered,
      existing,
      createdBy: this.createdBy,
    });

    for (const row of plan.inserts) {
      try {
        await this.prisma.modelRoleAssignment.create({ data: row });
        out.inserted++;
      } catch (err: any) {
        this.logger.warn({ providerName, model: row.model, err: err?.message }, '[RegistrySync] insert failed');
      }
    }
    for (const sd of plan.softDeletes) {
      try {
        await this.prisma.modelRoleAssignment.update({ where: { id: sd.id }, data: sd.patch });
        out.softDeleted++;
      } catch (err: any) {
        this.logger.warn({ providerName, rowId: sd.id, err: err?.message }, '[RegistrySync] soft-delete failed');
      }
    }
    for (const re of plan.reenables) {
      try {
        await this.prisma.modelRoleAssignment.update({ where: { id: re.id }, data: re.patch });
        out.reenabled++;
      } catch (err: any) {
        this.logger.warn({ providerName, rowId: re.id, err: err?.message }, '[RegistrySync] re-enable failed');
      }
    }
    out.preserved = plan.preserved.length;

    if (out.inserted + out.softDeleted + out.reenabled > 0) {
      this.logger.info({
        providerName,
        inserted: out.inserted,
        softDeleted: out.softDeleted,
        reenabled: out.reenabled,
        preserved: out.preserved,
      }, '[RegistrySync] cycle complete');
    }

    return out;
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor (Phase 4 — replaces (global as any).registrySyncJob)
// ---------------------------------------------------------------------------

let _registrySyncJobInstance: RegistrySyncJob | null = null;

export function setRegistrySyncJob(job: RegistrySyncJob): void {
  _registrySyncJobInstance = job;
}

export function getRegistrySyncJob(): RegistrySyncJob | null {
  return _registrySyncJobInstance;
}
