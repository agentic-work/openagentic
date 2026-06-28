/**
 * AgentRegistry
 *
 * Central registry for all agents in the OpenAgentic platform.
 * Provides full observability, metrics, and admin management capabilities.
 *
 * Features:
 * - Register/manage agents (data layer, tool execution, reasoning, etc.)
 * - Configure which model is used for each agent type
 * - Track all metrics: executions, latency, tokens, costs, success rates
 * - OTEL tracing integration for distributed observability
 * - Admin API for configuration and monitoring
 *
 * This enables the platform to:
 * - Use different models for different agent tasks (fast model for queries, smart for reasoning)
 * - Monitor agent performance in real-time
 * - Debug issues with full trace visibility
 * - Optimize costs by routing appropriately
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import { getRedisClient, type UnifiedRedisClient } from '../utils/redis-client.js';
import { prisma } from '../utils/prisma.js';
// AGENT_MODELS removed — agents use 'auto' (Smart Router / DB-configured models)
import type { Logger } from 'pino';
import type { Agent, AgentExecution, AgentVersion, Prisma } from '@prisma/client';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/**
 * Agent types in the platform
 */
export type AgentType =
  | 'data_query'           // Queries stored datasets (fast, simple)
  | 'data_extraction'      // Extracts/filters data from large responses
  | 'tool_orchestration'   // Decides which tools to call
  | 'reasoning'            // Complex multi-step reasoning
  | 'summarization'        // Summarizes large content
  | 'code_execution'       // Code generation/execution
  | 'planning'             // Plans multi-step tasks
  | 'validation'           // Validates tool outputs
  | 'synthesis'            // Synthesizes final response
  | 'artifact_creation'    // Visual artifact generation (dashboards, reports, diagrams)
  | 'docs_assistant'       // Documentation RAG chat assistant
  | 'flows_agent'          // Workflow/flows execution agent
  | 'cloud_operations'     // Long-horizon multi-cloud (Azure/AWS/GCP) provisioning + audit
  | 'finops_analyst'       // Cloud cost / FinOps dashboards (per-service, per-region spend)
  | 'security_auditor'     // IAM graphs, data-class heatmaps, compliance scorecards
  | 'engineering_metrics'  // DORA dashboards, pipeline health, per-service SLO status
  | 'product_analyst'      // Roadmap swimlanes, OKR scorecards, funnel metrics
  | 'custom';              // Custom agent type

/**
 * Workload-based tier preference. Advisory hint to SmartRouter when resolving
 * primaryModel='auto'. Honoured if a model in the preferred tier is configured
 * for the user's slider; otherwise falls back to slider-based resolution.
 */
export type ModelTierPreference = 'premium' | 'balanced' | 'economical' | 'free';

/**
 * Model configuration for an agent
 */
export interface AgentModelConfig {
  agentType: AgentType;
  primaryModel: string;        // 'auto' = SmartRouter selects, OR explicit model id
  fallbackModel?: string;      // 'auto' = SmartRouter selects, OR explicit model id
  maxTokens: number;
  temperature: number;
  thinkingEnabled: boolean;
  thinkingBudget?: number;     // Max thinking tokens
  costBudgetPerCall: number;   // Max cost in cents per call
  timeoutMs: number;
  retryAttempts: number;
  preferredTier?: ModelTierPreference;  // Workload-based hint to SmartRouter
  contextWindowMin?: number;            // Floor for context window when picking a model
}

/**
 * Agent execution metrics
 */
export interface AgentExecutionMetrics {
  agentType: AgentType;
  executionId: string;
  sessionId: string;
  userId: string;

  // Timing
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  queueTimeMs?: number;

  // Model info
  modelUsed: string;
  modelFallbackUsed: boolean;

  // Tokens
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;

  // Cost
  estimatedCostCents: number;

  // Results
  success: boolean;
  error?: string;
  errorCode?: string;
  resultSize?: number;

  // Context
  toolCallsInvolved: string[];
  datasetIdsAccessed: string[];

  // Trace
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

/**
 * Aggregated agent statistics
 */
export interface AgentStats {
  agentType: AgentType;
  period: 'hour' | 'day' | 'week' | 'month';

  // Counts
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;

  // Performance
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;

  // Tokens
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  avgTokensPerCall: number;

  // Cost
  totalCostCents: number;
  avgCostPerCallCents: number;

  // Errors
  errorBreakdown: Record<string, number>;

  // Models
  modelUsageBreakdown: Record<string, number>;
}

/**
 * Admin configuration for an agent
 */
export interface AgentAdminConfig {
  agentType: AgentType;
  enabled: boolean;
  modelConfig: AgentModelConfig;
  rateLimit: {
    maxPerMinute: number;
    maxPerHour: number;
    maxConcurrent: number;
  };
  alerts: {
    errorRateThreshold: number;    // Alert if error rate > X%
    latencyThreshold: number;      // Alert if p95 latency > X ms
    costThreshold: number;         // Alert if daily cost > X cents
  };
  logging: {
    verboseLogging: boolean;
    logInputs: boolean;
    logOutputs: boolean;
    sampleRate: number;            // 0.0 to 1.0 for sampling
  };
}

/**
 * Registered agent definition
 */
export interface RegisteredAgent {
  id: string;
  type: AgentType;
  name: string;
  description: string;
  version: string;
  config: AgentAdminConfig;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'disabled' | 'deprecated';
}

// =============================================================================
// DEFAULT CONFIGURATIONS
// =============================================================================

export const DEFAULT_MODEL_CONFIGS: Record<AgentType, AgentModelConfig> = {
  data_query: {
    agentType: 'data_query',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 2048,
    temperature: 0,
    thinkingEnabled: false,
    costBudgetPerCall: 5,
    timeoutMs: 10000,
    retryAttempts: 2,
    preferredTier: 'economical',
  },
  data_extraction: {
    agentType: 'data_extraction',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 4096,
    temperature: 0,
    thinkingEnabled: false,
    costBudgetPerCall: 20,
    timeoutMs: 30000,
    retryAttempts: 2,
    preferredTier: 'economical',
  },
  tool_orchestration: {
    agentType: 'tool_orchestration',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 4096,
    temperature: 0.1,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    costBudgetPerCall: 50,
    timeoutMs: 60000,
    retryAttempts: 3,
    preferredTier: 'balanced',
  },
  reasoning: {
    agentType: 'reasoning',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 8192,
    temperature: 0.3,
    thinkingEnabled: true,
    thinkingBudget: 16384,
    costBudgetPerCall: 100,
    timeoutMs: 120000,
    retryAttempts: 2,
    preferredTier: 'premium',
  },
  summarization: {
    agentType: 'summarization',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 4096,
    temperature: 0,
    thinkingEnabled: false,
    costBudgetPerCall: 10,
    timeoutMs: 30000,
    retryAttempts: 2,
    preferredTier: 'economical',
  },
  code_execution: {
    agentType: 'code_execution',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 8192,
    temperature: 0,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 75,
    timeoutMs: 180000,
    retryAttempts: 1,
    preferredTier: 'balanced',
  },
  planning: {
    agentType: 'planning',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 8192,
    temperature: 0.2,
    thinkingEnabled: true,
    thinkingBudget: 16384,
    costBudgetPerCall: 100,
    timeoutMs: 120000,
    retryAttempts: 2,
    preferredTier: 'premium',
  },
  validation: {
    agentType: 'validation',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 2048,
    temperature: 0,
    thinkingEnabled: false,
    costBudgetPerCall: 5,
    timeoutMs: 15000,
    retryAttempts: 2,
    preferredTier: 'economical',
  },
  synthesis: {
    agentType: 'synthesis',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 8192,
    temperature: 0.3,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 50,
    timeoutMs: 60000,
    retryAttempts: 2,
    preferredTier: 'balanced',
  },
  artifact_creation: {
    agentType: 'artifact_creation',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 32768,
    temperature: 0.4,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 200,
    timeoutMs: 180000,
    retryAttempts: 1,
    preferredTier: 'premium',  // SmartRouter picks best premium-tier model
  },
  docs_assistant: {
    agentType: 'docs_assistant',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 4096,
    temperature: 0.7,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    costBudgetPerCall: 25,
    timeoutMs: 30000,
    retryAttempts: 2,
    preferredTier: 'balanced',
  },
  flows_agent: {
    agentType: 'flows_agent',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 8192,
    temperature: 0.2,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 75,
    timeoutMs: 120000,
    retryAttempts: 2,
    preferredTier: 'premium',
  },
  cloud_operations: {
    // Long-horizon multi-cloud provisioning + enterprise audit. Big budget, big context.
    // Requires a 1M-context-class model (see ModelCapabilityGate Rule 6).
    agentType: 'cloud_operations',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 32768,
    temperature: 0.1,
    thinkingEnabled: true,
    thinkingBudget: 32768,
    costBudgetPerCall: 500,
    timeoutMs: 900000,        // 15 min per agent invocation; LRO polling extends inside
    retryAttempts: 1,
    preferredTier: 'premium',
    contextWindowMin: 1_000_000,
  },
  finops_analyst: {
    agentType: 'finops_analyst',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 32768,
    temperature: 0.4,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 200,
    timeoutMs: 180000,
    retryAttempts: 1,
    preferredTier: 'premium',
  },
  security_auditor: {
    agentType: 'security_auditor',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 32768,
    temperature: 0.4,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 200,
    timeoutMs: 180000,
    retryAttempts: 1,
    preferredTier: 'premium',
  },
  engineering_metrics: {
    agentType: 'engineering_metrics',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 32768,
    temperature: 0.4,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 200,
    timeoutMs: 180000,
    retryAttempts: 1,
    preferredTier: 'premium',
  },
  product_analyst: {
    agentType: 'product_analyst',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 32768,
    temperature: 0.4,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: 200,
    timeoutMs: 180000,
    retryAttempts: 1,
    preferredTier: 'premium',
  },
  custom: {
    agentType: 'custom',
    primaryModel: 'auto',
    fallbackModel: 'auto',
    maxTokens: 4096,
    temperature: 0.2,
    thinkingEnabled: false,
    costBudgetPerCall: 50,
    timeoutMs: 60000,
    retryAttempts: 2,
    preferredTier: 'balanced',
  }
};

// =============================================================================
// DEFAULT TOOL WHITELISTS
// Exported so tests and admin tooling can assert membership without needing
// to spin up the database. Mirrors SEED_AGENTS in admin-agents.ts.
// Empty array = all tools available; non-empty = restricted to listed tools.
// =============================================================================

export const DEFAULT_TOOLS_WHITELIST: Record<string, string[]> = {
  reasoning: ['web_search', 'web_fetch', 'sequential_thinking'],
  data_query: ['admin_postgres_raw_query', 'query_data'],
  tool_orchestration: [], // all tools
  summarization: [],
  code_execution: ['openagentic_execute'],
  planning: [],
  validation: ['web_search'],
  synthesis: [],
  // 2026-04-24: expanded to [] (all tools). When a user says "show me my
  // azure resources in an interactive architecture diagram", the
  // artifact_creation subagent needs to be able to actually FETCH the azure
  // data via the user's MCP azure_* tools — not default to web_search. Same
  // pattern as cloud_operations: empty whitelist = all tools available,
  // prompt does the scoping (the artifact-creation prompt module tells the
  // subagent to focus on visualization output). Previously the subagent
  // would apologize "I don't have direct access to your Azure subscription"
  // even when the session already had azure_* tools bound.
  artifact_creation: [],
  docs_assistant: ['web_search', 'web_fetch'],
  flows_agent: [],
  data_extraction: ['web_search', 'web_fetch'],
  // cloud_operations: multi-cloud infra. Empty = all tools (we let the system prompt
  // and the typed cloud SDK tools guide it). Web tools are available for
  // documentation lookups.
  cloud_operations: [],
  // Persona agents: MCP tool access is enforced at the user-session OBO layer.
  // Tool whitelists here are empty; per-session tool scoping is a follow-up task.
  finops_analyst: [],
  security_auditor: [],
  engineering_metrics: [],
  product_analyst: [],
  custom: [],
};

// =============================================================================
// DEFAULT PROMPT MODULES
// Exported so tests and admin tooling can assert module membership.
// Used by both new-row creation (seedDefaultLoops) AND the repair pass so
// upgrades pick up new modules without requiring a manual /seed call.
// =============================================================================

export const DEFAULT_PROMPT_MODULES: Record<string, string[]> = {
  reasoning: ['identity-default', 'safety', 'tool-calling-strategy', 'continuation'],
  data_query: ['identity-default', 'safety', 'tool-calling-strategy', 'data-efficiency', 'continuation'],
  tool_orchestration: ['identity-default', 'safety', 'tool-calling-strategy', 'provisioning-loops', 'error-recovery', 'continuation'],
  summarization: ['identity-default', 'safety', 'continuation'],
  code_execution: ['identity-default', 'safety', 'tool-calling-strategy', 'code-mode', 'continuation'],
  planning: ['identity-default', 'safety', 'agent-delegation', 'continuation'],
  validation: ['identity-default', 'safety', 'tool-calling-strategy', 'grounding-instructions', 'continuation'],
  synthesis: ['identity-default', 'safety', 'continuation'],
  artifact_creation: ['identity-default', 'safety', 'artifact-creation', 'architecture-diagram', 'continuation'],
  docs_assistant: ['identity-default', 'safety', 'continuation'],
  flows_agent: ['identity-default', 'safety', 'tool-calling-strategy', 'continuation'],
  data_extraction: ['identity-default', 'safety', 'data-efficiency', 'continuation'],
  cloud_operations: [
    'identity-default', 'safety', 'tool-calling-strategy',
    'cloud-ops-identity-discovery', 'cloud-ops-typed-tools-first',
    'cloud-ops-quota-fallback', 'cloud-ops-region-fallback',
    'cloud-ops-dependency-ordering', 'cloud-ops-long-running',
    'cloud-ops-cleanup', 'cloud-ops-hitl-denial',
    'cloud-ops-no-early-termination', 'cloud-ops-token-failure',
    'provisioning-loops', 'error-recovery',
    'azure-ops', 'aws-ops', 'gcp-ops',
    'react-reasoning', 'continuation',
  ],
  // Persona agents share the visualization + architecture module set from Task 3.
  finops_analyst: ['identity-default', 'safety', 'artifact-creation', 'architecture-diagram', 'continuation'],
  security_auditor: ['identity-default', 'safety', 'artifact-creation', 'architecture-diagram', 'continuation'],
  engineering_metrics: ['identity-default', 'safety', 'artifact-creation', 'architecture-diagram', 'continuation'],
  product_analyst: ['identity-default', 'safety', 'artifact-creation', 'architecture-diagram', 'continuation'],
  custom: ['identity-default', 'safety', 'tool-calling-strategy', 'continuation'],
};

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export class AgentRegistry {
  private log: Logger;
  private redis: UnifiedRedisClient | null = null;

  // In-memory cache for hot data (backed by PostgreSQL)
  private loopCache: Map<string, Agent> = new Map();
  private executionCache: Map<string, AgentExecutionMetrics> = new Map();
  private statsCache: Map<string, AgentStats> = new Map();
  private initialized: boolean = false;

  // Configuration
  private readonly REDIS_PREFIX = 'agentic:';
  private readonly METRICS_TTL_SECONDS = 86400;  // 24 hours
  private readonly STATS_CACHE_TTL_MS = 60000;   // 1 minute
  private readonly CACHE_TTL_MS = 300000;        // 5 minutes for loop cache

  constructor() {
    this.log = logger.child({ service: 'AgentRegistry' });
  }

  /**
   * Initialize the registry - must be called before use
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.redis = await getRedisClient();
      await this.seedDefaultLoops();
      await this.loadLoopsFromDB();
      this.initialized = true;
      this.log.info({ loopCount: this.loopCache.size }, 'AgentRegistry initialized with database backing');
    } catch (error) {
      this.log.error({ error }, 'Failed to initialize AgentRegistry');
      // Continue with in-memory fallback
      this.initialized = true;
    }
  }

  /**
   * Ensure initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ===========================================================================
  // DATABASE OPERATIONS
  // ===========================================================================

  /**
   * Seed default agent loops if they don't exist.
   * IMPORTANT: net-new installs depend on this — keep tool whitelists in sync
   * with `SEED_AGENTS` in admin-agents.ts. The admin /seed endpoint re-applies
   * the SEED_AGENTS list with the same content for upgrade scenarios.
   */
  private async seedDefaultLoops(): Promise<void> {

    for (const [agentType, config] of Object.entries(DEFAULT_MODEL_CONFIGS)) {
      const existing = await prisma.agent.findFirst({
        where: { agent_type: agentType }
      });

      if (!existing) {
        await prisma.agent.create({
          data: {
            name: agentType,
            display_name: this.formatDisplayName(agentType),
            description: `Default ${agentType} agent for the platform`,
            agent_type: agentType,
            category: 'platform',
            model_config: config as unknown as Prisma.InputJsonValue,
            graph_definition: this.getDefaultGraphDefinition(agentType as AgentType),
            tools_whitelist: DEFAULT_TOOLS_WHITELIST[agentType] || [],
            prompt_modules: DEFAULT_PROMPT_MODULES[agentType] || [],
            prompt_strategy: 'composite',
            prompt_mode: 'full',
            rate_limits: { maxPerMinute: 60, maxPerHour: 1000, maxConcurrent: 10 },
            cost_limits: { maxCostPerCall: config.costBudgetPerCall, maxDailyCost: 10000 },
            alert_config: { errorRateThreshold: 10, latencyThreshold: 30000, costThreshold: 10000 },
            logging_config: { verboseLogging: true, logInputs: true, logOutputs: true, sampleRate: 1.0 },
            enabled: true,
            is_default: true,
            version: '1.0.0'
          }
        });

        this.log.info({ agentType, tools: DEFAULT_TOOLS_WHITELIST[agentType] || [], modules: DEFAULT_PROMPT_MODULES[agentType] || [] }, 'Seeded default agent loop');
      } else if (agentType === 'artifact_creation') {
        // Upgrade path: existing rows with old whitelist variants need to pick
        // up the new empty (= all tools) list so the subagent can call MCP
        // azure_/aws_/gcp_ tools directly for "show me my X as diagram" prompts.
        // Only replace the known stale shapes — never overwrite admin edits
        // beyond those.
        const current = (existing as any).tools_whitelist || [];
        const isOldDefault = current.length === 1 && current[0] === 'generate_image';
        const isPreGapDefault =
          current.length === 4 &&
          current.includes('generate_image') &&
          current.includes('web_search') &&
          current.includes('web_fetch');
        if (isOldDefault || isPreGapDefault) {
          await prisma.agent.update({
            where: { id: existing.id },
            data: { tools_whitelist: DEFAULT_TOOLS_WHITELIST.artifact_creation, updated_at: new Date() },
          });
          this.log.info({ agentType, oldTools: current, newTools: DEFAULT_TOOLS_WHITELIST.artifact_creation }, 'Upgraded artifact_creation tools_whitelist (all tools for live-data visualization)');
        }
      }
    }

    // Audit + repair pass: every default agent must use SmartRouter ('auto'), and the
    // model_config in the DB must reflect the current preferredTier / contextWindowMin
    // floors from DEFAULT_MODEL_CONFIGS. Hardcoded model IDs in the DB are a footgun
    // (qwen3.5:latest disappears when Ollama is reseeded, claude-sonnet-4-5 burns budget
    // for agents that don't need it). Force everything to 'auto' and let the router pick.
    // Also patches prompt_modules so upgrades pick up newly-added composable modules
    // (e.g. cloud-ops-* modules added in this release) without requiring a manual seed.
    await this.repairAgentRegistry(DEFAULT_PROMPT_MODULES);
  }

  /**
   * One-time repair pass — runs every startup, idempotent.
   *  1. Force any DB row with a non-'auto' primaryModel to 'auto'.
   *  2. Patch model_config in-place to add preferredTier + contextWindowMin from
   *     DEFAULT_MODEL_CONFIGS so the SmartRouter resolution path can read them.
   *  3. Delete obvious duplicates (e.g., the legacy "Flows Agent" custom-type row that
   *     shadows the canonical flows_agent).
   */
  private async repairAgentRegistry(promptModuleDefaults: Record<string, string[]> = {}): Promise<void> {
    try {
      const rows = await prisma.agent.findMany({
        where: { is_default: true },
        select: { id: true, name: true, agent_type: true, model_config: true, prompt_modules: true, prompt_strategy: true },
      });

      let forcedToAuto = 0;
      let patchedTier = 0;
      let patchedModules = 0;

      for (const row of rows) {
        const mc = (row.model_config as any) || {};
        const updates: Record<string, any> = {};
        const def = DEFAULT_MODEL_CONFIGS[row.agent_type as AgentType];
        if (!def) continue; // not a known agent type, leave alone

        if (mc.primaryModel && mc.primaryModel !== 'auto') {
          this.log.warn({
            agentName: row.name,
            agentType: row.agent_type,
            previousModel: mc.primaryModel,
          }, '[AgentRegistry.repair] Forcing primaryModel to auto — every default agent must use SmartRouter');
          updates.primaryModel = 'auto';
          forcedToAuto++;
        }
        if (mc.fallbackModel && mc.fallbackModel !== 'auto') {
          updates.fallbackModel = 'auto';
        }
        if (def.preferredTier && mc.preferredTier !== def.preferredTier) {
          updates.preferredTier = def.preferredTier;
          patchedTier++;
        }
        if (def.contextWindowMin && mc.contextWindowMin !== def.contextWindowMin) {
          updates.contextWindowMin = def.contextWindowMin;
        }
        // Persist any maxTurns from DEFAULT_MODEL_CONFIGS so /api/agents/resolve
        // returns the right floor when the LLM doesn't pass an explicit override.
        if ((def as any).maxTurns && mc.maxTurns !== (def as any).maxTurns) {
          updates.maxTurns = (def as any).maxTurns;
        }

        if (Object.keys(updates).length > 0) {
          const merged = { ...mc, ...updates };
          await prisma.agent.update({
            where: { id: row.id },
            data: { model_config: merged as any, updated_at: new Date() },
          });
        }

        // Patch prompt_modules in a separate update so we don't write a stale
        // model_config when only modules changed. New modules added in upgrades
        // (e.g. cloud-ops-no-early-termination) get picked up here without needing
        // a manual /api/admin/agents/seed call.
        const wantedModules = promptModuleDefaults[row.agent_type] || [];
        const haveModules = (row.prompt_modules || []) as string[];
        const moduleDiff = wantedModules.filter((m) => !haveModules.includes(m));
        if (wantedModules.length > 0 && moduleDiff.length > 0) {
          // Union — preserve any admin-added modules, add the new defaults.
          const merged = Array.from(new Set([...haveModules, ...wantedModules]));
          await prisma.agent.update({
            where: { id: row.id },
            data: {
              prompt_modules: merged,
              prompt_strategy: row.prompt_strategy || 'composite',
              updated_at: new Date(),
            },
          });
          this.log.info({
            agentType: row.agent_type,
            added: moduleDiff,
            total: merged.length,
          }, '[AgentRegistry.repair] Patched prompt_modules with newly-shipped defaults');
          patchedModules++;
        }
      }

      // Delete the legacy "Flows Agent" custom-type duplicate that shadows the
      // canonical flows_agent. The canonical row uses agent_type='flows_agent';
      // the duplicate uses agent_type='custom' with display_name='Flows Agent'.
      const legacyFlows = await prisma.agent.findFirst({
        where: { agent_type: 'custom', display_name: 'Flows Agent' },
      });
      if (legacyFlows) {
        try {
          await prisma.agent.delete({ where: { id: legacyFlows.id } });
          this.log.warn({ id: legacyFlows.id }, '[AgentRegistry.repair] Deleted legacy duplicate Flows Agent (custom type)');
        } catch (delErr: any) {
          // FK constraints (executions) — fall back to disabling instead of hard delete
          await prisma.agent.update({
            where: { id: legacyFlows.id },
            data: { enabled: false, is_default: false, updated_at: new Date() },
          });
          this.log.warn({ id: legacyFlows.id, err: delErr.message }, '[AgentRegistry.repair] Could not delete legacy Flows Agent — disabled instead');
        }
      }

      if (forcedToAuto > 0 || patchedTier > 0 || patchedModules > 0) {
        this.log.info({ forcedToAuto, patchedTier, patchedModules }, '[AgentRegistry.repair] Audit pass complete');
      }
    } catch (err: any) {
      this.log.error({ err: err.message }, '[AgentRegistry.repair] Failed — continuing with existing registry');
    }
  }

  /**
   * Load all loops from database into cache
   */
  private async loadLoopsFromDB(): Promise<void> {
    const loops = await prisma.agent.findMany({
      where: { enabled: true }
    });

    for (const loop of loops) {
      this.loopCache.set(loop.id, loop);
    }

    this.log.debug({ count: loops.length }, 'Loaded agent loops from database');
  }

  /**
   * Refresh the in-memory cache from the database.
   * Called by admin-agents.ts after CRUD operations to keep cache in sync.
   */
  async refreshCache(): Promise<void> {
    this.loopCache.clear();
    await this.loadLoopsFromDB();
    this.log.info({ loopCount: this.loopCache.size }, 'AgentRegistry cache refreshed');
  }

  /**
   * Format agent type as display name
   */
  private formatDisplayName(agentType: string): string {
    const overrides: Record<string, string> = {
      docs_assistant: 'Documentation Assistant',
      flows_agent: 'Flows Agent',
      artifact_creation: 'Artifact Creation Agent',
      cloud_operations: 'Cloud Operations Agent',
    };
    if (overrides[agentType]) return overrides[agentType];
    return agentType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') + ' Agent';
  }

  /**
   * Get default graph definition for an agent type
   */
  private getDefaultGraphDefinition(agentType: AgentType): Prisma.InputJsonValue {
    // Graph-style agent definition (nodes/edges)
    // This can be edited in the admin UI
    const baseGraph = {
      nodes: [
        { id: 'start', type: 'entry', label: 'Start' },
        { id: 'process', type: 'llm', label: 'Process', config: { model: 'auto' } },
        { id: 'end', type: 'exit', label: 'End' }
      ],
      edges: [
        { source: 'start', target: 'process' },
        { source: 'process', target: 'end' }
      ],
      state_schema: {
        input: { type: 'string' },
        output: { type: 'string' },
        context: { type: 'object' }
      }
    };

    // Customize based on agent type
    switch (agentType) {
      case 'data_query':
        return {
          ...baseGraph,
          nodes: [
            { id: 'start', type: 'entry', label: 'Start' },
            { id: 'parse_query', type: 'llm', label: 'Parse Query', config: { model: 'fast' } },
            { id: 'execute_query', type: 'tool', label: 'Execute Query', config: { tool: 'query_data' } },
            { id: 'format_result', type: 'llm', label: 'Format Result', config: { model: 'fast' } },
            { id: 'end', type: 'exit', label: 'End' }
          ],
          edges: [
            { source: 'start', target: 'parse_query' },
            { source: 'parse_query', target: 'execute_query' },
            { source: 'execute_query', target: 'format_result' },
            { source: 'format_result', target: 'end' }
          ]
        } as Prisma.InputJsonValue;

      case 'reasoning':
        return {
          ...baseGraph,
          nodes: [
            { id: 'start', type: 'entry', label: 'Start' },
            { id: 'analyze', type: 'llm', label: 'Analyze Problem', config: { model: 'smart', thinking: true } },
            { id: 'plan', type: 'llm', label: 'Create Plan', config: { model: 'smart', thinking: true } },
            { id: 'execute', type: 'loop', label: 'Execute Steps', config: { maxIterations: 5 } },
            { id: 'synthesize', type: 'llm', label: 'Synthesize', config: { model: 'smart' } },
            { id: 'end', type: 'exit', label: 'End' }
          ],
          edges: [
            { source: 'start', target: 'analyze' },
            { source: 'analyze', target: 'plan' },
            { source: 'plan', target: 'execute' },
            { source: 'execute', target: 'synthesize' },
            { source: 'synthesize', target: 'end' }
          ]
        } as Prisma.InputJsonValue;

      case 'tool_orchestration':
        return {
          ...baseGraph,
          nodes: [
            { id: 'start', type: 'entry', label: 'Start' },
            { id: 'select_tools', type: 'llm', label: 'Select Tools', config: { model: 'smart' } },
            { id: 'execute_tools', type: 'tool_loop', label: 'Execute Tools', config: { maxCalls: 10 } },
            { id: 'validate', type: 'llm', label: 'Validate Results', config: { model: 'fast' } },
            { id: 'end', type: 'exit', label: 'End' }
          ],
          edges: [
            { source: 'start', target: 'select_tools' },
            { source: 'select_tools', target: 'execute_tools' },
            { source: 'execute_tools', target: 'validate' },
            { source: 'validate', target: 'end', condition: 'valid' },
            { source: 'validate', target: 'select_tools', condition: 'retry' }
          ]
        } as Prisma.InputJsonValue;

      default:
        return baseGraph as Prisma.InputJsonValue;
    }
  }

  // ===========================================================================
  // AGENT REGISTRATION (DATABASE-BACKED)
  // ===========================================================================

  /**
   * Create a new agent loop in the database
   */
  async createLoop(
    name: string,
    displayName: string,
    agentType: AgentType,
    description?: string,
    modelConfigOverrides?: Partial<AgentModelConfig>,
    graphDefinition?: object,
    createdBy?: string
  ): Promise<Agent> {
    await this.ensureInitialized();

    const baseConfig = DEFAULT_MODEL_CONFIGS[agentType] || DEFAULT_MODEL_CONFIGS['custom'];
    const modelConfig = { ...baseConfig, ...(modelConfigOverrides || {}) };

    const loop = await prisma.agent.create({
      data: {
        name,
        display_name: displayName,
        description,
        agent_type: agentType,
        category: 'custom',
        model_config: modelConfig as unknown as Prisma.InputJsonValue,
        graph_definition: (graphDefinition || this.getDefaultGraphDefinition(agentType)) as Prisma.InputJsonValue,
        rate_limits: { maxPerMinute: 60, maxPerHour: 1000, maxConcurrent: 10 },
        cost_limits: { maxCostPerCall: modelConfig.costBudgetPerCall, maxDailyCost: 10000 },
        alert_config: { errorRateThreshold: 10, latencyThreshold: 30000, costThreshold: 10000 },
        logging_config: { verboseLogging: true, logInputs: true, logOutputs: true, sampleRate: 1.0 },
        enabled: true,
        is_default: false,
        version: '1.0.0',
        created_by: createdBy
      }
    });

    this.loopCache.set(loop.id, loop);

    this.log.info({
      loopId: loop.id,
      name,
      agentType,
      model: modelConfig.primaryModel
    }, 'Agent loop created');

    return loop;
  }

  /**
   * Update an existing agent loop
   */
  async updateLoop(
    loopId: string,
    updates: {
      displayName?: string;
      description?: string;
      modelConfig?: Partial<AgentModelConfig>;
      graphDefinition?: object;
      rateLimits?: object;
      costLimits?: object;
      alertConfig?: object;
      loggingConfig?: object;
      enabled?: boolean;
      updatedBy?: string;
    }
  ): Promise<Agent | null> {
    await this.ensureInitialized();

    const existing = await prisma.agent.findUnique({ where: { id: loopId } });
    if (!existing) return null;

    const updateData: Prisma.AgentUpdateInput = {};

    if (updates.displayName) updateData.display_name = updates.displayName;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.modelConfig) {
      const currentConfig = existing.model_config as unknown as AgentModelConfig;
      updateData.model_config = { ...currentConfig, ...updates.modelConfig } as unknown as Prisma.InputJsonValue;
    }
    if (updates.graphDefinition) {
      updateData.graph_definition = updates.graphDefinition as Prisma.InputJsonValue;
    }
    if (updates.rateLimits) {
      updateData.rate_limits = updates.rateLimits as Prisma.InputJsonValue;
    }
    if (updates.costLimits) {
      updateData.cost_limits = updates.costLimits as Prisma.InputJsonValue;
    }
    if (updates.alertConfig) {
      updateData.alert_config = updates.alertConfig as Prisma.InputJsonValue;
    }
    if (updates.loggingConfig) {
      updateData.logging_config = updates.loggingConfig as Prisma.InputJsonValue;
    }
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;
    if (updates.updatedBy) updateData.updated_by = updates.updatedBy;

    const updated = await prisma.agent.update({
      where: { id: loopId },
      data: updateData
    });

    this.loopCache.set(updated.id, updated);

    this.log.info({
      loopId,
      updates: Object.keys(updates)
    }, 'Agent loop updated');

    return updated;
  }

  /**
   * Create a new version of an agent loop (for versioning/rollback)
   */
  async createVersion(
    loopId: string,
    changelog?: string,
    createdBy?: string
  ): Promise<AgentVersion> {
    const loop = await prisma.agent.findUnique({ where: { id: loopId } });
    if (!loop) throw new Error('Loop not found');

    // Get current max version
    const maxVersion = await prisma.agentVersion.findFirst({
      where: { loop_id: loopId },
      orderBy: { version: 'desc' }
    });

    const newVersion = (maxVersion?.version || 0) + 1;

    const version = await prisma.agentVersion.create({
      data: {
        loop_id: loopId,
        version: newVersion,
        graph_definition: loop.graph_definition,
        model_config: loop.model_config,
        system_prompt: loop.system_prompt,
        state_schema: loop.state_schema,
        changelog,
        is_active: true,
        created_by: createdBy
      }
    });

    // Deactivate previous versions
    await prisma.agentVersion.updateMany({
      where: { loop_id: loopId, id: { not: version.id } },
      data: { is_active: false }
    });

    this.log.info({ loopId, version: newVersion }, 'Agent loop version created');

    return version;
  }

  /**
   * Rollback to a previous version
   */
  async rollbackToVersion(loopId: string, versionNumber: number): Promise<Agent | null> {
    const version = await prisma.agentVersion.findFirst({
      where: { loop_id: loopId, version: versionNumber }
    });

    if (!version) return null;

    const updated = await prisma.agent.update({
      where: { id: loopId },
      data: {
        graph_definition: version.graph_definition,
        model_config: version.model_config,
        system_prompt: version.system_prompt,
        state_schema: version.state_schema
      }
    });

    this.loopCache.set(updated.id, updated);

    this.log.info({ loopId, version: versionNumber }, 'Agent loop rolled back to version');

    return updated;
  }

  // ===========================================================================
  // AGENT RETRIEVAL
  // ===========================================================================

  /**
   * Get all agent loops
   */
  async listLoops(filters?: {
    agentType?: AgentType;
    category?: string;
    enabled?: boolean;
  }): Promise<Agent[]> {
    await this.ensureInitialized();

    const where: Prisma.AgentWhereInput = {};
    if (filters?.agentType) where.agent_type = filters.agentType;
    if (filters?.category) where.category = filters.category;
    if (filters?.enabled !== undefined) where.enabled = filters.enabled;

    return prisma.agent.findMany({
      where,
      orderBy: [{ is_default: 'desc' }, { agent_type: 'asc' }, { name: 'asc' }]
    });
  }

  /**
   * Get loop by ID
   */
  async getLoop(loopId: string): Promise<Agent | null> {
    await this.ensureInitialized();

    // Check cache first
    const cached = this.loopCache.get(loopId);
    if (cached) return cached;

    const loop = await prisma.agent.findUnique({ where: { id: loopId } });
    if (loop) {
      this.loopCache.set(loop.id, loop);
    }

    return loop;
  }

  /**
   * Get loop by name
   */
  async getLoopByName(name: string): Promise<Agent | null> {
    await this.ensureInitialized();

    return prisma.agent.findUnique({ where: { name } });
  }

  /**
   * Get default loop for an agent type
   */
  async getDefaultLoop(agentType: AgentType): Promise<Agent | null> {
    await this.ensureInitialized();

    return prisma.agent.findFirst({
      where: { agent_type: agentType, is_default: true, enabled: true }
    });
  }

  // ===========================================================================
  // LEGACY COMPATIBILITY METHODS
  // ===========================================================================

  /**
   * Register a new agent type with the platform (legacy compatibility)
   * @deprecated Use createLoop instead
   */
  async registerAgent(
    type: AgentType,
    name: string,
    description: string,
    configOverrides?: Partial<AgentModelConfig>
  ): Promise<RegisteredAgent> {
    const loop = await this.createLoop(
      type,
      name,
      type,
      description,
      configOverrides
    );

    // Convert to legacy format
    return this.loopToRegisteredAgent(loop);
  }

  /**
   * Convert database loop to legacy RegisteredAgent format
   */
  private loopToRegisteredAgent(loop: Agent): RegisteredAgent {
    const modelConfig = loop.model_config as unknown as AgentModelConfig;
    return {
      id: loop.id,
      type: loop.agent_type as AgentType,
      name: loop.display_name,
      description: loop.description || '',
      version: loop.version,
      config: {
        agentType: loop.agent_type as AgentType,
        enabled: loop.enabled,
        modelConfig,
        rateLimit: loop.rate_limits as { maxPerMinute: number; maxPerHour: number; maxConcurrent: number },
        alerts: loop.alert_config as { errorRateThreshold: number; latencyThreshold: number; costThreshold: number },
        logging: loop.logging_config as { verboseLogging: boolean; logInputs: boolean; logOutputs: boolean; sampleRate: number }
      },
      createdAt: loop.created_at,
      updatedAt: loop.updated_at,
      status: loop.enabled ? 'active' : 'disabled'
    };
  }

  /**
   * Get agent by type (returns first active agent of that type) - LEGACY
   */
  getAgentByType(type: AgentType): RegisteredAgent | null {
    // Sync version - check cache only
    for (const loop of this.loopCache.values()) {
      if (loop.agent_type === type && loop.enabled) {
        return this.loopToRegisteredAgent(loop);
      }
    }
    return null;
  }

  /**
   * Get model config for an agent type
   */
  getModelConfig(type: AgentType): AgentModelConfig {
    // Check cache first
    for (const loop of this.loopCache.values()) {
      if (loop.agent_type === type && loop.enabled && loop.is_default) {
        return loop.model_config as unknown as AgentModelConfig;
      }
    }
    return DEFAULT_MODEL_CONFIGS[type] || DEFAULT_MODEL_CONFIGS['custom'];
  }

  /**
   * Get model config async (preferred) - checks database
   */
  async getModelConfigAsync(type: AgentType): Promise<AgentModelConfig> {
    await this.ensureInitialized();

    const loop = await this.getDefaultLoop(type);
    if (loop) {
      return loop.model_config as unknown as AgentModelConfig;
    }
    return DEFAULT_MODEL_CONFIGS[type] || DEFAULT_MODEL_CONFIGS['custom'];
  }

  /**
   * Update agent model configuration (admin function) - LEGACY
   */
  async updateAgentModel(
    agentId: string,
    modelConfig: Partial<AgentModelConfig>
  ): Promise<RegisteredAgent | null> {
    const updated = await this.updateLoop(agentId, { modelConfig });
    if (!updated) {
      this.log.warn({ agentId }, 'Agent not found for update');
      return null;
    }

    return this.loopToRegisteredAgent(updated);
  }

  /**
   * List all registered agents - LEGACY
   */
  listAgents(): RegisteredAgent[] {
    return Array.from(this.loopCache.values()).map(loop => this.loopToRegisteredAgent(loop));
  }

  /**
   * List all registered agents async (preferred)
   */
  async listAgentsAsync(): Promise<RegisteredAgent[]> {
    const loops = await this.listLoops();
    return loops.map(loop => this.loopToRegisteredAgent(loop));
  }

  // ===========================================================================
  // EXECUTION TRACKING (DATABASE-BACKED)
  // ===========================================================================

  /**
   * Start tracking an agent execution
   */
  async startExecution(
    agentType: AgentType,
    sessionId: string,
    userId: string,
    traceId?: string,
    loopId?: string
  ): Promise<AgentExecutionMetrics> {
    await this.ensureInitialized();

    const executionId = `exec_${uuidv4().substring(0, 12)}`;
    const config = this.getModelConfig(agentType);

    // Get loop ID if not provided
    let actualLoopId = loopId;
    if (!actualLoopId) {
      const loop = await this.getDefaultLoop(agentType);
      actualLoopId = loop?.id;
    }

    const metrics: AgentExecutionMetrics = {
      agentType,
      executionId,
      sessionId,
      userId,
      startTime: new Date(),
      modelUsed: config.primaryModel,
      modelFallbackUsed: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      estimatedCostCents: 0,
      success: false,
      toolCallsInvolved: [],
      datasetIdsAccessed: [],
      traceId,
      spanId: uuidv4().substring(0, 16)
    };

    // Store in cache for fast access during execution
    this.executionCache.set(executionId, metrics);

    // Persist to database asynchronously
    if (actualLoopId) {
      prisma.agentRunLog.create({
        data: {
          id: executionId,
          loop_id: actualLoopId,
          session_id: sessionId,
          user_id: userId,
          status: 'running',
          model_used: config.primaryModel,
          trace_id: traceId,
          span_id: metrics.spanId
        }
      }).catch(err => {
        this.log.warn({ err, executionId }, 'Failed to persist execution start to database');
      });
    }

    this.log.debug({
      executionId,
      agentType,
      sessionId,
      model: config.primaryModel,
      traceId,
      loopId: actualLoopId
    }, 'Agent execution started');

    return metrics;
  }

  /**
   * Start tracking (sync version for backward compatibility)
   */
  startExecutionSync(
    agentType: AgentType,
    sessionId: string,
    userId: string,
    traceId?: string
  ): AgentExecutionMetrics {
    const executionId = `exec_${uuidv4().substring(0, 12)}`;
    const config = this.getModelConfig(agentType);

    const metrics: AgentExecutionMetrics = {
      agentType,
      executionId,
      sessionId,
      userId,
      startTime: new Date(),
      modelUsed: config.primaryModel,
      modelFallbackUsed: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      estimatedCostCents: 0,
      success: false,
      toolCallsInvolved: [],
      datasetIdsAccessed: [],
      traceId,
      spanId: uuidv4().substring(0, 16)
    };

    this.executionCache.set(executionId, metrics);

    this.log.debug({
      executionId,
      agentType,
      sessionId,
      model: config.primaryModel,
      traceId
    }, 'Agent execution started (sync)');

    return metrics;
  }

  /**
   * Complete an agent execution with results
   */
  async completeExecution(
    executionId: string,
    result: {
      success: boolean;
      inputTokens: number;
      outputTokens: number;
      thinkingTokens?: number;
      modelUsed?: string;
      error?: string;
      errorCode?: string;
      resultSize?: number;
      toolCallsInvolved?: string[];
      datasetIdsAccessed?: string[];
      inputData?: unknown;
      outputData?: unknown;
    }
  ): Promise<AgentExecutionMetrics | null> {
    const metrics = this.executionCache.get(executionId);
    if (!metrics) {
      this.log.warn({ executionId }, 'Execution not found for completion');
      return null;
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - metrics.startTime.getTime();

    // Calculate cost (simplified - in production use pricing service)
    const costPerInputToken = 0.000003;   // $3 per 1M tokens
    const costPerOutputToken = 0.000015;  // $15 per 1M tokens
    const costCents = (
      result.inputTokens * costPerInputToken +
      result.outputTokens * costPerOutputToken
    ) * 100;

    // Update metrics
    metrics.endTime = endTime;
    metrics.durationMs = durationMs;
    metrics.success = result.success;
    metrics.inputTokens = result.inputTokens;
    metrics.outputTokens = result.outputTokens;
    metrics.thinkingTokens = result.thinkingTokens || 0;
    metrics.totalTokens = result.inputTokens + result.outputTokens + (result.thinkingTokens || 0);
    metrics.estimatedCostCents = costCents;
    metrics.error = result.error;
    metrics.errorCode = result.errorCode;
    metrics.resultSize = result.resultSize;
    metrics.toolCallsInvolved = result.toolCallsInvolved || [];
    metrics.datasetIdsAccessed = result.datasetIdsAccessed || [];

    if (result.modelUsed) {
      metrics.modelUsed = result.modelUsed;
      metrics.modelFallbackUsed = result.modelUsed !== this.getModelConfig(metrics.agentType).primaryModel;
    }

    // Persist to database
    prisma.agentRunLog.update({
      where: { id: executionId },
      data: {
        status: result.success ? 'completed' : 'failed',
        model_used: metrics.modelUsed,
        fallback_used: metrics.modelFallbackUsed,
        input_tokens: metrics.inputTokens,
        output_tokens: metrics.outputTokens,
        thinking_tokens: metrics.thinkingTokens,
        total_tokens: metrics.totalTokens,
        estimated_cost: costCents,
        duration_ms: durationMs,
        error: result.error,
        error_code: result.errorCode,
        result_size: result.resultSize,
        tool_calls_involved: result.toolCallsInvolved || [],
        dataset_ids_accessed: result.datasetIdsAccessed || [],
        input_data: result.inputData as Prisma.InputJsonValue || undefined,
        output_data: result.outputData as Prisma.InputJsonValue || undefined,
        completed_at: endTime
      }
    }).catch(err => {
      this.log.warn({ err, executionId }, 'Failed to persist execution completion to database');
    });

    // Log with full observability
    this.log.info({
      executionId,
      agentType: metrics.agentType,
      sessionId: metrics.sessionId,
      userId: metrics.userId,
      success: metrics.success,
      durationMs,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      thinkingTokens: metrics.thinkingTokens,
      totalTokens: metrics.totalTokens,
      costCents: Math.round(costCents * 100) / 100,
      modelUsed: metrics.modelUsed,
      fallbackUsed: metrics.modelFallbackUsed,
      error: metrics.error,
      traceId: metrics.traceId,
      spanId: metrics.spanId,
      toolCalls: metrics.toolCallsInvolved.length,
      datasetsAccessed: metrics.datasetIdsAccessed.length
    }, metrics.success ? 'Agent execution completed' : 'Agent execution failed');

    return metrics;
  }

  /**
   * Record a tool call within an execution
   */
  recordToolCall(executionId: string, toolName: string): void {
    const metrics = this.executionCache.get(executionId);
    if (metrics) {
      metrics.toolCallsInvolved.push(toolName);
    }
  }

  /**
   * Record dataset access within an execution
   */
  recordDatasetAccess(executionId: string, datasetId: string): void {
    const metrics = this.executionCache.get(executionId);
    if (metrics) {
      metrics.datasetIdsAccessed.push(datasetId);
    }
  }

  // ===========================================================================
  // METRICS & STATS
  // ===========================================================================

  /**
   * Get aggregated stats for an agent type
   */
  async getAgentStats(
    agentType: AgentType,
    period: 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<AgentStats> {
    const cacheKey = `${agentType}_${period}`;
    const cached = this.statsCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    // Calculate time range
    const now = new Date();
    const periodMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000
    };
    const startTime = new Date(now.getTime() - periodMs[period]);

    // Get executions from Redis (or calculate from in-memory)
    const executions = await this.getExecutionsInRange(agentType, startTime, now);

    // Calculate stats
    const stats = this.calculateStats(agentType, period, executions);

    // Cache the result
    this.statsCache.set(cacheKey, stats);
    setTimeout(() => this.statsCache.delete(cacheKey), this.STATS_CACHE_TTL_MS);

    return stats;
  }

  /**
   * Get real-time dashboard metrics for all agents
   */
  async getDashboardMetrics(): Promise<{
    agents: Array<{
      type: AgentType;
      name: string;
      status: 'active' | 'disabled' | 'deprecated';
      model: string;
      stats: AgentStats;
    }>;
    totalExecutionsToday: number;
    totalCostToday: number;
    errorRateToday: number;
    activeExecutions: number;
  }> {
    await this.ensureInitialized();

    const agents: Array<{
      type: AgentType;
      name: string;
      status: 'active' | 'disabled' | 'deprecated';
      model: string;
      stats: AgentStats;
    }> = [];

    let totalExecutionsToday = 0;
    let totalCostToday = 0;
    let totalErrors = 0;

    // Query from database
    const loops = await this.listLoops();
    for (const loop of loops) {
      const modelConfig = loop.model_config as unknown as AgentModelConfig;
      const stats = await this.getAgentStats(loop.agent_type as AgentType, 'day');
      agents.push({
        type: loop.agent_type as AgentType,
        name: loop.display_name,
        status: loop.enabled ? 'active' : 'disabled',
        model: modelConfig.primaryModel,
        stats
      });

      totalExecutionsToday += stats.totalExecutions;
      totalCostToday += stats.totalCostCents;
      totalErrors += stats.failedExecutions;
    }

    const errorRateToday = totalExecutionsToday > 0
      ? (totalErrors / totalExecutionsToday) * 100
      : 0;

    const activeExecutions = Array.from(this.executionCache.values())
      .filter(e => !e.endTime).length;

    return {
      agents,
      totalExecutionsToday,
      totalCostToday,
      errorRateToday: Math.round(errorRateToday * 100) / 100,
      activeExecutions
    };
  }

  /**
   * Get execution history for debugging
   */
  async getExecutionHistory(
    filters: {
      agentType?: AgentType;
      sessionId?: string;
      userId?: string;
      success?: boolean;
      fromTime?: Date;
      toTime?: Date;
    },
    limit: number = 100,
    offset: number = 0
  ): Promise<AgentExecutionMetrics[]> {
    await this.ensureInitialized();

    // Build query from database
    const where: Prisma.AgentRunLogWhereInput = {};

    if (filters.agentType) {
      where.agent = { agent_type: filters.agentType };
    }
    if (filters.sessionId) {
      where.session_id = filters.sessionId;
    }
    if (filters.userId) {
      where.user_id = filters.userId;
    }
    if (filters.success !== undefined) {
      where.status = filters.success ? 'completed' : 'failed';
    }
    if (filters.fromTime) {
      where.started_at = { gte: filters.fromTime };
    }
    if (filters.toTime) {
      where.started_at = { ...where.started_at as object, lte: filters.toTime };
    }

    const executions = await prisma.agentRunLog.findMany({
      where,
      include: { agent: true },
      orderBy: { started_at: 'desc' },
      take: limit,
      skip: offset
    });

    // Convert to AgentExecutionMetrics format
    return executions.map(exec => ({
      agentType: exec.agent.agent_type as AgentType,
      executionId: exec.id,
      sessionId: exec.session_id || '',
      userId: exec.user_id || '',
      startTime: exec.started_at,
      endTime: exec.completed_at || undefined,
      durationMs: exec.duration_ms || undefined,
      modelUsed: exec.model_used || '',
      modelFallbackUsed: exec.fallback_used,
      inputTokens: exec.input_tokens,
      outputTokens: exec.output_tokens,
      thinkingTokens: exec.thinking_tokens,
      totalTokens: exec.total_tokens,
      estimatedCostCents: Number(exec.estimated_cost),
      success: exec.status === 'completed',
      error: exec.error || undefined,
      errorCode: exec.error_code || undefined,
      resultSize: exec.result_size || undefined,
      toolCallsInvolved: exec.tool_calls_involved,
      datasetIdsAccessed: exec.dataset_ids_accessed,
      traceId: exec.trace_id || undefined,
      spanId: exec.span_id || undefined
    }));
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private async getExecutionsInRange(
    agentType: AgentType,
    startTime: Date,
    endTime: Date
  ): Promise<AgentExecutionMetrics[]> {
    // Query from database
    const executions = await prisma.agentRunLog.findMany({
      where: {
        agent: { agent_type: agentType },
        started_at: { gte: startTime, lte: endTime },
        completed_at: { not: null }
      },
      include: { agent: true },
      orderBy: { started_at: 'desc' }
    });

    return executions.map(exec => ({
      agentType: exec.agent.agent_type as AgentType,
      executionId: exec.id,
      sessionId: exec.session_id || '',
      userId: exec.user_id || '',
      startTime: exec.started_at,
      endTime: exec.completed_at || undefined,
      durationMs: exec.duration_ms || undefined,
      modelUsed: exec.model_used || '',
      modelFallbackUsed: exec.fallback_used,
      inputTokens: exec.input_tokens,
      outputTokens: exec.output_tokens,
      thinkingTokens: exec.thinking_tokens,
      totalTokens: exec.total_tokens,
      estimatedCostCents: Number(exec.estimated_cost),
      success: exec.status === 'completed',
      error: exec.error || undefined,
      errorCode: exec.error_code || undefined,
      resultSize: exec.result_size || undefined,
      toolCallsInvolved: exec.tool_calls_involved,
      datasetIdsAccessed: exec.dataset_ids_accessed,
      traceId: exec.trace_id || undefined,
      spanId: exec.span_id || undefined
    }));
  }

  // Legacy method - kept for backwards compatibility with stats calculation
  private async getExecutionsInRangeFromCache(
    agentType: AgentType,
    startTime: Date,
    endTime: Date
  ): Promise<AgentExecutionMetrics[]> {
    return Array.from(this.executionCache.values()).filter(e =>
      e.agentType === agentType &&
      e.startTime >= startTime &&
      e.startTime <= endTime &&
      e.endTime !== undefined
    );
  }

  private calculateStats(
    agentType: AgentType,
    period: 'hour' | 'day' | 'week' | 'month',
    executions: AgentExecutionMetrics[]
  ): AgentStats {
    const successful = executions.filter(e => e.success);
    const failed = executions.filter(e => !e.success);

    // Duration stats
    const durations = executions
      .filter(e => e.durationMs !== undefined)
      .map(e => e.durationMs!)
      .sort((a, b) => a - b);

    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99 = durations[Math.floor(durations.length * 0.99)] || 0;

    // Token stats
    const totalInput = executions.reduce((a, e) => a + e.inputTokens, 0);
    const totalOutput = executions.reduce((a, e) => a + e.outputTokens, 0);
    const totalThinking = executions.reduce((a, e) => a + e.thinkingTokens, 0);
    const totalCost = executions.reduce((a, e) => a + e.estimatedCostCents, 0);

    // Error breakdown
    const errorBreakdown: Record<string, number> = {};
    for (const exec of failed) {
      const code = exec.errorCode || 'unknown';
      errorBreakdown[code] = (errorBreakdown[code] || 0) + 1;
    }

    // Model usage
    const modelBreakdown: Record<string, number> = {};
    for (const exec of executions) {
      modelBreakdown[exec.modelUsed] = (modelBreakdown[exec.modelUsed] || 0) + 1;
    }

    return {
      agentType,
      period,
      totalExecutions: executions.length,
      successfulExecutions: successful.length,
      failedExecutions: failed.length,
      successRate: executions.length > 0 ? (successful.length / executions.length) * 100 : 100,
      avgDurationMs: Math.round(avgDuration),
      p50DurationMs: p50,
      p95DurationMs: p95,
      p99DurationMs: p99,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalThinkingTokens: totalThinking,
      avgTokensPerCall: executions.length > 0
        ? Math.round((totalInput + totalOutput + totalThinking) / executions.length)
        : 0,
      totalCostCents: Math.round(totalCost * 100) / 100,
      avgCostPerCallCents: executions.length > 0
        ? Math.round((totalCost / executions.length) * 100) / 100
        : 0,
      errorBreakdown,
      modelUsageBreakdown: modelBreakdown
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let instance: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!instance) {
    instance = new AgentRegistry();
  }
  return instance;
}

export default AgentRegistry;
