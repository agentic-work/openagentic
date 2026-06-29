/**
 * AgentSendTool — meta-tool definition for the chat-pipeline refactor 10-primitive
 * T1 catalog (the chat-pipeline refactor plan §Phase C, task C.2).
 *
 * The model invokes `agent_send` to push an additional message into a
 * sub-agent that is already running (was spawned via `Task`). Use cases:
 * mid-task scope nudges ("also check us-west-2"), follow-up questions
 * the orchestrator decides to ask without re-spawning, course corrections.
 *
 * Wire-up note: dispatcher + openagentic-proxy `POST /sessions/:id/send`
 * implementation lands in tasks C.2-C.4 of the plan. This file only owns
 * the tool definition the model sees.
 */

const DESCRIPTION = [
  'Send a follow-up message into a CURRENTLY-RUNNING sub-agent session.',
  '',
  'Use this when a sub-agent you previously launched (via Task) is still',
  'active and you want to nudge it — add scope ("also check us-west-2"),',
  'answer a clarifying question it asked, or correct course mid-flight.',
  'Distinct from Task (which spawns a NEW agent); agent_send only targets',
  'agents that are already live. List candidates with agent_list.',
  '',
  'WHAT IT RETURNS: an ack with the agent_session_id confirming delivery.',
  'The sub-agent\'s reply streams via the same NDJSON channel as its',
  'original Task fan-out — you don\'t need to wait for it inline.',
].join('\n');

export const AGENT_SEND_TOOL = {
  type: 'function' as const,
  function: {
    name: 'agent_send',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        agent_session_id: {
          type: 'string' as const,
          description:
            'The agent_session_id of the running sub-agent (from agent_list or the original Task tool_use_id).',
        },
        message: {
          type: 'string' as const,
          description:
            'The message to deliver to the sub-agent — written for it, not for the user. Plain language.',
        },
      },
      required: ['agent_session_id', 'message'] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isAgentSendTool(name: string): boolean {
  return name === 'agent_send';
}

export interface AgentSendInput {
  agent_session_id: string;
  message: string;
}

export interface AgentSendResult {
  ok: boolean;
  output?: string;
  error?: string;
  agent_session_id?: string;
}

/**
 * Minimal context the dispatcher passes through — parent userId + sessionId
 * land on the openagentic-proxy request body so its audit trail can correlate the
 * follow-up message back to the chat that owns the sub-agent.
 */
export interface AgentSendCtx {
  userId?: string;
  sessionId?: string;
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
    debug: (...a: unknown[]) => void;
  };
}

export interface AgentSendDeps {
  /** Injectable for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_OPENAGENTIC_PROXY_URL = 'http://openagentic-openagentic-proxy:3300';
const AGENT_SEND_TIMEOUT_MS = 10_000;

/**
 * POST a follow-up message into a running sub-agent session via openagentic-proxy.
 *
 * Endpoint: {OPENAGENTIC_PROXY_URL}/api/agents/executions/:agent_session_id/send
 * Auth:     Bearer ${OPENAGENTIC_PROXY_INTERNAL_KEY} + X-Agent-Proxy: true
 *
 * Fail-CLOSED on missing OPENAGENTIC_PROXY_INTERNAL_KEY (same posture
 * as OpenAgenticProxyClient.constructor). Never throws — network/HTTP errors
 * surface as `{ ok:false, error }` so the chat loop continues.
 */
export async function executeAgentSend(
  ctx: AgentSendCtx,
  input: AgentSendInput,
  deps: AgentSendDeps = {},
): Promise<AgentSendResult> {
  const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY ?? '';
  if (!internalKey || internalKey.trim() === '') {
    ctx.logger?.warn?.(
      { tool: 'agent_send' },
      '[agent_send] OPENAGENTIC_PROXY_INTERNAL_KEY not configured — refusing to call openagentic-proxy',
    );
    return {
      ok: false,
      error:
        'agent_send refused: OPENAGENTIC_PROXY_INTERNAL_KEY not configured. ' +
        'This is a server-side wiring bug — please contact your administrator.',
    };
  }

  const baseUrl = (process.env.OPENAGENTIC_PROXY_URL ?? DEFAULT_OPENAGENTIC_PROXY_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/api/agents/executions/${encodeURIComponent(input.agent_session_id)}/send`;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? globalThis.fetch;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AGENT_SEND_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalKey}`,
        'X-Agent-Proxy': 'true',
      } as any,
      body: JSON.stringify({
        message: input.message,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
      }),
      signal: ac.signal,
    } as any);
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        ok: false,
        error: `agent_send: openagentic-proxy ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`,
      };
    }

    return {
      ok: true,
      agent_session_id: input.agent_session_id,
      output: `Delivered message to agent_session_id=${input.agent_session_id}.`,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const msg = err?.message ?? String(err);
    ctx.logger?.warn?.({ err: msg, agent_session_id: input.agent_session_id }, '[agent_send] failed');
    return { ok: false, error: msg };
  }
}
