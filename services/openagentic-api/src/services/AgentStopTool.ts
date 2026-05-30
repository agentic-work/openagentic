/**
 * AgentStopTool — meta-tool definition for the chatmode-rip 10-primitive
 * T1 catalog (chatmode-rip plan §Phase C, task C.4).
 *
 * The model invokes `agent_stop` to terminate a running sub-agent before
 * it completes naturally. Destructive: the sub-agent's accumulated
 * context (tool results, partial reasoning) is discarded; you cannot
 * resume it. Use sparingly — usually you want to wait OR send a steering
 * message via agent_send instead.
 *
 * Wire-up note: dispatcher + openagentic-proxy `DELETE /sessions/:id`
 * implementation lands in tasks C.2-C.4 of the plan. This file only
 * owns the tool definition the model sees.
 */

const DESCRIPTION = [
  'Terminate a currently-running sub-agent session. DESTRUCTIVE: the',
  'sub-agent\'s accumulated context (tool results, partial work) is',
  'discarded and CANNOT be resumed.',
  '',
  'Use sparingly. Prefer agent_send to course-correct, or simply wait —',
  'sub-agents complete on their own. Reach for agent_stop only when:',
  '  - the user has changed their mind about the scope',
  '  - a sub-agent appears stuck or looping (agent_list shows it still',
  '    running well past expected duration)',
  '  - chat ending, want to clean up resources before the user leaves',
  '',
  'WHAT IT RETURNS: an ack confirming the session was torn down.',
].join('\n');

export const AGENT_STOP_TOOL = {
  type: 'function' as const,
  function: {
    name: 'agent_stop',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        agent_session_id: {
          type: 'string' as const,
          description:
            'The agent_session_id of the running sub-agent to terminate (from agent_list).',
        },
      },
      required: ['agent_session_id'] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isAgentStopTool(name: string): boolean {
  return name === 'agent_stop';
}

export interface AgentStopInput {
  agent_session_id: string;
}

export interface AgentStopResult {
  ok: boolean;
  output?: string;
  error?: string;
  agent_session_id?: string;
}

export interface AgentStopCtx {
  userId?: string;
  sessionId?: string;
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
    debug: (...a: unknown[]) => void;
  };
}

export interface AgentStopDeps {
  /** Injectable for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_OPENAGENTIC_PROXY_URL = 'http://openagentic-openagentic-proxy:3300';
const AGENT_STOP_TIMEOUT_MS = 5_000;

/**
 * Terminate a running sub-agent session via openagentic-proxy.
 *
 * Endpoint: POST {OPENAGENTIC_PROXY_URL}/api/agents/executions/:agent_session_id/kill
 *   (the existing teardown endpoint registered in
 *   services/openagentic-proxy/src/routes/executions.ts)
 * Auth:     Bearer ${OPENAGENTIC_PROXY_INTERNAL_KEY} + X-Agent-Proxy: true
 *
 * Fail-CLOSED on missing OPENAGENTIC_PROXY_INTERNAL_KEY. Never throws — network
 * errors surface as `{ ok:false, error }` so the chat loop continues.
 */
export async function executeAgentStop(
  ctx: AgentStopCtx,
  input: AgentStopInput,
  deps: AgentStopDeps = {},
): Promise<AgentStopResult> {
  const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY ?? '';
  if (!internalKey || internalKey.trim() === '') {
    ctx.logger?.warn?.(
      { tool: 'agent_stop' },
      '[agent_stop] OPENAGENTIC_PROXY_INTERNAL_KEY not configured — refusing',
    );
    return {
      ok: false,
      error:
        'agent_stop refused: OPENAGENTIC_PROXY_INTERNAL_KEY not configured. ' +
        'This is a server-side wiring bug — please contact your administrator.',
    };
  }

  const baseUrl = (process.env.OPENAGENTIC_PROXY_URL ?? DEFAULT_OPENAGENTIC_PROXY_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/api/agents/executions/${encodeURIComponent(input.agent_session_id)}/kill`;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? globalThis.fetch;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AGENT_STOP_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${internalKey}`,
        'X-Agent-Proxy': 'true',
      } as any,
      signal: ac.signal,
    } as any);
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        ok: false,
        error: `agent_stop: openagentic-proxy ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      agent_session_id: input.agent_session_id,
      output: `Terminated sub-agent session agent_session_id=${input.agent_session_id}.`,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const msg = err?.message ?? String(err);
    ctx.logger?.warn?.({ err: msg, agent_session_id: input.agent_session_id }, '[agent_stop] failed');
    return { ok: false, error: msg };
  }
}
