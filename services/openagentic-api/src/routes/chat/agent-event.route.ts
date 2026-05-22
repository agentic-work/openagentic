/**
 * Task #84 — openagentic-proxy → chat bridge.
 *
 * POST /api/chat/agent-event
 *
 * When a sub-agent spawned by `delegate_to_agents` or the legacy in-api orchestrator
 * emits progress (tool_executing / tool_complete / message / …), the
 * openagentic-proxy POSTs it here. The chat pipeline subscribed to the matching
 * turnId re-emits the event as an `agent_progress` NDJSON frame so
 * the UI can draw a live nested tree under the delegation card.
 *
 * Mirrors sandbox-result.route.ts: deliberately thin, validates the
 * envelope, dispatches to the in-process AgentEventStore.
 *
 * Auth: internal service auth (X-Internal-Secret) — never a user JWT.
 * openagentic-proxy sends the secret; we reject if it doesn't match.
 *
 * Phase A rename: body field is `turnId` (was `parentTurnId`).
 * `runId` + `parentRunId` are accepted and passed through so nested
 * sub-agent runs within a single turn can carry their tree structure.
 *
 * Phase C (2026-04-23):
 *  - Accepts `seq` (shared monotonic sequence from AgentProgressContext)
 *    and echoes it back in the response so callers can correlate. `seq`
 *    is optional for back-compat with pre-Phase-A publishers that only
 *    stamp turnId.
 *  - Seq-dedupe: keeps an in-memory LRU keyed on `(turnId, runId, seq)`
 *    with a 60s sliding TTL so openagentic-proxy retries (same tuple posted
 *    twice) accept idempotently instead of double-publishing.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getAgentEventStore,
  type AgentProgressEvent,
} from '../../services/AgentEventStore.js';
import { getInternalKey } from '../../utils/internalKeyReader.js';

interface AgentEventBody {
  turnId: string;
  runId?: string;
  parentRunId?: string | null;
  roundId?: string;
  agentId?: string;
  agentRole?: string;
  event: AgentProgressEvent['event'];
  payload: Record<string, unknown>;
  /** Optional client-supplied timestamp; server stamps if absent. */
  timestamp?: number;
  /** Accept Phase-C `ts` alias from AgentProgressContext envelopes. */
  ts?: number;
  /** Monotonic seq from AgentProgressContext. Used for dedupe + client reorder. */
  seq?: number;
}

const INTERNAL_SECRET_HEADER = 'x-internal-secret';

// ── Seq-dedupe ────────────────────────────────────────────────────────────
//
// openagentic-proxy retries on transient network errors. The envelope carries a
// stable `(turnId, runId, seq)` tuple (AgentProgressContext guarantees seq
// is monotonic + unique-per-tree), so we can drop duplicates at ingress
// instead of letting them leak into the UI's event stream.
//
// Narrow-scope LRU — no new dependency: a Map bounded by DEDUPE_MAX_ENTRIES
// with a 60s sliding TTL. Old entries are evicted lazily on every insert.
// Keyed on `${turnId}|${runId}|${seq}`. Miss → accept + publish; hit →
// accept + flag as duplicate (don't republish).
const DEDUPE_TTL_MS = 60_000;
const DEDUPE_MAX_ENTRIES = 1024;
const dedupeSeen = new Map<string, number>(); // key → insertedAt

function dedupeKey(turnId: string, runId: string | undefined, seq: number | undefined): string | null {
  if (!runId || typeof seq !== 'number') return null;
  return `${turnId}|${runId}|${seq}`;
}

function dedupeCheckAndMark(key: string): boolean {
  const now = Date.now();
  const existing = dedupeSeen.get(key);
  if (existing !== undefined && now - existing < DEDUPE_TTL_MS) {
    return true; // duplicate
  }

  // Evict expired entries + cap size (oldest-first since Map iteration is
  // insertion-order).
  if (dedupeSeen.size >= DEDUPE_MAX_ENTRIES) {
    for (const [k, inserted] of dedupeSeen) {
      if (now - inserted >= DEDUPE_TTL_MS) {
        dedupeSeen.delete(k);
      }
      if (dedupeSeen.size < DEDUPE_MAX_ENTRIES) break;
    }
    // If still over cap after TTL eviction, drop the oldest.
    if (dedupeSeen.size >= DEDUPE_MAX_ENTRIES) {
      const firstKey = dedupeSeen.keys().next().value;
      if (firstKey !== undefined) dedupeSeen.delete(firstKey);
    }
  }

  dedupeSeen.set(key, now);
  return false;
}

/** Test-only. Reset the dedupe LRU between vitest runs. */
export function __resetAgentEventDedupeForTests(): void {
  dedupeSeen.clear();
}

export async function agentEventRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: AgentEventBody }>(
    '/agent-event',
    async (
      request: FastifyRequest<{ Body: AgentEventBody }>,
      reply: FastifyReply,
    ) => {
      // Internal-service auth — same convention as code-manager ↔ api.
      // Reads fresh on every request so projected-secret rotation (#416)
      // takes effect without a pod restart.
      const expected = getInternalKey();
      if (expected) {
        const got = request.headers[INTERNAL_SECRET_HEADER];
        if (got !== expected) {
          return reply.status(401).send({ error: 'unauthorized', code: 'INTERNAL_AUTH_FAILED' });
        }
      }

      const body = request.body;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'invalid body', code: 'INVALID_BODY' });
      }
      if (typeof body.turnId !== 'string' || !body.turnId) {
        return reply.status(400).send({ error: 'turnId required', code: 'MISSING_TURN_ID' });
      }
      if (typeof body.event !== 'string' || !body.event) {
        return reply.status(400).send({ error: 'event required', code: 'MISSING_EVENT' });
      }

      // Phase-C dedupe: same (turnId, runId, seq) tuple → accept but no
      // double-publish. Returns 200 with `duplicate: true` so the caller
      // knows the retry was a no-op instead of a fresh fan-out.
      const dkey = dedupeKey(body.turnId, body.runId, body.seq);
      if (dkey !== null && dedupeCheckAndMark(dkey)) {
        return reply.send({
          ok: true,
          received: true,
          duplicate: true,
          turnId: body.turnId,
          runId: body.runId,
          seq: body.seq,
        });
      }

      // AgentProgressContext posts `ts`; pre-Phase-A callers post `timestamp`.
      // Accept either.
      const ts = typeof body.ts === 'number' ? body.ts : body.timestamp;

      const event: AgentProgressEvent = {
        turnId: body.turnId,
        runId: body.runId,
        parentRunId: body.parentRunId ?? null,
        roundId: body.roundId,
        // `agentId` was required in the pre-Phase-A contract; keep it in
        // the stored envelope for UI back-compat (the nested-tree view
        // uses it as a stable per-sub-agent id). Fall back to `runId`
        // when the Phase-C AgentProgressContext publisher omits it
        // (runId is already unique within the turn).
        agentId: body.agentId ?? body.runId ?? 'unknown',
        agentRole: body.agentRole,
        event: body.event,
        payload: body.payload ?? {},
        timestamp: ts ?? Date.now(),
      };

      const delivered = getAgentEventStore().publish(event);

      return reply.send({
        ok: true,
        received: true,
        duplicate: false,
        turnId: body.turnId,
        runId: body.runId,
        agentId: event.agentId,
        seq: body.seq,
        delivered,
      });
    },
  );
}
