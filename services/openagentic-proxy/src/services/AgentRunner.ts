import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { SecurityAnalyzer, type RiskLevel } from './SecurityAnalyzer';
import { CostTracker } from './CostTracker';
import { MCPBridge } from '../tools/MCPBridge';
import { logger } from '../utils/logger';
import { getRedis } from '../utils/redis';
import {
  projectFlowToolToOpenAi,
  buildFlowToolMap,
  isFlowTool,
  type FlowToolSchema,
} from '../tools/flowTools';

/**
 * Platform tools that run WITHOUT per-user OBO (web search, tool/agent
 * discovery, image gen, memorize). These are safe to run for a flow-dispatched
 * agent that has no run-user token. Everything else is treated as an OBO tool:
 * a flow-dispatched agent (flowContext present) with NO run-user token calling
 * one of those MUST fail fast with a clear, actionable error — NEVER silently
 * fall back to the platform service principal (#1275).
 */
const PLATFORM_NON_OBO_TOOLS = new Set<string>([
  'web_search',
  'web_news_search',
  'web_fetch',
  'url_fetch',
  'tool_search',
  'agent_search',
  'agent_list',
  'pattern_recall',
  'request_clarification',
  'generate_image',
  'memorize',
]);

/** True when the tool is a platform tool that runs without per-user OBO. */
export function isPlatformNonOboTool(toolName: string): boolean {
  if (!toolName) return false;
  return PLATFORM_NON_OBO_TOOLS.has(toolName.toLowerCase());
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentSpec {
  agentId?: string;
  role: string;
  task: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  systemPrompt?: string;
  maxTurns?: number;
  costBudget?: number;
  timeout?: number;
  delegationAllowed?: boolean;
  subAgentConfig?: {
    maxDepth: number;
    maxSubAgents: number;
    allowedRoles: string[];
  };
}

export interface AgentResult {
  agentId: string;
  role: string;
  status: 'success' | 'error' | 'timeout' | 'budget_exceeded' | 'loop_detected';
  output: string;
  toolCallsExecuted: Array<{ name: string; success: boolean; durationMs: number }>;
  metrics: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    durationMs: number;
    costCents: number;
    modelUsed: string;
    fallbackUsed: boolean;
    toolCallRounds: number;
  };
  error?: string;
}

export interface RunContext {
  userId: string;
  sessionId?: string;
  userToken?: string;
  authMethod: string;
  userGroups: string[];
  isAdmin: boolean;
  availableTools?: any[];
  executionId: string;
  depth?: number; // Current delegation depth (for sub-agent spawning)
  // GAP-2: full session conversation history + user identity so sub-agents
  // know who they're working for and what's been discussed.
  sessionMessages?: Array<{ role: string; content: string }>;
  userDisplayName?: string;
  userEmail?: string;
  // sliderPosition removed 0.6.7 — intelligence slider ripped. Model is
  // now decided by TieredFunctionCalling + admin defaults; sub-agents
  // inherit the chat's resolved model.
  userMessage?: string; // The current user request that triggered delegation
  flowContext?: {
    flowId?: string;
    flowName?: string;
    nodes?: any[];
    edges?: any[];
    lastExecution?: {
      status?: string;
      nodeResults?: Record<string, any>;
    };
  };
}

type EmitFn = (event: string, data: any) => void;

// ─── Tool Loop Detection (inspired by OpenClaw) ────────────────────────────
// Four independent detectors to catch different loop patterns:
// 1. Generic repeat: same tool+args called repeatedly
// 2. No-progress: tool called with same args, same result
// 3. Ping-pong: alternating between two tools
// 4. Circuit breaker: hard cap on total tool calls

interface ToolCallRecord {
  name: string;
  argsHash: string;
  resultHash: string;
  timestamp: number;
}

class ToolLoopDetector {
  private history: ToolCallRecord[] = [];
  private static readonly WINDOW_SIZE = 30;
  private static readonly REPEAT_WARN = 3;
  private static readonly REPEAT_BLOCK = 5;
  private static readonly CIRCUIT_BREAKER = 25;

  record(name: string, args: Record<string, any>, result: string): void {
    this.history.push({
      name,
      argsHash: this.hash(JSON.stringify(args)),
      resultHash: this.hash(result.substring(0, 500)),
      timestamp: Date.now(),
    });
    if (this.history.length > ToolLoopDetector.WINDOW_SIZE) {
      this.history.shift();
    }
  }

  check(): { blocked: boolean; reason?: string } {
    // Circuit breaker
    if (this.history.length >= ToolLoopDetector.CIRCUIT_BREAKER) {
      return { blocked: true, reason: `Circuit breaker: ${this.history.length} tool calls in window` };
    }

    if (this.history.length < 3) return { blocked: false };

    // Generic repeat: same tool+args N times
    const last = this.history[this.history.length - 1];
    const repeats = this.history.filter(h => h.name === last.name && h.argsHash === last.argsHash).length;
    if (repeats >= ToolLoopDetector.REPEAT_BLOCK) {
      return { blocked: true, reason: `Tool '${last.name}' called ${repeats} times with same args` };
    }

    // No-progress: same tool+args+result (tool isn't returning new info)
    const noProgress = this.history.filter(h =>
      h.name === last.name && h.argsHash === last.argsHash && h.resultHash === last.resultHash
    ).length;
    if (noProgress >= ToolLoopDetector.REPEAT_WARN + 1) {
      return { blocked: true, reason: `Tool '${last.name}' returning same result — no progress` };
    }

    // Ping-pong: alternating between two tools
    if (this.history.length >= 6) {
      const recent = this.history.slice(-6);
      const pattern1 = recent.filter((_, i) => i % 2 === 0).every(h => h.name === recent[0].name);
      const pattern2 = recent.filter((_, i) => i % 2 === 1).every(h => h.name === recent[1].name);
      if (pattern1 && pattern2 && recent[0].name !== recent[1].name) {
        return { blocked: true, reason: `Ping-pong detected between '${recent[0].name}' and '${recent[1].name}'` };
      }
    }

    return { blocked: false };
  }

  private hash(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h.toString(36);
  }
}

// ─── Default prompts ────────────────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
  reasoning: 'You are a deep reasoning agent. Analyze the problem thoroughly, consider multiple angles, and provide well-reasoned conclusions.',
  data_query: 'You are a data query specialist. Extract, filter, and return structured data efficiently. Be precise and concise.',
  tool_orchestration: 'You are a tool orchestration agent. Determine which tools to call and in what order to accomplish the task. Think step-by-step.',
  summarization: 'You are a summarization specialist. Distill complex information into clear, concise summaries.',
  code_execution: 'You are a code execution agent. Write, run, and debug code to solve the given task.',
  planning: 'You are a planning agent. Break down complex tasks into clear steps, identify dependencies, and create actionable plans.',
  validation: 'You are a validation agent. Verify outputs, check for errors, and ensure results meet requirements.',
  synthesis: 'You are a synthesis agent. Combine information from multiple sources into a coherent, complete response.',
  custom: 'You are a specialized agent. Complete the assigned task using available tools.',
};

// Default max delegation depth (overridden by per-agent max_spawn_depth from DB)
// Set to 1: agents spawned by openagentic-proxy should NOT sub-delegate (prevents stacking orchestrator blocks)
const DEFAULT_MAX_DELEGATION_DEPTH = 1;

// ─── AgentRunner ────────────────────────────────────────────────────────────

export class AgentRunner {
  private securityAnalyzer: SecurityAnalyzer;
  private costTracker: CostTracker;
  private mcpBridge: MCPBridge;
  private apiUrl: string;
  /**
   * HITL approval timeout in ms. Default 120s — overridable per-execution by the
   * spawn request (HITL-C: single source of truth from DB hitl_policy via the
   * API). Loaded lazily from the API at constructor time.
   */
  private hitlTimeoutMs: number = 300_000; // 5 min default — complex multi-tool requests need time for user review

  constructor(
    mcpBridge: MCPBridge,
    costTracker: CostTracker,
    apiUrl: string
  ) {
    this.securityAnalyzer = new SecurityAnalyzer();
    this.costTracker = costTracker;
    this.mcpBridge = mcpBridge;
    this.apiUrl = apiUrl;
    // Fire-and-forget: pull the canonical HITL timeout from the API. If it
    // fails (API not yet up), we use the default and try again next request.
    this.refreshHitlTimeoutFromApi().catch(() => {});
  }

  /**
   * HITL-C: pull the canonical HITL timeout from the API's DB-backed hitl_policy
   * so the sub-agent and the inline chat ReAct loop wait for the same duration.
   * Cached for the process lifetime; restart openagentic-proxy to refresh.
   */
  private async refreshHitlTimeoutFromApi(): Promise<void> {
    try {
      const internalSecret = process.env.INTERNAL_SERVICE_SECRET || '';
      const headers: Record<string, string> = { 'x-request-from': 'openagentic-proxy' };
      if (internalSecret) headers['x-internal-secret'] = internalSecret;
      const res = await axios.get(`${this.apiUrl}/api/internal/hitl/policy`, {
        headers,
        timeout: 3000,
      });
      if (res.status === 200 && typeof res.data?.timeoutMs === 'number') {
        this.hitlTimeoutMs = res.data.timeoutMs;
        logger.info({ hitlTimeoutMs: this.hitlTimeoutMs }, '[AgentRunner] Loaded HITL timeout from API');
      }
    } catch (err: any) {
      logger.debug({ err: err?.message }, '[AgentRunner] Could not pull HITL policy from API — using default 120s');
    }
  }

  async run(
    spec: AgentSpec & { agentId: string; model: string; maxTurns: number; timeout: number; systemPrompt: string },
    emit: EmitFn,
    ctx: RunContext
  ): Promise<AgentResult> {
    const startTime = Date.now();
    let modelUsed = spec.model;
    let fallbackUsed = false;

    // Intelligence slider was ripped in 0.6.7. Agents now inherit the
    // parent chat's resolved model (TFC-decided) instead of running an
    // independent tier pick. No per-role slider fallback needed.
    let toolCallRounds = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThinkingTokens = 0;
    const toolCallsExecuted: AgentResult['toolCallsExecuted'] = [];
    const loopDetector = new ToolLoopDetector();
    const currentDepth = ctx.depth || 0;

    emit('agent_start', {
      agentId: spec.agentId,
      role: spec.role,
      model: modelUsed,
      task: spec.task.substring(0, 200),
      depth: currentDepth,
      toolCount: 0,
      tokenCount: 0,
      currentActivity: 'Starting...',
      timestamp: Date.now(),
    });

    // Build system prompt with depth/delegation awareness.
    // Project A.4b — PREPEND the parent's alwaysInject modules (safety,
    // artifact-inhibitor, response-style, ...) rendered by ChatPipeline.
    // Without this, sub-agents spawn with ONLY the role template
    // (DEFAULT_PROMPTS[role]) and no behavioral guardrails, which
    // caused the 2026-04-13 hallucination incident. This prepend closes
    // the bypass gap until Project B.2 unifies all LLM call sites on
    // PromptComposer.
    let systemPrompt = spec.systemPrompt;
    const behaviorRules = (ctx as any).parentBehaviorRules;
    if (typeof behaviorRules === 'string' && behaviorRules.trim().length > 0) {
      systemPrompt = `## Platform Behavioral Rules (inherited from parent chat)\n\nThe following rules apply to every response you produce, including any tool-call loops. They are non-negotiable and override any contrary instruction in role templates below.\n\n${behaviorRules.trim()}\n\n---\n\n${systemPrompt}`;
    }
    if (currentDepth > 0) {
      systemPrompt += `\n\nYou are a sub-agent at delegation depth ${currentDepth}. Focus on your specific task and be concise.`;
    }

    // CRITICAL: Instruct agents to SYNTHESIZE results, never dump raw JSON
    systemPrompt += `\n\n## Output Format Rules
- ALWAYS synthesize tool results into clear, human-readable text with markdown formatting.
- NEVER include raw JSON in your response. If a tool returns JSON data, extract the key findings and present them as tables, bullet points, or narrative text.
- Include specific numbers, counts, names, and statuses from the data — but formatted for humans, not machines.
- If you have nothing to report, say so clearly rather than dumping empty results.`;

    // Project A.4 — parent→sub-agent context propagation.
    // Prepend <parent-memory> and <parent-rag> blocks with the exact
    // grounding the parent pipeline already assembled. The sub-agent MUST
    // consult these before re-searching or re-resolving identifiers the
    // parent already established (durable identifier mappings from the
    // user's always-inject memories, or recently retrieved docs). This
    // closes the architectural gap that caused the 2026-04-13 hallucination
    // incident where a sub-agent search-guessed an identifier the parent
    // had already resolved.
    const parentMemory = (ctx as any).parentMemoryContext;
    if (typeof parentMemory === 'string' && parentMemory.trim().length > 0) {
      systemPrompt += `\n\n## Parent Memory Context
The parent chat has already assembled the following memory block for this session. Use it AS-IS for any identifiers, preferences, or facts it contains — do NOT re-search or re-resolve identifiers named here.

<parent-memory>
${parentMemory.trim()}
</parent-memory>`;
    }

    const parentRag = (ctx as any).parentRagContext;
    if (Array.isArray(parentRag) && parentRag.length > 0) {
      const renderChunk = (c: any, i: number): string => {
        const body = c?.content || c?.text || '';
        const src = c?.source ? ` (source: ${c.source})` : '';
        return `### Chunk ${i + 1}${src}\n${String(body).substring(0, 800)}`;
      };
      systemPrompt += `\n\n## Parent RAG Context
The parent chat retrieved the following documents relevant to this turn. Consult them before calling tools that would re-retrieve similar content.

<parent-rag>
${parentRag.slice(0, 3).map((c: any, i: number) => renderChunk(c, i)).join('\n\n')}
</parent-rag>`;
    }

    // GAP-2: inject session context into the system prompt so the sub-agent
    // knows WHO the user is. This is identity-level info — small, always relevant.
    const userIdentity: string[] = [];
    if (ctx.userDisplayName) userIdentity.push(`Name: ${ctx.userDisplayName}`);
    if (ctx.userEmail) userIdentity.push(`Email: ${ctx.userEmail}`);
    if (userIdentity.length > 0) {
      systemPrompt += `\n\n## User you are working for\n${userIdentity.join('\n')}\nAddress them by name when appropriate. Their preferences and prior conversation are in the message history below.`;
    }

    // Inject flow context if present (for Flows Agent)
    const flowContext = (ctx as any).flowContext;
    if (flowContext) {
      let flowSection = `\n\n## Currently Open Flow\n**${flowContext.flowName || 'Untitled'}** (${flowContext.flowId || 'unknown'})\n`;
      if (flowContext.nodes?.length) {
        flowSection += `${flowContext.nodes.length} nodes | ${flowContext.edges?.length || 0} connections\n\n### Nodes:\n`;
        for (const node of flowContext.nodes) {
          const label = node.data?.label || node.id;
          const configKeys = Object.keys(node.data || {}).filter((k: string) => !['label', 'icon', 'color'].includes(k));
          const configSummary = configKeys.length > 0 ? ` {${configKeys.join(', ')}}` : '';
          flowSection += `- [${node.id}] ${node.type} "${label}"${configSummary}\n`;
        }
      }
      if (flowContext.edges?.length) {
        flowSection += `\n### Connections:\n`;
        for (const edge of flowContext.edges) {
          flowSection += `- ${edge.source} -> ${edge.target}${edge.label ? ` (${edge.label})` : ''}\n`;
        }
      }
      if (flowContext.lastExecution) {
        flowSection += `\n### Last Execution:\nStatus: ${flowContext.lastExecution.status || 'unknown'}`;
        if (flowContext.lastExecution.nodeResults) {
          const failed = Object.entries(flowContext.lastExecution.nodeResults)
            .filter(([, r]: [string, any]) => r.status === 'error' || r.error);
          if (failed.length > 0) {
            flowSection += `\nFailed nodes:\n`;
            for (const [nodeId, result] of failed) {
              flowSection += `- ${nodeId}: ${(result as any).error || 'unknown error'}\n`;
            }
          }
        }
      }
      systemPrompt += flowSection;
    }

    // GAP-2: include the session conversation history so the sub-agent has full
    // context (user identity, established preferences, prior turns, etc.). Without
    // this, sub-agents only see their isolated `task` string and can't reference
    // anything the user said earlier. We inject as historical user/assistant turns
    // followed by a clear delimiter, then the actual delegated task.
    const messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (ctx.sessionMessages && ctx.sessionMessages.length > 0) {
      // Replay the session history. Cap at the last 12 turns to keep token cost bounded;
      // the orchestrator should already have done a similar cap on its side.
      const history = ctx.sessionMessages.slice(-12);
      for (const m of history) {
        // Only forward user/assistant text; skip tool/system messages from the parent session
        if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()) {
          messages.push({ role: m.role, content: m.content });
        }
      }
      // Inject a clear delimiter so the sub-agent knows what's prior context vs the
      // delegated task it's supposed to actually perform. Without this, models tend
      // to respond to the most recent user turn instead of the delegation task.
      messages.push({
        role: 'system',
        content: '---\nThe above is the prior conversation in this session. Use it for context (user identity, preferences, what has been discussed). DO NOT respond to those prior messages — your actual job is the specific delegated task below.',
      });
    }

    messages.push({ role: 'user', content: spec.task });

    // Filter available tools to agent's whitelist
    let agentTools = ctx.availableTools || [];
    if (spec.tools && spec.tools.length > 0) {
      const allowed = new Set(spec.tools.map(t => t.toLowerCase()));
      agentTools = agentTools.filter((tool: any) => {
        const name = (tool.function?.name || tool.name || '').toLowerCase();
        return allowed.has(name);
      });
    }

    // Role-based default tool filtering — prevent sending 100+ MCP tools to roles that don't need them.
    // LLM providers reject or timeout when tool definitions exceed context limits (~270KB for 167 tools).
    //
    // GAP-3: artifact_creation needs more than just generate_image. To create real
    // artifacts (HTML textbooks, dashboards, reports) it also needs:
    //   - synth_synthesize: run Python to compute data, render charts, generate SVG
    //   - web_search/web_fetch: gather facts to put in the artifact
    //   - generate_image: produce images to embed
    // The artifact's HTML body itself comes from the LLM's text output, so no tool
    // needed for that — but data + visualizations + research need tools.
    const ROLE_TOOL_DEFAULTS: Record<string, string[]> = {
      artifact_creation: ['generate_image', 'synth_synthesize', 'web_search', 'web_fetch'],
      summarization: [],  // No tools needed
      validation: [],
      synthesis: [],
    };
    if ((!spec.tools || spec.tools.length === 0) && ROLE_TOOL_DEFAULTS[spec.role] !== undefined) {
      const defaultTools = ROLE_TOOL_DEFAULTS[spec.role];
      if (defaultTools.length === 0) {
        agentTools = []; // Role doesn't use tools
      } else {
        const allowed = new Set(defaultTools.map(t => t.toLowerCase()));
        agentTools = agentTools.filter((tool: any) => {
          const name = (tool.function?.name || tool.name || '').toLowerCase();
          return allowed.has(name);
        });
      }
      logger.info({ role: spec.role, toolCount: agentTools.length, defaultTools }, 'Applied role-based tool filter');
    }

    // Remove delegate_to_agents if depth limit reached or delegation not allowed.
    // Per-agent max_spawn_depth from DB overrides default; spec.subAgentConfig.maxDepth
    // is a runtime override.
    //
    // SUPERVISOR PATTERN (v0.6.1): cloud_operations ALLOWS one level of recursion
    // so a supervisor agent can fan out to N worker agents across subscription
    // batches when processing 100+ subs. Enforcement:
    //   - depth 0 (top-level cloud_operations) → can spawn children   (supervisor)
    //   - depth 1 (cloud_operations worker)    → CANNOT spawn children (leaf)
    //   - depth 2+                             → impossible by construction
    // This is capped at exactly 1 level so an LLM can't accidentally start an
    // infinite supervisor → supervisor → supervisor → ... chain.
    const CLOUD_OPS_SUPERVISOR_MAX_DEPTH = 1;
    const isCloudOpsSupervisor = spec.role === 'cloud_operations';
    const cloudOpsAtLeafDepth = isCloudOpsSupervisor && currentDepth >= CLOUD_OPS_SUPERVISOR_MAX_DEPTH;
    const maxDepth = isCloudOpsSupervisor
      ? CLOUD_OPS_SUPERVISOR_MAX_DEPTH
      : (spec.subAgentConfig?.maxDepth ?? (spec as any).maxSpawnDepth ?? DEFAULT_MAX_DELEGATION_DEPTH);
    if (cloudOpsAtLeafDepth || currentDepth >= maxDepth || spec.delegationAllowed === false) {
      const before = agentTools.length;
      agentTools = agentTools.filter((tool: any) => tool.function?.name !== 'delegate_to_agents');
      if (before !== agentTools.length) {
        logger.info({
          role: spec.role,
          reason:
            cloudOpsAtLeafDepth ? 'cloud-ops-leaf-worker' :
            spec.delegationAllowed === false ? 'spec-disallowed' :
            'depth-limit',
          currentDepth,
          maxDepth,
          before,
          after: agentTools.length,
        }, '[AgentRunner] Stripped delegate_to_agents from sub-agent tool list');
      }
    }

    // Inject workflow CRUD tools for Flows Agent when flowContext is present
    if (flowContext?.workflowId) {
      const workflowTools = [
        { type: 'function', function: { name: 'read_workflow', description: 'Read the full workflow definition (nodes, edges, config)', parameters: { type: 'object', properties: { flowId: { type: 'string', description: 'Workflow ID' } }, required: ['flowId'] } } },
        { type: 'function', function: { name: 'update_workflow', description: 'Update a workflow by replacing its nodes and edges', parameters: { type: 'object', properties: { flowId: { type: 'string' }, definition: { type: 'object', description: 'New definition with nodes[] and edges[]' } }, required: ['flowId', 'definition'] } } },
        { type: 'function', function: { name: 'execute_workflow', description: 'Execute a workflow and return the execution ID', parameters: { type: 'object', properties: { flowId: { type: 'string' }, input: { type: 'object', description: 'Input data for the trigger node' } }, required: ['flowId'] } } },
        { type: 'function', function: { name: 'get_execution_log', description: 'Get node-by-node execution results for a completed workflow run', parameters: { type: 'object', properties: { flowId: { type: 'string' }, executionId: { type: 'string' } }, required: ['flowId', 'executionId'] } } },
      ];
      agentTools = [...agentTools, ...workflowTools];
    }

    // V1.1 flow_tool — inject user's saved flows tagged 'agent-tool' as
    // dynamic per-turn tools. One round-trip to api at agent start; the
    // routing map is consulted in the tool-dispatch switch below.
    const flowToolMap = await this.loadUserFlowTools(ctx, (tools) => {
      agentTools = [...agentTools, ...tools.map(projectFlowToolToOpenAi)];
    });

    // Global image gen cap per execution (shared across all agents in the same execution)
    // Uses RunContext to track across sub-agents — prevents 15+ images from sub-delegation
    if (!(ctx as any)._globalImageGenCount) (ctx as any)._globalImageGenCount = 0;
    let imageGenCount = (ctx as any)._globalImageGenCount;
    try {
      for (let turn = 0; turn <= spec.maxTurns; turn++) {
        logger.info({ event: 'agent_step', executionId: ctx.executionId, agentId: spec.agentId, step: turn, action: 'turn_start', elapsed_ms: Date.now() - startTime }, 'Agent turn started');

        // Timeout check
        if (Date.now() - startTime > spec.timeout) {
          emit('agent_complete', {
            agentId: spec.agentId, role: spec.role, status: 'timeout',
            metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            timestamp: Date.now(),
          });
          return this.buildResult(spec, 'timeout', this.getLastAssistantContent(messages), toolCallsExecuted, {
            inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
            modelUsed, fallbackUsed, toolCallRounds,
          }, 'Agent timed out');
        }

        // Budget check
        if (this.costTracker.isAgentBudgetExceeded(spec.agentId)) {
          emit('agent_complete', {
            agentId: spec.agentId, role: spec.role, status: 'budget_exceeded',
            metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            timestamp: Date.now(),
          });
          return this.buildResult(spec, 'budget_exceeded', this.getLastAssistantContent(messages) || 'Budget exceeded', toolCallsExecuted, {
            inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
            modelUsed, fallbackUsed, toolCallRounds,
          });
        }

        // Tool loop check
        const loopCheck = loopDetector.check();
        if (loopCheck.blocked) {
          logger.warn({ agentId: spec.agentId, reason: loopCheck.reason }, 'Tool loop detected, stopping agent');
          emit('agent_complete', {
            agentId: spec.agentId, role: spec.role, status: 'loop_detected',
            error: loopCheck.reason,
            metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            timestamp: Date.now(),
          });
          return this.buildResult(spec, 'loop_detected', this.getLastAssistantContent(messages), toolCallsExecuted, {
            inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
            modelUsed, fallbackUsed, toolCallRounds,
          }, `Loop detected: ${loopCheck.reason}`);
        }

        // LLM completion (non-streaming for agents)
        const response = await this.callLLM(modelUsed, messages, agentTools, ctx);

        // Track tokens (support both OpenAI and Anthropic usage field names)
        if (response.usage) {
          const inputToks = response.usage.input_tokens || response.usage.prompt_tokens || 0;
          const outputToks = response.usage.output_tokens || response.usage.completion_tokens || 0;
          totalInputTokens += inputToks;
          totalOutputTokens += outputToks;
          const thinkingToks = response.usage.thinking_tokens || response.usage.cache_read_input_tokens || 0;
          totalThinkingTokens += thinkingToks;
          this.costTracker.track(spec.agentId, modelUsed, inputToks, outputToks);

          // Emit agent_thinking if thinking tokens are present
          if (thinkingToks > 0) {
            emit('agent_thinking', {
              executionId: ctx.executionId,
              agentId: spec.agentId,
              tokens: thinkingToks,
              durationMs: 0,
              timestamp: new Date().toISOString(),
            });
          }
        }

        const choice = response.choices?.[0];
        if (!choice) break;

        const content = choice.message?.content || '';
        const toolCalls = choice.message?.tool_calls;

        if (content) {
          emit('agent_stream', { agentId: spec.agentId, content, timestamp: Date.now() });
        }

        // No tool calls = done
        if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === 'stop') {
          messages.push({ role: 'assistant', content });
          logger.info({ event: 'agent_step', executionId: ctx.executionId, agentId: spec.agentId, step: turn, action: 'complete', status: 'success', elapsed_ms: Date.now() - startTime }, 'Agent completed');
          emit('agent_complete', {
            agentId: spec.agentId, role: spec.role, status: 'success',
            output: content.substring(0, 500),
            metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            timestamp: Date.now(),
          });
          return this.buildResult(spec, 'success', content, toolCallsExecuted, {
            inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
            modelUsed, fallbackUsed, toolCallRounds,
          });
        }

        // Handle tool calls
        toolCallRounds++;
        messages.push({ role: 'assistant', content: content || '', tool_calls: toolCalls });

        for (const tc of toolCalls) {
          const toolName = tc.function?.name || '';
          let args: Record<string, any> = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}

          emit('agent_tool_call', {
            agentId: spec.agentId, toolName,
            args: JSON.stringify(args).substring(0, 200),
            toolCount: toolCallsExecuted.length + 1,
            tokenCount: totalInputTokens + totalOutputTokens,
            currentActivity: this.describeToolActivity(toolName, args),
            timestamp: Date.now(),
          });

          // Security check — sub-agent tool calls go through the same HITL flow as
          // the inline chat ReAct loop. The emitted event (`mcp_approval_required`)
          // is the SAME event the chat UI's ToolApprovalPopup component listens for.
          // The Redis pub/sub relay forwards it through to the chat SSE stream.
          //
          // The cloud-ops-hitl-denial prompt module tells the LLM how to react to a
          // denial: do not retry, do not try a workaround tool, ask the user how to
          // proceed.
          const risk = this.securityAnalyzer.assess(toolName, args);
          if (risk.requiresApproval) {
            const requestId = `agent-hitl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            // Subscribe FIRST, then emit, then wait. This avoids the race where
            // the user clicks Approve in the gap between emit and subscribe.
            // armApprovalListener returns a promise that resolves on the published
            // result, AND it emits the SSE event after the subscription is fully
            // attached so the chat UI never sees the popup before we're listening.
            let approvalDecision = 'denied';
            let approvedBy: string | undefined;
            try {
              const approval = await this.armApprovalListenerAndEmit(
                requestId,
                this.hitlTimeoutMs,
                () => {
                  emit('mcp_approval_required', {
                    requestId,
                    agentId: spec.agentId,
                    executionId: ctx.executionId,
                    toolName,
                    serverName: undefined, // sub-agent doesn't always know the source server
                    arguments: args,
                    riskLevel: risk.level,
                    reason: risk.reason,
                    timeoutMs: this.hitlTimeoutMs,
                    source: 'openagentic-proxy',
                    timestamp: Date.now(),
                  });
                }
              );
              approvalDecision = approval.decision;
              approvedBy = approval.approvedBy;
              logger.info({ agentId: spec.agentId, toolName, requestId, decision: approvalDecision, approvedBy }, 'Approval received for tool call');
            } catch (approvalErr: any) {
              logger.warn({ agentId: spec.agentId, toolName, requestId, err: approvalErr.message }, 'Approval wait failed or timed out — denying tool call');
            }
            if (approvalDecision !== 'approved') {
              messages.push({
                role: 'tool',
                content:
                  `Tool call '${toolName}' was DENIED by the human approver (risk: ${risk.level}). ` +
                  `Reason: ${risk.reason}. ` +
                  `Decision: ${approvalDecision}. ` +
                  `IMPORTANT: Do NOT retry this tool. Do NOT try a workaround tool that achieves the ` +
                  `same effect. Tell the user clearly what you wanted to do and ask how they want ` +
                  `to proceed (different parameters, skip this step, abort the task).`,
                tool_call_id: tc.id,
              });
              toolCallsExecuted.push({ name: toolName, success: false, durationMs: 0 });
              loopDetector.record(toolName, args, `DENIED:approval:${approvalDecision}`);
              continue;
            }
            // Approved — fall through to execute the tool
          }

          // Execute tool -- workflow CRUD tools handled internally, others via MCP proxy
          const toolStart = Date.now();
          const authHeaders = this.buildAuthHeaders(ctx);
          let result: any;

          const WORKFLOW_TOOLS = ['read_workflow', 'update_workflow', 'execute_workflow', 'get_execution_log'];
          if (toolName === 'generate_image') {
            // Cap image generation at 3 per agent — qwen3.5 generates 10+ otherwise
            imageGenCount++;
            (ctx as any)._globalImageGenCount = imageGenCount;
            if (imageGenCount > 3) {
              result = { result: 'Image generation limit reached (max 3 per execution). Use the images already generated.' };
            } else {
              result = await this.executeImageGeneration(args, ctx, logger);
              // Emit the image inline to the SSE stream so user sees it immediately
              if (!result.error && result.result) {
                const urlMatch = result.result.match(/Image URL: (\/api\/images\/[^\s]+)/);
                if (urlMatch) {
                  emit('agent_image_generated', {
                    agentId: spec.agentId,
                    imageUrl: urlMatch[1],
                    prompt: args.prompt?.substring(0, 100) || '',
                    imageNumber: imageGenCount,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          } else if (WORKFLOW_TOOLS.includes(toolName)) {
            // Handle workflow CRUD tools via direct HTTP to API
            result = await this.executeWorkflowTool(toolName, args, ctx);
          } else if (isFlowTool(toolName, flowToolMap)) {
            // V1.1 flow_tool — dispatch to the wrapped saved flow.
            result = await this.executeFlowToolInvocation(
              flowToolMap.get(toolName)!,
              toolName,
              args,
              ctx,
            );
          } else if (
            // ── RUN-AS-USER HONESTY GUARD (#1275) ──
            // A flow-dispatched agent (flowContext present) that has NO run-user
            // token (async/scheduled run with no stored owner token) must NOT
            // call a cloud/OBO MCP tool as the platform service principal — that
            // would silently attribute the user's cloud action to a service
            // identity (wrong RBAC + wrong audit attribution). Fail fast with a
            // clear, actionable error. Platform non-OBO tools (web_search /
            // tool_search / generate_image / memorize) still proceed.
            !!(ctx as any).flowContext &&
            !ctx.userToken &&
            !isPlatformNonOboTool(toolName)
          ) {
            result = {
              toolName,
              toolCallId: `mcp_${toolName}_${Date.now()}`,
              result: null,
              error:
                `run-as-user token unavailable for this scheduled run — the tool '${toolName}' ` +
                `requires acting on behalf of the user (OBO), but no user credential is available. ` +
                `Re-run this flow interactively (so your Azure AD token is attached), or have the ` +
                `flow owner sign in to refresh their stored token, or configure a service credential ` +
                `for '${toolName}'. The platform will NOT run this cloud action as a service principal.`,
              executionTimeMs: 0,
            };
            logger.warn(
              {
                executionId: ctx.executionId,
                agentId: spec.agentId,
                toolName,
                flowId: (ctx as any).flowContext?.flowId,
              },
              'run-as-user OBO token missing for flow-dispatched agent — refusing cloud tool (no SP substitution)',
            );
          } else {
            result = await this.mcpBridge.callTool(toolName, args, authHeaders);
          }
          const toolDuration = Date.now() - toolStart;

          const resultContent = result.error
            ? `Error: ${result.error}`
            : (typeof result.result === 'string' ? result.result : JSON.stringify(result.result));

          messages.push({ role: 'tool', content: resultContent, tool_call_id: tc.id });
          toolCallsExecuted.push({ name: toolName, success: !result.error, durationMs: toolDuration });

          // Record for loop detection
          loopDetector.record(toolName, args, resultContent);

          logger.info({ event: 'agent_step', executionId: ctx.executionId, agentId: spec.agentId, step: turn, action: 'tool_call', tool: tc.function?.name, elapsed_ms: Date.now() - startTime }, 'Agent tool call executed');

          emit('agent_tool_result', {
            agentId: spec.agentId, toolName,
            success: !result.error,
            durationMs: toolDuration,
            resultPreview: resultContent.substring(0, 500),
            toolArgs: typeof args === 'string' ? (args as string).substring(0, 500) : JSON.stringify(args || {}).substring(0, 500),
            toolCount: toolCallsExecuted.length,
            tokenCount: totalInputTokens + totalOutputTokens,
            currentActivity: result.error ? `${toolName} failed` : `${toolName} done`,
            timestamp: Date.now(),
          });
        }

        // CONTINUATION PROMPT: After all tool results, remind the LLM to keep going
        // This prevents agents from stopping after one round of tool calls
        if (turn < spec.maxTurns - 1) {
          messages.push({
            role: 'system',
            content: 'Review the tool results above. Is your assigned task FULLY complete? ' +
              'If there are more steps needed, call the next tool immediately. ' +
              'Only provide a final text response when ALL work is done.',
          });
        }
      }

      // Max turns reached — return whatever we have
      const finalContent = this.getLastAssistantContent(messages) || 'Agent reached maximum tool call rounds.';
      logger.info({ event: 'agent_step', executionId: ctx.executionId, agentId: spec.agentId, step: spec.maxTurns, action: 'complete', status: 'max_turns', elapsed_ms: Date.now() - startTime }, 'Agent completed');
      emit('agent_complete', {
        agentId: spec.agentId, role: spec.role, status: 'success',
        output: finalContent.substring(0, 500),
        metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        timestamp: Date.now(),
      });
      return this.buildResult(spec, 'success', finalContent, toolCallsExecuted, {
        inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
        modelUsed, fallbackUsed, toolCallRounds,
      });

    } catch (error: any) {
      logger.error({ agentId: spec.agentId, error: error.message }, 'AgentRunner: agent failed');
      emit('agent_complete', {
        agentId: spec.agentId, role: spec.role,
        status: 'error', error: error.message,
        metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        timestamp: Date.now(),
      });
      return this.buildResult(spec, 'error', '', toolCallsExecuted, {
        inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
        modelUsed, fallbackUsed, toolCallRounds,
      }, error.message);
    }
  }

  /**
   * Generate human-readable activity description from tool name + args (Claude Code style)
   */
  private describeToolActivity(toolName: string, args: Record<string, any>): string {
    const name = toolName.toLowerCase();
    // Image generation
    if (name === 'generate_image') {
      const prompt = args.prompt?.substring(0, 60) || '';
      return prompt ? `Generating image: ${prompt}...` : 'Generating image...';
    }
    // Web search
    if (name.includes('search') || name.includes('web_search')) {
      return `Searching: ${args.query?.substring(0, 60) || args.q?.substring(0, 60) || ''}...`;
    }
    // Azure/AWS/GCP cost queries
    if (name.includes('cost') || name.includes('billing') || name.includes('spend')) {
      return `Querying ${name.replace(/_/g, ' ')}...`;
    }
    // Kubernetes
    if (name.startsWith('k8s_') || name.includes('kubectl')) {
      return `Querying Kubernetes: ${name.replace(/^k8s_/, '')}...`;
    }
    // GitHub
    if (name.startsWith('github_')) {
      return `Querying GitHub: ${name.replace(/^github_/, '')}...`;
    }
    // Generic: "Using tool_name..."
    const displayName = toolName.replace(/_/g, ' ');
    return `Using ${displayName}...`;
  }

  private getLastAssistantContent(messages: Array<{ role: string; content: string }>): string {
    const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
    return lastAssistant?.content || '';
  }

  private async callLLM(model: string, messages: any[], tools: any[], ctx: RunContext): Promise<any> {
    // Call the API's OpenAI-compatible endpoint for LLM completions
    // Auth strategy: Use internal service auth (X-Request-From + X-Internal-Secret)
    // This allows openagentic-proxy to call the API as a trusted internal service.
    // Falls back to user token or API key if internal secret not configured.
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Proxy': 'true',
    };

    if (internalSecret) {
      // Internal service-to-service auth — send as both header styles
      // API tokenValidator checks Authorization: Bearer or X-API-Key, not X-Internal-Secret
      headers['X-Request-From'] = 'openagentic-proxy';
      headers['X-Internal-Secret'] = internalSecret;
      // ALSO send as Authorization: Bearer so API tokenValidator accepts it
      headers['Authorization'] = `Bearer ${internalSecret}`;
      // oa_ covers user keys; oa_sys_ covers system/inter-service tokens (a prefix of oa_)
      if (internalSecret.startsWith('oa_')) {
        headers['X-API-Key'] = internalSecret;
      }
    } else {
      // Fallback: use user token or configured API key
      const authToken = ctx.userToken
        || process.env.OPENAGENTIC_PROXY_API_KEY
        || process.env.FLOWISE_INTERNAL_API_KEY;

      if (!authToken) {
        throw new Error('No auth token available for LLM call. Set INTERNAL_SERVICE_SECRET or OPENAGENTIC_PROXY_API_KEY or provide userToken.');
      }

      // Always use Authorization: Bearer for API auth (tokenValidator checks this header)
      headers['Authorization'] = `Bearer ${authToken}`;
      // oa_ covers user keys; oa_sys_ covers system/inter-service tokens (a prefix of oa_)
      if (authToken.startsWith('oa_')) {
        headers['X-API-Key'] = authToken; // Also send as X-API-Key when the token is an oa_ platform key
      }
    }

    // Enable thinking for Claude models (Bedrock or direct Anthropic)
    const isThinkingModel = model.includes('claude') || model.includes('anthropic');

    // slider_position removed in 0.6.7 — the /api/chat/completions and
    // /v1/messages endpoints no longer honor it. Model is resolved via
    // TFC + admin defaults upstream.
    const requestBody: Record<string, any> = {
      model,
      messages,
      temperature: isThinkingModel ? 1 : 0.3, // Claude thinking requires temperature=1
      max_tokens: 8192,
      tools: tools.length > 0 ? tools : undefined,
      stream: false,
    };

    if (isThinkingModel) {
      requestBody.thinking = { type: 'enabled', budget_tokens: 10000 };
    }

    // Retry on transient LLM provider errors (503 Service Unavailable,
    // 429 Rate Limited). Without this, a single Ollama/AIF hiccup kills
    // the entire sub-agent run and surfaces as "No agents completed".
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${this.apiUrl}/api/v1/chat/completions`,
          requestBody,
          {
            headers,
            timeout: 300000, // 5 min for complex artifacts with thinking
          }
        );
        return response.data;
      } catch (err: any) {
        const status = err.response?.status;
        if ((status === 503 || status === 429) && attempt < MAX_RETRIES) {
          const backoff = (attempt + 1) * 2000; // 2s, 4s
          logger.warn({ status, attempt, backoff, model }, `LLM provider returned ${status}, retrying in ${backoff}ms`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Unreachable');
  }

  /**
   * Waits for a human approval decision for a high-risk tool call.
   *
   * Subscribe-before-emit ordering: this method first attaches a Redis pub/sub
   * subscriber to `hitl:result:{requestId}`, THEN calls the supplied emit
   * callback (which fires the `mcp_approval_required` SSE event the chat UI
   * shows as a popup). This eliminates the race where the user might click
   * Approve in the gap between the SSE emit and the subscription being ready.
   *
   * The publish side is `POST /api/chat/tool-approval/:requestId` which
   * publishes to the same channel name (HITL-A: unified path).
   *
   * Payload shape: `{"decision": "approved"|"denied", "approvedBy": "<user>"}`
   */
  private async armApprovalListenerAndEmit(
    requestId: string,
    timeoutMs: number,
    emitAfterSubscribe: () => void
  ): Promise<{ decision: string; approvedBy?: string }> {
    const redis = getRedis();
    const channel = `hitl:result:${requestId}`;
    const sub = redis.duplicate();

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        sub.unsubscribe(channel).catch(() => {});
        sub.quit().catch(() => {});
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Approval timeout'));
      }, timeoutMs);

      sub.on('message', (ch: string, message: string) => {
        if (ch !== channel || settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        try {
          resolve(JSON.parse(message));
        } catch {
          reject(new Error(`Invalid approval payload: ${message}`));
        }
      });

      // Subscribe FIRST, then emit AFTER the subscribe ack arrives.
      sub.subscribe(channel)
        .then(() => {
          // Subscription is now active — safe to emit the popup event.
          try {
            emitAfterSubscribe();
          } catch (emitErr: any) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            cleanup();
            reject(new Error(`Failed to emit approval request: ${emitErr.message}`));
          }
        })
        .catch((err: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          cleanup();
          reject(err);
        });
    });
  }

  private buildAuthHeaders(ctx: RunContext): Record<string, string> {
    const headers: Record<string, string> = {
      'X-User-ID': ctx.userId,
      'X-Auth-Method': ctx.authMethod,
    };
    if (ctx.userToken) headers['Authorization'] = `Bearer ${ctx.userToken}`;
    if (ctx.isAdmin) headers['X-Is-Admin'] = 'true';
    // Sev-0 #927 (2026-05-17) — defensive length-on-undefined guard.
    //
    // Pre-fix: `if (ctx.userGroups.length)` threw `Cannot read properties of
    // undefined (reading 'length')` when the chat-side OpenAgenticProxyClient
    // sent a body without `userGroups` AND the proxy's execute-sync
    // handler took the internal-caller-with-userId branch that SKIPS the
    // body.userGroups = user.groups override (services/openagentic-proxy/src/
    // routes/execute.ts:68-74). Pinned by api-side
    // subagentDispatch.undefinedLength.test.ts.
    //
    // The api side now ships `userGroups: []` defensively so this access
    // is safe from the chat path; this optional-chain is defense-in-depth
    // for any future internal caller that omits the field.
    if (ctx.userGroups && ctx.userGroups.length > 0) headers['X-User-Groups'] = ctx.userGroups.join(',');
    if (ctx.userEmail) headers['X-User-Email'] = ctx.userEmail;
    // OSS: no OBO (On-Behalf-Of) ID-token forwarding — local-auth only; cloud
    // MCP servers (azure/aws/gcp) authenticate via their own service-account /
    // static-keypair / ADC credentials, not a per-user OBO token.
    return headers;
  }

  /**
   * Execute workflow CRUD tools by making HTTP calls to the OpenAgentic API.
   * These tools let the Flows Agent read, modify, execute, and inspect workflows.
   */
  private async executeWorkflowTool(toolName: string, args: Record<string, any>, ctx: RunContext): Promise<any> {
    const apiUrl = process.env.API_URL || 'http://openagentic-api:8000';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (ctx.userToken) headers['Authorization'] = `Bearer ${ctx.userToken}`;

    try {
      let response;
      switch (toolName) {
        case 'read_workflow':
          response = await axios.get(`${apiUrl}/api/workflows/${args.flowId}`, { headers, timeout: 10000 });
          return { result: JSON.stringify(response.data, null, 2) };

        case 'update_workflow':
          response = await axios.put(`${apiUrl}/api/workflows/${args.flowId}`, {
            definition: args.definition,
          }, { headers, timeout: 10000 });
          return { result: `Workflow updated successfully. ${JSON.stringify(response.data).substring(0, 200)}` };

        case 'execute_workflow':
          response = await axios.post(`${apiUrl}/api/workflows/${args.flowId}/execute`, {
            input: args.input || {},
            trigger_type: 'manual',
          }, { headers, timeout: 60000, responseType: 'text' });
          // Parse SSE response to extract execution result
          const lines = (response.data || '').split('\n');
          const completeLine = lines.find((l: string) => l.includes('execution_complete'));
          if (completeLine) {
            const data = JSON.parse(completeLine.replace('data: ', ''));
            return { result: `Execution completed. Output: ${JSON.stringify(data.output || {}).substring(0, 500)}` };
          }
          const errorLine = lines.find((l: string) => l.includes('execution_error'));
          if (errorLine) {
            const data = JSON.parse(errorLine.replace('data: ', ''));
            return { error: `Execution failed: ${data.error}` };
          }
          return { result: 'Execution started. Check execution logs for results.' };

        case 'get_execution_log':
          response = await axios.get(
            `${apiUrl}/api/workflows/${args.flowId}/executions/${args.executionId}`,
            { headers, timeout: 10000 }
          );
          return { result: JSON.stringify(response.data, null, 2) };

        default:
          return { error: `Unknown workflow tool: ${toolName}` };
      }
    } catch (err: any) {
      return { error: `Workflow tool ${toolName} failed: ${err.message}` };
    }
  }

  /**
   * Execute generate_image tool by calling the API's image generation endpoint,
   * then storing the result in MinIO via the images API. Returns a stable URL.
   */
  private async executeImageGeneration(args: Record<string, any>, ctx: RunContext, logger: any): Promise<any> {
    const apiUrl = process.env.API_URL || 'http://openagentic-api:8000';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.userToken) headers['Authorization'] = `Bearer ${ctx.userToken}`;

    try {
      // Step 1: Generate image via ProviderManager
      const genResponse = await axios.post(`${apiUrl}/api/chat/generate-image`, {
        prompt: args.prompt || args.description || 'Generate an image',
        size: args.size || '1024x1024',
        style: args.style || 'vivid',
      }, { headers, timeout: 120000 });

      const genData = genResponse.data;
      if (!genData.success) {
        return { error: genData.error || 'Image generation returned no data' };
      }

      // API now stores in MinIO and returns imageUrl directly
      const imageUrl = genData.imageUrl || (genData.imageId ? `/api/images/${genData.imageId.replace(/\.png$/, '')}.png` : null);
      if (!imageUrl) {
        return { error: 'Image generated but no storage URL returned' };
      }

      logger.info({ imageUrl, model: genData.model, provider: genData.provider }, 'Image generated and stored for agent');

      return {
        result: `Image generated successfully (${genData.model} via ${genData.provider}).\nImage URL: ${imageUrl}\nEmbed in HTML as: <img src="${imageUrl}" alt="${(args.prompt || '').substring(0, 80)}" style="max-width:100%;border-radius:8px">\nDo NOT use placeholder images — use this exact URL.`
      };
    } catch (err: any) {
      logger.warn({ err: err.message, status: err.response?.status }, 'Image generation failed in agent');
      return { error: `Image generation failed: ${err.response?.data?.error || err.message}` };
    }
  }

  /**
   * V1.1 flow_tool: fetch the user's saved flows tagged `agent-tool` and
   * surface them as a name→flowId map. The caller injects projected
   * OpenAI-tool defs into `agentTools` via the side-effect callback. On any
   * failure we log + return an empty map; flow-tool injection is best-effort.
   */
  private async loadUserFlowTools(
    ctx: RunContext,
    onTools: (tools: FlowToolSchema[]) => void,
  ): Promise<Map<string, string>> {
    try {
      const apiUrl = process.env.API_URL || 'http://openagentic-api:8000';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
      if (internalSecret) {
        headers['X-Request-From'] = 'openagentic-proxy';
        headers['X-Internal-Secret'] = internalSecret;
        headers['Authorization'] = `Bearer ${internalSecret}`;
        if (ctx.userId) headers['X-User-Id'] = ctx.userId;
        if (ctx.userEmail) headers['X-User-Email'] = ctx.userEmail;
      } else if (ctx.userToken) {
        headers['Authorization'] = `Bearer ${ctx.userToken}`;
      }

      const response = await axios.get(`${apiUrl}/api/workflows/agent-tools`, {
        headers,
        timeout: 5000,
      });
      const tools: FlowToolSchema[] = response.data?.tools ?? [];
      if (tools.length > 0) {
        onTools(tools);
        logger.info(
          { agentId: ctx.executionId, flowToolCount: tools.length, names: tools.map((t) => t.name) },
          '[AgentRunner] Injected user saved-flow tools',
        );
      }
      return buildFlowToolMap(tools);
    } catch (err: any) {
      logger.warn(
        { err: err.message, status: err.response?.status },
        '[AgentRunner] Failed to load user flow tools — skipping injection',
      );
      return new Map();
    }
  }

  /**
   * V1.1 flow_tool: dispatch a flow-tool invocation by POSTing the args as
   * trigger input to /api/workflows/:flowId/execute and parsing the SSE
   * response — same envelope shape executeWorkflowTool already handles.
   */
  private async executeFlowToolInvocation(
    flowId: string,
    toolName: string,
    args: Record<string, any>,
    ctx: RunContext,
  ): Promise<{ result?: string; error?: string }> {
    const apiUrl = process.env.API_URL || 'http://openagentic-api:8000';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    if (internalSecret) {
      headers['X-Request-From'] = 'openagentic-proxy';
      headers['X-Internal-Secret'] = internalSecret;
      headers['Authorization'] = `Bearer ${internalSecret}`;
      if (ctx.userId) headers['X-User-Id'] = ctx.userId;
      if (ctx.userEmail) headers['X-User-Email'] = ctx.userEmail;
    } else if (ctx.userToken) {
      headers['Authorization'] = `Bearer ${ctx.userToken}`;
    }

    try {
      const response = await axios.post(
        `${apiUrl}/api/workflows/${flowId}/execute`,
        { input: args || {}, trigger_type: 'manual' },
        { headers, timeout: 120000, responseType: 'text' },
      );
      const lines = (response.data || '').split('\n');
      const completeLine = lines.find((l: string) => l.includes('execution_complete'));
      if (completeLine) {
        const data = JSON.parse(completeLine.replace(/^data:\s*/, ''));
        const output = data.output ?? data.result ?? {};
        return {
          result: `Flow '${toolName}' (${flowId}) completed. Output: ${JSON.stringify(output).substring(0, 1000)}`,
        };
      }
      const errorLine = lines.find((l: string) => l.includes('execution_error'));
      if (errorLine) {
        const data = JSON.parse(errorLine.replace(/^data:\s*/, ''));
        return { error: `Flow '${toolName}' failed: ${data.error}` };
      }
      return { result: `Flow '${toolName}' started — check execution logs for results.` };
    } catch (err: any) {
      return { error: `Flow '${toolName}' failed: ${err.response?.data?.error || err.message}` };
    }
  }

  private buildResult(
    spec: { agentId: string; role: string },
    status: AgentResult['status'],
    output: string,
    toolCallsExecuted: AgentResult['toolCallsExecuted'],
    metrics: Omit<AgentResult['metrics'], 'costCents'>,
    error?: string
  ): AgentResult {
    const costCents = this.costTracker.getAgentCost(spec.agentId);
    return {
      agentId: spec.agentId,
      role: spec.role,
      status,
      output,
      toolCallsExecuted,
      metrics: { ...metrics, costCents },
      error,
    };
  }
}
