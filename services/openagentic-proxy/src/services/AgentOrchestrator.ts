import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { AgentRunner, type AgentSpec, type AgentResult, type RunContext } from './AgentRunner';
import { CostTracker } from './CostTracker';
import { MCPBridge } from '../tools/MCPBridge';
import { SSERelay } from './SSERelay';
import { PersistenceService } from './PersistenceService';
import { RedisExecutionStore } from './RedisExecutionStore';
import {
  AgentProgressContext,
  createHttpPublisher,
} from './AgentProgressContext';
import { logger } from '../utils/logger';
import {
  activeExecutions,
  agentExecutionsTotal,
  agentExecutionDuration,
  toolCallsTotal,
  toolCallDuration,
  costTotal,
} from '../metrics';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecuteRequest {
  agents: AgentSpec[];
  orchestration: 'parallel' | 'sequential' | 'supervisor' | 'hierarchical';
  aggregation: 'merge' | 'synthesize' | 'first' | 'vote';
  sessionId?: string;
  executionId?: string;
  userId: string;
  userMessage: string;
  // GAP-2: full session conversation history so sub-agents have context.
  // Last N user/assistant messages from the chat session — gives sub-agents
  // visibility into who the user is, prior turns, established preferences.
  sessionMessages?: Array<{ role: string; content: string }>;
  userDisplayName?: string;
  userEmail?: string;
  userToken?: string;
  // GAP-#277: Azure AD ID token (separate audience from userToken).
  // Used as X-Azure-ID-Token / X-AWS-ID-Token header for OBO when sub-agents
  // call MCP tools — sub-agents need this to make Azure/AWS calls AS the user.
  userIdToken?: string;
  authMethod: string;
  userGroups: string[];
  isAdmin: boolean;
  totalBudgetCents?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  flowContext?: any;
  // Project A.4 — parent→sub-agent context propagation.
  // The parent chat's already-assembled <user_memory> markdown block.
  // Passed verbatim so the sub-agent inherits the same grounding the
  // parent had (durable identifier mappings + semantic hits for THIS
  // session's topic) without re-querying. Prevents the sub-agent from
  // fabricating identifiers the parent already resolved.
  parentMemoryContext?: string;
  // The parent's top RAG chunks (already retrieved). Pass-through rather
  // than re-querying. Keep payload small — top 3 chunks.
  parentRagContext?: Array<{ content?: string; text?: string; source?: string; score?: number }>;
  // Project A.4b — sub-agents spawned through this service bypass
  // PromptComposer (they use DEFAULT_PROMPTS[role] hardcoded in this
  // file, not the DB-backed module system). Until Project B.2 unifies
  // the bypass paths, the parent (ChatPipeline) renders the alwaysInject
  // modules (safety, artifact-inhibitor, response-style, ...) and ships
  // the concatenated content here. AgentRunner prepends this to every
  // sub-agent's system prompt BEFORE the role template, so behavioral
  // rules survive the bypass.
  parentBehaviorRules?: string;
  // Phase C (2026-04-23) — conversation-level turnId used as the
  // subscription key on the openagentic-api side AgentEventStore.
  // When present, AgentOrchestrator constructs an AgentProgressContext
  // whose `publish` callback HTTP-POSTs progress envelopes back to
  // /api/chat/agent-event so the parent chat stream can re-emit them
  // as `agent_progress` NDJSON frames. When absent (legacy callers
  // that don't route through the chat pipeline), we skip the callback
  // entirely — the execution still runs and SSERelay still works.
  turnId?: string;
}

export interface ExecutionState {
  executionId: string;
  userId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  results: AgentResult[];
  output?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

// Default models by role — use 'auto' to let ProviderManager auto-select
// Override via AGENT_DEFAULT_MODEL env var or per-agent spec.model
const DEFAULT_MODEL = process.env.AGENT_DEFAULT_MODEL || 'auto';

// Use a fast/cheap model for planning and synthesis overhead
const PLANNER_MODEL = process.env.AGENT_PLANNER_MODEL || 'auto';

const DEFAULT_MODELS: Record<string, string> = {
  reasoning: DEFAULT_MODEL,
  data_query: DEFAULT_MODEL,
  tool_orchestration: DEFAULT_MODEL,
  summarization: DEFAULT_MODEL,
  code_execution: DEFAULT_MODEL,
  planning: DEFAULT_MODEL,
  validation: DEFAULT_MODEL,
  synthesis: DEFAULT_MODEL,
  artifact_creation: DEFAULT_MODEL,
  oat_function_builder: DEFAULT_MODEL,
  custom: DEFAULT_MODEL,
};

// Shared instruction appended to all agent system prompts
const AGENT_CONTINUATION_INSTRUCTION = '\n\nCRITICAL: You MUST keep working until your task is FULLY complete. After each tool result, evaluate if there are more steps needed. If yes, call the next tool immediately. Do NOT present partial results or stop early. Only provide your final response when ALL work is done. Complex tasks may need 5-20 tool calls — this is normal.';

const DEFAULT_PROMPTS: Record<string, string> = {
  reasoning: 'You are a deep reasoning agent. Analyze thoroughly and provide well-reasoned conclusions.' + AGENT_CONTINUATION_INSTRUCTION,
  data_query: 'You are a data query specialist. Extract and return structured data efficiently.' + AGENT_CONTINUATION_INSTRUCTION,
  tool_orchestration: 'You are a tool orchestration agent. Determine which tools to call and in what order. If an operation is in progress (status: Creating, Provisioning, etc.), call the status tool again in the next turn. Do not give up — keep polling until the operation completes or fails.' + AGENT_CONTINUATION_INSTRUCTION,
  summarization: 'You are a summarization specialist. Distill complex information into clear summaries.' + AGENT_CONTINUATION_INSTRUCTION,
  code_execution: 'You are a code execution agent. Write, run, and debug code to solve the task.' + AGENT_CONTINUATION_INSTRUCTION,
  planning: 'You are a planning agent. Break down tasks into clear steps with dependencies.' + AGENT_CONTINUATION_INSTRUCTION,
  validation: 'You are a validation agent. Verify outputs and check for errors.' + AGENT_CONTINUATION_INSTRUCTION,
  synthesis: 'You are a synthesis agent. Combine information into a coherent response.' + AGENT_CONTINUATION_INSTRUCTION,
  oat_function_builder: `You create Python functions for artifact rendering. Each function must:
- Have signature: async def execute(context: dict) -> dict
- Return JSON-serializable results (data for charts, processed datasets, SVG strings)
- Declare CAPABILITIES_USED and RISK_LEVEL

Output format per function:
FUNCTION_NAME: descriptive_name
DESCRIPTION: What this function does
CAPABILITIES_USED: data_processing, visualization
RISK_LEVEL: LOW
RISK_REASONING: Read-only data processing, no side effects
HUMAN_EXPLANATION: Processes the data and returns chart-ready arrays
CODE:
async def execute(context: dict) -> dict:
    import pandas as pd
    # ... implementation
    return {"labels": [...], "values": [...]}

CRITICAL: Only use capabilities that are genuinely needed. LOW risk for read-only data processing. HIGH risk for network/cloud access.`,
  artifact_creation: `MANDATORY: Use a LIGHT background (white, cream, #faf7f0, #f8fafc). NEVER use dark backgrounds (#0d1117, #1a1a2e, dark blue, black) unless the content is explicitly about space or nighttime. This is the #1 rule.

MANDATORY: Output a single \`\`\`artifact:html code block. NEVER use artifact:react or JSX. Only vanilla HTML+CSS+JS.

\`\`\`artifact:html
<!DOCTYPE html>
<html lang="en"><head><title>Descriptive Title</title>...</head><body>...</body></html>
\`\`\`

IMAGE GENERATION WORKFLOW (MANDATORY when user asks for images):
1. Call \`generate_image\` for each image you need (max 3 images). Do NOT batch — call them one at a time.
2. Each call returns "Image URL: /api/images/xxx.png" — SAVE these exact URLs.
3. ONLY AFTER all generate_image calls complete, write your \`\`\`artifact:html block.
4. In the HTML, use \`<img src="/api/images/xxx.png" style="max-width:100%;border-radius:8px">\` with the EXACT URLs from step 2.
5. Do NOT use SVG diagrams, placeholder images, or external URLs when you have real generated images.
6. Do NOT create the HTML artifact until you have the image URLs from the tool results.

You are a world-class designer. Every artifact must look like a published textbook or premium SaaS product.

DESIGN RULES:
- Load Google Fonts: \`<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">\`
- Light backgrounds: white (#fff), cream (#faf7f0), light gray (#f8fafc). Color accents via borders, headings, badges — NOT background.
- Typographic hierarchy: display font for h1, body font for text, proper sizing (h1 2.5rem, body 1rem, line-height 1.7)
- Multi-column CSS Grid for content-rich layouts. Callout boxes with colored left borders. Styled tables with alternating rows.
- Use AI-generated images from generate_image tool (NOT SVG placeholders). Chart.js via CDN for data charts only.
- Smooth hover transitions, interactive tabs/filters, descriptive <title> tag.
- No placeholder data. No Lorem ipsum. No dark themes. No generic titles.` + AGENT_CONTINUATION_INSTRUCTION,
  custom: 'You are a specialized agent. Complete the assigned task.' + AGENT_CONTINUATION_INSTRUCTION,
};

// Adaptive turn limits by role — complex roles get more turns
const ADAPTIVE_TURNS: Record<string, number> = {
  reasoning: 3,      // Minimal tool use, mostly thinking
  data_query: 8,     // May need several queries
  tool_orchestration: 20, // Multi-step tool chains (Azure VM lifecycle can need 15-20 turns)
  summarization: 3,  // Minimal tool use
  code_execution: 12, // Write, run, debug cycles
  planning: 5,
  validation: 6,
  synthesis: 3,
  artifact_creation: 8,
  oat_function_builder: 5,
  custom: 5,
};

// ─── Resolved Agent Config (from DB via /api/agents/resolve) ────────────────

interface ResolvedAgentConfig {
  id: string;
  name: string;
  display_name: string;
  agent_type: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  maxTokens: number;
  temperature: number;
  tools: string[];
  toolsDenyList: string[];
  skills: string[];
  prompt_strategy: string;
  prompt_modules: string[];
  prompt_mode: string;
  // Spawn safety limits
  max_spawn_depth: number;
  max_children: number;
  // Reliability
  retry_strategy: { maxRetries?: number; fallbackToMinimal?: boolean; partialResultsOk?: boolean };
  output_schema: any;
  handoff_schema: any;
}

interface CacheEntry {
  config: ResolvedAgentConfig;
  cachedAt: number;
}

// ─── AgentOrchestrator ──────────────────────────────────────────────────────

export class AgentOrchestrator {
  private executions: Map<string, ExecutionState> = new Map();
  private mcpBridge: MCPBridge;
  private apiUrl: string;
  private persistence: PersistenceService;
  private redisStore: RedisExecutionStore;

  // In-memory cache for resolved agent configs (60s TTL)
  private agentConfigCache: Map<string, CacheEntry> = new Map();
  private static readonly AGENT_CACHE_TTL_MS = 60 * 1000;

  private static readonly MAX_EXECUTIONS = 1000;
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

  constructor(mcpBridge: MCPBridge, apiUrl: string) {
    this.mcpBridge = mcpBridge;
    this.apiUrl = apiUrl;
    this.persistence = new PersistenceService();
    this.redisStore = new RedisExecutionStore();

    // Periodically clean up completed/failed executions to prevent memory leaks (Bug 2 fix)
    setInterval(() => this.cleanupExecutions(), AgentOrchestrator.CLEANUP_INTERVAL_MS);
  }

  private cleanupExecutions(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, state] of this.executions) {
      const isTerminal = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
      const isOld = now - state.startedAt > AgentOrchestrator.MAX_AGE_MS;
      if (isTerminal && isOld) {
        this.executions.delete(id);
        cleaned++;
      }
    }
    // Hard cap: if still over limit, remove oldest completed entries
    if (this.executions.size > AgentOrchestrator.MAX_EXECUTIONS) {
      const sorted = [...this.executions.entries()]
        .filter(([, s]) => s.status !== 'running')
        .sort(([, a], [, b]) => a.startedAt - b.startedAt);
      const toRemove = sorted.slice(0, this.executions.size - AgentOrchestrator.MAX_EXECUTIONS);
      for (const [id] of toRemove) { this.executions.delete(id); cleaned++; }
    }
    if (cleaned > 0) logger.info({ cleaned, remaining: this.executions.size }, 'Cleaned up old executions');
  }

  /**
   * Resolve agent config from the API (DB + PromptComposer).
   * Falls back to hardcoded defaults if API is unreachable.
   * Caches results in-memory for 60s.
   */
  private async resolveAgentFromAPI(
    role: string,
    id?: string,
    mode: string = 'chat'
  ): Promise<ResolvedAgentConfig | null> {
    const cacheKey = id || `role:${role}:${mode}`;
    const cached = this.agentConfigCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < AgentOrchestrator.AGENT_CACHE_TTL_MS) {
      return cached.config;
    }

    try {
      const params = new URLSearchParams();
      if (id) params.set('id', id);
      else if (role) params.set('role', role);
      params.set('mode', mode);

      // api's unifiedAuthHook expects x-request-from + x-internal-secret
      // (see services/openagentic-api/src/middleware/unifiedAuth.ts). The
      // OPENAGENTIC_PROXY_INTERNAL_KEY header pattern was legacy and never wired up.
      const internalSecret = process.env.INTERNAL_SERVICE_SECRET || '';
      const headers: Record<string, string> = { 'x-request-from': 'openagentic-proxy' };
      if (internalSecret) {
        headers['x-internal-secret'] = internalSecret;
      }

      const res = await axios.get(`${this.apiUrl}/api/agents/resolve?${params}`, {
        headers,
        timeout: 5000,
      });

      // 2026-05-13 fix: do NOT gate on systemPrompt truthiness. Many DB
      // agent rows have empty `system_prompt` (the seeder uses
      // DEFAULT_PROMPTS[role] at runtime as the prompt fallback). The
      // previous `&& res.data?.systemPrompt` gate caused those rows to
      // return null here, which silently dropped the per-agent
      // `model_config.primaryModel` override and fell through to
      // DEFAULT_MODELS[role] = 'auto'. Affected ~11 of 19 default agent
      // rows. The empty-prompt case still falls back to
      // DEFAULT_PROMPTS[role] downstream via `dbConfig?.systemPrompt ||
      // DEFAULT_PROMPTS[a.role]` in runExecution.
      if (res.status === 200 && res.data) {
        const config: ResolvedAgentConfig = {
          id: res.data.id,
          name: res.data.name,
          display_name: res.data.display_name,
          agent_type: res.data.agent_type,
          systemPrompt: res.data.systemPrompt || '',
          model: res.data.model || 'auto',
          maxTurns: res.data.maxTurns || 5,
          maxTokens: res.data.maxTokens || 8192,
          temperature: res.data.temperature || 0.5,
          tools: res.data.tools || [],
          toolsDenyList: res.data.toolsDenyList || [],
          skills: res.data.skills || [],
          prompt_strategy: res.data.prompt_strategy || 'custom',
          prompt_modules: res.data.prompt_modules || [],
          prompt_mode: res.data.prompt_mode || 'full',
          max_spawn_depth: res.data.max_spawn_depth ?? 1,
          max_children: res.data.max_children ?? 5,
          retry_strategy: res.data.retry_strategy || {},
          output_schema: res.data.output_schema || {},
          handoff_schema: res.data.handoff_schema || {},
        };
        this.agentConfigCache.set(cacheKey, { config, cachedAt: Date.now() });
        logger.info({
          role, id, strategy: config.prompt_strategy,
          modules: config.prompt_modules.length,
          promptLen: config.systemPrompt.length,
        }, 'Resolved agent config from API');
        return config;
      }
      return null;
    } catch (err: any) {
      logger.warn({ role, id, error: err.message }, 'Failed to resolve agent from API, using hardcoded defaults');
      return null;
    }
  }

  async execute(request: ExecuteRequest): Promise<{ executionId: string; status: string }> {
    const executionId = request.executionId || uuidv4();
    const state: ExecutionState = {
      executionId,
      userId: request.userId,
      status: 'pending',
      results: [],
      startedAt: Date.now(),
    };
    this.executions.set(executionId, state);
    this.redisStore.set(state).catch(() => {}); // Write-through to Redis

    // Run asynchronously
    this.runExecution(executionId, request).catch(err => {
      logger.error({ executionId, error: err.message }, 'Execution failed');
      // Prometheus: ensure gauge is decremented on unhandled failure
      activeExecutions.dec();
      agentExecutionsTotal.inc({ pattern: request.orchestration, status: 'failed' });
      agentExecutionDuration.observe({ pattern: request.orchestration }, (Date.now() - state.startedAt) / 1000);
      const s = this.executions.get(executionId);
      if (s) {
        s.status = 'failed';
        s.error = err.message;
        this.redisStore.set(s).catch(() => {});
      }
    });

    return { executionId, status: 'started' };
  }

  async executeSync(request: ExecuteRequest): Promise<{
    executionId: string;
    output: string;
    results: AgentResult[];
    metrics: any;
  }> {
    const executionId = request.executionId || uuidv4();
    const state: ExecutionState = {
      executionId,
      userId: request.userId,
      status: 'pending',
      results: [],
      startedAt: Date.now(),
    };
    this.executions.set(executionId, state);
    this.redisStore.set(state).catch(() => {}); // Write-through to Redis

    await this.runExecution(executionId, request);

    const finalState = this.executions.get(executionId)!;
    return {
      executionId,
      output: finalState.output || '',
      results: finalState.results,
      metrics: this.getExecutionMetrics(finalState),
    };
  }

  getExecution(executionId: string): ExecutionState | undefined {
    return this.executions.get(executionId);
  }

  async getExecutionAsync(executionId: string): Promise<ExecutionState | undefined> {
    const local = this.executions.get(executionId);
    if (local) return local;
    // Fall back to Redis for cross-instance visibility / crash recovery
    const remote = await this.redisStore.get(executionId);
    if (remote) {
      // Populate local cache for subsequent fast reads
      this.executions.set(executionId, remote);
    }
    return remote ?? undefined;
  }

  async getLiveExecutions(): Promise<ExecutionState[]> {
    return this.redisStore.list({ status: 'running' });
  }

  async getStats(): Promise<{
    activeCount: number;
    totalToday: number;
    completedToday: number;
    failedToday: number;
  }> {
    return this.redisStore.getStats();
  }

  cancelExecution(executionId: string): boolean {
    const state = this.executions.get(executionId);
    if (state && state.status === 'running') {
      state.status = 'cancelled';
      state.completedAt = Date.now();
      // Publish kill signal for cross-instance cancellation and persist state
      this.redisStore.publishKill(executionId).catch(() => {});
      this.redisStore.set(state).catch(() => {});
      return true;
    }
    return false;
  }

  private async runExecution(executionId: string, request: ExecuteRequest): Promise<void> {
    const state = this.executions.get(executionId)!;
    state.status = 'running';
    await this.redisStore.set(state); // Persist running state

    // Prometheus: track active execution
    activeExecutions.inc();
    const execStartTime = Date.now();

    // Subscribe to kill channel for cross-instance cancellation
    const unsubKill = await this.redisStore.subscribeKill(executionId, () => {
      state.status = 'cancelled';
      state.completedAt = Date.now();
      logger.info({ executionId }, 'Execution cancelled via Redis kill signal');
    });

    const relay = new SSERelay(executionId);
    const costTracker = new CostTracker(request.totalBudgetCents);
    const runner = new AgentRunner(this.mcpBridge, costTracker, this.apiUrl);

    // Phase C: when the chat pipeline passes `turnId`, fan every emit()
    // out to both the SSE relay (existing path: Redis pub/sub channel
    // `agent:exec:<executionId>`) AND the chat-side AgentEventStore via
    // HTTP callback to /api/chat/agent-event. The HTTP callback is
    // keyed on `turnId` (conversation-level), the SSE relay on
    // `executionId` (per-execution). Dual-write lets both subscribers
    // see the full event stream without having to correlate IDs.
    const progressContext: AgentProgressContext | undefined = request.turnId
      ? new AgentProgressContext({
          publish: createHttpPublisher({
            onError: (err) => logger.warn({ err, turnId: request.turnId }, 'agent progress HTTP callback failed'),
          }),
          turnId: request.turnId,
          runId: executionId,
          parentRunId: null,
        })
      : undefined;

    const emitFn = (event: string, data: any) => {
      // SSE relay — existing contract, don't change.
      relay.emit(event, data);
      // Phase C: mirror to chat-side via HTTP. Fire-and-forget;
      // AgentProgressContext.emit swallows publish errors so a failed
      // callback never blocks the agent loop.
      if (progressContext) {
        progressContext.emit({
          event,
          payload: typeof data === 'object' && data !== null ? data : { data },
        });
      }
    };

    // Discover available tools from MCP proxy (Bug 7 fix: tools must be populated for LLM to generate tool calls)
    let availableTools: any[] = [];
    try {
      // MCP proxy uses Bearer token auth
      const authHeaders: Record<string, string> = {};
      const mcpToken = request.userToken || process.env.OPENAGENTIC_PROXY_API_KEY;
      if (mcpToken) {
        // User API keys (oa_…) authenticate via X-API-Key; system tokens
        // (oa_sys_…) and JWTs go through Authorization: Bearer. Note oa_sys_
        // also matches the oa_ prefix, so check the system prefix first.
        if (mcpToken.startsWith('oa_') && !mcpToken.startsWith('oa_sys_')) {
          authHeaders['X-API-Key'] = mcpToken;
        } else {
          authHeaders['Authorization'] = `Bearer ${mcpToken}`;
        }
      }
      availableTools = await this.mcpBridge.listTools(authHeaders);
      logger.info({ toolCount: availableTools.length }, 'Discovered available tools from MCP proxy');
    } catch (err) {
      logger.warn({ err }, 'Failed to discover tools from MCP proxy — agents will run without tools');
    }

    // Inject generate_image tool (routed through ProviderManager, not MCP)
    // This enables agents to generate real AI images instead of SVG placeholders
    if (!availableTools.some((t: any) => (t.function?.name || t.name) === 'generate_image')) {
      availableTools.push({
        type: 'function',
        function: {
          name: 'generate_image',
          description: 'Generate an AI image using the configured image generation provider (e.g., Imagen, DALL-E). Returns a stored image URL. Use this to create real images for artifacts instead of SVG placeholders.',
          parameters: {
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', description: 'Detailed description of the image to generate' },
              size: { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'], description: 'Image dimensions (default: 1024x1024)' },
              style: { type: 'string', enum: ['vivid', 'natural'], description: 'Image style (default: vivid)' },
            },
          },
        },
      });
    }

    const ctx: RunContext = {
      userId: request.userId,
      sessionId: request.sessionId,
      userToken: request.userToken,
      authMethod: request.authMethod,
      userGroups: request.userGroups,
      isAdmin: request.isAdmin,
      executionId,
      availableTools,
      depth: (request as any).depth || 0,
      flowContext: request.flowContext,
      // GAP-2: thread session conversation history into agent context so
      // sub-agents see prior turns + know who the user is.
      sessionMessages: request.sessionMessages,
      userDisplayName: request.userDisplayName,
      userEmail: request.userEmail,
      userMessage: request.userMessage,
      userIdToken: request.userIdToken,
    };

    // Resolve agent specs: try API (DB + PromptComposer) first, fall back to hardcoded defaults
    const flowMode = request.flowContext ? 'flow' : 'chat';
    const resolvedAgents = await Promise.all(request.agents.map(async (a) => {
      const dbConfig = await this.resolveAgentFromAPI(a.role, undefined, flowMode);

      // cloud_operations SUPERVISOR PATTERN: allow exactly ONE level of
      // recursion so a top-level supervisor can fan out to worker sub-agents
      // across subscription batches (enterprise-scale audits of 100+ subs).
      // The depth cap is enforced in AgentRunner via CLOUD_OPS_SUPERVISOR_MAX_DEPTH.
      const isCloudOps = a.role === 'cloud_operations';
      const callerDelegationAllowed = (a as any).delegationAllowed;
      const callerMaxSpawnDepth = (a as any).maxSpawnDepth;

      return {
        ...a,
        agentId: a.agentId || `agent_${uuidv4().substring(0, 8)}`,
        // Spec overrides > DB config > hardcoded defaults
        model: a.model || dbConfig?.model || DEFAULT_MODELS[a.role] || DEFAULT_MODELS.custom,
        maxTurns: a.maxTurns ?? dbConfig?.maxTurns ?? ADAPTIVE_TURNS[a.role] ?? 5,
        timeout: a.timeout ?? 300000, // 5 min default — complex cloud operations need time
        systemPrompt: a.systemPrompt || dbConfig?.systemPrompt || DEFAULT_PROMPTS[a.role] || DEFAULT_PROMPTS.custom,
        // Spawn safety limits — caller spec wins, then DB, then hardcoded.
        // cloud_operations allows depth=1 (supervisor → workers, workers are leaves).
        maxSpawnDepth: isCloudOps ? 1 : (callerMaxSpawnDepth ?? dbConfig?.max_spawn_depth ?? 1),
        maxChildren: isCloudOps ? 10 : (dbConfig?.max_children ?? 5),
        // Recursion gate (read by AgentRunner.run). cloud_operations = true at the
        // supervisor level; AgentRunner strips delegate_to_agents at depth >= 1.
        delegationAllowed: isCloudOps ? true : callerDelegationAllowed,
        // Structured output schema
        outputSchema: dbConfig?.output_schema || {},
      };
    }));

    // Set per-agent budgets
    for (const agent of resolvedAgents) {
      if (agent.costBudget) costTracker.setAgentBudget(agent.agentId, agent.costBudget);
    }

    // Enforce max_children limit: cap number of agents spawned per execution
    const maxChildrenLimit = Math.min(...resolvedAgents.map(a => (a as any).maxChildren ?? 5));
    if (resolvedAgents.length > maxChildrenLimit) {
      logger.warn({ requested: resolvedAgents.length, limit: maxChildrenLimit }, 'Agent count exceeds max_children, truncating');
      resolvedAgents.length = maxChildrenLimit;
    }

    emitFn('agent_spawn_plan', {
      agents: resolvedAgents.map(a => ({ agentId: a.agentId, role: a.role, model: a.model, task: a.task.substring(0, 200) })),
      strategy: request.orchestration,
      timestamp: Date.now(),
    });

    let results: AgentResult[];

    switch (request.orchestration) {
      case 'parallel':
        results = await this.runParallel(resolvedAgents, runner, emitFn, ctx, request.maxConcurrency || 5);
        break;
      case 'sequential':
        results = await this.runSequential(resolvedAgents, runner, emitFn, ctx);
        break;
      case 'supervisor':
        results = await this.runSupervisor(resolvedAgents, runner, emitFn, ctx, request);
        break;
      case 'hierarchical':
        results = await this.runHierarchical(resolvedAgents, runner, emitFn, ctx, request);
        break;
      default:
        results = await this.runParallel(resolvedAgents, runner, emitFn, ctx, request.maxConcurrency || 5);
    }

    state.results = results;
    state.output = await this.aggregateResults(results, request.aggregation, request.userMessage, ctx);
    state.status = results.every(r => r.status === 'error') ? 'failed' : 'completed';
    state.completedAt = Date.now();

    // Clean up kill subscription and persist final state to Redis
    unsubKill();
    await this.redisStore.set(state);

    // Persist final execution state to database
    const metrics = costTracker.getMetrics();
    this.persistence.saveExecution({
      executionId: state.executionId,
      sessionId: request.sessionId,
      userId: request.userId,
      orchestration: request.orchestration,
      aggregation: request.aggregation,
      agentSpecs: request.agents,
      status: state.status,
      results: results.map(r => ({ agentId: r.agentId, role: r.role, status: r.status, output: r.output?.substring(0, 5000) })),
      totalCostCents: metrics.totalCostCents || 0,
      totalTokens: (metrics.totalInputTokens || 0) + (metrics.totalOutputTokens || 0),
      totalDurationMs: state.completedAt - state.startedAt,
      error: state.error,
    }).catch(() => {}); // Fire-and-forget

    // Prometheus: record execution metrics
    activeExecutions.dec();
    const execDurationSec = (Date.now() - execStartTime) / 1000;
    agentExecutionsTotal.inc({ pattern: request.orchestration, status: state.status });
    agentExecutionDuration.observe({ pattern: request.orchestration }, execDurationSec);

    // Record per-tool-call metrics from agent results
    for (const result of results) {
      for (const tc of result.toolCallsExecuted) {
        toolCallsTotal.inc({ tool_name: tc.name, status: tc.success ? 'success' : 'error' });
        toolCallDuration.observe({ tool_name: tc.name }, tc.durationMs / 1000);
      }
      // Record cost by model
      if (result.metrics.costCents > 0 && result.metrics.modelUsed) {
        costTotal.inc({ model: result.metrics.modelUsed }, result.metrics.costCents);
      }
    }

    emitFn('execution_complete', {
      output: state.output.substring(0, 1000),
      aggregatedMetrics: metrics,
      timestamp: Date.now(),
    });
  }

  private async runParallel(
    agents: Array<AgentSpec & { agentId: string; model: string; maxTurns: number; timeout: number; systemPrompt: string }>,
    runner: AgentRunner,
    emit: (e: string, d: any) => void,
    ctx: RunContext,
    maxConcurrency: number
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    for (let i = 0; i < agents.length; i += maxConcurrency) {
      const batch = agents.slice(i, i + maxConcurrency);
      const batchResults = await Promise.allSettled(
        batch.map(agent => runner.run(agent, emit, ctx))
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          const failedAgent = batch[batchResults.indexOf(r)];
          results.push({
            agentId: failedAgent?.agentId || 'unknown',
            role: failedAgent?.role || 'custom',
            status: 'error',
            output: '',
            toolCallsExecuted: [],
            metrics: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, durationMs: 0, costCents: 0, modelUsed: '', fallbackUsed: false, toolCallRounds: 0 },
            error: r.reason?.message || String(r.reason),
          });
        }
      }
    }
    return results;
  }

  private async runSequential(
    agents: Array<AgentSpec & { agentId: string; model: string; maxTurns: number; timeout: number; systemPrompt: string }>,
    runner: AgentRunner,
    emit: (e: string, d: any) => void,
    ctx: RunContext
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    let previousOutput = '';

    for (const agent of agents) {
      // Chain: append previous output to task
      const chainedTask = previousOutput
        ? `${agent.task}\n\n--- Previous agent output ---\n${previousOutput}`
        : agent.task;

      const chainedAgent = { ...agent, task: chainedTask };
      const result = await runner.run(chainedAgent, emit, ctx);
      results.push(result);
      previousOutput = result.output;

      if (result.status === 'error') {
        logger.warn({ agentId: agent.agentId }, 'Sequential chain: agent failed, stopping chain');
        break;
      }
    }
    return results;
  }

  private async runSupervisor(
    agents: Array<AgentSpec & { agentId: string; model: string; maxTurns: number; timeout: number; systemPrompt: string }>,
    runner: AgentRunner,
    emit: (e: string, d: any) => void,
    ctx: RunContext,
    request: ExecuteRequest
  ): Promise<AgentResult[]> {
    // Supervisor strategy: first agent is the supervisor, rest are available workers.
    // The supervisor LLM decides which workers to dispatch and in what order.
    if (agents.length < 2) {
      return this.runParallel(agents, runner, emit, ctx, 5);
    }

    const [supervisorSpec, ...workerSpecs] = agents;
    const results: AgentResult[] = [];
    const workerDescriptions = workerSpecs.map(w =>
      `- ${w.agentId} (role: ${w.role}): ${w.task.substring(0, 200)}`
    ).join('\n');

    // Build supervisor prompt
    const supervisorPrompt = `You are a supervisor agent coordinating a team of worker agents.

USER REQUEST: ${request.userMessage}

AVAILABLE WORKERS:
${workerDescriptions}

Your job:
1. Analyze the user request and decide which workers to dispatch
2. Respond with a JSON plan: {"dispatch": [{"agentId": "...", "task": "refined task for this worker"}], "reasoning": "why these workers"}
3. After receiving worker results, synthesize a final answer

Rules:
- Only dispatch workers that are relevant to the task
- You can dispatch workers in sequence (one at a time) or all at once
- Refine each worker's task to be specific and actionable
- Respond ONLY with valid JSON, no markdown fences`;

    // Step 1: Ask supervisor which workers to dispatch
    const supervisorAgent = {
      ...supervisorSpec,
      systemPrompt: supervisorPrompt,
      task: `Analyze this request and create a dispatch plan:\n\n${request.userMessage}`,
    };

    emit('agent_start', {
      agentId: supervisorSpec.agentId, role: 'supervisor',
      model: supervisorSpec.model, timestamp: Date.now(),
    });

    const planResult = await runner.run(supervisorAgent, emit, ctx);
    results.push(planResult);

    if (planResult.status !== 'success') {
      logger.warn({ agentId: supervisorSpec.agentId }, 'Supervisor failed to produce plan, falling back to parallel');
      const workerResults = await this.runParallel(workerSpecs, runner, emit, ctx, 5);
      return [...results, ...workerResults];
    }

    // Step 2: Parse dispatch plan
    let plan: { dispatch: Array<{ agentId: string; task: string }>; reasoning?: string };
    try {
      const jsonMatch = planResult.output.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch?.[0] || planResult.output);
    } catch {
      logger.warn('Supervisor output not valid JSON, dispatching all workers');
      plan = { dispatch: workerSpecs.map(w => ({ agentId: w.agentId, task: w.task })) };
    }

    emit('agent_delegation', {
      fromAgent: supervisorSpec.agentId,
      plan: plan.dispatch.map(d => d.agentId),
      reasoning: plan.reasoning,
      timestamp: Date.now(),
    });

    // Step 3: Dispatch selected workers with refined tasks
    const dispatchedWorkers = plan.dispatch
      .map(d => {
        const worker = workerSpecs.find(w => w.agentId === d.agentId);
        if (!worker) return null;
        return { ...worker, task: d.task || worker.task };
      })
      .filter((w): w is NonNullable<typeof w> => w !== null);

    if (dispatchedWorkers.length === 0) {
      dispatchedWorkers.push(...workerSpecs); // Fallback: dispatch all
    }

    const workerResults = await this.runParallel(dispatchedWorkers, runner, emit, ctx, 5);
    results.push(...workerResults);

    // Step 4: Ask supervisor to synthesize final answer
    const workerOutputs = workerResults.map(r =>
      `### Worker: ${r.role} (${r.agentId})\nStatus: ${r.status}\n${r.output || r.error || 'No output'}`
    ).join('\n\n');

    const synthesisAgent = {
      ...supervisorSpec,
      agentId: `${supervisorSpec.agentId}_synthesis`,
      systemPrompt: 'You are a supervisor synthesizing worker results into a final comprehensive answer.',
      task: `Original request: ${request.userMessage}\n\nWorker results:\n${workerOutputs}\n\nSynthesize these results into a clear, comprehensive final answer.`,
    };

    const synthesisResult = await runner.run(synthesisAgent, emit, ctx);
    results.push(synthesisResult);

    return results;
  }

  private async runHierarchical(
    agents: Array<AgentSpec & { agentId: string; model: string; maxTurns: number; timeout: number; systemPrompt: string }>,
    runner: AgentRunner,
    emit: (e: string, d: any) => void,
    ctx: RunContext,
    request: ExecuteRequest
  ): Promise<AgentResult[]> {
    // Hierarchical strategy: split agents into tiers.
    // Tier 0 (first agent) = top supervisor
    // Remaining agents split into groups, each group led by the first agent in the group.
    // For simplicity: if <=3 agents, use supervisor. If >3, create sub-groups.
    if (agents.length <= 3) {
      return this.runSupervisor(agents, runner, emit, ctx, request);
    }

    const [topSupervisor, ...rest] = agents;
    const groupSize = Math.ceil(rest.length / 2);
    const groups = [];
    for (let i = 0; i < rest.length; i += groupSize) {
      groups.push(rest.slice(i, i + groupSize));
    }

    emit('agent_delegation', {
      fromAgent: topSupervisor.agentId,
      strategy: 'hierarchical',
      groups: groups.map((g, i) => ({ groupIndex: i, agents: g.map(a => a.agentId) })),
      timestamp: Date.now(),
    });

    // Run each group as a supervisor pattern (first agent in group leads)
    const groupResults = await Promise.allSettled(
      groups.map(group => {
        if (group.length === 1) {
          return runner.run(group[0], emit, ctx);
        }
        return this.runSupervisor(group, runner, emit, ctx, request);
      })
    );

    const allResults: AgentResult[] = [];
    for (const gr of groupResults) {
      if (gr.status === 'fulfilled') {
        if (Array.isArray(gr.value)) {
          allResults.push(...gr.value);
        } else {
          allResults.push(gr.value);
        }
      }
    }

    // Top supervisor synthesizes group results
    const groupOutputs = allResults
      .filter(r => r.status === 'success')
      .map(r => `### ${r.role} (${r.agentId})\n${r.output}`)
      .join('\n\n');

    const finalSynthesis = {
      ...topSupervisor,
      systemPrompt: 'You are the top-level supervisor. Synthesize all team results into a final comprehensive answer.',
      task: `Original request: ${request.userMessage}\n\nTeam results:\n${groupOutputs}\n\nProvide the final synthesized answer.`,
    };

    const synthResult = await runner.run(finalSynthesis, emit, ctx);
    return [...allResults, synthResult];
  }

  private async aggregateResults(
    results: AgentResult[],
    strategy: string,
    userMessage: string,
    ctx: RunContext
  ): Promise<string> {
    const successResults = results.filter(r => r.status === 'success' || r.status === 'loop_detected');

    switch (strategy) {
      case 'first': {
        return successResults[0]?.output || 'No agents completed successfully.';
      }
      case 'synthesize': {
        // For supervisor/hierarchical, the last successful result IS the synthesis
        if (successResults.length > 0) {
          const last = successResults[successResults.length - 1];
          if (last.agentId.includes('synthesis') || last.role === 'supervisor' || last.role === 'synthesis') {
            return last.output;
          }
        }
        // LLM-powered synthesis: combine results intelligently
        return this.llmSynthesize(successResults, userMessage, ctx);
      }
      case 'vote': {
        if (successResults.length === 0) return 'No agents completed successfully.';
        if (successResults.length === 1) return successResults[0].output;

        // Improved vote: Use content similarity beyond just first 100 chars
        const groups = new Map<string, { count: number; fullOutput: string; quality: number }>();
        for (const r of successResults) {
          // Use normalized content fingerprint (more robust than first 100 chars)
          const words = r.output.toLowerCase().split(/\s+/).slice(0, 50);
          const key = words.join(' ');
          const existing = groups.get(key);
          const quality = r.metrics.toolCallRounds > 0 ? 2 : 1; // Tool-backed answers are higher quality
          if (existing) {
            existing.count++;
            existing.quality += quality;
          } else {
            groups.set(key, { count: 1, fullOutput: r.output, quality });
          }
        }
        let best = { count: 0, fullOutput: '', quality: 0 };
        for (const g of groups.values()) {
          if (g.quality > best.quality || (g.quality === best.quality && g.count > best.count)) {
            best = g;
          }
        }
        return best.fullOutput || successResults[0].output;
      }
      case 'merge':
      default: {
        // For merge: if there's only one successful result, return it directly (no metadata noise)
        if (successResults.length === 1) {
          return successResults[0].output;
        }
        const parts: string[] = [];
        for (const result of results) {
          if (result.status === 'error' && !result.output) continue; // Skip empty errors
          parts.push(
            `## Agent: ${result.role} (${result.agentId})\n` +
            `Status: ${result.status}\n` +
            `Model: ${result.metrics.modelUsed}\n` +
            `Tool calls: ${result.toolCallsExecuted.length}\n` +
            `Tokens: ${result.metrics.inputTokens}in/${result.metrics.outputTokens}out\n` +
            `Duration: ${result.metrics.durationMs}ms\n\n` +
            (result.output || result.error || 'No output')
          );
        }
        return parts.join('\n\n---\n\n');
      }
    }
  }

  /**
   * LLM-powered result synthesis — uses a fast model to intelligently combine
   * multiple agent outputs, resolve conflicts, and produce a coherent response.
   */
  private async llmSynthesize(
    results: AgentResult[],
    userMessage: string,
    ctx: RunContext
  ): Promise<string> {
    if (results.length === 0) return 'No agents completed successfully.';
    if (results.length === 1) return results[0].output;

    const agentOutputs = results.map(r =>
      `=== Agent: ${r.role} (${r.agentId}) ===\n` +
      `Tools used: ${r.toolCallsExecuted.map(t => t.name).join(', ') || 'none'}\n` +
      `${r.output}`
    ).join('\n\n');

    try {
      const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Agent-Proxy': 'true' };

      if (internalSecret) {
        headers['X-Request-From'] = 'openagentic-proxy';
        headers['X-Internal-Secret'] = internalSecret;
        // ALSO send as Authorization: Bearer so API tokenValidator accepts it
        headers['Authorization'] = `Bearer ${internalSecret}`;
        // User API keys (oa_…, excluding oa_sys_…) also go in X-API-Key.
        if (internalSecret.startsWith('oa_') && !internalSecret.startsWith('oa_sys_')) {
          headers['X-API-Key'] = internalSecret;
        }
      } else {
        const authToken = ctx.userToken || process.env.OPENAGENTIC_PROXY_API_KEY || process.env.OPENAGENTIC_PROXY_INTERNAL_KEY || process.env.FLOWISE_INTERNAL_API_KEY;
        if (!authToken) {
          return results.map(r => r.output).join('\n\n---\n\n');
        }
        headers['Authorization'] = `Bearer ${authToken}`;
        // User API keys (oa_…, excluding oa_sys_…) authenticate via X-API-Key.
        if (authToken.startsWith('oa_') && !authToken.startsWith('oa_sys_')) {
          headers['X-API-Key'] = authToken;
        } else {
          headers['Authorization'] = `Bearer ${authToken}`;
        }
      }

      const response = await axios.post(
        `${this.apiUrl}/api/v1/chat/completions`,
        {
          model: PLANNER_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a synthesis agent. Combine the outputs from multiple specialist agents into one coherent, comprehensive response. ' +
                'Resolve any conflicts between agent outputs by preferring tool-backed findings over pure reasoning. ' +
                'Do NOT mention the individual agents or their roles — present the information as a unified answer. ' +
                'Be thorough but concise. Preserve all important details, data, and recommendations.',
            },
            {
              role: 'user',
              content: `Original user request: ${userMessage}\n\nAgent outputs to synthesize:\n\n${agentOutputs}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 4096,
          stream: false,
        },
        { headers, timeout: 60000 }
      );

      return response.data?.choices?.[0]?.message?.content || results.map(r => r.output).join('\n\n---\n\n');
    } catch (err) {
      logger.warn({ err }, 'LLM synthesis failed, falling back to merge');
      return results.map(r => r.output).filter(Boolean).join('\n\n---\n\n');
    }
  }

  private getExecutionMetrics(state: ExecutionState): any {
    return {
      totalDurationMs: (state.completedAt || Date.now()) - state.startedAt,
      agentCount: state.results.length,
      successCount: state.results.filter(r => r.status === 'success').length,
      errorCount: state.results.filter(r => r.status === 'error').length,
      totalInputTokens: state.results.reduce((s, r) => s + r.metrics.inputTokens, 0),
      totalOutputTokens: state.results.reduce((s, r) => s + r.metrics.outputTokens, 0),
      totalCostCents: state.results.reduce((s, r) => s + r.metrics.costCents, 0),
    };
  }
}
