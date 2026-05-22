/**
 * Sev-0 #838 — merge persisted sub-agent payloads into the live
 * subAgentsByMessageId map so AgenticActivityStream renders them
 * INLINE at the Task tool_use position even after a page reload.
 *
 * Pre-fix: live path threaded sub-agents via `subAgentsByMessageId` →
 * AgenticActivityStream → SubAgentCard at the agent_group's timeline
 * position. Persisted path (after reload) rendered a SEPARATE
 * `<div data-testid="persisted-sub-agents">` BELOW the assistant prose,
 * dropping the inline anchor (out-of-band, same shape as the HITL bug
 * #831).
 *
 * Post-fix: this pure helper folds each message's
 * `visualizations[].type === 'sub_agent_complete' | 'sub_agent_completed'`
 * entries into a SubAgentEntry-shaped record keyed by the assistant
 * message id, merged with whatever the live reducer already has. AAS
 * sees a single source-of-truth map and renders inline regardless of
 * the live-vs-persisted hydration source.
 */

export interface PersistedSubAgentPayload {
  role: string;
  description?: string;
  model?: string | null;
  ok?: boolean;
  error?: string | null;
  turns?: number;
  tokens?: number;
  durationMs?: number;
  toolsUsed?: string[];
  output?: string;
  session_id?: string | null;
  sessionId?: string | null;
}

export interface SubAgentEntryShape {
  role: string;
  description?: string;
  model: string | null;
  status: 'running' | 'ok' | 'error';
  stats?: {
    turns: number;
    tokens: number;
    wallMs: number;
    toolsUsed?: string[];
  };
  error?: string | null;
  sessionId?: string;
  output?: string;
}

export interface NormalizedMessageLike {
  id: string;
  role?: string;
  /** `chat_messages.visualizations` JSON column hydrated on load. */
  visualizations?: Array<{ type?: string; data?: any }> | null;
}

/**
 * Convert a persisted `sub_agent_complete[d]` payload (the wire shape
 * api/persistableInlineFrames.ts emits) into the in-memory
 * SubAgentEntry shape consumed by AAS + SubAgentCard.
 *
 * Returns null on malformed input so callers can filter cleanly.
 */
export function normalizePersistedSubAgent(
  p: PersistedSubAgentPayload | null | undefined,
): SubAgentEntryShape | null {
  if (!p || typeof p.role !== 'string' || p.role.length === 0) return null;
  const status: SubAgentEntryShape['status'] =
    p.ok === false ? 'error' : 'ok'; // persisted payload is always terminal
  const entry: SubAgentEntryShape = {
    role: p.role,
    model: p.model ?? null,
    status,
  };
  if (p.description) entry.description = p.description;
  if (p.error !== undefined) entry.error = p.error;
  if (p.output !== undefined) entry.output = p.output;
  const sid = p.sessionId ?? p.session_id;
  if (sid) entry.sessionId = sid;
  if (
    typeof p.turns === 'number' ||
    typeof p.tokens === 'number' ||
    typeof p.durationMs === 'number'
  ) {
    entry.stats = {
      turns: p.turns ?? 0,
      tokens: p.tokens ?? 0,
      wallMs: p.durationMs ?? 0,
      ...(p.toolsUsed ? { toolsUsed: p.toolsUsed } : {}),
    };
  }
  return entry;
}

/**
 * Build the union of (live subAgentsByMessageId, persisted sub-agent
 * payloads from each assistant message's `visualizations` array).
 *
 * Live entries win on key collision — once the reducer has owned an
 * entry, the persisted blob's stale snapshot must not overwrite it.
 *
 * Pure: no React, no DOM. Safe to test in isolation.
 */
export function mergePersistedSubAgents(
  live: Record<string, SubAgentEntryShape[]> | undefined | null,
  messages: ReadonlyArray<NormalizedMessageLike> | undefined | null,
): Record<string, SubAgentEntryShape[]> {
  const out: Record<string, SubAgentEntryShape[]> = { ...(live ?? {}) };
  if (!Array.isArray(messages)) return out;
  for (const msg of messages) {
    if (!msg || msg.role !== 'assistant') continue;
    const viz = msg.visualizations;
    if (!Array.isArray(viz) || viz.length === 0) continue;
    // Skip if the live reducer already owns this messageId — preserves
    // live updates over stale persistence.
    if (out[msg.id] && out[msg.id].length > 0) continue;
    const persisted = viz
      .filter(
        f =>
          f &&
          (f.type === 'sub_agent_complete' || f.type === 'sub_agent_completed') &&
          f.data,
      )
      .map(f => normalizePersistedSubAgent(f.data as PersistedSubAgentPayload))
      .filter((e): e is SubAgentEntryShape => e !== null);
    if (persisted.length > 0) out[msg.id] = persisted;
  }
  return out;
}
