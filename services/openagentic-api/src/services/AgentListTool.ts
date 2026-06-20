/**
 * AgentListTool — meta-tool definition for the chat-pipeline refactor 10-primitive
 * T1 catalog (the chat-pipeline refactor plan §Phase C, task C.3).
 *
 * Pairs with `agent_search` (catalog discovery) and `agent_send` /
 * `agent_stop` (lifecycle control). The model invokes `agent_list` to
 * enumerate sub-agent sessions that are CURRENTLY ALIVE for the active
 * chat — so it can decide whether to send another message into one,
 * stop one, or spawn a fresh `Task`.
 *
 * Wire-up note: the dispatcher + openagentic-proxy `GET /sessions?chatSessionId=:id`
 * implementation land in tasks C.2-C.4 of the plan. This file only owns
 * the tool definition the model sees.
 */

const DESCRIPTION = [
  'Enumerate the live (running) sub-agent sessions tied to this chat.',
  '',
  'Use this when the user asks "what agents are running?", or when you',
  'need to decide whether to follow up with an existing agent (call',
  'agent_send) versus spawning a new one (call Task). Distinct from',
  'agent_search, which queries the CATALOG of agents available to spawn —',
  'agent_list returns only the active running instances.',
  '',
  'WHAT IT RETURNS: an array of { agent_session_id, agent_name, state,',
  'started_at } for every sub-agent currently active in this chat',
  'session. Empty array when no sub-agents are running.',
].join('\n');

export const AGENT_LIST_TOOL = {
  type: 'function' as const,
  function: {
    name: 'agent_list',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isAgentListTool(name: string): boolean {
  return name === 'agent_list';
}

export interface AgentListEntry {
  agent_session_id: string;
  agent_name: string;
  state: 'running' | 'completed' | 'failed' | 'stopped';
  started_at: string;
}

export interface AgentListResult {
  ok: boolean;
  output?: string;
  error?: string;
  sessions?: ReadonlyArray<AgentListEntry>;
}

export interface AgentListInput {
  // No required fields. Reserved for a future `state` filter
  // ('running'|'completed'|...) — for now this lists everything alive
  // for the calling chat session.
}

export interface AgentListCtx {
  userId?: string;
  sessionId?: string;
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
    debug: (...a: unknown[]) => void;
  };
}

export interface AgentListDeps {
  /** Injectable for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_OPENAGENTIC_PROXY_URL = 'http://openagentic-openagentic-proxy:3300';
const AGENT_LIST_TIMEOUT_MS = 5_000;

/**
 * Map an openagentic-proxy execution row (varying shapes across endpoints) into
 * the canonical AgentListEntry the model consumes.
 */
function normalizeExecutionRow(row: any): AgentListEntry | null {
  const id = row?.id ?? row?.executionId ?? row?.agent_session_id;
  if (typeof id !== 'string' || id.length === 0) return null;
  const stateRaw = String(row?.status ?? row?.state ?? 'running').toLowerCase();
  const state: AgentListEntry['state'] =
    stateRaw === 'completed' || stateRaw === 'failed' || stateRaw === 'stopped'
      ? (stateRaw as AgentListEntry['state'])
      : 'running';
  return {
    agent_session_id: id,
    agent_name:
      row?.agentName ?? row?.agent_name ?? row?.agentId ?? row?.role ?? 'unknown',
    state,
    started_at: row?.startedAt ?? row?.started_at ?? row?.createdAt ?? new Date().toISOString(),
  };
}

/**
 * GET the live sub-agent sessions for the calling chat from openagentic-proxy.
 *
 * Endpoint: {OPENAGENTIC_PROXY_URL}/api/agents/executions/live?sessionId=:id
 * Auth:     Bearer ${OPENAGENTIC_PROXY_INTERNAL_KEY} + X-Agent-Proxy: true
 *
 * Fail-CLOSED on missing OPENAGENTIC_PROXY_INTERNAL_KEY. Network/HTTP errors
 * degrade to `{ ok:true, sessions:[] }` because list-everything is read-only
 * — model treats "no sessions" as a valid state, never as a turn-aborting
 * failure.
 */
export async function executeAgentList(
  ctx: AgentListCtx,
  _input: AgentListInput,
  deps: AgentListDeps = {},
): Promise<AgentListResult> {
  const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY ?? '';
  if (!internalKey || internalKey.trim() === '') {
    ctx.logger?.warn?.(
      { tool: 'agent_list' },
      '[agent_list] OPENAGENTIC_PROXY_INTERNAL_KEY not configured — refusing',
    );
    return {
      ok: false,
      error:
        'agent_list refused: OPENAGENTIC_PROXY_INTERNAL_KEY not configured. ' +
        'This is a server-side wiring bug — please contact your administrator.',
    };
  }

  const baseUrl = (process.env.OPENAGENTIC_PROXY_URL ?? DEFAULT_OPENAGENTIC_PROXY_URL).replace(/\/+$/, '');
  const qs = ctx.sessionId ? `?sessionId=${encodeURIComponent(ctx.sessionId)}` : '';
  const url = `${baseUrl}/api/agents/executions/live${qs}`;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? globalThis.fetch;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AGENT_LIST_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${internalKey}`,
        'X-Agent-Proxy': 'true',
      } as any,
      signal: ac.signal,
    } as any);
    clearTimeout(timer);

    if (!resp.ok) {
      return { ok: true, sessions: [], output: `agent_list: openagentic-proxy ${resp.status} — no sessions returned.` };
    }
    const body: any = await resp.json().catch(() => ({}));
    const rows: any[] = Array.isArray(body?.executions)
      ? body.executions
      : Array.isArray(body)
        ? body
        : [];
    const sessions = rows
      .map(normalizeExecutionRow)
      .filter((s): s is AgentListEntry => s !== null);
    return {
      ok: true,
      sessions,
      output: sessions.length === 0
        ? 'No sub-agent sessions currently active in this chat.'
        : `Active sub-agent sessions: ${sessions.map((s) => `${s.agent_name}(${s.agent_session_id})`).join(', ')}`,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const msg = err?.message ?? String(err);
    ctx.logger?.warn?.({ err: msg }, '[agent_list] failed — returning empty');
    return { ok: true, sessions: [], output: 'agent_list: transient error — no sessions returned.' };
  }
}
