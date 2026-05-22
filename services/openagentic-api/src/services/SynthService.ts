/**
 * Synth (Tool Synthesis) Service
 *
 * Integrates the Synth framework for dynamic tool synthesis and execution.
 *
 * Features:
 * - Natural language intent → synthesized tool
 * - Human-in-the-loop approval workflows
 * - User credential injection (runs AS authenticated user)
 * - Full metrics: TTFT, tokens, cost, risk level
 * - Platform SSO integration (Azure AD, Google)
 */

import { EventEmitter } from 'events';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';
import { SynthExecutorClient, getSynthExecutorClient } from './SynthExecutorClient.js';
// 2026-04-19 — SliderService import removed (task #144, slider rip).
import { ProviderManager, getProviderManager } from './llm-providers/ProviderManager.js';
import type { CompletionRequest, CompletionResponse } from './llm-providers/ILLMProvider.js';
import ToolSemanticCacheService, { getToolSemanticCache } from './ToolSemanticCacheService.js';
import { LLMMetricsService } from './LLMMetricsService.js';
import { SynthAbuseClassifier } from './SynthAbuseClassifier.js';
import { AuditLogger, type SynthAuditEntry } from './AuditLogger.js';

/**
 * Synth Configuration
 */
export interface SynthConfig {
  // ===========================================
  // VISIBILITY & ENABLEMENT
  // ===========================================
  /** Enable Synth globally - when false, Synth is completely disabled */
  enabled: boolean;
  /** Whether the LLM can see Synth as an available tool during chat.
   * When false, Synth is disabled at runtime but config is preserved.
   * This allows admins to "hide" Synth from the LLM without losing settings. */
  visibleToLLM: boolean;

  // ===========================================
  // MODEL CONFIGURATION (Direct LLM Access)
  // ===========================================
  /** LLM provider for Synth synthesis: anthropic, bedrock, ollama, openai, google, azure */
  provider: string;
  /** Specific model ID to use for synthesis (e.g., 'claude-sonnet-4-20250514') */
  model?: string;
  /** Base URL for LLM API (for ollama, openai custom deployments) */
  baseUrl?: string;
  /** Temperature for synthesis LLM call (0.0-1.0) */
  synthesisTemperature?: number;
  /** Maximum tokens for synthesis output */
  maxSynthesisTokens?: number;

  // ===========================================
  // EXECUTION SETTINGS
  // ===========================================
  /** Maximum execution timeout in seconds */
  timeoutSeconds?: number;
  /** Synth Executor URL (K8s service) */
  executorUrl?: string;
  /** Maximum memory for execution (MB) */
  maxMemoryMb?: number;
  /** Maximum concurrent executions across all users */
  maxConcurrentExecutions: number;

  // ===========================================
  // RATE LIMITS & BUDGETS
  // ===========================================
  /** Maximum daily synthesis requests per user */
  maxDailySynthesesPerUser: number;
  /** Default daily budget per user in USD (0 = unlimited) */
  defaultUserDailyBudgetUsd?: number;
  /** Default daily budget per group in USD (0 = unlimited) */
  defaultGroupDailyBudgetUsd?: number;

  // ===========================================
  // APPROVAL WORKFLOW
  // ===========================================
  /** Auto-approve low-risk tools without human review */
  autoApproveLowRisk: boolean;
  /** Auto-approve medium-risk tools without human review */
  autoApproveMediumRisk?: boolean;
  /** Approval timeout in seconds (after which request is auto-rejected) */
  approvalTimeoutSeconds?: number;
  /** Action when approval times out: 'reject' | 'approve' */
  approvalTimeoutAction?: 'reject' | 'approve';

  // ===========================================
  // CAPABILITIES
  // ===========================================
  /** Allowed capabilities (empty = all non-blocked) */
  allowedCapabilities: string[];
  /** Blocked capabilities (always blocked regardless of allowedCapabilities) */
  blockedCapabilities: string[];
  /** Admin-only capabilities (require synth:admin permission) */
  adminOnlyCapabilities?: string[];

  // ===========================================
  // SEMANTIC SEARCH & OPTIMIZATION
  // ===========================================
  /** Use semantic tool search to find existing MCP tools before synthesis */
  useSemanticToolSearch?: boolean;
  /** Number of existing tools to consider before synthesis */
  semanticSearchTopK?: number;

  // ===========================================
  // CREDENTIAL & AUTH SETTINGS
  // ===========================================
  /** Credential source: 'sso_only' | 'linked_accounts' | 'none' */
  credentialSource?: 'sso_only' | 'linked_accounts' | 'none';
  /** Require session-based OAuth (users re-auth each session) */
  sessionBasedOAuth?: boolean;
}

/**
 * Synth Synthesis Request
 */
export interface SynthRequest {
  /** Natural language intent */
  intent: string;
  /** User ID making the request */
  userId: string;
  /** User email */
  userEmail: string;
  /** User's cloud credentials (from SSO) */
  credentials?: {
    aws?: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
      region?: string;
    };
    azure?: {
      accessToken: string;
      tenantId: string;
    };
    gcp?: {
      accessToken: string;
      projectId?: string;
    };
    github?: {
      token: string;
    };
  };
  /** Specific capabilities to use (optional) */
  capabilities?: string[];
  /** Dry run - only synthesize, don't execute */
  dryRun?: boolean;
  /** Session ID for tracking */
  sessionId?: string;
}

/**
 * Synth Synthesis Result
 */
export interface SynthResult {
  success: boolean;
  toolId: string;
  intent: string;

  /** Synthesized tool details */
  tool?: {
    code: string;
    explanation: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskReasoning: string;
    capabilitiesUsed: string[];
    requestedScopes: string[];
  };

  /** Execution result (if not dry run) */
  result?: unknown;

  /** Error if failed */
  error?: string;

  /** Metrics */
  metrics: {
    synthesisTimeMs: number;
    executionTimeMs: number;
    totalTimeMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    ttftMs?: number;
  };

  /** Existing MCP tools that might accomplish the same task */
  existingToolsSuggested?: string[];

  /** Approval status */
  approval?: {
    required: boolean;
    approved: boolean;
    reason?: string;
    approvedBy?: string;
    approvedAt?: Date;
  };
}

/**
 * Synth Service for platform integration
 */
export class SynthService extends EventEmitter {
  private static instance: SynthService;
  private config: SynthConfig;
  private activeExecutions: Map<string, AbortController> = new Map();
  private dailyUsage: Map<string, number> = new Map();
  private executorClient: SynthExecutorClient;
  private abuseClassifier: SynthAbuseClassifier = new SynthAbuseClassifier();
  private auditLoggerInstance: AuditLogger | null = null;

  private getAuditLogger(): AuditLogger {
    if (!this.auditLoggerInstance) {
      this.auditLoggerInstance = new AuditLogger(this.logger);
    }
    return this.auditLoggerInstance;
  }

  /**
   * Fire-and-forget audit write. Never blocks the synth code path.
   * SynthAuditEntry.code is sha256-hashed inside AuditLogger; credentials
   * are dropped by the type (only env key names accepted).
   */
  private auditSynth(entry: SynthAuditEntry): void {
    void this.getAuditLogger().logSynthExecution(entry).catch((err) => {
      this.logger.warn({ err, executionId: entry.executionId }, '[SYNTH] audit write failed (non-fatal)');
    });
  }

  private constructor(
    private logger: Logger,
    initialConfig?: Partial<SynthConfig>
  ) {
    super();

    // Parse env vars with defaults
    const envEnabled = process.env.SYNTH_ENABLED === 'true';
    const envVisibleToLLM = process.env.SYNTH_VISIBLE_TO_LLM !== 'false'; // Default true if Synth is enabled

    this.config = {
      // Visibility & Enablement
      enabled: initialConfig?.enabled ?? envEnabled,
      visibleToLLM: initialConfig?.visibleToLLM ?? (envEnabled && envVisibleToLLM),

      // Model Configuration
      provider: initialConfig?.provider || process.env.SYNTH_LLM_PROVIDER || 'auto',
      model: initialConfig?.model || process.env.SYNTH_LLM_MODEL,
      baseUrl: initialConfig?.baseUrl || process.env.SYNTH_LLM_BASE_URL,
      synthesisTemperature: initialConfig?.synthesisTemperature ?? parseFloat(process.env.SYNTH_SYNTHESIS_TEMPERATURE || '0.2'),
      maxSynthesisTokens: initialConfig?.maxSynthesisTokens ?? parseInt(process.env.SYNTH_MAX_SYNTHESIS_TOKENS || '4096'),

      // Execution Settings
      timeoutSeconds: initialConfig?.timeoutSeconds ?? parseInt(process.env.SYNTH_MAX_TIMEOUT_SECONDS || '60'),
      executorUrl: initialConfig?.executorUrl || process.env.SYNTH_EXECUTOR_URL,
      maxMemoryMb: initialConfig?.maxMemoryMb ?? parseInt(process.env.SYNTH_EXECUTOR_MAX_MEMORY_MB || '256'),
      maxConcurrentExecutions: initialConfig?.maxConcurrentExecutions ?? parseInt(process.env.SYNTH_MAX_CONCURRENT_EXECUTIONS || '10'),

      // Rate Limits & Budgets
      maxDailySynthesesPerUser: initialConfig?.maxDailySynthesesPerUser ?? parseInt(process.env.SYNTH_MAX_DAILY_SYNTHESES || '1000'),
      defaultUserDailyBudgetUsd: initialConfig?.defaultUserDailyBudgetUsd ?? parseFloat(process.env.SYNTH_DEFAULT_USER_DAILY_BUDGET_USD || '10'),
      defaultGroupDailyBudgetUsd: initialConfig?.defaultGroupDailyBudgetUsd ?? parseFloat(process.env.SYNTH_DEFAULT_GROUP_DAILY_BUDGET_USD || '100'),

      // Approval Workflow
      autoApproveLowRisk: initialConfig?.autoApproveLowRisk ?? (process.env.SYNTH_AUTO_APPROVE_LOW_RISK !== 'false'),
      autoApproveMediumRisk: initialConfig?.autoApproveMediumRisk ?? (process.env.SYNTH_AUTO_APPROVE_MEDIUM_RISK === 'true'),
      approvalTimeoutSeconds: initialConfig?.approvalTimeoutSeconds ?? parseInt(process.env.SYNTH_APPROVAL_TIMEOUT_SECONDS || '3600'),
      approvalTimeoutAction: (initialConfig?.approvalTimeoutAction || process.env.SYNTH_APPROVAL_TIMEOUT_ACTION || 'reject') as 'reject' | 'approve',

      // Capabilities
      allowedCapabilities: initialConfig?.allowedCapabilities || (process.env.SYNTH_ALLOWED_CAPABILITIES?.split(',').filter(Boolean) || []),
      blockedCapabilities: initialConfig?.blockedCapabilities || (process.env.SYNTH_BLOCKED_CAPABILITIES?.split(',').filter(Boolean) || []),
      adminOnlyCapabilities: initialConfig?.adminOnlyCapabilities || (process.env.SYNTH_ADMIN_ONLY_CAPABILITIES?.split(',').filter(Boolean) || ['shell', 'filesystem']),

      // Semantic Search & Optimization
      useSemanticToolSearch: initialConfig?.useSemanticToolSearch ?? (process.env.SYNTH_USE_SEMANTIC_TOOL_SEARCH !== 'false'),
      semanticSearchTopK: initialConfig?.semanticSearchTopK ?? parseInt(process.env.SYNTH_SEMANTIC_SEARCH_TOP_K || '10'),

      // Credential & Auth Settings
      credentialSource: (initialConfig?.credentialSource || process.env.SYNTH_CREDENTIAL_SOURCE || 'sso_only') as 'sso_only' | 'linked_accounts' | 'none',
      sessionBasedOAuth: initialConfig?.sessionBasedOAuth ?? (process.env.SYNTH_SESSION_BASED_OAUTH !== 'false'),
    };

    // Initialize executor client
    this.executorClient = getSynthExecutorClient(logger);

    // Reset daily usage at midnight
    this.scheduleDailyReset();

    // Load config from database (overrides env defaults with admin-set values)
    this.loadConfig().then(() => {
      this.logger.info({
        enabled: this.config.enabled,
        visibleToLLM: this.config.visibleToLLM,
        provider: this.config.provider,
        model: this.config.model,
}, '[SYNTH] Service initialized with configuration (DB config loaded)');
    }).catch(() => {
      this.logger.info({
        enabled: this.config.enabled,
        visibleToLLM: this.config.visibleToLLM,
        provider: this.config.provider,
        model: this.config.model,
}, '[SYNTH] Service initialized with configuration (env defaults)');
    });
  }

  /**
   * Get the ProviderManager via singleton accessor (Phase 4: replaced global read)
   */
  private getProviderManager(): ProviderManager | null {
    return getProviderManager();
  }

  // 2026-04-19 — getSliderService() removed (task #144, slider rip).
  // Synth picks the premium model directly from ModelConfigurationService.

  /**
   * Get LLMMetricsService instance
   */
  private getMetricsService(): LLMMetricsService {
    return LLMMetricsService.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(logger: Logger, config?: Partial<SynthConfig>): SynthService {
    if (!SynthService.instance) {
      SynthService.instance = new SynthService(logger, config);
    }
    return SynthService.instance;
  }

  /**
   * Update configuration
   */
  async updateConfig(config: Partial<SynthConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    this.logger.info({ config: this.config }, 'Synth configuration updated');

    // Persist to database
    await prisma.systemConfiguration.upsert({
      where: { key: 'synth_config' },
      update: {
        value: JSON.stringify(this.config),
        updated_at: new Date(),
      },
      create: {
        key: 'synth_config',
        value: JSON.stringify(this.config),
        description: 'Synth (Tool Synthesis) configuration',
      },
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): SynthConfig {
    return { ...this.config };
  }

  /**
   * Load configuration from database
   */
  async loadConfig(): Promise<void> {
    try {
      const dbConfig = await prisma.systemConfiguration.findUnique({
        where: { key: 'synth_config' },
      });

      if (dbConfig?.value) {
        const parsed = JSON.parse(dbConfig.value as string);
        this.config = { ...this.config, ...parsed };
        this.logger.info('Synth configuration loaded from database');
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to load Synth config from database, using defaults');
    }
  }

  /**
   * Synthesize and optionally execute a tool
   */
  async synthesize(request: SynthRequest): Promise<SynthResult> {
    const startTime = Date.now();

    // Check if Synth is enabled
    if (!this.config.enabled) {
      return {
        success: false,
        toolId: 'disabled',
        intent: request.intent,
        error: 'Synth is disabled by administrator',
        metrics: this.emptyMetrics(startTime),
      };
    }

    // Check rate limits
    const dailyCount = this.dailyUsage.get(request.userId) || 0;
    if (dailyCount >= this.config.maxDailySynthesesPerUser) {
      return {
        success: false,
        toolId: 'rate-limited',
        intent: request.intent,
        error: `Daily synthesis limit (${this.config.maxDailySynthesesPerUser}) reached`,
        metrics: this.emptyMetrics(startTime),
      };
    }

    // Check concurrent execution limit
    if (this.activeExecutions.size >= this.config.maxConcurrentExecutions) {
      return {
        success: false,
        toolId: 'concurrent-limited',
        intent: request.intent,
        error: `Maximum concurrent executions (${this.config.maxConcurrentExecutions}) reached`,
        metrics: this.emptyMetrics(startTime),
      };
    }

    // Increment daily usage
    this.dailyUsage.set(request.userId, dailyCount + 1);

    // Pre-synthesis abuse gate: reject obvious policy violations on the
    // raw intent before spending LLM tokens. Mirrors the abuse policy the
    // model sees in the `oat-guidance` prompt module.
    const preCheck = this.abuseClassifier.classify({ intent: request.intent });
    if (preCheck.category) {
      this.logger.warn({
        userId: request.userId,
        category: preCheck.category,
        confidence: preCheck.confidence,
        matchedPatterns: preCheck.matchedPatterns,
      }, '[SYNTH] Intent matches abuse policy — refusing pre-synthesis');
      const execId = `synth-refused-${Date.now()}`;
      this.auditSynth({
        userId: request.userId,
        userEmail: (request as any).userEmail,
        executionId: execId,
        intent: request.intent,
        capabilities: request.capabilities || [],
        cloudTargets: [],
        riskLevel: 'critical',
        outcome: 'refused',
        executionTimeMs: Date.now() - startTime,
      });
      return {
        success: false,
        toolId: 'policy-refused',
        intent: request.intent,
        error: `Refused by policy: request matches "${preCheck.category}" category. ` +
               `Synth cannot be used for content/actions in the prohibited list.`,
        metrics: this.emptyMetrics(startTime),
      };
    }

    // Build environment with user credentials
    const env = this.buildExecutionEnvironment(request);

    // Build Synth command arguments
    const args = this.buildSynthArgs(request);

    this.logger.info({
      userId: request.userId,
      intent: request.intent.substring(0, 100),
      provider: this.config.provider,
      dryRun: request.dryRun,
    }, '[SYNTH] Starting synthesis request');

    try {
      // Step 1: Synthesize Python code from intent using LLM with full platform integration
      const synthesis = await this.synthesizeCode(request);

      if (!synthesis.code) {
        return {
          success: false,
          toolId: 'synthesis-failed',
          intent: request.intent,
          error: `Failed to synthesize code: ${synthesis.riskReasoning}`,
          metrics: {
            synthesisTimeMs: synthesis.synthesisMetrics.totalMs,
            executionTimeMs: 0,
            totalTimeMs: Date.now() - startTime,
            inputTokens: synthesis.synthesisMetrics.inputTokens,
            outputTokens: synthesis.synthesisMetrics.outputTokens,
            costUsd: synthesis.synthesisMetrics.costUsd,
            ttftMs: synthesis.synthesisMetrics.ttftMs,
          },
        };
      }

      // Post-synthesis abuse gate: re-check the classifier with the
      // generated code. Catches the case where the LLM accepted a benign-
      // sounding intent but produced a payload in the prohibited set.
      const postCheck = this.abuseClassifier.classify({
        intent: request.intent,
        code: synthesis.code,
      });
      if (postCheck.category) {
        this.logger.warn({
          userId: request.userId,
          category: postCheck.category,
          confidence: postCheck.confidence,
          matchedPatterns: postCheck.matchedPatterns,
        }, '[SYNTH] Generated code matches abuse policy — refusing post-synthesis');
        const execId = `synth-refused-${Date.now()}`;
        this.auditSynth({
          userId: request.userId,
          userEmail: (request as any).userEmail,
          executionId: execId,
          intent: request.intent,
          code: synthesis.code,
          capabilities: request.capabilities || [],
          cloudTargets: [],
          riskLevel: 'critical',
          outcome: 'refused',
          executionTimeMs: Date.now() - startTime,
        });
        return {
          success: false,
          toolId: 'policy-refused-code',
          intent: request.intent,
          error: `Refused by policy: synthesized code matches "${postCheck.category}" category. ` +
                 'The request was blocked after code generation.',
          metrics: {
            synthesisTimeMs: synthesis.synthesisMetrics.totalMs,
            executionTimeMs: 0,
            totalTimeMs: Date.now() - startTime,
            inputTokens: synthesis.synthesisMetrics.inputTokens,
            outputTokens: synthesis.synthesisMetrics.outputTokens,
            costUsd: synthesis.synthesisMetrics.costUsd,
            ttftMs: synthesis.synthesisMetrics.ttftMs,
          },
        };
      }

      // For dry run, return without executing
      if (request.dryRun) {
        return {
          success: true,
          toolId: `synth-${Date.now()}`,
          intent: request.intent,
          result: {
            dryRun: true,
            code: synthesis.code,
            riskLevel: synthesis.riskLevel,
            explanation: `Synthesized tool (dry run - not executed). Risk: ${synthesis.riskLevel}`,
          },
          tool: {
            code: synthesis.code,
            explanation: `Synthesized tool using ${synthesis.synthesisMetrics.model} (dry run - not executed)`,
            riskLevel: synthesis.riskLevel,
            riskReasoning: synthesis.riskReasoning,
            capabilitiesUsed: request.capabilities || [],
            requestedScopes: [],
          },
          metrics: {
            synthesisTimeMs: synthesis.synthesisMetrics.totalMs,
            executionTimeMs: 0,
            totalTimeMs: Date.now() - startTime,
            inputTokens: synthesis.synthesisMetrics.inputTokens,
            outputTokens: synthesis.synthesisMetrics.outputTokens,
            costUsd: synthesis.synthesisMetrics.costUsd,
            ttftMs: synthesis.synthesisMetrics.ttftMs,
          },
          existingToolsSuggested: synthesis.existingTools.length > 0 ? synthesis.existingTools : undefined,
        };
      }

      // Step 2: Risk-based gating -- determine if approval is needed before execution
      // - low risk: auto-approved if config.autoApproveLowRisk is true (default)
      // - medium risk: auto-approved if config.autoApproveMediumRisk is true
      // - high/critical risk: ALWAYS requires manual approval (never auto-approved)
      const needsApproval = this.riskRequiresApproval(synthesis.riskLevel);

      if (needsApproval) {
        const toolId = `synth-${Date.now()}`;
        this.auditSynth({
          userId: request.userId,
          userEmail: (request as any).userEmail,
          executionId: toolId,
          intent: request.intent,
          code: synthesis.code,
          capabilities: request.capabilities || [],
          cloudTargets: (request.capabilities || []).filter((c) => ['aws', 'azure', 'gcp'].includes(c)),
          riskLevel: synthesis.riskLevel,
          outcome: 'approval_pending',
          executionTimeMs: Date.now() - startTime,
        });
        const tool = {
          code: synthesis.code,
          explanation: synthesis.riskReasoning,
          riskLevel: synthesis.riskLevel,
          riskReasoning: synthesis.riskReasoning,
          capabilitiesUsed: request.capabilities || [],
          requestedScopes: [],
        };

        // Create an approval record in the database so admins can see and act on it
        try {
          const approval = await this.createApprovalRecord(toolId, request, tool);

          this.logger.info({
            userId: request.userId,
            riskLevel: synthesis.riskLevel,
            approvalId: approval.approvalId,
          }, '[SYNTH] Approval required - synthesis blocked pending review');

          return {
            success: false,
            toolId,
            intent: request.intent,
            error: `Approval required: risk level "${synthesis.riskLevel}" requires human review before execution`,
            tool,
            metrics: {
              synthesisTimeMs: synthesis.synthesisMetrics.totalMs,
              executionTimeMs: 0,
              totalTimeMs: Date.now() - startTime,
              inputTokens: synthesis.synthesisMetrics.inputTokens,
              outputTokens: synthesis.synthesisMetrics.outputTokens,
              costUsd: synthesis.synthesisMetrics.costUsd,
              ttftMs: synthesis.synthesisMetrics.ttftMs,
            },
            approval: {
              required: true,
              approved: false,
              reason: `Risk level "${synthesis.riskLevel}" requires manual approval`,
            },
          };
        } catch (approvalError) {
          this.logger.error({ error: approvalError }, '[SYNTH] Failed to create approval record');
          return {
            success: false,
            toolId,
            intent: request.intent,
            error: `Approval required but failed to create approval record: ${approvalError instanceof Error ? approvalError.message : String(approvalError)}`,
            tool,
            metrics: {
              synthesisTimeMs: synthesis.synthesisMetrics.totalMs,
              executionTimeMs: 0,
              totalTimeMs: Date.now() - startTime,
              inputTokens: synthesis.synthesisMetrics.inputTokens,
              outputTokens: synthesis.synthesisMetrics.outputTokens,
              costUsd: synthesis.synthesisMetrics.costUsd,
              ttftMs: synthesis.synthesisMetrics.ttftMs,
            },
            approval: {
              required: true,
              approved: false,
              reason: `Risk level "${synthesis.riskLevel}" requires manual approval`,
            },
          };
        }
      }

      // Step 3: Execute synthesized code via Synth Executor
      const result = await this.executeSynth(args, env, request, synthesis.code);

      // Merge synthesis metrics into result
      result.tool = {
        code: synthesis.code,
        explanation: `Synthesized tool using ${synthesis.synthesisMetrics.model}`,
        riskLevel: synthesis.riskLevel,
        riskReasoning: synthesis.riskReasoning,
        capabilitiesUsed: request.capabilities || [],
        requestedScopes: [],
      };

      // Update metrics with synthesis cost
      result.metrics.synthesisTimeMs = synthesis.synthesisMetrics.totalMs;
      result.metrics.inputTokens = synthesis.synthesisMetrics.inputTokens;
      result.metrics.outputTokens = synthesis.synthesisMetrics.outputTokens;
      result.metrics.costUsd = synthesis.synthesisMetrics.costUsd;
      result.metrics.ttftMs = synthesis.synthesisMetrics.ttftMs;
      result.metrics.totalTimeMs = Date.now() - startTime;

      // Log synthesis to database
      await this.logSynthesis(request, result);

      return result;

    } catch (error) {
      this.logger.error({ error, userId: request.userId }, '[SYNTH] Synthesis failed');

      return {
        success: false,
        toolId: 'error',
        intent: request.intent,
        error: error instanceof Error ? error.message : String(error),
        metrics: this.emptyMetrics(startTime),
      };
    }
  }

  /**
   * Synthesize Python code from natural language intent
   * This calls the configured LLM to generate executable code
   */
  private async synthesizeCode(request: SynthRequest): Promise<{
    code: string | null;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskReasoning: string;
    existingTools: string[];
    synthesisMetrics: {
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      ttftMs?: number;
      totalMs: number;
      model: string;
    };
  }> {
    const startTime = Date.now();
    let ttftMs: number | undefined;

    // Get platform services
    const providerManager = this.getProviderManager();
    const metricsService = this.getMetricsService();

    // Default response for failures
    const defaultResponse = {
      code: null,
      riskLevel: 'low' as const,
      riskReasoning: 'No synthesis performed',
      existingTools: [] as string[],
      synthesisMetrics: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        totalMs: Date.now() - startTime,
        model: this.config.model || 'unknown',
      },
    };

    if (!providerManager) {
      this.logger.warn('ProviderManager not available - cannot synthesize code');
      return defaultResponse;
    }

    this.logger.info({
      userId: request.userId,
      intent: request.intent.substring(0, 100),
      provider: this.config.provider,
      useSemanticSearch: this.config.useSemanticToolSearch,
    }, '[SYNTH] Starting code synthesis with platform integration');

    try {
      // Step 1 removed 2026-04-19 — slider ripped (task #144). Synth always
      // uses the premium model from ModelConfigurationService; per-user
      // spend caps are enforced at dispatch time by UserModelBudgetService.

      // Step 2: Find relevant existing MCP tools via semantic search
      let existingTools: Array<{ name: string; description: string; server: string }> = [];

      if (this.config.useSemanticToolSearch) {
        try {
          // Get ToolSemanticCacheService via singleton accessor
          const toolCache: ToolSemanticCacheService | null = getToolSemanticCache();

          if (toolCache && toolCache.isInitialized) {
            const searchResults = await toolCache.searchTools(request.intent, 10);
            existingTools = searchResults.map(tool => ({
              name: tool.name,
              description: tool.description || '',
              server: tool.server_name || 'unknown',
            }));

            this.logger.info({
              userId: request.userId,
              foundTools: existingTools.length,
              topTools: existingTools.slice(0, 3).map(t => t.name),
            }, '[SYNTH] Found existing MCP tools via semantic search');
          }
        } catch (searchError) {
          this.logger.warn({ error: searchError }, '[SYNTH] Semantic tool search failed, continuing without');
        }
      }

      // Step 3: Build synthesis prompt
      const systemPrompt = this.buildSynthesisSystemPrompt(request.capabilities || []);
      const userPrompt = this.buildSynthesisUserPrompt(request, existingTools);

      // Step 4a: Resolve target provider
      const providerNameMap: Record<string, string> = {
        bedrock: 'aws-bedrock',
        anthropic: 'anthropic',
        google: 'vertex-ai',
        azure: 'azure-openai',
        ollama: 'ollama',
        openai: 'openai',
        'azure-ai-foundry': 'azure-ai-foundry',
        'aws-bedrock': 'aws-bedrock',
        'google-vertex': 'vertex-ai',
        'vertex-ai': 'vertex-ai',
        'azure-openai': 'azure-openai',
      };
      let targetProvider: string | undefined;
      if (this.config.provider && this.config.provider !== 'auto') {
        const mappedName = providerNameMap[this.config.provider] || this.config.provider;
        // Verify the provider exists before targeting it
        const providerForModel = providerManager.getProviderForModel?.(mappedName);
        // Check using createCompletion's targetProvider param — it checks providers.has()
        // We need a safe check, so try getProviderForModel or just let it fall through
        targetProvider = mappedName;

        // Quick availability check: try to detect if provider exists
        // ProviderManager.createCompletion will throw if not found, so we pre-validate
        try {
          const testModel = mappedName; // Will be caught by createCompletion
          // Actually, just let auto-detection handle it if the explicit provider fails
        } catch {
          targetProvider = undefined;
        }
      }

      // Step 4b: Determine model — prefer premium from registry (synth needs the smartest model)
      let model = this.config.model;

      if (!model) {
        try {
          const { ModelConfigurationService: mcs } = await import('./ModelConfigurationService.js');
          const tiers = await mcs.getTierModels();
          model = tiers.premium;
          this.logger.debug({ model }, '[SYNTH] Using premium model from registry for synthesis');
        } catch { /* fall through to provider defaults */ }
      }

      if (!model) {
        const providerDefaults: Record<string, string> = {
          'aws-bedrock': 'us.anthropic.claude-sonnet-4-6',
          anthropic: 'claude-sonnet-4-6',
          'google-vertex': 'gemini-2.5-pro',
          'vertex-ai': 'gemini-2.5-pro',
          'azure-openai': 'gpt-4o',
          ollama: 'gpt-oss',
          openai: 'gpt-4o',
        };

        if (targetProvider && providerDefaults[targetProvider]) {
          model = providerDefaults[targetProvider];
        } else if (this.config.provider && this.config.provider !== 'auto') {
          const mapped = providerNameMap[this.config.provider] || this.config.provider;
          model = providerDefaults[mapped] || 'gpt-oss';
        } else {
          // Use 'auto' — Smart Router / ProviderManager picks the best available model from DB
          model = 'auto';
        }
      }

      this.logger.info({
        userId: request.userId,
        model,
        targetProvider,
        maxTokens: this.config.maxSynthesisTokens,
      }, '[SYNTH] Calling LLM for synthesis');

      // Step 5: Call LLM via ProviderManager
      const completionRequest: CompletionRequest = {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model,
        temperature: this.config.synthesisTemperature,
        max_tokens: this.config.maxSynthesisTokens,
        stream: false,
      };

      const llmStartTime = Date.now();
      let response: CompletionResponse;
      try {
        response = await providerManager.createCompletion(completionRequest, targetProvider) as CompletionResponse;
      } catch (providerError: any) {
        // If targeted provider failed, retry with auto-detection and a compatible model
        if (targetProvider) {
          this.logger.warn({
            targetProvider,
            error: providerError.message,
          }, '[SYNTH] Targeted provider failed, retrying with auto-detection');
          // Reset model to 'auto' — Smart Router picks best available
          const fallbackRequest = { ...completionRequest, model: 'auto' };
          response = await providerManager.createCompletion(fallbackRequest) as CompletionResponse;
        } else {
          throw providerError;
        }
      }

      const llmEndTime = Date.now();
      const totalMs = llmEndTime - startTime;

      // Step 6: Extract Python code and risk assessment from response
      const content = response.choices?.[0]?.message?.content || '';
      const { code, riskLevel, riskReasoning } = this.parseCodeResponse(content);

      // Step 7: Log metrics
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;

      await metricsService.logRequest({
        userId: request.userId,
        sessionId: request.sessionId || undefined,
        providerType: this.config.provider,
        model: response.model || model,
        requestType: 'completion',
        source: 'api',
        streaming: false,
        temperature: this.config.synthesisTemperature,
        maxTokens: this.config.maxSynthesisTokens,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        totalDurationMs: llmEndTime - llmStartTime,
        status: code ? 'success' : 'error',
        requestStartedAt: new Date(llmStartTime),
        requestCompletedAt: new Date(llmEndTime),
        // Synth-specific metadata for tracking/analytics
        providerMetadata: {
          synth: true,
          synth_intent: request.intent.substring(0, 200),
          synth_capabilities: request.capabilities || [],
          synth_existing_tools_found: existingTools.length,
          synth_risk_level: riskLevel,
        },
      });

      // Calculate cost using metrics service
      const costs = metricsService.calculateCost(
        this.config.provider,
        response.model || model,
        inputTokens,
        outputTokens
      );

      this.logger.info({
        userId: request.userId,
        codeGenerated: !!code,
        codeLength: code?.length || 0,
        riskLevel,
        inputTokens,
        outputTokens,
        costUsd: costs.totalCost.toFixed(6),
        totalMs,
      }, '[SYNTH] Synthesis completed');

      return {
        code,
        riskLevel,
        riskReasoning,
        existingTools: existingTools.map(t => t.name),
        synthesisMetrics: {
          inputTokens,
          outputTokens,
          costUsd: costs.totalCost,
          ttftMs,
          totalMs,
          model: response.model || model,
        },
      };

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId: request.userId,
      }, '[SYNTH] Code synthesis failed');

      return {
        ...defaultResponse,
        synthesisMetrics: {
          ...defaultResponse.synthesisMetrics,
          totalMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Request human approval for a tool
   */

  /**
   * Build the system prompt for code synthesis
   */
  private buildSynthesisSystemPrompt(capabilities: string[]): string {
    const capabilityList = capabilities.length > 0
      ? capabilities.join(', ')
      : 'http, json, datetime (default safe capabilities)';

    return `You are an expert Python code generator for Synth (Tool Synthesis).
Your task is to synthesize Python code that accomplishes the user's intent.

## Your Capabilities
You can generate code that uses these capabilities: ${capabilityList}

## Output Format
You MUST respond in this exact format:

\`\`\`python
# Your synthesized Python code here
\`\`\`

RISK_LEVEL: [low|medium|high|critical]
RISK_REASONING: [One sentence explaining the risk assessment]

## Risk Assessment Guidelines
- **low**: Read-only operations, local computations, safe HTTP GET requests
- **medium**: Data modification, authenticated API calls, file operations in allowed paths
- **high**: Credential handling, external system modifications, database writes
- **critical**: System-level operations, credential storage, network configuration changes

## Code Requirements
1. Code must be self-contained and executable
2. Use standard Python libraries when possible
3. Always include error handling
4. Print results as JSON to stdout for capture
5. Do NOT use any blocked operations
6. If credentials are needed, access them from environment variables (they will be injected)

## Blocked Operations (NEVER generate code that does these)
- Direct shell command execution (subprocess, os.system) unless explicitly allowed
- File operations outside /tmp unless filesystem capability is enabled
- Network requests to internal/private IP ranges
- Credential hardcoding
- Infinite loops or resource exhaustion`;
  }

  /**
   * Build the user prompt for code synthesis
   */
  private buildSynthesisUserPrompt(
    request: SynthRequest,
    existingTools: Array<{ name: string; description: string; server: string }>
  ): string {
    let prompt = `## User Intent
${request.intent}

## Context
- User ID: ${request.userId}
- Capabilities available: ${(request.capabilities || ['http', 'json', 'datetime']).join(', ')}`;

    // Add existing tools as reference
    if (existingTools.length > 0) {
      prompt += `\n\n## Relevant Existing MCP Tools
The following existing tools might be relevant to this task. Consider if the intent could be accomplished using these tools instead, or if custom code is truly needed:

`;
      existingTools.forEach((tool, i) => {
        prompt += `${i + 1}. **${tool.name}** (${tool.server}): ${tool.description.substring(0, 200)}${tool.description.length > 200 ? '...' : ''}\n`;
      });

      prompt += `\nIf an existing tool can accomplish the task, mention it in your response. Generate code only if custom logic is truly required.`;
    }

    // Add uploaded file context so generated code knows where files are
    const files = (request as any).files;
    if (files && Array.isArray(files) && files.length > 0) {
      prompt += `\n\n## Uploaded Files (available at runtime)
The following files have been uploaded and will be available in the sandbox:
`;
      files.forEach((f: any, i: number) => {
        prompt += `- **${f.name}** (${f.type}, ${Math.round((f.data?.length || 0) * 3 / 4 / 1024)}KB) → path: \`/tmp/${f.name}\` (env var: UPLOADED_FILE_${i})\n`;
      });
      prompt += `
**IMPORTANT**: The files are pre-decoded to /tmp. Read them directly from the file paths above.
Do NOT try to decode base64 — the files are already binary on disk.
For output files, write them to /tmp/ and print the result as JSON with a base64-encoded "file_output" field:
\`\`\`python
import base64
with open("/tmp/output.docx", "rb") as f:
    encoded = base64.b64encode(f.read()).decode()
print(json.dumps({"status": "success", "file_output": encoded, "file_name": "output.docx"}))
\`\`\``;
    }

    // Add credential hints
    if (request.credentials) {
      prompt += `\n\n## Available Credentials (as environment variables)`;
      if (request.credentials.aws) {
        prompt += `\n- AWS credentials: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION`;
      }
      if (request.credentials.azure) {
        prompt += `\n- Azure credentials: AZURE_ACCESS_TOKEN, AZURE_TENANT_ID`;
      }
      if (request.credentials.gcp) {
        prompt += `\n- GCP credentials: GOOGLE_OAUTH_ACCESS_TOKEN, GCLOUD_PROJECT`;
      }
      if (request.credentials.github) {
        prompt += `\n- GitHub credentials: GITHUB_TOKEN`;
      }
    }

    prompt += `\n\nGenerate the Python code to accomplish this task.`;

    return prompt;
  }

  /**
   * Parse the LLM response to extract code and risk assessment
   */
  private parseCodeResponse(content: string): {
    code: string | null;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskReasoning: string;
  } {
    // Extract Python code block
    const codeMatch = content.match(/```python\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : null;

    // Extract risk level
    const riskMatch = content.match(/RISK_LEVEL:\s*(low|medium|high|critical)/i);
    const riskLevel = (riskMatch?.[1]?.toLowerCase() || 'medium') as 'low' | 'medium' | 'high' | 'critical';

    // Extract risk reasoning
    const reasoningMatch = content.match(/RISK_REASONING:\s*(.+?)(?:\n|$)/);
    const riskReasoning = reasoningMatch?.[1]?.trim() || 'No risk reasoning provided';

    // Validate code doesn't contain obvious security issues
    if (code) {
      const blockedPatterns = [
        /subprocess\.(run|call|Popen)/,
        /os\.(system|popen|spawn)/,
        /eval\s*\(/,
        /exec\s*\(/,
        /import\s+pickle/,
        /__import__/,
        /socket\.(AF_UNIX|connect)/,
      ];

      for (const pattern of blockedPatterns) {
        if (pattern.test(code)) {
          this.logger.warn({
            pattern: pattern.toString(),
          }, '[SYNTH] Blocked pattern detected in synthesized code');

          return {
            code: null,
            riskLevel: 'critical',
            riskReasoning: 'Code contains blocked security patterns',
          };
        }
      }
    }

    return { code, riskLevel, riskReasoning };
  }

  /**
   * @deprecated Use createApprovalRecord() instead, which uses the Prisma model
   * and matches the actual synth_approvals schema (synthesis_id, requester_id, etc.)
   */

  /**
   * Process approval decision using Prisma model
   */
  async processApproval(
    approvalId: string,
    decision: {
      approved: boolean;
      reason?: string;
      approvedBy: string;
      // GAP-4: optional cloud credentials snapshot from the approving user's
      // session — used to actually execute the approved synth code with the
      // user's identity. If absent, code runs without cloud credentials and
      // any cloud SDK calls in the synth will fail at the API level.
      cloudCredentials?: SynthRequest['credentials'];
    }
  ): Promise<void> {
    // Find the approver user by email to get their ID
    let approverId: string | undefined;
    try {
      const approver = await prisma.user.findFirst({
        where: { email: decision.approvedBy },
        select: { id: true },
      });
      approverId = approver?.id;
    } catch {
      // approver lookup failed, continue without ID
    }

    // Update the approval record
    const newStatus = decision.approved ? 'approved' : 'rejected';
    await prisma.synthApproval.update({
      where: { id: approvalId },
      data: {
        status: newStatus,
        reason: decision.reason || null,
        approver_id: approverId || null,
        resolved_at: new Date(),
      },
    });

    // Look up the linked synthesis record
    let synthesisId: string | null = null;
    let synthesisRow: any = null;
    try {
      const approval = await prisma.synthApproval.findUnique({
        where: { id: approvalId },
        select: { synthesis_id: true },
      });
      if (approval?.synthesis_id) {
        synthesisId = approval.synthesis_id;
        synthesisRow = await prisma.synthSynthesis.findUnique({
          where: { id: approval.synthesis_id },
        });
        await prisma.synthSynthesis.update({
          where: { id: approval.synthesis_id },
          data: {
            status: decision.approved ? 'approved' : 'rejected',
          },
        });
      }
    } catch (err) {
      this.logger.warn({ err, approvalId }, 'Failed to update linked synthesis status');
    }

    this.emit('approval_processed', {
      approvalId,
      ...decision,
    });

    // GAP-4: post-approval execution.
    // Previously processApproval just flipped status and returned — the user clicked
    // Approve and then nothing visible happened, because the original SSE stream had
    // long since closed and there was no path to deliver the executed result back
    // to chat. The user had to re-prompt the LLM to retry.
    //
    // Fix: when approved, re-run the stored code via executeSynth using the
    // approving user's cloud credentials, then write the result back to the
    // synth_syntheses row + emit a redis event so live UIs can pick it up via
    // their existing /api/synth/approvals polling.
    if (decision.approved && synthesisRow && synthesisRow.code) {
      // Fire-and-forget — caller (HTTP handler) doesn't need to wait
      this.executePostApproval(synthesisId!, synthesisRow, decision.cloudCredentials).catch(err => {
        this.logger.error({ err, approvalId, synthesisId }, '[SYNTH-POST-APPROVAL] Execution failed');
      });
    }
  }

  /**
   * GAP-4: Re-execute approved synth code in the sandbox.
   * Runs async after processApproval() returns so the HTTP /approve call doesn't
   * block on potentially-slow sandbox execution. Result is persisted to the
   * synth_syntheses row so the UI's polling endpoint can deliver it back to chat.
   */
  private async executePostApproval(
    synthesisId: string,
    synthesisRow: any,
    cloudCredentials?: SynthRequest['credentials']
  ): Promise<void> {
    const startMs = Date.now();
    this.logger.info({ synthesisId, hasCredentials: !!cloudCredentials }, '[SYNTH-POST-APPROVAL] Executing approved synth');

    // Reconstruct the SynthRequest from the stored synthesis row
    const request: SynthRequest = {
      intent: synthesisRow.intent,
      userId: synthesisRow.user_id,
      userEmail: undefined, // not stored; OBO will inject token via env regardless
      capabilities: synthesisRow.capabilities || [],
      sessionId: synthesisRow.session_id || undefined,
      credentials: cloudCredentials,
    };

    // Mark as executing
    try {
      await prisma.synthSynthesis.update({
        where: { id: synthesisId },
        data: { status: 'executing' },
      });
    } catch { /* non-fatal */ }

    let result: SynthResult;
    try {
      // Skip the LLM resynthesis step — we already have the approved code
      result = await this.executeSynth(
        this.buildSynthArgs(request),
        this.buildExecutionEnvironment(request),
        request,
        synthesisRow.code
      );
    } catch (err: any) {
      this.logger.error({ err, synthesisId }, '[SYNTH-POST-APPROVAL] executeSynth threw');
      result = {
        success: false,
        toolId: synthesisId,
        intent: synthesisRow.intent,
        error: err?.message || 'Unknown execution error',
        metrics: this.emptyMetrics(startMs),
      };
    }

    // Persist the result back to the synthesis row
    try {
      await prisma.synthSynthesis.update({
        where: { id: synthesisId },
        data: {
          status: result.success ? 'completed' : 'failed',
          result: (result.result ?? null) as any,
          error: result.error || null,
          execution_time_ms: result.metrics?.executionTimeMs || (Date.now() - startMs),
          completed_at: new Date(),
        },
      });
      this.logger.info({
        synthesisId,
        success: result.success,
        executionTimeMs: result.metrics?.executionTimeMs,
      }, '[SYNTH-POST-APPROVAL] Result persisted to DB');
    } catch (err) {
      this.logger.error({ err, synthesisId }, '[SYNTH-POST-APPROVAL] Failed to persist result');
    }

    // Best-effort: publish to Redis pubsub so live UIs can pick up the result
    // immediately instead of waiting for the next poll cycle. Channel name is
    // session-keyed so it lines up with what the chat UI subscribes to.
    if (synthesisRow.session_id) {
      try {
        const { getRedisClient } = await import('../utils/redis-client.js');
        const redis = await getRedisClient();
        if (redis) {
          await redis.publish(
            `synth:result:${synthesisRow.session_id}`,
            JSON.stringify({
              synthesisId,
              sessionId: synthesisRow.session_id,
              success: result.success,
              result: result.result,
              error: result.error,
              executionTimeMs: result.metrics?.executionTimeMs,
              timestamp: Date.now(),
            })
          );
          this.logger.debug({ synthesisId, sessionId: synthesisRow.session_id }, '[SYNTH-POST-APPROVAL] Published result to Redis');
        }
      } catch (err) {
        this.logger.debug({ err }, '[SYNTH-POST-APPROVAL] Redis publish failed (non-fatal)');
      }
    }

    // Emit local event for any in-process listeners
    this.emit('post_approval_complete', {
      synthesisId,
      sessionId: synthesisRow.session_id,
      success: result.success,
      result: result.result,
      error: result.error,
    });
  }

  /**
   * Determine if a given risk level requires human approval based on config
   */
  private riskRequiresApproval(riskLevel: 'low' | 'medium' | 'high' | 'critical'): boolean {
    switch (riskLevel) {
      case 'low':
        return !this.config.autoApproveLowRisk;
      case 'medium':
        return !this.config.autoApproveMediumRisk;
      case 'high':
      case 'critical':
        // High and critical ALWAYS require approval -- no auto-approve option
        return true;
      default:
        return true;
    }
  }

  /**
   * Create an approval record in the database and emit SSE notification
   */
  private async createApprovalRecord(
    toolId: string,
    request: SynthRequest,
    tool: NonNullable<SynthResult['tool']>
  ): Promise<{ approvalId: string }> {
    // First create the synthesis record
    const synthesis = await prisma.synthSynthesis.create({
      data: {
        user_id: request.userId,
        intent: request.intent,
        session_id: request.sessionId || null,
        capabilities: request.capabilities || [],
        code: tool.code,
        explanation: tool.explanation,
        risk_level: tool.riskLevel,
        risk_reasoning: tool.riskReasoning,
        capabilities_used: tool.capabilitiesUsed,
        status: 'pending',
        approval_required: true,
        dry_run: false,
      },
    });

    // Calculate expiry based on config
    const expiresAt = new Date(Date.now() + (this.config.approvalTimeoutSeconds || 3600) * 1000);

    // Create the approval record
    const approval = await prisma.synthApproval.create({
      data: {
        synthesis_id: synthesis.id,
        requester_id: request.userId,
        intent: request.intent,
        risk_level: tool.riskLevel,
        code: tool.code,
        status: 'pending',
        expires_at: expiresAt,
        timeout_action: this.config.approvalTimeoutAction || 'reject',
      },
    });

    // Link approval to synthesis
    await prisma.synthSynthesis.update({
      where: { id: synthesis.id },
      data: { approval_id: approval.id },
    });

    // Emit event for SSE notification to admin clients
    this.emit('approval_requested', {
      approvalId: approval.id,
      synthesisId: synthesis.id,
      toolId,
      userId: request.userId,
      userEmail: request.userEmail,
      intent: request.intent,
      riskLevel: tool.riskLevel,
      code: tool.code,
      expiresAt: expiresAt.toISOString(),
    });

    return { approvalId: approval.id };
  }

  /**
   * Get synthesis history for a user
   */
  async getHistory(userId: string, limit: number = 50): Promise<unknown[]> {
    try {
      const records = await prisma.synthSynthesis.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          id: true,
          intent: true,
          status: true,
          risk_level: true,
          capabilities_used: true,
          execution_time_ms: true,
          cost_usd: true,
          error: true,
          dry_run: true,
          created_at: true,
          completed_at: true,
        },
      });

      return records.map(r => ({
        toolId: r.id,
        intent: r.intent,
        success: r.status === 'completed',
        riskLevel: r.risk_level,
        capabilitiesUsed: r.capabilities_used,
        executionTimeMs: r.execution_time_ms || 0,
        costUsd: r.cost_usd ? Number(r.cost_usd) : 0,
        error: r.error,
        dryRun: r.dry_run,
        createdAt: r.created_at.toISOString(),
        completedAt: r.completed_at?.toISOString(),
      }));
    } catch (error) {
      this.logger.warn({ error }, 'Failed to query synth history from Prisma model, falling back to raw SQL');
      // Fallback for backwards compatibility (raw table may have different columns)
      try {
        return await prisma.$queryRaw`
          SELECT * FROM synth_syntheses
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      } catch {
        return [];
      }
    }
  }

  /**
   * Get usage statistics from synth_syntheses table
   */
  async getUsageStats(userId?: string): Promise<{
    totalSyntheses: number;
    successfulSyntheses: number;
    failedSyntheses: number;
    todaySyntheses: number;
    avgCostUsd: number;
    avgExecutionMs: number;
    totalCostUsd: number;
    riskBreakdown: Record<string, number>;
    topCapabilities: Array<{ name: string; count: number }>;
    dailyUsage: Array<{ date: string; count: number; cost: number }>;
  }> {
    try {
      const whereClause: Record<string, any> = {};
      if (userId) {
        whereClause.user_id = userId;
      }

      // Total count
      const totalSyntheses = await prisma.synthSynthesis.count({ where: whereClause });

      // Successful count
      const successfulSyntheses = await prisma.synthSynthesis.count({
        where: { ...whereClause, status: 'completed' },
      });

      // Failed count
      const failedSyntheses = await prisma.synthSynthesis.count({
        where: { ...whereClause, status: 'failed' },
      });

      // Today count
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todaySyntheses = await prisma.synthSynthesis.count({
        where: { ...whereClause, created_at: { gte: todayStart } },
      });

      // Aggregates: avg cost, avg execution time, total cost
      const aggregates = await prisma.synthSynthesis.aggregate({
        where: whereClause,
        _avg: {
          cost_usd: true,
          execution_time_ms: true,
        },
        _sum: {
          cost_usd: true,
        },
      });

      // Risk breakdown using groupBy
      const riskGroups = await prisma.synthSynthesis.groupBy({
        by: ['risk_level'],
        where: whereClause,
        _count: { _all: true },
      });

      const riskBreakdown: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const group of riskGroups) {
        if (group.risk_level && group.risk_level in riskBreakdown) {
          riskBreakdown[group.risk_level] = group._count._all;
        }
      }

      // Top capabilities (flatten all capabilities_used arrays and count)
      let topCapabilities: Array<{ name: string; count: number }> = [];
      try {
        const capabilityRows = userId
          ? await prisma.$queryRaw<Array<{ capability: string; count: bigint }>>`
              SELECT unnest(capabilities_used) AS capability, COUNT(*) AS count
              FROM synth_syntheses
              WHERE user_id = ${userId}
              GROUP BY capability
              ORDER BY count DESC
              LIMIT 10`
          : await prisma.$queryRaw<Array<{ capability: string; count: bigint }>>`
              SELECT unnest(capabilities_used) AS capability, COUNT(*) AS count
              FROM synth_syntheses
              GROUP BY capability
              ORDER BY count DESC
              LIMIT 10`;
        topCapabilities = capabilityRows.map(r => ({
          name: r.capability,
          count: Number(r.count),
        }));
      } catch {
        // capabilities_used array unnesting may fail on some setups; graceful fallback
        topCapabilities = [];
      }

      // Daily usage for last 30 days
      let dailyUsage: Array<{ date: string; count: number; cost: number }> = [];
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const dailyRows = userId
          ? await prisma.$queryRaw<Array<{ date: Date; count: bigint; cost: number }>>`
              SELECT DATE(created_at) AS date, COUNT(*) AS count, COALESCE(SUM(cost_usd), 0) AS cost
              FROM synth_syntheses
              WHERE created_at >= ${thirtyDaysAgo} AND user_id = ${userId}
              GROUP BY DATE(created_at)
              ORDER BY date DESC`
          : await prisma.$queryRaw<Array<{ date: Date; count: bigint; cost: number }>>`
              SELECT DATE(created_at) AS date, COUNT(*) AS count, COALESCE(SUM(cost_usd), 0) AS cost
              FROM synth_syntheses
              WHERE created_at >= ${thirtyDaysAgo}
              GROUP BY DATE(created_at)
              ORDER BY date DESC`;
        dailyUsage = dailyRows.map(r => ({
          date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
          count: Number(r.count),
          cost: Number(r.cost),
        }));
      } catch {
        dailyUsage = [];
      }

      return {
        totalSyntheses,
        successfulSyntheses,
        failedSyntheses,
        todaySyntheses,
        avgCostUsd: Number(aggregates._avg.cost_usd || 0),
        avgExecutionMs: Number(aggregates._avg.execution_time_ms || 0),
        totalCostUsd: Number(aggregates._sum.cost_usd || 0),
        riskBreakdown,
        topCapabilities,
        dailyUsage,
      };
    } catch (error) {
      this.logger.warn({ error }, 'Failed to query synth stats, returning in-memory fallback');
      return {
        totalSyntheses: 0,
        successfulSyntheses: 0,
        failedSyntheses: 0,
        todaySyntheses: userId ? (this.dailyUsage.get(userId) || 0) : 0,
        avgCostUsd: 0,
        avgExecutionMs: 0,
        totalCostUsd: 0,
        riskBreakdown: { low: 0, medium: 0, high: 0, critical: 0 },
        topCapabilities: [],
        dailyUsage: [],
      };
    }
  }

  /**
   * Cancel a running execution
   */
  cancelExecution(executionId: string): boolean {
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      this.activeExecutions.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Check if Synth Executor is available
   */
  async isExecutorAvailable(): Promise<boolean> {
    return this.executorClient.isReady();
  }

  // ============================================
  // Private Methods
  // ============================================

  private buildExecutionEnvironment(request: SynthRequest): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Synth user context
      SYNTH_USER_ID: request.userId,
      SYNTH_USER_EMAIL: request.userEmail,
      SYNTH_SESSION_ID: request.sessionId || '',
    };

    // Inject AWS credentials
    if (request.credentials?.aws) {
      env.AWS_ACCESS_KEY_ID = request.credentials.aws.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = request.credentials.aws.secretAccessKey;
      if (request.credentials.aws.sessionToken) {
        env.AWS_SESSION_TOKEN = request.credentials.aws.sessionToken;
      }
      env.AWS_DEFAULT_REGION = request.credentials.aws.region || 'us-east-1';
    }

    // Inject Azure credentials
    if (request.credentials?.azure) {
      env.AZURE_ACCESS_TOKEN = request.credentials.azure.accessToken;
      env.AZURE_TENANT_ID = request.credentials.azure.tenantId;
    }

    // Inject GCP credentials
    if (request.credentials?.gcp) {
      env.GOOGLE_OAUTH_ACCESS_TOKEN = request.credentials.gcp.accessToken;
      if (request.credentials.gcp.projectId) {
        env.GCLOUD_PROJECT = request.credentials.gcp.projectId;
        env.CLOUDSDK_CORE_PROJECT = request.credentials.gcp.projectId;
      }
    }

    // Inject GitHub token
    if (request.credentials?.github) {
      env.GITHUB_TOKEN = request.credentials.github.token;
    }

    return env;
  }

  private buildSynthArgs(request: SynthRequest): string[] {
    const args: string[] = ['synth', request.intent];

    // Provider
    args.push('--provider', this.config.provider);

    // Model
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Base URL
    if (this.config.baseUrl) {
      args.push('--base-url', this.config.baseUrl);
    }

    // Capabilities
    const capabilities = request.capabilities || this.config.allowedCapabilities;
    if (capabilities.length > 0) {
      args.push('--capabilities', capabilities.join(','));
    }

    // Dry run
    if (request.dryRun) {
      args.push('--dry-run');
    }

    return args;
  }

  /**
   * #482 — direct code execution (skips LLM synthesis).
   *
   * Used by the T3 compose_app iframe path: the model has already authored
   * Python (with boto3 / azure-mgmt-* / google-cloud-* available in the
   * synth-executor image), and the iframe POSTs to /api/synth/exec from
   * inside the sandboxed iframe. The /api/synth/* OBO preHandler has
   * already populated `credentials` with the AD user's ARM + Graph tokens,
   * so the executed code runs AS the authenticated user — same identity
   * boundary as the chatmode synth_execute tool.
   *
   * Returns the raw executor response so the caller can decide whether to
   * stream stdout or wrap it. No approval gate here — T3 mini-apps run
   * pre-validated code in the same distroless sandbox; LOW risk by design.
   */
  async executeCode(req: {
    userId: string;
    userEmail?: string;
    sessionId?: string;
    code: string;
    capabilities?: string[];
    credentials?: SynthRequest['credentials'];
    timeoutSeconds?: number;
    maxMemoryMb?: number;
  }): Promise<{
    success: boolean;
    result?: unknown;
    stdout?: string;
    stderr?: string;
    error?: string;
    executionTimeMs?: number;
    executionId: string;
  }> {
    const startTime = Date.now();
    const executionId = `${req.userId}-exec-${Date.now()}`;

    const credentials: Record<string, string> = {};
    if (req.credentials?.aws) {
      credentials.AWS_ACCESS_KEY_ID = req.credentials.aws.accessKeyId;
      credentials.AWS_SECRET_ACCESS_KEY = req.credentials.aws.secretAccessKey;
      if (req.credentials.aws.sessionToken) {
        credentials.AWS_SESSION_TOKEN = req.credentials.aws.sessionToken;
      }
      credentials.AWS_DEFAULT_REGION = req.credentials.aws.region || 'us-east-1';
    }
    if (req.credentials?.azure) {
      credentials.AZURE_ACCESS_TOKEN = req.credentials.azure.accessToken;
      credentials.AZURE_TENANT_ID = req.credentials.azure.tenantId;
    }
    if (req.credentials?.gcp) {
      credentials.GOOGLE_OAUTH_ACCESS_TOKEN = req.credentials.gcp.accessToken;
      if (req.credentials.gcp.projectId) {
        credentials.GCLOUD_PROJECT = req.credentials.gcp.projectId;
      }
    }
    if (req.credentials?.github) {
      credentials.GITHUB_TOKEN = req.credentials.github.token;
    }

    const isReady = await this.executorClient.isReady();
    if (!isReady) {
      return {
        success: false,
        executionId,
        error: 'Synth Executor service is not available.',
      };
    }

    try {
      const response = await this.executorClient.execute({
        executionId,
        code: req.code,
        intent: '[T3-iframe-direct-exec]',
        userId: req.userId,
        sessionId: req.sessionId ?? executionId,
        userEmail: req.userEmail,
        timeoutSeconds: req.timeoutSeconds ?? this.config.timeoutSeconds,
        maxMemoryMb: req.maxMemoryMb ?? this.config.maxMemoryMb,
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        capabilities: req.capabilities || this.config.allowedCapabilities,
      });

      const caps = req.capabilities || [];
      this.auditSynth({
        userId: req.userId,
        userEmail: req.userEmail,
        executionId,
        intent: '[T3-iframe-direct-exec]',
        code: req.code,
        capabilities: caps,
        cloudTargets: caps.filter((c) => ['aws', 'azure', 'gcp'].includes(c)),
        riskLevel: 'low',
        outcome: response.success ? 'success' : 'error',
        executionTimeMs: response.executionTimeMs ?? (Date.now() - startTime),
        injectedEnvKeys: Object.keys(credentials),
      });

      return {
        success: response.success,
        result: response.result,
        stdout: response.stdout,
        stderr: response.stderr,
        error: response.error,
        executionTimeMs: response.executionTimeMs,
        executionId,
      };
    } catch (err) {
      this.logger.error({ err, executionId }, '[SYNTH] executeCode failed');
      return {
        success: false,
        executionId,
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  private async executeSynth(
    _args: string[],
    _env: NodeJS.ProcessEnv,
    request: SynthRequest,
    synthesizedCode: string
  ): Promise<SynthResult> {
    const startTime = Date.now();
    const executionId = `${request.userId}-${Date.now()}`;

    // Create abort controller for cancellation
    const abortController = new AbortController();
    this.activeExecutions.set(executionId, abortController);

    try {
      // Check if executor is available
      const isReady = await this.executorClient.isReady();
      if (!isReady) {
        this.logger.warn('Synth Executor is not ready, checking health...');
        const health = await this.executorClient.healthCheck();
        if (!health) {
          return {
            success: false,
            toolId: 'executor-unavailable',
            intent: request.intent,
            error: 'Synth Executor service is not available. Ensure synth-executor is deployed and running.',
            metrics: this.emptyMetrics(startTime),
          };
        }
      }

      // Build credentials map for executor
      const credentials: Record<string, string> = {};
      if (request.credentials?.aws) {
        credentials.AWS_ACCESS_KEY_ID = request.credentials.aws.accessKeyId;
        credentials.AWS_SECRET_ACCESS_KEY = request.credentials.aws.secretAccessKey;
        if (request.credentials.aws.sessionToken) {
          credentials.AWS_SESSION_TOKEN = request.credentials.aws.sessionToken;
        }
        credentials.AWS_DEFAULT_REGION = request.credentials.aws.region || 'us-east-1';
      }
      if (request.credentials?.azure) {
        credentials.AZURE_ACCESS_TOKEN = request.credentials.azure.accessToken;
        credentials.AZURE_TENANT_ID = request.credentials.azure.tenantId;
      }
      if (request.credentials?.gcp) {
        credentials.GOOGLE_OAUTH_ACCESS_TOKEN = request.credentials.gcp.accessToken;
        if (request.credentials.gcp.projectId) {
          credentials.GCLOUD_PROJECT = request.credentials.gcp.projectId;
        }
      }
      if (request.credentials?.github) {
        credentials.GITHUB_TOKEN = request.credentials.github.token;
      }

      // Execute via the synth-executor service
      const response = await this.executorClient.execute({
        executionId,
        code: synthesizedCode,
        intent: request.intent,
        userId: request.userId,
        sessionId: request.sessionId ?? executionId,
        userEmail: request.userEmail,
        timeoutSeconds: this.config.timeoutSeconds,
        maxMemoryMb: this.config.maxMemoryMb,
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        capabilities: request.capabilities || this.config.allowedCapabilities,
        // Pass input files (base64) for sandbox processing
        files: (request as any).files,
      });

      this.activeExecutions.delete(executionId);

      this.logger.info({
        executionId,
        executorSuccess: response.success,
        hasResult: response.result !== null && response.result !== undefined,
        resultType: typeof response.result,
        resultPreview: response.result ? JSON.stringify(response.result).substring(0, 200) : 'null',
        hasStdout: !!response.stdout,
        hasError: !!response.error,
      }, '[SYNTH] Executor response received');

      // Emit completion event
      this.emit('synthesis_complete', {
        executionId,
        userId: request.userId,
        success: response.success,
      });

      const endTime = Date.now();

      // Use executor result, falling back to stdout if result is null
      const executionResult = response.result ?? (response.stdout ? { output: response.stdout } : null);

      // Audit: one row per execution, success or error. code_hash + intent
      // + cloud_targets + outcome + execution_time_ms are persisted;
      // stdout/result are NOT.
      const caps = request.capabilities || [];
      this.auditSynth({
        userId: request.userId,
        userEmail: (request as any).userEmail,
        executionId,
        intent: request.intent,
        code: synthesizedCode,
        capabilities: caps,
        cloudTargets: caps.filter((c) => ['aws', 'azure', 'gcp'].includes(c)),
        riskLevel: (request as any)._riskLevel || 'low',
        outcome: response.success ? 'success' : 'error',
        executionTimeMs: response.executionTimeMs,
        injectedEnvKeys: Object.keys((request as any).credentials || {}),
      });

      return {
        success: response.success,
        toolId: executionId,
        intent: request.intent,
        tool: {
          code: synthesizedCode,
          explanation: 'Synthesized tool executed via Synth Executor',
          riskLevel: 'low', // TODO: Get from synthesis step
          riskReasoning: 'Executed in isolated container with resource limits',
          capabilitiesUsed: request.capabilities || [],
          requestedScopes: [],
        },
        result: executionResult,
        error: response.error,
        metrics: {
          synthesisTimeMs: 0, // TODO: Track synthesis time separately
          executionTimeMs: response.executionTimeMs,
          totalTimeMs: endTime - startTime,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          ttftMs: undefined,
        },
      };

    } catch (error) {
      this.activeExecutions.delete(executionId);

      return {
        success: false,
        toolId: 'executor-error',
        intent: request.intent,
        error: `Failed to execute via Synth Executor: ${error instanceof Error ? error.message : String(error)}`,
        metrics: this.emptyMetrics(startTime),
      };
    }
  }

  private emptyMetrics(startTime: number): SynthResult['metrics'] {
    return {
      synthesisTimeMs: 0,
      executionTimeMs: 0,
      totalTimeMs: Date.now() - startTime,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  private async logSynthesis(
    request: SynthRequest,
    result: SynthResult
  ): Promise<void> {
    try {
      await prisma.synthSynthesis.create({
        data: {
          user_id: request.userId,
          intent: request.intent,
          session_id: request.sessionId || null,
          capabilities: request.capabilities || [],
          code: result.tool?.code || '',
          explanation: result.tool?.explanation || null,
          risk_level: result.tool?.riskLevel || 'unknown',
          risk_reasoning: result.tool?.riskReasoning || null,
          capabilities_used: result.tool?.capabilitiesUsed || [],
          status: result.success ? 'completed' : 'failed',
          result: result.result ? JSON.parse(JSON.stringify(result.result)) : null,
          error: result.error || null,
          dry_run: request.dryRun || false,
          approval_required: false,
          synthesis_time_ms: result.metrics.synthesisTimeMs || null,
          execution_time_ms: result.metrics.executionTimeMs || null,
          input_tokens: result.metrics.inputTokens || null,
          output_tokens: result.metrics.outputTokens || null,
          cost_usd: result.metrics.costUsd || null,
          ttft_ms: result.metrics.ttftMs || null,
          completed_at: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn({ error }, 'Failed to log Synth synthesis to database');
    }
  }

  private scheduleDailyReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
      this.dailyUsage.clear();
      this.logger.info('Synth daily usage counters reset');
      this.scheduleDailyReset(); // Schedule next reset
    }, msUntilMidnight);
  }
}

export default SynthService;
