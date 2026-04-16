/**
 * Agents Stage - Injects delegate_to_agents tool and background agent results
 *
 * Position in pipeline: After MCP stage (tools discovered), before message-preparation.
 *
 * Three responsibilities:
 * A) ALWAYS inject `delegate_to_agents` tool — let the LLM decide when delegation
 *    is valuable (like Claude Code always has Task tool available).
 * B) Inject complexity hint in system context to help LLM make better delegation decisions.
 * C) Attach pending background agent results as context.
 *
 * Design philosophy: The LLM is smarter than regex at knowing when to delegate.
 * We give it the tool unconditionally and provide guidance on when to use it.
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { getImageGenToolDefinition } from './image-gen-tool.js';

const AGENT_ROLES = [
  'reasoning', 'data_query', 'tool_orchestration', 'summarization',
  'code_execution', 'planning', 'validation', 'synthesis', 'artifact_creation',
  'cloud_operations', 'custom',
];

// Signals that a query is likely to benefit from multi-agent orchestration.
// Used for the complexity hint, NOT for gating the tool.
const COMPLEXITY_SIGNALS = {
  multiDomain: /\b(aws|azure|gcp|kubernetes|github|financial|legal|technical)\b/gi,
  parallelWork: /\b(simultaneously|concurrently|in parallel|at the same time|meanwhile)\b/i,
  multiStep: /\b(first|then|after|next|finally|step \d|phase \d)\b/gi,
  decomposition: /\b(break down|decompose|analyze.*multiple|compare.*across|comprehensive.*audit)\b/i,
  explicitDelegation: /\b(use agents?|delegate|orchestrate|spawn|multi-?agent)\b/i,
  // cloudOps: long-horizon multi-step provisioning OR cross-resource enterprise audit.
  // When this matches, AgentsStage prepends a strong delegation hint to the LLM
  // so it picks cloud_operations via delegate_to_agents instead of running inline.
  cloudOps:
    /\b(create|provision|deploy|spin\s*up|set\s*up|launch|stand\s*up)\b[\s\S]{0,300}\b(then|after|next|and\s+(?:then|also|create|provision|deploy)|step\s*\d|first[\s\S]{0,80}then)\b|\b(audit|inventory|enumerate|discover|map|catalog)\b[\s\S]{0,200}\b(across|all|every|enterprise|organi[sz]ation|tenant|subscriptions?|accounts?|projects?|resource\s*groups?)\b/i,
};

export class AgentsStage implements PipelineStage {
  readonly name = 'agents';
  readonly priority = 45; // After MCP (40), before message-preparation (50)

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const openagenticProxyEnabled = process.env.OPENAGENTIC_PROXY_ENABLED !== 'false';
    const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-proxy:3300';

    if (!openagenticProxyEnabled) {
      context.logger.debug('[Agents] Agent proxy disabled, skipping');
      return context;
    }

    // ─── A) Inject delegate_to_agents tool when appropriate ─────────────
    // Skip for simple queries that don't need delegation (math, greetings).
    // The LLM decides when to delegate for complex queries.
    if (!context.availableTools) context.availableTools = [];

    // Check if this is a simple query — no delegation needed
    const userMsg = (context.request.message || '').toLowerCase().trim();
    const isSimpleQuery = this.isSimpleQuery(userMsg);
    if (isSimpleQuery) {
      context.logger.debug('[Agents] Simple query detected, skipping delegate_to_agents injection');
      return context;
    }

    // Remove old spawn_parallel_agents if present
    context.availableTools = context.availableTools.filter(
      (t: any) => t.function?.name !== 'spawn_parallel_agents' && t.function?.name !== 'delegate_to_agents'
    );

    // Build the list of available MCP tools for the tool description
    const toolNames = (context.availableTools || [])
      .map((t: any) => t.function?.name)
      .filter(Boolean)
      .slice(0, 50); // Cap at 50 to keep tool description manageable

    // Inject generate_image tool so it's available to artifact_creation agents
    const hasImageGenTool = context.availableTools.some((t: any) => t.function?.name === 'generate_image');
    if (!hasImageGenTool) {
      context.availableTools.push(getImageGenToolDefinition());
    }

    // Build dynamic agent catalog from registry for LLM visibility
    let agentGuidance = '';
    let modelGuidance = '';
    let oatGuidance = '';
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const dbAgents = await prisma.agent.findMany({
        where: { enabled: true },
        select: { name: true, display_name: true, agent_type: true, description: true, tools_whitelist: true, tags: true },
        orderBy: { agent_type: 'asc' },
      });
      if (dbAgents.length > 0) {
        agentGuidance = '\n\nAvailable agents (from registry — use these roles):\n' +
          dbAgents.map((a: any) => {
            const tools = (a.tools_whitelist || []).length > 0 ? ` [tools: ${a.tools_whitelist.slice(0, 5).join(', ')}]` : '';
            return `- role: "${a.agent_type}" (${a.display_name || a.name}): ${(a.description || '').substring(0, 120)}${tools}`;
          }).join('\n') +
          '\nPick the role that best matches each subtask. Agents resolve their full config from the registry.';
      }
    } catch { /* non-fatal — fall back to hardcoded roles */ }

    try {
      const { ModelConfigurationService: mcs } = await import('../../../services/ModelConfigurationService.js');
      const models = await mcs.getAvailableModelsForDisplay();
      if (models.length > 0) {
        modelGuidance = '\n\nAvailable models (from registry):\n' +
          models.map((m: any) => `- ${m.modelId} (${m.provider}): ${m.tier} tier, ${Math.round(m.contextWindow/1000)}K ctx`).join('\n') +
          '\nAgents get tier-appropriate models by role automatically. Override with the model field.';
      }
    } catch { /* non-fatal */ }

    // OAT availability hint
    const synthEnabled = process.env.SYNTH_ENABLED !== 'false' && process.env.SYNTH_VISIBLE_TO_LLM !== 'false';
    if (synthEnabled) {
      oatGuidance = '\n\nOAT (synth_synthesize) is available as a LAST RESORT only. ALWAYS prefer existing MCP tools first (azure_*, aws_*, k8s_*, github_*, web_*). Only use OAT when NO existing tool can accomplish the task.';
    }

    context.availableTools.push({
      type: 'function',
      function: {
        name: 'delegate_to_agents',
        description:
          'Delegate work to specialized AI agents. Each agent gets its own tool loop and context.\n' +
          'USE when:\n' +
          '- Creating dashboards, charts, visualizations, presentations → role "artifact_creation" (1 agent)\n' +
          '- Deep analysis, research, reasoning about complex topics → role "reasoning"\n' +
          '- Multi-step data queries across multiple sources → role "data_query"\n' +
          '- Complex multi-tool orchestration (5+ tools, chained operations) → role "tool_orchestration"\n' +
          '- Writing and executing code (scripts, tests, debugging) → role "code_execution"\n' +
          '- Task decomposition and planning → role "planning"\n' +
          '- Validating outputs, fact-checking, cross-referencing → role "validation"\n' +
          '- Combining results from multiple sources → role "synthesis"\n' +
          '- LONG-HORIZON multi-step cloud infrastructure work (provision + audit + cleanup across Azure/AWS/GCP, multi-resource dependencies, quota fallbacks, cross-subscription queries) → role "cloud_operations" with maxTurns: 40. This agent has typed cloud SDK tools, infrastructure-tuned prompt, and a 1M-context-class model. Always prefer this over running multi-step infra inline.\n' +
          'DO NOT USE for simple questions, single tool calls, or tasks you can answer directly.\n' +
          'Use 1 agent per distinct task. Use multiple agents for genuinely independent parallel work.' +
          agentGuidance + modelGuidance + oatGuidance,
        parameters: {
          type: 'object',
          required: ['agents', 'orchestration'],
          properties: {
            agents: {
              type: 'array',
              minItems: 1,
              description: 'Agent specs — each agent gets its own LLM loop with tool access',
              items: {
                type: 'object',
                required: ['role', 'task'],
                properties: {
                  role: {
                    type: 'string',
                    enum: AGENT_ROLES,
                    description: 'Agent specialization: reasoning (deep analysis), data_query (structured data), ' +
                      'tool_orchestration (multi-tool chains), code_execution (write/run code), ' +
                      'planning (decompose tasks), validation (verify outputs), synthesis (combine results), ' +
                      'artifact_creation (visual artifacts: dashboards, reports, diagrams, charts, interactive visualizations, presentations)',
                  },
                  task: {
                    type: 'string',
                    description: 'Specific, actionable task for this agent. Be precise — vague tasks produce vague results.',
                  },
                  tools: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Restrict this agent to specific MCP tools (optional — omit for all tools)',
                  },
                  model: {
                    type: 'string',
                    description: 'Model override. Use "auto" for SmartRouter selection, or specify e.g. "claude-sonnet-4-6" for cost-efficient agents',
                  },
                  maxTurns: {
                    type: 'number',
                    description: 'Max tool-call rounds for this agent (default: 5, max: 15). Increase for complex multi-step tasks.',
                  },
                  workflow_id: {
                    type: 'string',
                    description: 'Instead of an LLM agent, execute a saved workflow by ID. The workflow receives the task as input and its output becomes the agent result. Use workflow_list to discover available workflows.',
                  },
                },
              },
            },
            orchestration: {
              type: 'string',
              enum: ['parallel', 'sequential', 'supervisor', 'hierarchical'],
              description: 'Execution strategy: parallel (all at once, best for independent tasks), ' +
                'sequential (chain output→input, for dependent steps), ' +
                'supervisor (LLM plans which workers to dispatch — best for complex/ambiguous tasks), ' +
                'hierarchical (multi-level supervisor tree for large agent teams)',
            },
            aggregation: {
              type: 'string',
              enum: ['merge', 'synthesize', 'first', 'vote'],
              description: 'Result aggregation: synthesize (LLM combines results — recommended for most cases), ' +
                'merge (concatenate all outputs), first (return first success), vote (consensus)',
            },
          },
        },
      },
    });
    context.logger.debug('[Agents] Injected delegate_to_agents tool (always-on)');

    // ─── B) Inject complexity analysis hint ──────────────────────────────
    const userQuery = context.request.message || '';
    const complexityHint = this.analyzeComplexity(userQuery);
    if (complexityHint) {
      // Add as a subtle system hint — doesn't force delegation, just informs the LLM
      (context as any).agentComplexityHint = complexityHint;
      // PromptStage runs BEFORE AgentsStage, so the agentComplexityHint stored on
      // context never reaches the system prompt. Inject directly into messages so
      // the LLM actually sees it on this turn.
      context.messages.push({
        id: `complexity_hint_${Date.now()}`,
        role: 'system',
        content: complexityHint,
        timestamp: new Date(),
        tokenUsage: null,
      } as any);
    }

    // ─── B.2) Strong cloud-ops delegation directive ──────────────────────
    // When the regex detects multi-step provisioning or enterprise audit, we
    // PREPEND a directive directly to the user message in the in-flight messages
    // array. This is unavoidable for the LLM — it reads the user message verbatim
    // and treats prefixed instructions as user intent, not a trailing system
    // hint that can be ignored. Tested: trailing system message gets ignored by
    // Sonnet 4.5 in favour of inline execution.
    if (COMPLEXITY_SIGNALS.cloudOps.test(userQuery)) {
      // ARCHITECTURAL ENFORCEMENT — strip every cloud / k8s / synth tool from the
      // parent LLM's tool list so it has NO choice but to delegate via the only
      // tool we leave available (delegate_to_agents). Telling the LLM "please
      // delegate" via a system directive isn't reliable — Sonnet/Opus have strong
      // tool-use post-training that overrides preambles when they see a clear
      // path to do the work themselves. Removing the tools entirely is the only
      // robust mechanism. The cloud_operations sub-agent gets the FULL tool list
      // back via its own MCPBridge in openagentic-proxy.
      //
      // CRITICAL: do NOT prepend any directive into the user message itself.
      // The LLM's delegate_to_agents call passes the user's message verbatim
      // as the sub-agent's `task` field — if the directive is glued to the
      // front, the sub-agent's task says "your first call must be delegate_to_agents"
      // which causes the sub-agent to recursively delegate, waste a turn on a 400
      // error, and burn iteration budget. Use a SEPARATE system message instead.
      const STRIP_PREFIXES = ['azure_', 'aws_', 'gcp_', 'k8s_', 'helm_', 'call_aws'];
      const beforeStrip = context.availableTools.length;
      context.availableTools = context.availableTools.filter((t: any) => {
        const name = (t.function?.name || t.name || '').toLowerCase();
        // Always keep delegate_to_agents and a small allowlist of meta tools
        if (name === 'delegate_to_agents') return true;
        if (name === 'web_search' || name === 'web_fetch') return true; // for docs lookup
        if (name === 'sequential_thinking' || name === 'sequentialthinking') return true;
        // Strip everything that looks like a direct cloud call
        for (const p of STRIP_PREFIXES) {
          if (name.startsWith(p)) return false;
        }
        // Also strip synth_synthesize so the LLM can't bypass via Python escape hatch
        if (name === 'synth_synthesize') return false;
        return true;
      });
      context.logger.info({
        before: beforeStrip,
        after: context.availableTools.length,
        stripped: beforeStrip - context.availableTools.length,
      }, '[Agents] cloudOps signal matched — stripped direct cloud tools to force delegation');

      // Trailing system message (NOT prepended into the user message). This is a
      // hint, not a coercion — the actual coercion is the empty cloud-tool list
      // above. The hint just helps the LLM phrase the delegate_to_agents call
      // correctly (right role, right maxTurns, right task content).
      context.messages.push({
        id: `cloud_ops_hint_${Date.now()}`,
        role: 'system',
        content:
          'Routing hint for THIS turn only: this request is multi-step cloud infrastructure work or an ' +
          'enterprise-scale cloud audit. The only cloud-related tool available to you is `delegate_to_agents`. ' +
          'Call it ONCE with: agents=[{role:"cloud_operations", task:"<the user\'s full request verbatim, every ' +
          'requirement, every audit query>", maxTurns:40}], orchestration:"sequential", aggregation:"synthesize". ' +
          'The `task` field MUST be the user\'s actual request — do NOT include this routing hint in it. ' +
          'After the sub-agent returns, write a summary for the user and stop.',
        timestamp: new Date(),
        tokenUsage: null,
      } as any);
      context.logger.info({ msgPreview: userQuery.substring(0, 120) }, '[Agents] Cloud-ops delegation hint appended as system message (not prepended to user message)');
    }

    // ─── C) Attach background agent results ─────────────────────────────
    try {
      const prisma = (context as any).prisma || (globalThis as any).__prisma;
      if (prisma) {
        const pendingResults = await prisma.backgroundAgentResult?.findMany({
          where: {
            session_id: context.request.sessionId,
            user_id: context.user.id,
            consumed: false,
            status: 'completed',
          },
          orderBy: { created_at: 'asc' },
          take: 5,
        }).catch(() => []);

        if (pendingResults && pendingResults.length > 0) {
          const bgContext = pendingResults.map((r: any) =>
            `[Background ${r.agent_type}: ${r.result_type}]\n${JSON.stringify(r.result_data)}`
          ).join('\n\n');

          context.messages.push({
            id: `bg_results_${Date.now()}`,
            role: 'system',
            content: `Background agent results available:\n${bgContext}`,
            timestamp: new Date(),
            tokenUsage: null,
          });

          await prisma.backgroundAgentResult?.updateMany({
            where: { id: { in: pendingResults.map((r: any) => r.id) } },
            data: { consumed: true },
          }).catch(() => {});

          context.logger.info({ count: pendingResults.length }, '[Agents] Injected background agent results');
        }
      }
    } catch (err) {
      context.logger.debug({ err }, '[Agents] Background results lookup failed (non-fatal)');
    }

    (context as any).openagenticProxyUrl = openagenticProxyUrl;
    return context;
  }

  /**
   * Check if query is simple enough to skip delegation entirely.
   * Greetings, math, short questions don't need multi-agent orchestration.
   */
  private isSimpleQuery(query: string): boolean {
    // Math, greetings at any length
    if (/^(what('s| is)\s+\d|how much|calculate|\d+\s*[+\-*/])/i.test(query)) return true;
    if (/^(hi|hello|hey|thanks|thank you|bye|good\s)/i.test(query)) return true;

    // Simple questions up to 120 chars (covers "What is X? Answer in one word." patterns)
    if (query.length < 120) {
      // Single factual question without multi-part indicators
      if (/^(what|who|where|when|why|how)\b/i.test(query) && !/\b(and then|also|after that|simultaneously|in parallel|compare.*across|multiple|analyze.*and)\b/i.test(query)) return true;
      // Direct commands like "explain", "define", "describe"
      if (/^(explain|define|describe|tell me|list|name)\b/i.test(query) && !/\b(and then|also|after that)\b/i.test(query)) return true;
    }
    return false;
  }

  /**
   * Analyze query complexity and return a hint string for the system prompt.
   * Returns null for simple queries.
   */
  private analyzeComplexity(query: string): string | null {
    if (query.length < 30) return null;

    const domainMatches = query.match(COMPLEXITY_SIGNALS.multiDomain) || [];
    const uniqueDomains = [...new Set(domainMatches.map(d => d.toLowerCase()))];
    const hasParallelSignal = COMPLEXITY_SIGNALS.parallelWork.test(query);
    const stepMatches = query.match(COMPLEXITY_SIGNALS.multiStep) || [];
    const hasDecomposition = COMPLEXITY_SIGNALS.decomposition.test(query);
    const hasExplicit = COMPLEXITY_SIGNALS.explicitDelegation.test(query);

    // Detect artifact requests — these MUST delegate
    const isArtifactRequest = /\b(create|build|make|generate|design)\b.*\b(artifact|dashboard|visualization|interactive|report|textbook|diagram|chart|simulation|presentation)\b/i.test(query) ||
      /\b(interactive|visual)\b.*\b(html|page|document|app)\b/i.test(query);

    const score = uniqueDomains.length * 2 + (hasParallelSignal ? 3 : 0) +
      Math.min(stepMatches.length, 3) + (hasDecomposition ? 2 : 0) + (hasExplicit ? 5 : 0) +
      (isArtifactRequest ? 10 : 0); // Artifact requests always score high enough to hint delegation

    if (score < 3) return null;

    const parts: string[] = [];
    if (uniqueDomains.length >= 2) parts.push(`spans ${uniqueDomains.length} domains (${uniqueDomains.join(', ')})`);
    if (hasParallelSignal) parts.push('user requests parallel work');
    if (stepMatches.length >= 3) parts.push(`has ${stepMatches.length} sequential steps`);
    if (hasDecomposition) parts.push('requires decomposition');
    if (hasExplicit) parts.push('user explicitly requests agent delegation');
    if (isArtifactRequest) parts.push('ARTIFACT REQUEST — call delegate_to_agents with a SINGLE artifact_creation agent (1 agent is enough, do NOT split into multiple agents)');

    return `[Complexity: ${score >= 8 ? 'HIGH' : 'MODERATE'}] This request ${parts.join(', ')}. ` +
      `Consider using delegate_to_agents for better results.`;
  }
}
