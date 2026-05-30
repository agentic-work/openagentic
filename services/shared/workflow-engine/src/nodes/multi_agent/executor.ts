/**
 * multi_agent node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeMultiAgentNode (~lines
 * 3855-3962). Routes through openagentic-proxy with orchestration='parallel'
 * and falls back to a direct LLM-batch loop when openagentic-proxy is
 * unavailable (preserving the existing user-visible behavior).
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
import {
  validateAgentInput,
  validateAgentOutput,
  type AgentContract,
} from '../../contracts/AgentContract.js';
import {
  buildSubAgentStarted,
  buildSubAgentCompleted,
} from '@agentic-work/llm-sdk';
import { withGenAISpan } from '../../observability/GenAITracer.js';

interface AgentSpec {
  agentId?: string;
  role: string;
  task: string;
  model?: string;
  tools: string[];
  systemPrompt?: string;
  maxTurns: number;
  costBudget: number;
  timeout: number;
  /**
   * Pillar 3 (#53): optional typed contract per slot. When present,
   * the executor validates input + output and emits
   * `subagent.contract_violation` on any mismatch. WARNING-ONLY for
   * now — we don't fail the run; we surface the signal so AgentOps
   * + signed traces can capture it. Hard enforcement is a follow-up.
   */
  contract?: AgentContract;
}

/**
 * Emit a contract_violation telemetry event for a slot. Failure to
 * emit must not throw (telemetry is fire-and-forget, identical to
 * subagent.start / subagent.complete).
 */
function emitContractViolation(
  ctx: NodeExecutionContext,
  nodeId: string,
  slot: number,
  kind: 'input' | 'output',
  errors: string[],
): void {
  try {
    ctx.emitNodeProgress?.({
      nodeId,
      eventType: 'subagent.contract_violation',
      payload: { slot, kind, errors },
    });
  } catch {
    /* swallow */
  }
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;

  const {
    agents: agentList = [],
    maxConcurrency = 5,
    aggregationStrategy = 'merge',
    sharedContext = true,
    timeoutMs = 120000,
    pattern = 'parallel',
  } = data;

  if (!Array.isArray(agentList) || agentList.length === 0) {
    throw new Error('multi_agent requires a non-empty agents array');
  }

  // Map workspace-facing patterns to openagentic-proxy orchestration modes.
  // 'debate' is sequential with explicit pro/con/judge framing — openagentic-proxy
  // doesn't yet have a native debate pattern, so we route through sequential
  // and let the agent task descriptions carry the debate semantics.
  const orchestrationMode: 'parallel' | 'sequential' | 'supervisor' =
    pattern === 'sequential' ? 'sequential'
    : pattern === 'supervisor' ? 'supervisor'
    : pattern === 'debate' ? 'sequential'
    : 'parallel';

  // Build per-agent specs with template interpolation.
  const agentSpecsRaw = agentList.map((agent: any) => agent);

  // Emit canonical SubAgentStartedEvent (one per spec) BEFORE we call
  // openagentic-proxy, so the swarm popover can paint pending cards immediately.
  // Tier A: canonical AgenticEvent shape from @agentic-work/llm-sdk —
  // chatmode + Flows share one swarm-renderer contract. Failure to emit
  // must not throw — emitNodeProgress is optional.
  for (let i = 0; i < agentSpecsRaw.length; i++) {
    const a = agentSpecsRaw[i];
    try {
      const role = a.role || 'agent';
      const taskId = a.agentId || `${node.id}:slot-${i}`;
      ctx.emitNodeProgress?.({
        nodeId: node.id,
        event: buildSubAgentStarted({
          task_id: taskId,
          agent_role: role,
          description:
            a.displayName ||
            (typeof a.taskDescription === 'string'
              ? a.taskDescription
              : typeof a.task === 'string'
                ? a.task
                : `Agent ${i + 1}`),
          parent_session_id: ctx.executionId,
          parent_user_id: ctx.userId,
        }),
      });
    } catch { /* swallow — telemetry must not break execution */ }
  }

  const agentSpecs: AgentSpec[] = agentSpecsRaw.map((agent: any) => {
    const rawTask = agent.taskDescription || agent.task || agent.prompt || '';
    const resolvedTask = ctx.interpolateTemplate(rawTask, input);
    const taskWithContext =
      sharedContext && input
        ? `Context: ${typeof input === 'string' ? input : JSON.stringify(input)}\n\nTask: ${resolvedTask}`
        : resolvedTask;
    const resolvedSystemPrompt = agent.systemPrompt
      ? ctx.interpolateTemplate(agent.systemPrompt, input)
      : undefined;
    const model = agent.model && agent.model !== 'auto' ? agent.model : undefined;
    return {
      agentId: agent.agentId || undefined,
      role: agent.role || 'custom',
      task: taskWithContext,
      model,
      tools: Array.isArray(agent.tools) ? agent.tools : [],
      systemPrompt: resolvedSystemPrompt,
      maxTurns: agent.maxTurns ?? 5,
      costBudget: agent.costBudget ?? 50,
      timeout: timeoutMs,
      contract: agent.contract as AgentContract | undefined,
    };
  });

  // Pillar 3 (#53): pre-flight contract.input check per slot.
  // Validates the run-level engine input (which the spec then
  // augments with task/systemPrompt) against each spec's declared
  // input shape. Violations emit telemetry — they don't block.
  for (let i = 0; i < agentSpecs.length; i++) {
    const spec = agentSpecs[i];
    if (!spec.contract?.input) continue;
    const r = validateAgentInput(spec.contract, input);
    if (!r.ok) {
      emitContractViolation(ctx, node.id, i, 'input', r.errors);
      ctx.logger.warn(
        { nodeId: node.id, slot: i, role: spec.role, errors: r.errors },
        '[multi_agent] AgentContract input violation (warning-only)',
      );
    }
  }

  const userMessage =
    typeof input === 'string'
      ? input
      : (input as any)?.message || JSON.stringify(input ?? null);

  const aggregation =
    aggregationStrategy === 'first'
      ? 'first'
      : aggregationStrategy === 'vote'
        ? 'vote'
        : 'merge';

  ctx.logger.info(
    { nodeId: node.id, agentCount: agentSpecs.length, maxConcurrency },
    '[multi_agent] Executing via openagentic-proxy',
  );

  // Resolve openagentic-proxy URL; if not configured, skip directly to fallback.
  let openagenticProxyUrl: string | undefined;
  try {
    openagenticProxyUrl = resolveOpenAgenticProxyUrl(ctx);
  } catch {
    openagenticProxyUrl = undefined;
  }

  if (openagenticProxyUrl) {
    try {
      // OTel GenAI v1.37 — multi_agent orchestrates N sub-agents, so the
      // outer span maps to operation=task_execution. Each child agent's
      // tokens roll up to the parent here. Per-agent spans live inside
      // openagentic-proxy itself (not visible at this layer until /execute-stream
      // surfaces them on the SSE).
      const response = await withGenAISpan(
        {
          operation: 'task_execution',
          system: 'openagentic.platform',
          requestModel: 'auto',
          agentId: `multi_agent:${agentSpecs.length}`,
          agentName: `multi_agent(${orchestrationMode}, ${agentSpecs.length})`,
        },
        async () => {
          const r = await abortableAxiosPost(
            { signal: ctx.signal },
            `${openagenticProxyUrl}/api/agents/execute-sync`,
            {
              agents: agentSpecs,
              orchestration: orchestrationMode,
              aggregation,
              sessionId: ctx.executionId,
              userId: ctx.userId,
              userMessage,
              totalBudgetCents: 200,
              timeoutMs,
              maxConcurrency,
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
              timeout: timeoutMs + 30000,
            },
          );
          const rd = (r.data || {}) as any;
          const m = rd.metrics || {};
          return {
            result: r,
            meta: {
              inputTokens: (m.promptTokens as number | undefined) ?? 0,
              outputTokens: (m.completionTokens as number | undefined) ?? 0,
            },
          };
        },
      );

      if (response.status >= 400) {
        // Surface upstream error before falling back.
        const errMsg =
          response.data?.error ||
          response.data?.message ||
          `openagentic-proxy returned HTTP ${response.status}`;
        throw new Error(errMsg);
      }

      const r = response.data || {};
      const results = Array.isArray(r.results) ? r.results : [];
      // Emit canonical SubAgentCompletedEvent per result so the swarm
      // popover can flip each card to done/failed with its real output
      // preview. Tier A: typed AgenticEvent from @agentic-work/llm-sdk.
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const ok =
          res?.status === 'completed' ||
          res?.status === 'success' ||
          (!!res?.content && !res?.error);
        const taskId =
          (res?.agentId as string | undefined) ||
          (agentSpecsRaw[i]?.agentId as string | undefined) ||
          `${node.id}:slot-${i}`;
        try {
          const toolCalls = Array.isArray(res?.toolCalls) ? res.toolCalls : [];
          const toolsUsed: string[] = toolCalls
            .map((tc: any) =>
              typeof tc?.name === 'string'
                ? tc.name
                : typeof tc?.function?.name === 'string'
                  ? tc.function.name
                  : undefined,
            )
            .filter((n: unknown): n is string => typeof n === 'string');
          ctx.emitNodeProgress?.({
            nodeId: node.id,
            event: buildSubAgentCompleted({
              task_id: taskId,
              ok,
              output: typeof res?.content === 'string' ? res.content.slice(0, 240) : undefined,
              error: typeof res?.error === 'string' ? res.error : undefined,
              turns: typeof res?.turns === 'number' ? res.turns : 1,
              tokens: typeof res?.usage?.total_tokens === 'number' ? res.usage.total_tokens : 0,
              duration_ms: typeof res?.durationMs === 'number' ? res.durationMs : 0,
              tools_used: toolsUsed,
            }),
          });
        } catch { /* swallow */ }
      }
      return {
        source: 'multi_agent',
        content: r.output || '',
        output: r.output || '',
        agents: results,
        agentCount: results.length || agentSpecs.length,
        strategy: aggregationStrategy,
        metrics: r.metrics || {},
      };
    } catch (err: any) {
      // If the abort signal fired, propagate without fallback — the user
      // explicitly cancelled and we shouldn't keep racking up LLM cost.
      if (err?.name === 'CanceledError' || ctx.signal.aborted) {
        throw err;
      }
      ctx.logger.warn(
        { nodeId: node.id, error: err?.message },
        '[multi_agent] openagentic-proxy unavailable, falling back to direct LLM',
      );
      // fall through to fallback path
    }
  }

  // Fallback: direct LLM batch.
  const results: any[] = [];
  for (let i = 0; i < agentSpecs.length; i += maxConcurrency) {
    const batch = agentSpecs.slice(i, i + maxConcurrency);
    const batchOffset = i;
    const batchResults = await Promise.allSettled(
      batch.map(async (spec, batchIdx) => {
        const slot = batchOffset + batchIdx;
        const messages: Array<{ role: string; content: string }> = [];
        if (spec.systemPrompt) {
          messages.push({ role: 'system', content: spec.systemPrompt });
        }
        messages.push({ role: 'user', content: spec.task });

        // Fallback path: each slot is its own chat span (proxy unavailable).
        const res = await withGenAISpan(
          {
            operation: 'chat',
            system: 'openagentic.platform',
            requestModel: spec.model || 'auto',
            maxTokens: 4096,
            agentId: spec.agentId || spec.role,
            agentName: spec.role,
          },
          async () => {
            const r = await abortableAxiosPost(
              { signal: ctx.signal },
              `${ctx.apiUrl}/api/v1/chat/completions`,
              {
                // Honor per-spec model override (#63 per-node model picker).
                // Empty/undefined → 'auto' so Smart Router still works.
                model: spec.model || 'auto',
                messages,
                max_tokens: 4096,
                stream: false,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  ...ctx.getInternalAuthHeaders(),
                  'X-Workflow-Execution': ctx.executionId,
                },
                timeout: timeoutMs,
              },
            );
            const rd = (r.data || {}) as any;
            return {
              result: r,
              meta: {
                responseModel: rd.model as string | undefined,
                responseId: rd.id as string | undefined,
                finishReasons: rd.choices?.[0]?.finish_reason
                  ? [rd.choices[0].finish_reason]
                  : undefined,
                inputTokens: rd.usage?.prompt_tokens as number | undefined,
                outputTokens: rd.usage?.completion_tokens as number | undefined,
              },
            };
          },
        );
        const rawContent = res.data?.choices?.[0]?.message?.content || '';

        // Pillar 3 (#53): post-response contract.output check. We try
        // to parse the LLM output as JSON to compare against the
        // declared shape — non-JSON returns get compared as strings.
        // Violations log + emit telemetry but never block.
        if (spec.contract?.output) {
          let parsed: unknown = rawContent;
          try { parsed = JSON.parse(rawContent); } catch { /* keep raw */ }
          const r = validateAgentOutput(spec.contract, parsed);
          if (!r.ok) {
            emitContractViolation(ctx, node.id, slot, 'output', r.errors);
            ctx.logger.warn(
              { nodeId: node.id, slot, role: spec.role, errors: r.errors },
              '[multi_agent] AgentContract output violation (warning-only)',
            );
          }
        }

        return {
          agentId: spec.agentId || spec.role,
          role: spec.role,
          status: 'completed',
          content: rawContent,
          usage: res.data?.usage,
        };
      }),
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({
          status: 'failed',
          error: (r as any).reason?.message || 'Agent failed',
        });
      }
    }
  }

  const aggregated = results
    .map((r) => r.content || '')
    .filter(Boolean)
    .join('\n\n---\n\n');

  return {
    source: 'multi_agent_fallback',
    content: aggregated,
    output: aggregated,
    agents: results,
    agentCount: results.length,
    strategy: aggregationStrategy,
  };
}
