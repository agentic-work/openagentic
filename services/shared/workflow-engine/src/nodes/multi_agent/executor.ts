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
  buildAgentProxyUserAuth,
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

  // ── Topic resolution (regression: Multi-Agent Research Team exec 55c3698c) ──
  // The dispatched agents MUST receive the real research topic. Two failure
  // modes were observed live: (a) per-agent `taskDescription` resolved empty
  // because a save round-trip stripped it, leaving only { agentId, role }; (b)
  // the node carries a topic but the agent got only a JSON "Context:" blob
  // (which the model ignored, emitting "No task provided"). We resolve a single
  // canonical topic string from the node config and the run input so each
  // agent's task is always non-empty and grounded.
  const resolveTopicSignal = (): string => {
    // 1) Node-level topic/task/prompt config (interpolated).
    const nodeTopicRaw =
      (typeof data.topic === 'string' && data.topic) ||
      (typeof data.task === 'string' && data.task) ||
      (typeof data.prompt === 'string' && data.prompt) ||
      '';
    const nodeTopic = nodeTopicRaw
      ? ctx.interpolateTemplate(nodeTopicRaw, input).trim()
      : '';
    if (nodeTopic) return nodeTopic;
    // 2) Run input — bare string, or a `topic`/`message`/`input`/`query` field.
    if (typeof input === 'string' && input.trim()) return input.trim();
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      for (const key of ['topic', 'message', 'input', 'query', 'question', 'text']) {
        const v = obj[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }
    // 3) Last resort: let {{trigger.topic}} resolve through the engine. The
    //    engine interpolator reads its own execContext (not `input`), so this
    //    recovers the run-level topic even when `input` doesn't carry it.
    const fromTrigger = ctx.interpolateTemplate('{{trigger.topic}}', input).trim();
    return fromTrigger;
  };
  const topicSignal = resolveTopicSignal();

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
    let resolvedTask = ctx.interpolateTemplate(rawTask, input).trim();

    // GUARANTEE A REAL TASK (regression exec 55c3698c). When the per-agent
    // task resolved empty — stripped on a save round-trip, or a template var
    // that resolved to '' — synthesize a topic-bearing instruction from the
    // node/run topic + the agent's role so the spawned agent is NEVER handed a
    // bare placeholder ("Complete the assigned task" → "No task provided").
    if (!resolvedTask) {
      const role = (agent.role || 'researcher').replace(/_/g, ' ');
      resolvedTask = topicSignal
        ? `As the ${role}, investigate the following topic thoroughly and report substantive findings. Use available tools to ground your work in real data. Topic: ${topicSignal}`
        : `As the ${role}, complete your part of the team's task and report substantive findings.`;
    } else if (
      topicSignal &&
      // The interpolated task ended with a dangling "Topic:" (or "Topic :")
      // label and no value — the {{trigger.topic}} var resolved to '' upstream.
      // Append the recovered topic so the instruction is grounded.
      /\btopic\s*:?\s*$/i.test(resolvedTask)
    ) {
      resolvedTask = `${resolvedTask.replace(/\btopic\s*:?\s*$/i, '').trimEnd()}\nTopic: ${topicSignal}`;
    }

    // HARD GUARANTEE (#1273 follow-up — live exec 65ddacec): even after the two
    // recoveries above, the resolved task can STILL be topic-less when the
    // interpolator silently dropped {{trigger.topic}} somewhere OTHER than a
    // trailing "Topic:" label (mid-sentence template var, alternate phrasing,
    // or a stochastic round-trip). The live symptom was all 3 agents replying
    // verbatim "There is no user query yet… we don't know the assigned task"
    // even though the node input carried `{ topic: "…CRISPR…" }`. The model
    // never saw the topic because (a) the topic string was absent from the
    // task and (b) the only grounding was a leading JSON `Context:` blob the
    // model ignored. We therefore FORCE the resolved topic into the task string
    // whenever we have a topicSignal and it isn't already present — so no agent
    // can be dispatched topic-less regardless of how interpolation behaved.
    if (topicSignal && !resolvedTask.includes(topicSignal)) {
      resolvedTask = `${resolvedTask}\n\nTopic to work on: ${topicSignal}`;
    }

    // HOIST THE TOPIC TO THE LEAD (live exec 8229c47a). The previous fixes
    // guaranteed the topic was PRESENT in the task string — but live, the topic
    // trailed a 4-part run-on instruction, surfacing only ~149 chars in, and was
    // then duplicated in a JSON `Reference context` blob. gpt-oss anchors on the
    // START of the user turn; a topic buried mid-instruction does not register
    // as "what am I working on." So when we have a real topicSignal we PREPEND an
    // explicit, unmissable single-line header carrying the topic, so the very
    // first line the model reads is the subject — BEFORE any role boilerplate.
    // The original role instruction (which already contains the topic) and the
    // shared-context blob follow.
    const topicHeader =
      topicSignal && !/^\s*(research\s+)?topic\s*:/i.test(resolvedTask)
        ? `RESEARCH TOPIC: ${topicSignal}\n\n`
        : '';

    // Lead with the topic header + explicit instruction so the model reads WHAT
    // to do (and on what subject) FIRST (gpt-oss treated a leading `Context:`
    // JSON blob as "no real query", AND treated a trailing "Topic:" clause as
    // skippable). The shared-context object is appended AFTER the task as
    // reference material, not before it.
    const taskWithContext =
      sharedContext && input
        ? `${topicHeader}Task: ${resolvedTask}\n\nReference context (shared run input): ${
            typeof input === 'string' ? input : JSON.stringify(input)
          }`
        : `${topicHeader}${resolvedTask}`;
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
              // #1275 run-as-user attribution: thread the run-user's bearer +
              // email into the body so each dispatched sub-agent's tool calls are
              // attributed to the user. OSS is local-auth only — no OBO ID-token
              // forwarding; cloud MCPs use their own service-account credentials.
              ...buildAgentProxyUserAuth(ctx),
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
      const rawResults = Array.isArray(r.results) ? r.results : [];

      // Normalize each openagentic-proxy result to the canonical shape the rest
      // of the platform reads. #1262: the openagentic-proxy `AgentResult`
      // contract (services/openagentic-proxy AgentRunner.ts) is
      //   { agentId, role, status: 'success'|'error'|'timeout'|…,
      //     output: string, toolCallsExecuted: [{name,success,durationMs}],
      //     metrics: { inputTokens, outputTokens, durationMs, … }, error? }.
      // It carries NO `content`, NO `usage`, NO top-level `durationMs`, and
      // NO `toolCalls`. The prior mapping read all of those undefined fields
      // — so per-agent content was dropped from `agents[]` (downstream
      // merge/synthesize read `agents[].content` → empty → refusal) and the
      // swarm card always showed 0 tokens / 0 duration / no output preview.
      // Confirmed live 2026-06-02 against execution 335b3f85 + a direct
      // openagentic-proxy probe returning `results[i].output`.
      //
      // We surface `output` as BOTH `output` and `content` (back-compat with
      // any consumer reading either), keep the original fields intact, and
      // fall back to the legacy field names so older fixtures / a future
      // proxy revision still map cleanly.
      const results = rawResults.map((res: any) => {
        const content =
          typeof res?.content === 'string'
            ? res.content
            : typeof res?.output === 'string'
              ? res.output
              : '';
        return { ...res, content, output: res?.output ?? content };
      });

      // Emit canonical SubAgentCompletedEvent per result so the swarm
      // popover can flip each card to done/failed with its real output
      // preview. Tier A: typed AgenticEvent from @agentic-work/llm-sdk.
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const raw = rawResults[i] || {};
        const ok =
          res?.status === 'completed' ||
          res?.status === 'success' ||
          (!!res?.content && !res?.error);
        const taskId =
          (res?.agentId as string | undefined) ||
          (agentSpecsRaw[i]?.agentId as string | undefined) ||
          `${node.id}:slot-${i}`;
        try {
          // Real contract: `toolCallsExecuted: [{name,success,durationMs}]`.
          // Legacy fallback: `toolCalls: [{name|function.name}]`.
          const toolCalls = Array.isArray(raw?.toolCallsExecuted)
            ? raw.toolCallsExecuted
            : Array.isArray(raw?.toolCalls)
              ? raw.toolCalls
              : [];
          const toolsUsed: string[] = toolCalls
            .map((tc: any) =>
              typeof tc?.name === 'string'
                ? tc.name
                : typeof tc?.function?.name === 'string'
                  ? tc.function.name
                  : undefined,
            )
            .filter((n: unknown): n is string => typeof n === 'string');
          // Real contract: metrics.{inputTokens,outputTokens,durationMs}.
          // Legacy fallback: usage.total_tokens + top-level durationMs.
          const m = (raw?.metrics || {}) as Record<string, unknown>;
          const tokens =
            typeof raw?.usage?.total_tokens === 'number'
              ? raw.usage.total_tokens
              : (typeof m.inputTokens === 'number' ? m.inputTokens : 0) +
                (typeof m.outputTokens === 'number' ? m.outputTokens : 0);
          const durationMs =
            typeof m.durationMs === 'number'
              ? m.durationMs
              : typeof raw?.durationMs === 'number'
                ? raw.durationMs
                : 0;
          ctx.emitNodeProgress?.({
            nodeId: node.id,
            event: buildSubAgentCompleted({
              task_id: taskId,
              ok,
              output:
                typeof res?.content === 'string' && res.content.length > 0
                  ? res.content.slice(0, 240)
                  : undefined,
              error: typeof res?.error === 'string' ? res.error : undefined,
              turns: typeof raw?.turns === 'number' ? raw.turns : 1,
              tokens,
              duration_ms: durationMs,
              tools_used: toolsUsed,
            }),
          });
        } catch { /* swallow */ }
      }
      // P0 typed-IO contract: fold the per-agent results into a top-level
      // primary `content`/`output` so {{steps.X.output}} (schema.primary=content)
      // resolves to the swarm's meaningful synthesis. Mirrors agent_single /
      // agent_pool. Previously this returned `r.output || ''` ONLY — so when the
      // openagentic-proxy returned per-agent `results[].output` but NO top-level
      // `output` (the documented multi_agent contract gap), the canonical
      // content/output were EMPTY and the next node received nothing even though
      // the swarm did real work. Now: prefer the proxy's top-level aggregate;
      // else join each agent's normalized content with the merge separator.
      const aggregatedContent =
        typeof r.output === 'string' && r.output.length > 0
          ? r.output
          : results
              .map((res: any) => (typeof res?.content === 'string' ? res.content : ''))
              .filter(Boolean)
              .join('\n\n---\n\n');
      return {
        source: 'multi_agent',
        content: aggregatedContent,
        output: aggregatedContent,
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
