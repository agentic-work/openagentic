/**
 * AgentSearchTool — synthetic meta-tool for model-invoked sub-agent discovery.
 *
 * Sister to ToolSearchTool. Spec:
 * the design notes
 *
 * The description teaches Claude Code's parallel-spawn pattern verbatim
 * — the model emits multiple Task tool_use blocks in ONE assistant turn
 * for parallelism (api runtime executes them concurrently via Promise.all,
 * shipped in commit d49d0fd5).
 */

const DESCRIPTION = [
  'Search the agent catalog for sub-agents matching what you need.',
  'Returns 3-5 agent definitions you can dispatch via the Task tool on',
  'your next turn.',
  '',
  'Use when the user request needs specialist expertise (code review,',
  'data analysis, security audit, cloud-ops fan-out) AND you do not',
  'already know which agent to dispatch. Use FIRST when more than ~10',
  'tools are needed for a request — fan out across sub-agents instead',
  'of overloading the main agent.',
  '',
  'Do NOT use agent_search when the right tool is obvious from the user',
  'request — call the tool directly instead. Do NOT use it for simple',
  'questions answerable from your own knowledge. Avoid calling',
  'agent_search if you have already received a recent agent_search',
  'result this session — reuse those results.',
  '',
  'To run multiple sub-agents in parallel, emit multiple Task tool_use',
  'blocks in a SINGLE assistant turn — the runtime executes them',
  'concurrently and you get all results in the next turn. This is the',
  'correct pattern when sub-tasks are independent or when the user says',
  '"in parallel".',
  '',
  'Don\'t fabricate or predict sub-agent results while a Task is in',
  'flight. Don\'t race the runtime — the tool_result arrives in the',
  'next assistant turn.',
].join(' ').replace(/  +/g, ' ').trim();

export const AGENT_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'agent_search',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What kind of agent you need, in plain language. e.g. "code reviewer", "data analyst", "fact checker".',
        },
        k: {
          type: 'integer',
          description: 'How many agents to retrieve. Default 5.',
          default: 5,
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

export function isAgentSearchTool(name: string): boolean {
  return name === 'agent_search';
}

export interface AgentSearchInput {
  query: string;
  k?: number;
}

export interface AgentSearchResult {
  ok: boolean;
  output?: string;
  error?: string;
  discoveredAgents?: ReadonlyArray<any>;
}

const DEFAULT_K = 5;
const FORWARD_TIMEOUT_MS = 5_000;

function apiBaseUrl(): string {
  return (
    process.env.INTERNAL_API_URL
    || process.env.API_BASE_URL
    || 'http://127.0.0.1:8000'
  ).replace(/\/+$/, '');
}

function renderResultText(query: string, agents: ReadonlyArray<any>): string {
  if (!agents.length) {
    return `agent_search('${query}'): no agents found. Try a different phrasing.`;
  }
  const names = agents
    .map((a: any) => a?.function?.name ?? a?.id ?? a?.name)
    .filter((n: any): n is string => typeof n === 'string');
  return (
    `Found ${agents.length} agent${agents.length === 1 ? '' : 's'} matching '${query}':\n\n`
    + names.map((n) => `- ${n}`).join('\n')
    + `\n\nDispatch any of them via Task on your next turn.`
  );
}

export async function executeAgentSearch(
  _ctx: any,
  input: AgentSearchInput,
): Promise<AgentSearchResult> {
  const query = String(input?.query ?? '').trim();
  const k = Number.isFinite(input?.k) ? Number(input!.k) : DEFAULT_K;
  if (!query) {
    return { ok: true, discoveredAgents: [], output: 'agent_search: query was empty.' };
  }

  const url = `${apiBaseUrl()}/api/internal/agent-search`;
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET ?? '';

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FORWARD_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': internalSecret,
      } as any,
      body: JSON.stringify({ query, k }),
      signal: ac.signal,
    } as any);
    clearTimeout(timer);

    if (!resp.ok) {
      return {
        ok: true,
        discoveredAgents: [],
        output: `agent_search('${query}'): backend error ${resp.status} — no agents returned.`,
      };
    }

    const body: any = await resp.json().catch(() => ({}));
    const agents = Array.isArray(body?.agents) ? body.agents : [];
    return {
      ok: true,
      discoveredAgents: agents,
      output: renderResultText(query, agents),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: true,
      discoveredAgents: [],
      output: `agent_search('${query}'): network/timeout error — no agents returned.`,
    };
  }
}
