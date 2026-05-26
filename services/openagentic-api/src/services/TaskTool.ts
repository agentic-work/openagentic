/**
 * TaskTool — sub-agent dispatch for chatmode.
 *
 * Mirrors Anthropic's `AgentTool` (Task) at
 * `/home/trent/anthropic/src/tools/AgentTool/AgentTool.tsx`. The model
 * picks a specialized sub-agent from a description-driven catalog; each
 * sub-agent runs in its own ReAct loop with a filtered tool list and
 * its own system prompt. NO enum gate, NO regex post-filter — the tool
 * description IS the routing.
 *
 * REPLACES: today's `delegate_to_agents` JSON-enum dispatch + the
 * regex-based `delegationGating.ts`.
 *
 * REUSES (does not replace):
 *   - the legacy per-agent ReAct execution primitive (slated for
 *     replacement by chatLoop recursion in Phase E.8.d-g). The Task tool
 *     currently wraps it via `deps.runSubagent` — the wrapper stays as-is.
 *   - `listAgentsFromDb()` — Option B (2026-05-13) DB-backed canonical
 *     agent registry (`prisma.agent`). Replaced markdown-only
 *     `getBuiltInAgents()` so admin-created custom agents are immediately
 *     dispatchable from chatmode Task.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRegistryEntry {
  agent_type: string;
  display_name: string;
  description: string;
}

export interface TaskInput {
  /** Short (3-5 word) human description of the task. */
  description: string;
  /** The full prompt the sub-agent will receive verbatim. */
  prompt: string;
  /**
   * #844 (2026-05-14) — schema-required justification. Every Task call
   * must self-report why a sub-agent dispatch is warranted. Server-side
   * validator rejects unjustified calls. Capability-agnostic gate that
   * forces the model to articulate (and thereby checks against trivial
   * single-tool queries that should call the tool directly).
   */
  multi_step_justification?: import('./TaskJustificationValidator.js').MultiStepJustification;
  /** Which built-in sub-agent to dispatch. Defaults to 'general-purpose'. */
  subagent_type?: string;
  /**
   * Optional model override for the sub-agent's loop. Free-form string
   * matching a deployed Registry model id. The Task tool does NOT bias
   * the schema toward Anthropic family names — that historical bias
   * trained the LLM to dispatch with `model: "sonnet"` even on clusters
   * that only serve gpt-5.x or gemini-* (live capture 2026-05-01: AIF-
   * only deploy timed out because no provider served `sonnet`). Omit to
   * fall through to the agent definition's preference and finally the
   * parent turn's default chat model.
   */
  model?: string;
  /** Run the sub-agent in the background (returns immediately). */
  run_in_background?: boolean;
  /**
   * S3 — pre-registered output schema name. When set, executeTask
   * validates the sub-agent's final assistant output as JSON against
   * the named schema (from `taskOutputSchemas.ts`). On failure, the
   * TaskResult carries `schema_violation` so the parent agent can
   * decide whether to retry or surface the error to the user.
   * Cognition's diverging-implicit-decisions failure mode rationale:
   * see services/taskOutputSchemas.ts header.
   */
  output_schema_name?: string;
}

export interface SubagentSpec {
  /** Maps to AgentRegistry.agent_type. */
  role: string;
  /** Verbatim prompt for the sub-agent. */
  prompt: string;
  /** Short description used in NDJSON frames + UI cards. */
  description: string;
  /** Optional model override (any deployed Registry model id, or undefined). */
  model?: string;
  /** Background flag forwarded to the orchestrator. */
  background?: boolean;
  /** Inherited from the parent turn for audit + RLS. */
  parentSessionId?: string;
  parentUserId?: string;
}

export interface SubagentRunResult {
  ok: boolean;
  output?: string;
  error?: string;
  turns: number;
  tokens: number;
  durationMs: number;
  toolsUsed: string[];
}

/**
 * A2 — pluggable sub-agent transcript store. When TaskDeps.traceStore is
 * present, executeTask persists the full sub-agent transcript + final
 * output keyed by an opaque handle, and surfaces the handle on the
 * TaskResult so the parent agent can `read_subagent_trace(handle)` later
 * if it needs to recover from a confusing summary. Cognition's "share
 * full traces" principle (https://cognition.ai/blog/dont-build-multi-agents).
 *
 * Implementations: LargeResultStorageService in prod; in-memory Map in
 * tests; null/undefined to disable (back-compat).
 */
export interface TraceStore {
  store(payload: {
    sessionId?: string;
    userId?: string;
    role: string;
    prompt: string;
    output?: string;
    stats: { turns: number; tokens: number; durationMs: number; toolsUsed: string[] };
    error?: string;
  }): Promise<{ handle: string }>;
}

export interface TaskDeps {
  /**
   * Returns the canonical sub-agent registry (markdown built-ins +
   * DB-managed entries via `listAgentsFromSOT`).
   */
  listSubagentTypes: () => Promise<AgentRegistryEntry[]>;
  /**
   * Wraps the legacy orchestrator's `runSubagentReActLoop` for a single
   * sub-agent. Returns the structured result the model can read back.
   *
   * SEV-0 fix 2026-04-30 — `parentCtx` is the live v2 ctx of the parent
   * turn. The chat-side runner uses it to build a ctx-aware
   * `executeMcpTool` callback that injects Azure-AD OBO headers
   * (Authorization, X-Azure-ID-Token, X-AWS-ID-Token, X-User-Email,
   * X-User-Id) on every sub-agent MCP tool call. Optional for
   * back-compat with callers that don't carry a ctx.
   */
  runSubagent: (
    spec: SubagentSpec,
    parentCtx?: any,
  ) => Promise<SubagentRunResult>;
  /** A2 — optional trace store. See TraceStore JSDoc above. */
  traceStore?: TraceStore;
}

export interface TaskResult {
  ok: boolean;
  output?: string;
  error?: string;
  /** Stats forwarded from the sub-agent so the model can see what happened. */
  stats?: {
    turns: number;
    tokens: number;
    durationMs: number;
    toolsUsed: string[];
  };
  /**
   * S3 — when input.output_schema_name was set and validation failed,
   * carries the concatenated error string. Parent agent can choose to
   * retry the dispatch with a clarifying prompt or surface to the user.
   */
  schema_violation?: string;
  /**
   * S3 — when input.output_schema_name was set and validation passed,
   * carries the parsed JSON object. Saves the parent agent from having
   * to JSON.parse(output) itself.
   */
  data?: unknown;
  /**
   * A2 — opaque handle pointing to the persisted sub-agent transcript.
   * Present when deps.traceStore is configured. Parent agent passes
   * this to `read_subagent_trace(handle)` to retrieve the full
   * transcript for debug / recovery / merging with sibling sub-agents.
   */
  trace_handle?: string;
}

interface TaskContext {
  emit: (frameType: string, payload: unknown) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
  /**
   * A2 (2026-05-12) — parent tool_use_id (the Task call's own id, NOT
   * a per-sub-agent id). Task can fan out multiple sub-agents from one
   * call; every sub_agent_started / sub_agent_completed frame carries
   * `parent_tool_use_id` so the UI's SubAgentCard binds under the
   * correct Task card. Populated by chatLoop on the dispatch ctx.
   */
  toolUseId?: string;
}

// ---------------------------------------------------------------------------
// Description builder
// ---------------------------------------------------------------------------

const HEADER = [
  'Dispatch a specialized sub-agent to handle a focused task. Each sub-agent',
  'runs in its own ReAct loop with its own filtered tool set and system',
  'prompt. The sub-agent returns a single structured result you can use to',
  'compose your response.',
  '',
  'USE WHEN:',
  '- the task is genuinely multi-step AND benefits from a dedicated context',
  '  (e.g., audit IAM drift across multiple AWS accounts; reconcile naming',
  '   conventions across a fleet of subscriptions; trace a pod\'s network',
  '   path through a VNet by chaining 6+ tool calls).',
  '- a specialist agent has tools or expertise the main loop lacks',
  '  (e.g., `code_execution` for sandbox-running scripts).',
  '- you want to run independent sub-tasks in parallel',
  '  (call this tool multiple times in one turn).',
  '',
  "DO NOT USE for:",
  '- "show me" / "list " / single-list / single-pull queries — call the',
  '  cloud tool directly yourself (e.g. `azure_cost_query`,',
  '  `aws_cost_summary`, `gcp_query_cost_usage`, `azure_list_subscriptions`).',
  '  The main loop has the SAME tool surface the sub-agent does;',
  '  delegating one tool call wastes a full ReAct loop.',
  '- single-step factual questions you can answer directly with a tool',
  '  call + a sentence.',
  '- visual rendering — call `compose_visual` / `render_artifact` instead.',
  '- asking the user a question — call `request_clarification` instead.',
  '',
  'RULE: if the user prompt fits "show me X" or "list X" or "what is my X",',
  'you MUST call the relevant tool directly. Sub-agent dispatch is reserved',
  'for genuine multi-step audit / drift / cross-account / chained-reasoning',
  'work where a dedicated context window pays for itself.',
  '',
  'AVAILABLE SUB-AGENT TYPES (pick the closest match):',
].join('\n');

const FOOTER = [
  '',
  'PICKING A SUBAGENT TYPE — DISCOVERY-FIRST (Sev-1 #837 anti-anchor rule):',
  '  1. If you already know which agent matches from the AVAILABLE list above,',
  '     pass its `agent_type` as `subagent_type`. The names you see there are',
  '     the only valid values.',
  '  2. If you are uncertain, call `agent_search({query: "..."})` FIRST to',
  '     get 3-5 ranked candidates with descriptions, then call `Task` with',
  '     the best match.',
  '  3. If you omit `subagent_type` entirely, the request routes to',
  '     `general-purpose` (same tool surface as the main loop).',
  '  4. To run different specialists in parallel, emit MULTIPLE `Task`',
  '     tool_use blocks in the SAME assistant turn with DIFFERENT',
  '     `subagent_type` values — the runtime dispatches them concurrently.',
  '',
  'EXAMPLE A — single specialist for a focused audit:',
  '  Task({',
  '    description: "IAM drift audit",',
  '    prompt: "Enumerate every AWS account in the org, fetch the IAM policy",',
  '             attached to each Admin role, diff against the canonical baseline,",',
  '             return a structured findings report with drift class + remediation.",',
  '    subagent_type: "<pick from AVAILABLE list above — e.g. the cloud / infra agent>",',
  '  })',
  '',
  'EXAMPLE B — parallel fan-out across DIFFERENT specialists (one assistant turn):',
  '  // Three Task blocks emitted together → runtime runs them concurrently.',
  '  Task({ description: "data-shape check", prompt: "...",',
  '         subagent_type: "<the data-analysis agent>" })',
  '  Task({ description: "code-quality check", prompt: "...",',
  '         subagent_type: "<the code-execution agent>" })',
  '  Task({ description: "deploy validation", prompt: "...",',
  '         subagent_type: "<the validation agent>" })',
  '',
  'DO NOT pin every Task call to the same `subagent_type`. The right agent is',
  'task-shaped, not fixed. When unsure, prefer `agent_search` over guessing.',
].join('\n');

/**
 * Build the `Task` tool description from the live agent registry. Called
 * once per turn during tool-array assembly so admins editing the agent
 * registry see their changes immediately.
 */
export async function buildTaskToolDescription(
  agents: AgentRegistryEntry[] | undefined | null,
): Promise<string> {
  // #927 (2026-05-18) — defensive guard: if the caller's listAgents()
  // rejected and the promise resolved to undefined/null, fall through to
  // the no-agents-registered branch instead of crashing the Task tool
  // description build with `TypeError: Cannot read properties of undefined
  // (reading 'length')` (which then bubbles up as a sub-agent dispatch
  // failure the model can't recover from).
  if (!Array.isArray(agents) || agents.length === 0) {
    return HEADER + '\n  (no specialized agents registered yet — use `general-purpose`)\n' + FOOTER;
  }
  const rows = agents
    .map(a => `- "${a.agent_type}" (${a.display_name}): ${a.description}`)
    .join('\n');
  return HEADER + '\n' + rows + FOOTER;
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

/**
 * Static `Task` tool schema. The description is replaced at runtime via
 * `buildTaskToolDescription(await listSubagentTypes())` — we keep a
 * static fallback here so the schema is type-safe + the description
 * passes the ≥200-char rubric even with no agents registered.
 */
export const TASK_TOOL = {
  type: 'function',
  function: {
    name: 'Task',
    description: HEADER + '\n  (run-time list injected at dispatch)\n' + FOOTER,
    /** #1110 — input_examples reach the wire via AWSBedrockProvider's
     * description inlining (#1112). The examples below show parallel
     * fan-outs with DISTINCT per-Task descriptions so the model learns
     * to vary the label rather than repeating one across all parallel
     * blocks (which collapses the UI cards to a single label). */
    input_examples: [
      {
        description: 'Azure IAM audit',
        prompt: 'List every Azure subscription. For each, list role assignments. Identify principals with Owner or User Access Administrator across >1 subscription. Return JSON findings array.',
        subagent_type: 'cloud_operations',
        multi_step_justification: {
          tool_count_estimate: 6,
          requires_dedicated_context: true,
          why: 'enumerate subs → enumerate role assignments per sub → group by principal → flag cross-scope owners',
          single_tool_alternative: 'none — requires chained reads across N subscriptions',
        },
      },
      {
        description: 'AWS IAM audit',
        prompt: 'List every AWS account in the org. For each, list IAM users/roles with AdministratorAccess. Identify principals with cross-account admin. Return JSON findings array.',
        subagent_type: 'cloud_operations',
        multi_step_justification: {
          tool_count_estimate: 5,
          requires_dedicated_context: true,
          why: 'enumerate accounts → enumerate IAM principals per account → group by principal → flag cross-account admins',
          single_tool_alternative: 'none — requires chained reads across N accounts',
        },
      },
      {
        description: 'GCP IAM audit',
        prompt: 'List every GCP project. For each, fetch the IAM policy. Identify principals with roles/owner across >1 project. Return JSON findings array.',
        subagent_type: 'cloud_operations',
        multi_step_justification: {
          tool_count_estimate: 5,
          requires_dedicated_context: true,
          why: 'enumerate projects → fetch IAM policy per project → group by principal → flag cross-project owners',
          single_tool_alternative: 'none — requires chained reads across N projects',
        },
      },
    ],
    parameters: {
      type: 'object',
      required: ['description', 'prompt', 'multi_step_justification'],
      properties: {
        description: {
          type: 'string',
          description:
            'A short (3-5 word) human-readable label for THIS specific ' +
            'sub-task. Shown verbatim in the UI sub-agent card title. ' +
            '#1110 — when emitting MULTIPLE parallel Task blocks in one ' +
            'turn, each MUST have a DISTINCT description naming its ' +
            'specific scope: "Azure IAM audit", "AWS IAM audit", "GCP IAM ' +
            'audit" — NEVER repeat the same description across parallel ' +
            'Task calls or all cards collide on one label.',
        },
        prompt: {
          type: 'string',
          description:
            'The full prompt the sub-agent will receive verbatim. Be ' +
            'specific: tell the sub-agent what to do, what tools to ' +
            'prefer, and what shape the result should take.',
        },
        multi_step_justification: {
          type: 'object',
          required: [
            'tool_count_estimate',
            'requires_dedicated_context',
            'why',
            'single_tool_alternative',
          ],
          description:
            'REQUIRED. Structured justification for dispatching a sub-agent. ' +
            'Server validates this BEFORE dispatch — calls that admit a ' +
            'single direct tool answers the question, or estimate <3 tool ' +
            'calls, or report no need for dedicated context, are REJECTED ' +
            'with a tool_result asking the model to call the direct tool ' +
            'instead. (#844)\n' +
            'Rule of thumb: if you are answering "show me X" / "list X" / ' +
            '"what is my X" — you should not be dispatching a sub-agent.',
          properties: {
            tool_count_estimate: {
              type: 'integer',
              minimum: 3,
              description:
                'How many distinct tool calls do you estimate the sub-agent ' +
                'will make? Sub-agent dispatch is reserved for genuine 3+ ' +
                'tool chains. If this is 1 or 2, call the tools directly.',
            },
            requires_dedicated_context: {
              type: 'boolean',
              description:
                'Does this task genuinely need a fresh ReAct loop with its ' +
                'own context window? Set false if the main loop can handle ' +
                'it in-line.',
            },
            why: {
              type: 'string',
              description:
                'One sentence (≥20 chars) explaining why the dedicated ' +
                'sub-agent context is needed.',
            },
            single_tool_alternative: {
              type: ['string', 'null'],
              description:
                'If a single direct tool COULD answer this in one call, ' +
                'NAME IT here (e.g. "azure_list_subscriptions"). Otherwise ' +
                'null. The server REJECTS the dispatch when this is non-null ' +
                '— honesty is rewarded by letting you call the direct tool ' +
                'instead of wasting a sub-agent loop.',
            },
          },
        },
        subagent_type: {
          type: 'string',
          description:
            'Which specialized sub-agent to dispatch. See AVAILABLE ' +
            'SUB-AGENT TYPES above. Omit for general-purpose.',
        },
        model: {
          type: 'string',
          description:
            'Optional model override for the sub-agent. Free-form string. ' +
            'Omit to fall through to the agent definition\'s preferred ' +
            'model and finally the parent turn\'s default. Do NOT default ' +
            'to "sonnet"/"opus"/"haiku" — that biases the dispatch toward ' +
            'Anthropic family names regardless of which providers the ' +
            'platform actually has deployed.',
        },
        run_in_background: {
          type: 'boolean',
          description:
            'Run the sub-agent asynchronously and return immediately ' +
            'with a tracking id. The result is delivered as a separate ' +
            'NDJSON frame later in the session.',
        },
        output_schema_name: {
          type: 'string',
          description:
            "Optional. When set, the sub-agent's final output is " +
            "validated as JSON against the named pre-registered shape. " +
            "On validation failure the TaskResult carries " +
            "`schema_violation`; on success it carries parsed `data`. " +
            'Use to enforce same-shape outputs across parallel sub-agents ' +
            'so merging stays consistent. Available schemas: ' +
            'cloud_resource_listing, cost_analysis, security_finding, ' +
            'migration_plan.',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Name-match
// ---------------------------------------------------------------------------

const ALIAS_NAMES = new Set<string>([
  'Task',
  'task',
  'TASK',
  'subagent',
  'agent_task',
]);

export function isTaskTool(name: string): boolean {
  return ALIAS_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Dispatch a sub-agent. Validates input, builds a SubagentSpec, calls
 * deps.runSubagent (which wraps the legacy orchestrator),
 * emits sub_agent_started/completed NDJSON frames, returns a structured
 * result the model can use.
 *
 * NO regex-classify of the prompt. NO post-filter of tools. The
 * sub-agent's tool whitelist comes from its registry definition; the
 * orchestrator handles the loop.
 */
export async function executeTask(
  ctx: TaskContext,
  input: TaskInput,
  deps: TaskDeps,
): Promise<TaskResult> {
  // Validate.
  if (typeof input?.description !== 'string' || input.description.trim().length === 0) {
    return {
      ok: false,
      error: 'description is required (a short 3-5 word label).',
    };
  }
  if (typeof input?.prompt !== 'string' || input.prompt.trim().length === 0) {
    return {
      ok: false,
      error: 'prompt is required (the full task description for the sub-agent).',
    };
  }

  // #844 (2026-05-14) — schema-required multi_step_justification.
  // Capability-agnostic gate. Reject dispatches the model itself admits
  // are single-tool queries, or that lack a fresh-context need, or that
  // can be answered by a single direct tool. Pure structural check on
  // the model's self-reported signals — NO regex on user prompt, NO
  // model-tier match.
  {
    const { validateMultiStepJustification } = await import('./TaskJustificationValidator.js');
    const v = validateMultiStepJustification(input.multi_step_justification);
    if (!v.ok) {
      ctx.logger.info(
        {
          reason: v.error,
          tool_count_estimate: input.multi_step_justification?.tool_count_estimate,
          single_tool_alternative: input.multi_step_justification?.single_tool_alternative,
          directToolHint: v.directToolHint ?? null,
          description: input.description,
        },
        '[Task] dispatch REJECTED by multi_step_justification validator (#844)',
      );
      return {
        ok: false,
        error: v.error ?? 'Task dispatch rejected: invalid multi_step_justification',
      };
    }
  }

  const role = input.subagent_type?.trim() || 'general-purpose';

  const spec: SubagentSpec = {
    role,
    prompt: input.prompt,
    description: input.description,
    model: input.model,
    background: input.run_in_background ?? false,
    parentSessionId: ctx.sessionId,
    parentUserId: ctx.userId,
  };

  ctx.logger.info({
    role,
    description: input.description,
    background: spec.background,
    model: spec.model ?? null,
    promptBytes: input.prompt.length,
  }, '[Task] dispatching sub-agent');

  // A2 (2026-05-12) — parent_tool_use_id binds every sub-agent frame
  // back to the Task call's tool_use_id. Resolved once at the top of
  // the function so error + success paths share the same value.
  const parentToolUseId = ctx.toolUseId ?? null;

  ctx.emit('sub_agent_started', {
    role,
    description: input.description,
    model: spec.model ?? null,
    session_id: ctx.sessionId ?? null,
    parent_tool_use_id: parentToolUseId,
  });

  let runResult: SubagentRunResult;
  try {
    // SEV-0 fix 2026-04-30 — propagate parent ctx so the runner can
    // build OBO-aware MCP tool callback for the sub-agent's ReAct loop.
    runResult = await deps.runSubagent(spec, ctx);
  } catch (err: any) {
    const errorMessage = err?.message ?? String(err);
    ctx.logger.error({ role, error: errorMessage }, '[Task] sub-agent threw');
    ctx.emit('sub_agent_completed', {
      role,
      ok: false,
      error: errorMessage,
      turns: 0,
      tokens: 0,
      durationMs: 0,
      parent_tool_use_id: parentToolUseId,
    });
    return { ok: false, error: errorMessage };
  }

  ctx.emit('sub_agent_completed', {
    role,
    ok: runResult.ok,
    error: runResult.error ?? null,
    turns: runResult.turns,
    tokens: runResult.tokens,
    durationMs: runResult.durationMs,
    toolsUsed: runResult.toolsUsed,
    // Phase 16 — surface the sub-agent's actual return content so the UI's
    // SubAgentCard cm-sa-return strip shows real outcome instead of the
    // stale "X turns Y tok" stats-string.
    output: runResult.output,
    parent_tool_use_id: parentToolUseId,
  });

  // A2 — persist transcript if a store is configured. Best-effort:
  // a store failure must NOT block the model from receiving the result.
  let traceHandle: string | undefined;
  if (deps.traceStore) {
    try {
      const stored = await deps.traceStore.store({
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        role,
        prompt: input.prompt,
        output: runResult.output,
        stats: {
          turns: runResult.turns,
          tokens: runResult.tokens,
          durationMs: runResult.durationMs,
          toolsUsed: runResult.toolsUsed,
        },
        error: runResult.error,
      });
      traceHandle = stored.handle;
    } catch (err) {
      ctx.logger.warn(
        { role, err: (err as Error).message },
        '[Task] traceStore.store failed — continuing without trace_handle',
      );
    }
  }

  const statsOut = {
    turns: runResult.turns,
    tokens: runResult.tokens,
    durationMs: runResult.durationMs,
    toolsUsed: runResult.toolsUsed,
  };

  if (!runResult.ok) {
    return {
      ok: false,
      error: runResult.error ?? 'sub-agent failed without an explicit error',
      stats: statsOut,
      ...(traceHandle ? { trace_handle: traceHandle } : {}),
    };
  }

  // S3 — schema validation when caller requested it.
  if (input.output_schema_name) {
    // Lazy import to keep TaskTool's hot path import-light when no schema
    // validation is requested.
    const { validateTaskOutput } = await import('./taskOutputSchemas.js');
    const validation = validateTaskOutput(runResult.output ?? '', input.output_schema_name);
    if (!validation.ok) {
      ctx.logger.warn(
        { role, schema: input.output_schema_name, errors: validation.errors },
        '[Task] sub-agent output failed schema validation',
      );
      return {
        ok: false,
        output: runResult.output ?? '',
        error: 'sub-agent output failed schema validation',
        schema_violation: (validation.errors ?? []).join('; '),
        stats: statsOut,
        ...(traceHandle ? { trace_handle: traceHandle } : {}),
      };
    }
    return {
      ok: true,
      output: runResult.output ?? '',
      data: validation.data,
      stats: statsOut,
      ...(traceHandle ? { trace_handle: traceHandle } : {}),
    };
  }

  return {
    ok: true,
    output: runResult.output ?? '',
    stats: statsOut,
    ...(traceHandle ? { trace_handle: traceHandle } : {}),
  };
}
