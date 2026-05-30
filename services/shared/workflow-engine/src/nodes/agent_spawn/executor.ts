/**
 * agent_spawn node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeAgentSpawnNode (~lines 3292-3417).
 * Posts to openagentic-proxy `POST /api/agents/execute-sync` with one agent spec
 * and unwraps the response into the legacy `{ source: 'agent_spawn', ... }`
 * shape so downstream template references (`{{steps.<id>.content}}`,
 * `{{steps.<id>.output}}`) keep working.
 *
 * Shared by the `a2a` node (alias) — see ../a2a/executor.ts.
 *
 * Auth: prefers ctx.openagenticProxyInternalKey + 'X-Agent-Proxy: true' + 'X-User-Id'.
 * Falls back to ctx.getInternalAuthHeaders() when no openagentic-proxy key is set.
 *
 * TODO: Tier D — openagentic-proxy /execute-stream needed before this node
 * can emit per-token canonical events. See agent_single executor for
 * full Tier D scope. Tier C wired the 6 Group-1 LLM-direct nodes only.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

/**
 * Legacy role mapping — maps high-level template roles to DB agent_type values.
 * Verbatim copy of WorkflowExecutionEngine.executeAgentSpawnNode's
 * ROLE_TO_AGENT_TYPE table.
 */
const ROLE_TO_AGENT_TYPE: Record<string, string> = {
  general: 'reasoning',
  researcher: 'reasoning',
  research: 'reasoning',
  coder: 'code_execution',
  'code-generator': 'code_execution',
  analyst: 'data_query',
  'data-analyst': 'data_query',
  'security-scanner': 'tool_orchestration',
  investigator: 'reasoning',
  deployer: 'tool_orchestration',
  'urgent-handler': 'reasoning',
  'routine-handler': 'summarization',
  planner: 'planning',
  validator: 'validation',
  summarizer: 'summarization',
  synthesizer: 'synthesis',
  'deep-reasoner': 'reasoning',
  'fact-checker': 'validation',
};

export function getOpenAgenticProxyAuthHeaders(ctx: NodeExecutionContext): Record<string, string> {
  if (ctx.openagenticProxyInternalKey) {
    return {
      Authorization: `Bearer ${ctx.openagenticProxyInternalKey}`,
      'X-Agent-Proxy': 'true',
      'X-User-Id': ctx.userId || 'workflow-engine',
    };
  }
  return ctx.getInternalAuthHeaders();
}

export function resolveOpenAgenticProxyUrl(ctx: NodeExecutionContext): string {
  const url = ctx.openagenticProxyUrl || process.env.OPENAGENTIC_PROXY_URL;
  if (!url) {
    throw new Error(
      'agent_spawn requires ctx.openagenticProxyUrl (or OPENAGENTIC_PROXY_URL env)',
    );
  }
  return url;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const openagenticProxyUrl = resolveOpenAgenticProxyUrl(ctx);
  const data = (node.data || {}) as Record<string, any>;

  const {
    agentType = 'general',
    task,
    taskDescription,
    model,
    tools = [],
    systemPrompt,
    maxTurns = 10,
    timeout = 120000,
    costBudget = 200,
    agentId,
    agentRole,
  } = data;

  const rawTask = task || taskDescription || '';
  const resolvedTask = ctx.interpolateTemplate(rawTask, input);

  if (!resolvedTask) {
    throw new Error('agent_spawn requires a task description');
  }

  const role = agentRole || agentType;
  const resolvedRole =
    ROLE_TO_AGENT_TYPE[role] || ROLE_TO_AGENT_TYPE[agentType] || role;

  const resolvedSystemPrompt = systemPrompt
    ? ctx.interpolateTemplate(systemPrompt, input)
    : undefined;

  ctx.logger.info(
    {
      nodeId: node.id,
      agentType,
      agentRole: role,
      resolvedRole,
      agentId,
      maxTurns,
      toolCount: Array.isArray(tools) ? tools.length : 0,
    },
    '[agent_spawn] Executing via openagentic-proxy',
  );

  const effectiveModel = model && model !== 'auto' ? model : undefined;

  const response = await withGenAISpan(
    {
      operation: 'agent',
      system: 'openagentic.platform',
      requestModel: effectiveModel ?? 'auto',
      agentId: agentId || resolvedRole,
      agentName: resolvedRole,
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
                role: resolvedRole,
                task: resolvedTask,
                model: effectiveModel,
                tools: Array.isArray(tools) && tools.length > 0 ? tools : undefined,
                systemPrompt: resolvedSystemPrompt,
                maxTurns,
                timeout,
                costBudget,
              },
            ],
            orchestration: 'parallel',
            aggregation: 'first',
            sessionId: ctx.executionId,
            userId: ctx.userId,
            userMessage: resolvedTask,
            totalBudgetCents: costBudget,
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
      const rd = (resp.data || {}) as any;
      const m = rd.metrics || rd.results?.[0]?.metrics || {};
      return {
        result: resp,
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
    // Surface cost-budget errors verbatim — they're already actionable.
    throw new Error(`openagentic-proxy execute-sync failed: ${msg}`);
  }

  const r = response.data || {};
  const firstResult = Array.isArray(r.results) && r.results.length > 0 ? r.results[0] : {};
  const content = r.output ?? firstResult.content ?? firstResult.output ?? '';
  const status = firstResult.status || r.status || 'completed';

  return {
    source: 'agent_spawn',
    agentId: agentId || resolvedRole,
    agentType: role,
    executionId: r.executionId,
    status,
    content,
    output: content,
    tokenUsage: r.metrics,
    metrics: r.metrics,
  };
}
