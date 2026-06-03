/**
 * agent_supervisor node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeOpenAgenticProxyNode (the
 * 'agent_supervisor' branch, ~lines 4199-4218 + the shared dispatch logic).
 *
 * Posts openagentic-proxy with orchestration='supervisor': the first agent in
 * the list is the supervisor (with the goal/prompt), followed by the
 * worker specs whose tasks are delegated dynamically.
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
  buildAgentProxyUserAuth,
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
    supervisorPrompt,
    goal,
    supervisorModel,
    agents: workerListA = [],
    workers: workerListB = [],
    maxTurns = 10,
    concurrency = 5,
    totalBudget = 200,
    timeout = 120000,
  } = data;

  const workers = Array.isArray(workerListA) && workerListA.length > 0
    ? workerListA
    : Array.isArray(workerListB) ? workerListB : [];

  if (workers.length === 0) {
    throw new Error('agent_supervisor requires a non-empty agents array (workers)');
  }

  const rawSupervisorTask = supervisorPrompt || goal || '{{input.message}}';
  const resolvedSupervisorTask = ctx.interpolateTemplate(rawSupervisorTask, input);

  if (!resolvedSupervisorTask) {
    throw new Error('agent_supervisor requires a supervisorPrompt or goal');
  }

  const supervisorEffectiveModel =
    supervisorModel && supervisorModel !== 'auto' ? supervisorModel : undefined;

  const supervisorSpec = {
    role: 'supervisor',
    task: resolvedSupervisorTask,
    model: supervisorEffectiveModel,
    maxTurns,
  };

  const workerSpecs = workers.map((w: any) => {
    const wModel = w.model && w.model !== 'auto' ? w.model : undefined;
    return {
      agentId: w.agentId || undefined,
      role: w.role || 'custom',
      // Supervisor assigns tasks dynamically; placeholder preserved verbatim
      // (matches legacy behavior at WorkflowExecutionEngine line ~4212).
      task: '{{delegated}}',
      model: wModel,
      tools: Array.isArray(w.tools) ? w.tools : [],
      maxTurns: w.maxTurns ?? 5,
    };
  });

  const allAgents = [supervisorSpec, ...workerSpecs];

  const userMessage =
    typeof input === 'string'
      ? input
      : (input as any)?.message || JSON.stringify(input ?? null);

  ctx.logger.info(
    { nodeId: node.id, workerCount: workers.length, maxTurns },
    '[agent_supervisor] Executing via openagentic-proxy',
  );

  const response = await withGenAISpan(
    {
      operation: 'agent',
      system: 'openagentic.platform',
      requestModel: 'auto',
      agentId: `supervisor:${workers.length}`,
      agentName: `supervisor(${workers.length}w)`,
    },
    async () => {
      let resp;
      try {
        resp = await abortableAxiosPost(
          { signal: ctx.signal },
          `${openagenticProxyUrl}/api/agents/execute-sync`,
          {
            agents: allAgents,
            orchestration: 'supervisor',
            aggregation: 'merge',
            sessionId: ctx.executionId,
            userId: ctx.userId,
            userMessage,
            // #1275 true run-as-user OBO (token + id token + email in the body).
            ...buildAgentProxyUserAuth(ctx),
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
    source: 'agent_supervisor',
    content,
    output: content,
    agents: resultAgents,
    agentCount: resultAgents.length,
    metrics: r.metrics || {},
    orchestration: 'supervisor',
    status: r.status || 'completed',
  };
}
