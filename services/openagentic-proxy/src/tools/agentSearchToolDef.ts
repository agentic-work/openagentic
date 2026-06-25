/**
 * Synthetic `agent_search` meta-tool definition.
 *
 * Mirrors the T1 design used for `tool_search` in mcp-proxy: when the
 * model needs a sub-agent and no obvious always-on agent fits the task,
 * it invokes `agent_search({query, k})` to discover candidates from the
 * Milvus-backed `mcp_agents_cache` collection. The model then dispatches
 * one of the returned candidates via the `Task` meta-tool.
 *
 * The description is deliberately heavy on the parallel-spawn pattern —
 * Claude Code's `Agent` tool takes ONE subagent dispatch per invocation,
 * and parallelism emerges when the model emits multiple `Task` tool_use
 * blocks in a single assistant turn. The runtime then executes them
 * concurrently via `Promise.all`. Hammer this in the description so the
 * model doesn't try to pass an `agents: []` array (the legacy
 * `delegate_to_agents` shape).
 *
 * the design notes
 */

export const AGENT_SEARCH_TOOL_DEF = {
  type: 'function',
  function: {
    name: 'agent_search',
    description: [
      'Search the agent catalog for sub-agents matching what you need.',
      'Returns 3-5 agent definitions you can dispatch via Task on your',
      'next turn.',
      '',
      'Use this when no always-on agent obviously fits the user request',
      'and you want to discover specialized agents (code reviewers, data',
      'analysts, fact-checkers, cloud auditors, etc.) before dispatching.',
      '',
      'To run agents in parallel, emit multiple Task tool_use blocks in a',
      'single assistant turn — the runtime executes them concurrently and',
      'you get all results in the next turn. The Task tool always takes',
      'ONE agent + ONE prompt; never pass an `agents: []` array.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "What kind of agent you need, in plain language. e.g. 'code reviewer', 'data analyst', 'fact checker'.",
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
    },
  },
} as const;

export type AgentSearchInput = {
  query: string;
  k?: number;
};

export interface AgentSearchHit {
  id: string;
  name: string;
  description: string;
  role: string;
  tools: string[];
}

export interface AgentSearchResult {
  agents: AgentSearchHit[];
  count: number;
  error?: string;
}
