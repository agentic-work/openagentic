/**
 * listAgentsFromDb — chatmode-facing DB-backed agent registry reader.
 *
 * Option B unification (2026-05-13): the chatmode Task tool now reads its
 * sub-agent registry from `prisma.agent` instead of the 8 markdown files
 * under `src/agents/built-in/*.md`. This brings chatmode in line with
 * Flows + Admin Console which already use the DB as SoT.
 *
 * Shape compatibility: returns entries with the SAME field surface that
 * the legacy `getBuiltInAgents()` produced (agent_type, display_name,
 * description, tools, body) so `makeListAgents` in `buildChatV2Deps.ts`
 * and the registry lookup in `makeRunSubagentViaRecursor.ts` work without
 * blast-radius changes.
 *
 * Failure mode: when the DB is unreachable mid-turn, returns []. The Task
 * tool description builder shows "no specialized agents registered yet —
 * use general-purpose" and dispatch continues to function (no crash).
 *
 * the design notes.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services || loggers;

/**
 * Subset of `prisma.agent` fields the chatmode Task tool + recursor read.
 * Matches the shape `getBuiltInAgents()` produced from the markdown files,
 * with one extra field — `name` — which the admin path uses as the
 * primary stable identifier.
 */
export interface DbBackedAgentEntry {
  /** DB column — usually equal to agent_type. */
  name: string;
  /** Underscored type identifier (e.g. `cloud_operations`). */
  agent_type: string;
  /** Title-case display name (UI label). */
  display_name: string;
  /** Encyclopedia-article description used by the Task tool description. */
  description: string;
  /** Tool whitelist (wildcards + exact names). */
  tools: string[];
  /**
   * Legacy field-name compat — returns the `system_prompt` column under
   * `body` so makeRunSubagentViaRecursor's `agent.body` read still works.
   */
  body: string;
  /** Original `system_prompt` — same as `body`, kept for clarity. */
  systemPrompt: string;
}

/**
 * Fetch the canonical agent list from `prisma.agent`. Only rows with
 * `is_default=true AND enabled=true` are returned — these are the agents
 * the chatmode Task tool dispatches to.
 *
 * Admins create custom dispatchable agents via the Admin Console, which
 * writes `is_default=true` rows. The 8 markdown built-ins are seeded at
 * boot with `is_default=true` (see `14-agent-md-to-db-seeder.ts`).
 */
export async function listAgentsFromDb(): Promise<DbBackedAgentEntry[]> {
  try {
    const rows = await prisma.agent.findMany({
      where: { is_default: true, enabled: true },
      orderBy: { display_name: 'asc' },
    });
    return rows.map((row: any) => {
      const tools = Array.isArray(row.tools_whitelist) ? row.tools_whitelist : [];
      const systemPrompt = typeof row.system_prompt === 'string' ? row.system_prompt : '';
      return {
        name: row.name,
        agent_type: row.agent_type,
        display_name: row.display_name,
        description: row.description ?? '',
        tools,
        body: systemPrompt,
        systemPrompt,
      };
    });
  } catch (err: any) {
    logger.warn(
      { err: err.message },
      '[listAgentsFromDb] prisma.agent query failed — returning empty list',
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Synchronous snapshot cache for the recursor
//
// `makeRunSubagentViaRecursor` calls its `getAgents()` callback
// synchronously inside the dispatch hot path. We bridge async DB reads
// with the sync lookup by keeping a process-lifetime snapshot that:
//   * primes lazily on first sync read (returns [] until the first
//     async refresh resolves — chatmode falls back to "Task tool shows
//     no built-ins" for the first turn at cold start);
//   * refreshes every CACHE_TTL_MS on demand;
//   * is force-invalidated by admin agent CRUD via
//     `invalidateAgentsFromDbCache()` (mirrors the provider-hot-reload
//     pattern in [[feedback_provider_hot_reload_after_write]]).
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
let cachedSnapshot: DbBackedAgentEntry[] = [];
let cachedAt = 0;
let inflight: Promise<DbBackedAgentEntry[]> | null = null;

async function refreshSnapshot(): Promise<DbBackedAgentEntry[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const rows = await listAgentsFromDb();
      cachedSnapshot = rows;
      cachedAt = Date.now();
      return rows;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Synchronous accessor used by the recursor's `getAgents()` callback.
 * Returns the in-memory snapshot. When the snapshot is stale (older than
 * CACHE_TTL_MS) or empty, kicks off a non-blocking refresh in the
 * background — the current call gets whatever was cached, the NEXT call
 * sees the fresh data.
 */
export function listAgentsFromDbSync(): DbBackedAgentEntry[] {
  const now = Date.now();
  if (now - cachedAt > CACHE_TTL_MS || cachedSnapshot.length === 0) {
    // Fire-and-forget: refresh asynchronously without blocking the caller.
    refreshSnapshot().catch((err) => {
      logger.warn(
        { err: err?.message },
        '[listAgentsFromDbSync] background refresh failed — keeping stale snapshot',
      );
    });
  }
  return cachedSnapshot;
}

/**
 * Force the next sync read to trigger a refresh. Admin agent CRUD routes
 * call this after POST/PUT/DELETE so chatmode picks up new/edited/deleted
 * agents immediately rather than waiting for the TTL to expire.
 */
export function invalidateAgentsFromDbCache(): void {
  cachedAt = 0;
}

/**
 * Prime the cache eagerly. Boot path calls this after the seeder runs so
 * the first chat turn sees populated agents instead of an empty list.
 * Best-effort — failures fall through to lazy population.
 */
export async function primeAgentsFromDbCache(): Promise<void> {
  try {
    await refreshSnapshot();
  } catch (err: any) {
    logger.warn(
      { err: err?.message },
      '[primeAgentsFromDbCache] prime failed — cache will lazy-populate on first sync read',
    );
  }
}

/**
 * Test-only — reset the cache so each test sees a fresh state.
 */
export function resetAgentsFromDbCacheForTests(): void {
  cachedSnapshot = [];
  cachedAt = 0;
  inflight = null;
}
