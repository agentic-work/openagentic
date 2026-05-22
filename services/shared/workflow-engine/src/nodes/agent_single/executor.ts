/**
 * agent_single node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeOpenAgenticProxyNode (the
 * 'agent_single' branch, ~lines 4172-4183 + the shared dispatch logic
 * at ~4220-4270).
 *
 * Posts a single agent spec to openagentic-proxy with orchestration='parallel'
 * and returns the unwrapped { content, status, agents, metrics, orchestration }.
 *
 * TODO: Tier D — openagentic-proxy needs a /api/agents/execute-stream endpoint
 * to enable per-token streaming for agent nodes. Today the call to
 * /execute-sync is blocking — the inner LLM's canonical events are
 * locked inside the openagentic-proxy process and we only see the final
 * aggregated response. Tier D will add streamLLMCompletion-equivalent
 * wiring once that endpoint exists. (Tier C scope: 6 Group-1 LLM-direct
 * nodes — llm_completion, openagentic_chat, azure_ai, bedrock, vertex,
 * reasoning, structured_output.)
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
    agentId,
    role = 'custom',
    prompt,
    task,
    model,
    tools = [],
    systemPrompt,
    maxTurns = 5,
    costBudget = 50,
    totalBudget = 200,
    timeout = 60000,
    aggregation = 'merge',
  } = data;

  const rawTask = prompt || task || '';
  const resolvedTask = ctx.interpolateTemplate(rawTask, input);

  if (!resolvedTask && !agentId) {
    throw new Error('agent_single requires a prompt/task or agentId');
  }

  const resolvedSystemPrompt = systemPrompt
    ? ctx.interpolateTemplate(systemPrompt, input)
    : undefined;

  const effectiveModel = model && model !== 'auto' ? model : undefined;

  ctx.logger.info(
    {
      nodeId: node.id,
      role,
      agentId,
      maxTurns,
      toolCount: Array.isArray(tools) ? tools.length : 0,
    },
    '[agent_single] Executing via openagentic-proxy',
  );

  const userMessage =
    typeof input === 'string'
      ? input
      : (input as any)?.message || JSON.stringify(input ?? null);

  const { response, dispatchMeta } = await withGenAISpan(
    {
      operation: 'agent',
      system: 'openagentic.platform',
      requestModel: effectiveModel ?? 'auto',
      maxTokens: undefined,
      agentId: agentId || role,
      agentName: agentId || role,
      agentDescription: resolvedSystemPrompt || undefined,
    },
    async () => {
      let resp;
      try {
        resp = await abortableAxiosPost(
          { signal: ctx.signal },
          `${openagenticProxyUrl}/api/agents/execute-sync`,
          {
            agents: [
              {
                agentId: agentId || undefined,
                role,
                task: resolvedTask,
                model: effectiveModel,
                tools: Array.isArray(tools) && tools.length > 0 ? tools : [],
                systemPrompt: resolvedSystemPrompt,
                maxTurns,
                costBudget,
                timeout,
              },
            ],
            orchestration: 'parallel',
            aggregation,
            sessionId: ctx.executionId,
            userId: ctx.userId,
            userMessage,
            totalBudgetCents: totalBudget,
            timeoutMs: timeout,
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

      // Pull tokens off openagentic-proxy's metrics envelope when present.
      const rd = (resp.data || {}) as any;
      const m = rd.metrics || rd.results?.[0]?.metrics || {};
      return {
        result: { response: resp, dispatchMeta: m },
        meta: {
          responseModel: (m.model as string | undefined) ?? effectiveModel,
          inputTokens: (m.promptTokens as number | undefined) ?? (m.input_tokens as number | undefined),
          outputTokens: (m.completionTokens as number | undefined) ?? (m.output_tokens as number | undefined),
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
  // Surface for downstream telemetry — engine doesn't read this field; kept
  // so a maintainer browsing the executor can confirm the meta was captured.
  void dispatchMeta;
  const agents = Array.isArray(r.results) ? r.results : [];
  const firstResult = agents[0] || {};
  const content =
    typeof r.output === 'string' && r.output.length > 0
      ? r.output
      : firstResult.content || firstResult.output || '';

  return {
    source: 'agent_single',
    content,
    output: content,
    status: firstResult.status || r.status || 'completed',
    agents,
    metrics: r.metrics || {},
    orchestration: 'parallel',
  };
}
