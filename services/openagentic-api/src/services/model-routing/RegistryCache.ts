/**
 * RegistryCache — TTL cache for resolveModel() outputs.
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (F1.7)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * Two indexes:
 *   - by role (for `resolveRoleDefault('chat')`-style lookups)
 *   - by registry row id (for `resolveModel({explicitRowId})` and FK-resolved hits)
 *
 * Invalidation has THREE triggers, in order of speed:
 *   1. **Postgres LISTEN/NOTIFY** on `model_registry_changed` — push, ~ms latency.
 *      Wired in F2 / F3 by attaching a pg client.LISTEN consumer that calls
 *      `cache.handleNotification(JSON.parse(notification.payload))`.
 *   2. **App-level invalidate hooks** — when an admin endpoint mutates a Registry
 *      row, the route handler calls `cache.invalidateById()` immediately so the
 *      same-pod next read sees the new state without waiting for NOTIFY.
 *   3. **TTL safety net (default 30s)** — if NOTIFY misses (network blip, multi-region),
 *      every entry expires within 30s. Prevents permanent staleness.
 *
 * The Notification trigger function lives in the F0.5 migration:
 *   `notify_model_registry_change()` on `admin.model_role_assignments` for
 *   INSERT/UPDATE/DELETE.
 *
 * Live integration test (real Postgres + NOTIFY end-to-end) lands at F2's
 * cold-install + hot-restart deploy-verify gate.
 */

import type { ResolvedModel } from './resolveModel.js';

interface CacheEntry {
  value: ResolvedModel;
  expiresAt: number;
}

export interface RegistryCacheOptions {
  /** TTL for every entry, default 30_000 ms. Safety net for missed NOTIFY. */
  ttlMs?: number;
}

export interface RegistryNotificationPayload {
  /** 'INSERT' | 'UPDATE' | 'DELETE' — emitted by F0.5 trigger. */
  action?: string;
  /** Registry row id (uuid). */
  registry_row_id?: string;
  /** Role of the changed row. */
  role?: string;
}

export class RegistryCache {
  private readonly ttlMs: number;
  /** Cache keyed by `${role}` → role-default ResolvedModel. */
  private readonly byRole = new Map<string, CacheEntry>();
  /** Cache keyed by registry row id → ResolvedModel. */
  private readonly byId = new Map<string, CacheEntry>();

  constructor(opts: RegistryCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 30_000;
  }

  // ── role-default index ────────────────────────────────────────────────

  setRoleDefault(role: string, model: ResolvedModel): void {
    this.byRole.set(role, { value: model, expiresAt: Date.now() + this.ttlMs });
  }

  getRoleDefault(role: string): ResolvedModel | undefined {
    const entry = this.byRole.get(role);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.byRole.delete(role);
      return undefined;
    }
    return entry.value;
  }

  invalidateRole(role: string): void {
    this.byRole.delete(role);
  }

  // ── by-id index ───────────────────────────────────────────────────────

  setById(rowId: string, model: ResolvedModel): void {
    this.byId.set(rowId, { value: model, expiresAt: Date.now() + this.ttlMs });
  }

  getById(rowId: string): ResolvedModel | undefined {
    const entry = this.byId.get(rowId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.byId.delete(rowId);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Drop the by-id entry AND any role-default entry whose cached value points
   * at the same row. Used when a specific row mutates — the role-default
   * lookup might still be cached and pointing at this stale row id.
   */
  invalidateById(rowId: string): void {
    this.byId.delete(rowId);
    for (const [role, entry] of this.byRole) {
      if (entry.value.registryRowId === rowId) {
        this.byRole.delete(role);
      }
    }
  }

  invalidateAll(): void {
    this.byRole.clear();
    this.byId.clear();
  }

  // ── LISTEN/NOTIFY consumer ────────────────────────────────────────────

  /**
   * Process a NOTIFY payload from the `model_registry_changed` channel.
   * Defensive against malformed payloads — TTL is the safety net so we never
   * throw out of the listener (which would tear down the pg client).
   */
  handleNotification(payload: RegistryNotificationPayload): void {
    if (!payload || typeof payload !== 'object') return;

    const { action, registry_row_id, role } = payload;
    if (!action || typeof action !== 'string') return;

    if (registry_row_id && typeof registry_row_id === 'string') {
      this.invalidateById(registry_row_id);
    }
    if (role && typeof role === 'string') {
      this.invalidateRole(role);
    }
  }
}
