/**
 * agent_pool node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeOpenAgenticProxyNode (the
 * 'agent_pool' branch, ~lines 4184-4198 + the shared dispatch logic).
 *
 * Runs N agents in parallel via openagentic-proxy and returns the aggregated
 * { content, agents, metrics, orchestration='parallel', status }.
 *
 * TODO: Tier D — openagentic-proxy /execute-stream needed before this node
 * can emit per-token canonical events. See agent_single executor for
 * full Tier D scope. Tier C wired the 6 Group-1 LLM-direct nodes only.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';
import {
  getOpenAgenticProxyAuthHeaders,
  resolveOpenAgenticProxyUrl,
} from '../agent_spawn/executor.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const openagenticProxyUrl = resolveOpenAgenticProxyUrl(ctx);
  const data = (node.data || {}) as Record<string, any>;

  const {
    agents: agentList = [],
    concurrency = 5,
    aggregation = 'merge',
    totalBudget = 200,
    timeout = 120000,
  } = data;

  if (!Array.isArray(agentList) || agentList.length === 0) {
    throw new Error('agent_pool requires a non-empty agents array');
  }

  const agents = agentList.map((a: any) => {
    const taskRaw = a.task || a.prompt || '{{input.message}}';
    const resolvedTask = ctx.interpolateTemplate(taskRaw, input);
    const resolvedSystemPrompt = a.systemPrompt
      ? ctx.interpolateTemplate(a.systemPrompt, input)
      : undefined;
    const model = a.model && a.model !== 'auto' ? a.model : undefined;
    return {
      agentId: a.agentId || undefined,
      role: a.role || 'custom',
      task: resolvedTask,
      model,
      tools: Array.isArray(a.tools) ? a.tools : [],
      systemPrompt: resolvedSystemPrompt,
      maxTurns: a.maxTurns ?? 5,
      costBudget: a.costBudget ?? 50,
      timeout: a.timeout ?? 60000,
    };
  });

  const userMessage =
    typeof input === 'string'
      ? input
      : (input as any)?.message || JSON.stringify(input ?? null);

  ctx.logger.info(
    { nodeId: node.id, agentCount: agents.length, concurrency },
    '[agent_pool] Executing via openagentic-proxy',
  );

  const response = await withGenAISpan(
    {
      operation: 'agent',
      system: 'openagentic.platform',
      requestModel: 'auto',
      agentId: `pool:${agents.length}`,
      agentName: `agent_pool(${agents.length})`,
    },
    async () => {
      let resp;
      try {
        resp = await abortableAxiosPost(
          { signal: ctx.signal },
          `${openagenticProxyUrl}/api/agents/execute-sync`,
          {
            agents,
            orchestration: 'parallel',
            aggregation,
            sessionId: ctx.executionId,
            userId: ctx.userId,
            userMessage,
            totalBudgetCents: totalBudget,
            timeoutMs: timeout,
            maxConcurrency: concurrency,
            flowContext: {
              flowId: ctx.workflowId,
              executionId: ctx.executionId,
              nodeId: node.id,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...getOpenAgenticProxyAuthHeaders(ctx),
              'X-Workflow-Execution': ctx.executionId,
            },
            timeout: timeout + 30000,
          },
        );
      } catch (err: any) {
        if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND') {
          throw new Error(
            `openagentic-proxy is not reachable at ${openagenticProxyUrl}: ${err.message}`,
          );
        }
        throw err;
      }
      const rd = (resp.data || {}) as any;
      const m = rd.metrics || {};
      return {
        result: resp,
        meta: {
          inputTokens: (m.promptTokens as number | undefined) ?? 0,
          outputTokens: (m.completionTokens as number | undefined) ?? 0,
        },
      };
    },
  );

  if (response.status >= 400) {
    const msg =
      response.data?.error || response.data?.message || `HTTP ${response.status}`;
    throw new Error(`openagentic-proxy execute-sync failed: ${msg}`);
  }

  const r = response.data || {};
  const resultAgents = Array.isArray(r.results) ? r.results : [];
  const content =
    typeof r.output === 'string' && r.output.length > 0
      ? r.output
      : resultAgents
          .map((x: any) => x?.content || x?.output || '')
          .filter(Boolean)
          .join('\n\n---\n\n');

  return {
    source: 'agent_pool',
    content,
    output: content,
    agents: resultAgents,
    agentCount: resultAgents.length,
    metrics: r.metrics || {},
    orchestration: 'parallel',
    status: r.status || 'completed',
    strategy: aggregation,
  };
}
