/**
 * AU-10 (NIST 800-53 — Non-repudiation) — the admin-audit cryptographic hash
 * chain, as a SINGLE shared writer.
 *
 * Every `admin_audit_log` row is chained:
 *   chain_hash = SHA256(previous_hash + 'admin_action' + userId + action + ts + details)
 * with previous_hash = the prior row's chain_hash. Tampering with any row breaks
 * every subsequent hash, so the chain is tamper-evident.
 *
 * Before this, the chaining logic lived in `AuditLogger.logAdminAction` but the
 * ~8 admin-audit writers across the codebase wrote `prisma.adminAuditLog.create`
 * DIRECTLY, bypassing it — so chain_hash/previous_hash were null and AU-10 was
 * effectively unmet. This module is the ONE place that writes the table; all
 * callers (incl. AuditLogger) delegate here, so every row is chained.
 *
 * Writes are SERIALIZED through a module-level promise queue: two concurrent
 * appends must not both read the same `previous_hash` and fork the chain.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';

export interface AdminAuditEntry {
  adminUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: unknown;
  ipAddress?: string | null;
  /** Any extra columns a caller already sets (e.g. tenant_id); merged verbatim. */
  extra?: Record<string, unknown>;
}

const EVENT_TYPE = 'admin_action';

// Cached tip of the chain + a serialization queue so concurrent appends link
// to the correct predecessor instead of forking.
let lastHash: string | null = null;
let coldStartDone = false;
let writeQueue: Promise<void> = Promise.resolve();

/** Test-only: reset the in-memory chain cache between cases. */
export function __resetAdminAuditChainCache(): void {
  lastHash = null;
  coldStartDone = false;
  writeQueue = Promise.resolve();
}

/**
 * Canonical string form for `details`, IDENTICAL on write and verify so the hash
 * is deterministic. `details` lives in a jsonb column, which does NOT preserve
 * object key order — so we recursively SORT keys before serializing. Without
 * this, write-hash (original order) != verify-hash (jsonb-reordered) and the
 * chain would report false tampering. (null/undefined/'' → ''; a string is
 * parsed-then-canonicalized when it's JSON, else used as-is.)
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function normalizeDetails(details: unknown): string {
  if (details === null || details === undefined || details === '') return '';
  let v: unknown = details;
  if (typeof details === 'string') {
    try { v = JSON.parse(details); } catch { return details; } // non-JSON string: use as-is
  }
  return JSON.stringify(canonicalize(v));
}

/**
 * The ONE crypto primitive shared by every tamper-evident audit chain in the
 * codebase (admin-audit AND tool-call-audit). Given the prior row's hash and an
 * ordered list of content fields, produce `SHA256(previousHash | f0 | f1 | …)`.
 *
 * Callers pass already-stringified, deterministic fields (use `normalizeDetails`
 * for any jsonb value so write-hash == verify-hash despite Postgres key churn).
 * Keeping this generic means a second chain (tool-call) reuses the exact crypto
 * — no duplicated SHA-256 / GENESIS / canonicalization logic.
 */
export function computeChainHash(previousHash: string | null, fields: string[]): string {
  const payload = [previousHash ?? 'GENESIS', ...fields].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

export function computeAdminChainHash(
  previousHash: string | null,
  userId: string,
  action: string,
  timestamp: Date,
  details?: unknown,
): string {
  return computeChainHash(previousHash, [
    EVENT_TYPE,
    userId,
    action,
    timestamp.toISOString(),
    normalizeDetails(details),
  ]);
}

async function coldStart(): Promise<void> {
  if (coldStartDone) return;
  try {
    const latest = await prisma.adminAuditLog.findFirst({
      orderBy: { created_at: 'desc' },
      select: { chain_hash: true } as any,
    });
    lastHash = (latest as any)?.chain_hash ?? null;
  } catch {
    // Column may not exist on a legacy DB — degrade to no-previous.
    lastHash = null;
  }
  coldStartDone = true;
}

/**
 * Append a chained admin-audit row. Serialized + fail-safe: an audit failure is
 * logged but NEVER throws into the caller (an audit write must not block the
 * user-visible mutation — AU-5 graceful).
 */
export async function appendAdminAudit(entry: AdminAuditEntry): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      await coldStart();
      const timestamp = new Date();
      const userId = entry.adminUserId ?? 'unknown';
      const chainHash = computeAdminChainHash(lastHash, userId, entry.action, timestamp, entry.details);

      await prisma.adminAuditLog.create({
        data: {
          ...(entry.extra ?? {}),
          admin_user_id: entry.adminUserId,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId ?? null,
          // jsonb column — store the OBJECT (the hash canonicalizes it).
          details: entry.details ?? null,
          ip_address: entry.ipAddress ?? null,
          created_at: timestamp,
          previous_hash: lastHash,
          chain_hash: chainHash,
        } as any,
      });

      lastHash = chainHash;
    } catch (error) {
      loggers.services.warn({ err: (error as any)?.message, action: entry.action }, '[AUDIT] chained admin-audit write failed');
    }
  };

  // Serialize: chain this append behind the previous one.
  const next = writeQueue.then(run);
  writeQueue = next.catch(() => undefined);
  return next;
}

/**
 * Raw passthrough for the existing direct writers: takes the exact `data` object
 * a caller already builds for `prisma.adminAuditLog.create({ data })`, adds the
 * chain fields (serialized), and writes it. Lets the ~8 call sites switch with a
 * one-line change while keeping their own column shapes (tenant_id, etc.).
 * Fail-safe: never throws into the caller.
 */
export async function createChainedAdminAudit(args: { data: Record<string, any> }): Promise<any> {
  const data = args?.data ?? {};
  const run = async (): Promise<any> => {
    try {
      await coldStart();
      const timestamp: Date = data.created_at instanceof Date ? data.created_at : new Date();
      const userId = data.admin_user_id ?? 'unknown';
      let details: unknown = data.details;
      if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch { /* leave as string */ }
      }
      const chainHash = computeAdminChainHash(lastHash, userId, data.action, timestamp, details);
      const row = await prisma.adminAuditLog.create({
        data: {
          ...data,
          created_at: timestamp,
          previous_hash: lastHash,
          chain_hash: chainHash,
        } as any,
      });
      lastHash = chainHash;
      return row;
    } catch (error) {
      loggers.services.warn({ err: (error as any)?.message, action: data?.action }, '[AUDIT] chained admin-audit write failed');
      return null;
    }
  };
  const next = writeQueue.then(run);
  writeQueue = next.then(() => undefined).catch(() => undefined);
  return next;
}

/** Verify the chain integrity over the first `limit` rows (AU-10 verify). */
export async function verifyAdminAuditChain(
  limit = 100,
): Promise<{ intact: boolean; brokenAt?: string; checkedCount: number }> {
  try {
    const events = await prisma.adminAuditLog.findMany({
      orderBy: { created_at: 'asc' },
      take: limit,
      select: {
        id: true, admin_user_id: true, action: true,
        details: true, created_at: true, chain_hash: true, previous_hash: true,
      } as any,
    });
    for (let i = 0; i < events.length; i++) {
      const ev = events[i] as any;
      if (!ev.chain_hash || ev.previous_hash === undefined) continue;
      const expected = computeAdminChainHash(
        ev.previous_hash,
        ev.admin_user_id ?? 'unknown',
        ev.action,
        new Date(ev.created_at),
        // jsonb returns details as an object (or string on legacy rows);
        // computeAdminChainHash canonicalizes either form. Do NOT JSON.parse —
        // that throws on the object form and silently voids verification.
        ev.details,
      );
      if (expected !== ev.chain_hash) {
        return { intact: false, brokenAt: ev.id, checkedCount: i + 1 };
      }
    }
    return { intact: true, checkedCount: events.length };
  } catch (error) {
    loggers.services.warn({ err: (error as any)?.message }, '[AUDIT] chain verification failed');
    return { intact: true, checkedCount: 0 };
  }
}
