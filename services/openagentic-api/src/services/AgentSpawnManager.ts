/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * AgentSpawnManager
 *
 * Orchestrates parallel sub-agents for complex multi-step tasks.
 * Each sub-agent gets its own model (from AGENT_MODELS config), its own tool
 * subset, and its own tool call loop. Sub-agents run concurrently via
 * Promise.allSettled with configurable maxConcurrency.
 *
 * Integration points:
 * - ProviderManager: LLM completions (non-streaming, per sub-agent)
 * - executeToolCalls(): MCP tool execution (reuses existing pipeline helper)
 * - AgentRegistry: execution tracking, metrics, cost budgets
 * - SSE emit callback: real-time progress to the UI via parent pipeline
 *
 * Usage (from ChatPipeline tool call handler):
 *   const manager = new AgentSpawnManager(providerManager, logger);
 *   const results = await manager.spawnAgents(configs, emitFn, { maxConcurrency: 5 });
 */

import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { ProviderManager } from './llm-providers/ProviderManager.js';
import type { CompletionResponse } from './llm-providers/ILLMProvider.js';
import { MODELS, type AgentType } from '../config/models.js';
import { getAgentRegistry } from './AgentRegistry.js';
import { prisma } from '../utils/prisma.js';
import { executeToolCalls } from '../routes/chat/pipeline/tool-execution.helper.js';

// =============================================================================
// TYPES
// =============================================================================

export interface SubAgentConfig {
  /** Unique ID for this sub-agent (auto-generated if not provided) */
  agentId?: string;
  /** Agent role — maps to AgentRegistry agent types */
  role: AgentType;
  /** Natural language task description for this sub-agent */
  task: string;
  /** Optional system prompt override (defaults to role-based prompt) */
  systemPrompt?: string;
  /** Model to use (defaults to AGENT_MODELS[role].primary) */
  model?: string;
  /** Fallback model (defaults to AGENT_MODELS[role].fallback) */
  fallbackModel?: string;
  /** Tool names this agent can use (subset of available MCP tools) */
  tools?: string[];
  /** Max tool call rounds before forcing synthesis (default 3) */
  maxTurns?: number;
  /** Timeout in ms (default from AgentRegistry config) */
  timeout?: number;
  /** Max cost in cents for this agent (default from registry) */
  costBudget?: number;
}

export interface SubAgentResult {
  agentId: string;
  role: AgentType;
  status: 'success' | 'error' | 'timeout';
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

export interface SpawnOptions {
  /** Max concurrent sub-agents (default 5) */
  maxConcurrency?: number;
  /** How to aggregate results: merge (concat), synthesize (LLM summary), first (first success) */
  aggregationStrategy?: 'merge' | 'synthesize' | 'first';
  /** User context for tool execution auth */
  userToken?: string;
  idToken?: string;
  userId?: string;
  sessionId?: string;
  messageId?: string;
  userGroups?: string[];
  isAdmin?: boolean;
  userName?: string;
  userEmail?: string;
  /** Available MCP tools (from pipeline context) */
  availableTools?: any[];
  /** Original auth method from middleware ('api-key' | 'azure-ad' | 'local') */
  authMethod?: string;
}

type EmitFn = (event: string, data: any) => void;

// =============================================================================
// DEFAULT SYSTEM PROMPTS PER ROLE
// =============================================================================

// Fallback strings ONLY — used when an agent has no DB row and no composable
// prompt_modules. The DB-backed system_prompt + prompt_modules pipeline is the
// canonical source. Do not add behavioral rules here — add them as composable
// modules in services/prompt/ModuleSeeder.ts and reference via prompt_modules.
const ROLE_SYSTEM_PROMPTS: Record<AgentType, string> = {
  data_query: 'You are a data query specialist. Extract, filter, and return structured data efficiently. Be precise and concise.',
  data_extraction: 'You are a data extraction specialist. Parse complex data structures, extract key fields, and normalize outputs.',
  tool_orchestration: 'You are a tool orchestration agent. Determine which tools to call and in what order to accomplish the task. Think step-by-step.',
  reasoning: 'You are a deep reasoning agent. Analyze the problem thoroughly, consider multiple angles, and provide well-reasoned conclusions.',
  summarization: 'You are a summarization specialist. Distill complex information into clear, concise summaries.',
  code_execution: 'You are a code execution agent. Write, run, and debug code to solve the given task. Be precise with syntax and test your code.',
  planning: 'You are a planning agent. Break down complex tasks into clear steps, identify dependencies, and create actionable plans.',
  validation: 'You are a validation agent. Verify outputs, check for errors, and ensure results meet the specified requirements.',
  synthesis: 'You are a synthesis agent. Combine information from multiple sources into a coherent, complete response.',
  artifact_creation: 'You are a world-class artifact designer producing textbook-quality HTML. ALWAYS load Google Fonts (2-3 fonts per artifact). NEVER default to dark backgrounds — use light/warm/colorful themes unless content demands dark. Use multi-column CSS Grid layouts, callout boxes, figure captions, styled tables, inline SVG diagrams. Every artifact must look like a published textbook or premium SaaS product. Output as artifact:html with a descriptive <title> tag.',
  cloud_operations: 'You are the cloud_operations agent. Long-horizon multi-cloud provisioning, audit, and lifecycle work across Azure, AWS, and GCP. Behavioral rules are composed from prompt_modules — see the cloud-ops-* and provisioning-* modules in your composed system prompt.',
  custom: 'You are a specialized agent. Complete the assigned task using available tools and information.',
};

// Per-role cap on maxTurns. Most agents top out at 15 (legacy default). Long-
// horizon roles (cloud_operations) get a much bigger budget.
const MAX_TURNS_CEILING: Partial<Record<AgentType, number>> = {
  cloud_operations: 50,
};
const DEFAULT_MAX_TURNS_CEILING = 15;

// =============================================================================
// SERVICE
// =============================================================================

export class AgentSpawnManager {
  private providerManager: ProviderManager;
  private logger: Logger;

  constructor(providerManager: ProviderManager, logger: Logger) {
    this.providerManager = providerManager;
    this.logger = logger.child({ service: 'AgentSpawnManager' });
  }

  /**
   * Spawn multiple sub-agents concurrently.
   * Each agent runs its own tool call loop, uses its configured model,
   * and reports progress via SSE events.
   */
  async spawnAgents(
    configs: SubAgentConfig[],
    emit: EmitFn,
    options: SpawnOptions = {}
  ): Promise<SubAgentResult[]> {
    const { maxConcurrency = 5 } = options;

    // Load multi-model config from database (if enabled)
    const multiModelRoles = await this.getMultiModelRoleMap();

    // Resolve registry-based model tiers from DB (no hardcoded model IDs)
    // All agents use the same model selection as chat — DB-configured via Admin Console
    let registryTiers: Record<string, string> = {};
    let fallbackTier = 'auto'; // 'auto' = let Smart Router pick
    try {
      const { ModelConfigurationService: mcs } = await import('./ModelConfigurationService.js');
      const tiers = await mcs.getSliderTiers();
      fallbackTier = tiers.economical || 'auto';
      const roleToTier: Record<string, string> = {
        artifact_creation: tiers.premium || tiers.balanced,
        reasoning: tiers.premium || tiers.balanced,
        planning: tiers.premium || tiers.balanced,
        tool_orchestration: tiers.balanced,
        code_execution: tiers.balanced,
        data_extraction: tiers.balanced,
        data_query: tiers.economical,
        summarization: tiers.economical,
        validation: tiers.economical,
        synthesis: tiers.balanced,
        // cloud_operations needs a 1M-context-class model — Rule 6 in
        // ModelCapabilityGate enforces this floor and will upgrade if the tier
        // model doesn't meet it. We start at premium as the best opening bid.
        cloud_operations: tiers.premium || tiers.balanced,
        custom: tiers.balanced,
      };
      registryTiers = roleToTier;
      this.logger.info({ tiers, roleToTier }, '[AgentSpawnManager] Resolved model tiers from DB');
    } catch (err: any) {
      // Don't swallow — log and use 'auto' so Smart Router handles model selection
      this.logger.warn({ error: err.message }, '[AgentSpawnManager] Failed to load model tiers from DB, using auto (Smart Router)');
    }

    // Assign IDs and resolve defaults — DB tiers first, then Smart Router 'auto'
    // maxTurns ceiling is per-role: cloud_operations can reach 50, others 15.
    const resolvedConfigs = configs.map(c => {
      const ceiling = MAX_TURNS_CEILING[c.role] ?? DEFAULT_MAX_TURNS_CEILING;
      const requestedTurns = c.maxTurns ?? Math.min(15, ceiling);
      return {
        ...c,
        agentId: c.agentId || `agent_${uuidv4().substring(0, 8)}`,
        model: c.model || registryTiers[c.role] || multiModelRoles[c.role]?.primary || 'auto',
        fallbackModel: c.fallbackModel || multiModelRoles[c.role]?.fallback || fallbackTier,
        maxTurns: Math.min(requestedTurns, ceiling),
        timeout: c.timeout ?? 60000,
        systemPrompt: c.systemPrompt || ROLE_SYSTEM_PROMPTS[c.role] || ROLE_SYSTEM_PROMPTS.custom,
      };
    });

    // Validate agent models exist in registry
    for (const agentConfig of resolvedConfigs) {
      try {
        const { ModelConfigurationService: mcs } = await import('./ModelConfigurationService.js');
        const resolved = await mcs.resolveModelProvider(agentConfig.model);
        if (!resolved) {
          this.logger.warn({ model: agentConfig.model, role: agentConfig.role }, 'Agent model not in registry, using default');
          agentConfig.model = await mcs.getDefaultChatModel();
        }
      } catch { /* keep assigned model */ }
    }

    // CAPABILITY GATE: Validate agent models can handle tool calling
    // Agents always use tools. Economical models (gpt-oss, gemma3) may not support function calling.
    try {
      const { gateModelSelection } = await import('./ModelCapabilityGate.js');
      for (const agentConfig of resolvedConfigs) {
        // cloud_operations REQUIRES a 1M-context-class model. Rule 6 in
        // ModelCapabilityGate enforces the floor and will throw if no such
        // model is configured (we never silently downgrade an agent that
        // explicitly asked for 1M context).
        const requiredContextWindow =
          agentConfig.role === 'cloud_operations' ? 1_000_000 : undefined;

        const gateResult = await gateModelSelection({
          selectedModel: agentConfig.model,
          toolCount: 10, // Agents typically use many tools
          systemPromptLength: agentConfig.systemPrompt?.length || 0,
          hasImages: false,
          hasAgentDelegation: false,
          estimatedToolChainDepth:
            agentConfig.role === 'cloud_operations' ? 4 :
            agentConfig.role === 'tool_orchestration' ? 3 : 2,
          requiredContextWindow,
        }, this.logger);

        if (gateResult.upgraded) {
          this.logger.info({
            agentId: agentConfig.agentId,
            role: agentConfig.role,
            originalModel: agentConfig.model,
            upgradedModel: gateResult.model,
            reason: gateResult.reason,
          }, '🛡️ [CapabilityGate] Agent model upgraded');
          agentConfig.model = gateResult.model;
        }
      }
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AgentSpawnManager] CapabilityGate check failed, using assigned models');
    }

    // Emit spawn plan
    emit('agent_spawn_plan', {
      agents: resolvedConfigs.map(c => ({
        agentId: c.agentId,
        role: c.role,
        task: c.task.substring(0, 200),
        model: c.model,
      })),
      strategy: options.aggregationStrategy || 'merge',
      timestamp: Date.now(),
    });

    this.logger.info({
      agentCount: resolvedConfigs.length,
      roles: resolvedConfigs.map(c => c.role),
      models: resolvedConfigs.map(c => c.model),
      maxConcurrency,
    }, '[AgentSpawn] Spawning parallel agents');

    // Run with concurrency limit
    const results: SubAgentResult[] = [];
    for (let i = 0; i < resolvedConfigs.length; i += maxConcurrency) {
      const batch = resolvedConfigs.slice(i, i + maxConcurrency);
      const batchResults = await Promise.allSettled(
        batch.map(config => this.runSubAgent(config, emit, options))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // Create error result for rejected promises
          const failedConfig = batch[batchResults.indexOf(result)];
          results.push({
            agentId: failedConfig?.agentId || 'unknown',
            role: failedConfig?.role || 'custom',
            status: 'error',
            output: '',
            toolCallsExecuted: [],
            metrics: {
              inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
              durationMs: 0, costCents: 0, modelUsed: failedConfig?.model || '',
              fallbackUsed: false, toolCallRounds: 0,
            },
            error: result.reason?.message || String(result.reason),
          });
        }
      }
    }

    this.logger.info({
      totalAgents: results.length,
      successes: results.filter(r => r.status === 'success').length,
      errors: results.filter(r => r.status === 'error').length,
      totalInputTokens: results.reduce((s, r) => s + r.metrics.inputTokens, 0),
      totalOutputTokens: results.reduce((s, r) => s + r.metrics.outputTokens, 0),
    }, '[AgentSpawn] All agents completed');

    return results;
  }

  /**
   * Run a single sub-agent with its own tool call loop.
   */
  private async runSubAgent(
    config: SubAgentConfig & { agentId: string; model: string; fallbackModel: string; maxTurns: number; timeout: number; systemPrompt: string },
    emit: EmitFn,
    options: SpawnOptions
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const registry = getAgentRegistry();
    let executionMetrics;

    // Start execution tracking
    try {
      executionMetrics = await registry.startExecution(
        config.role,
        options.sessionId || '',
        options.userId || '',
        undefined, // traceId
        undefined  // loopId
      );
    } catch {
      // Non-fatal — continue without registry tracking
    }

    emit('agent_start', {
      agentId: config.agentId,
      role: config.role,
      model: config.model,
      task: config.task.substring(0, 200),
      timestamp: Date.now(),
    });

    const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: config.task },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThinkingTokens = 0;
    let modelUsed = config.model;
    let fallbackUsed = false;
    let toolCallRounds = 0;
    const toolCallsExecuted: SubAgentResult['toolCallsExecuted'] = [];

    // Filter available tools to only those this agent is allowed to use
    let agentTools = options.availableTools || [];
    if (config.tools && config.tools.length > 0) {
      const allowedTools = new Set(config.tools.map(t => t.toLowerCase()));
      agentTools = agentTools.filter(tool => {
        const name = (tool.function?.name || tool.name || '').toLowerCase();
        return allowedTools.has(name);
      });
    }

    // Ensure all agents have OAT (synth_synthesize) capability
    if (process.env.SYNTH_ENABLED !== 'false') {
      const synthToolNames = ['synth_synthesize', 'synthesize_tool', 'synth_execute'];
      const hasSynth = agentTools.some((t: any) => synthToolNames.includes(t.function?.name));
      if (!hasSynth) {
        const parentSynth = (options.availableTools || []).find((t: any) => synthToolNames.includes(t.function?.name));
        if (parentSynth) {
          agentTools.push(parentSynth);
        }
      }
    }

    try {
      // Tool call loop (up to maxTurns)
      for (let turn = 0; turn <= config.maxTurns; turn++) {
        // Check timeout
        if (Date.now() - startTime > config.timeout) {
          emit('agent_complete', {
            agentId: config.agentId, role: config.role,
            status: 'timeout', timestamp: Date.now(),
          });
          return this.buildResult(config, 'timeout', '', toolCallsExecuted, {
            inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
            modelUsed, fallbackUsed, toolCallRounds,
          }, 'Agent timed out');
        }

        // Call LLM (non-streaming for sub-agents — simpler and still fast)
        let response: CompletionResponse;
        try {
          const completionResult = await this.providerManager.createCompletion({
            model: modelUsed,
            messages,
            temperature: 0.3,
            max_tokens: 8192,
            tools: agentTools.length > 0 ? agentTools : undefined,
            stream: false,
          });
          response = completionResult as CompletionResponse;
        } catch (primaryError: any) {
          // Try fallback model
          if (!fallbackUsed && config.fallbackModel && config.fallbackModel !== modelUsed) {
            this.logger.warn({
              agentId: config.agentId, primaryModel: modelUsed,
              fallbackModel: config.fallbackModel, error: primaryError.message,
            }, '[AgentSpawn] Primary model failed, trying fallback');

            modelUsed = config.fallbackModel;
            fallbackUsed = true;

            const fallbackResult = await this.providerManager.createCompletion({
              model: modelUsed,
              messages,
              temperature: 0.3,
              max_tokens: 8192,
              tools: agentTools.length > 0 ? agentTools : undefined,
              stream: false,
            });
            response = fallbackResult as CompletionResponse;
          } else {
            throw primaryError;
          }
        }

        // Accumulate token usage
        if (response.usage) {
          totalInputTokens += response.usage.prompt_tokens || 0;
          totalOutputTokens += response.usage.completion_tokens || 0;
        }

        const choice = response.choices?.[0];
        if (!choice) break;

        const assistantContent = choice.message?.content || '';
        const toolCalls = choice.message?.tool_calls;

        // Emit thinking/content
        if (assistantContent) {
          emit('agent_stream', {
            agentId: config.agentId,
            content: assistantContent,
            timestamp: Date.now(),
          });
        }

        // If no tool calls, we're done
        if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === 'stop') {
          // Add final assistant message
          messages.push({ role: 'assistant', content: assistantContent });

          // Complete
          emit('agent_complete', {
            agentId: config.agentId, role: config.role, status: 'success',
            output: assistantContent.substring(0, 500),
            metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            timestamp: Date.now(),
          });

          // Track in registry
          if (executionMetrics) {
            registry.completeExecution(executionMetrics.executionId, {
              success: true,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              thinkingTokens: totalThinkingTokens,
              modelUsed,
              toolCallsInvolved: toolCallsExecuted.map(t => t.name),
            }).catch(() => {});
          }

          return this.buildResult(config, 'success', assistantContent, toolCallsExecuted, {
            inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
            thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
            modelUsed, fallbackUsed, toolCallRounds,
          });
        }

        // Handle tool calls
        toolCallRounds++;
        messages.push({
          role: 'assistant',
          content: assistantContent || '',
          tool_calls: toolCalls,
        });

        // Emit tool call events
        for (const tc of toolCalls) {
          emit('agent_tool_call', {
            agentId: config.agentId, toolName: tc.function?.name,
            args: tc.function?.arguments?.substring(0, 200),
            timestamp: Date.now(),
          });
        }

        // Execute tools via MCP proxy (reuses pipeline helper)
        const toolStartTime = Date.now();
        const { results: toolResults } = await executeToolCalls(
          toolCalls,
          this.logger,
          agentTools,
          options.userToken,
          options.idToken,
          options.userId,
          options.sessionId,
          options.messageId,
          undefined, undefined,
          (event, data) => emit(event, data),
          config.task,
          options.userGroups,
          options.isAdmin,
          modelUsed,
          undefined,
          options.userName,
          options.userEmail,
          undefined,  // codeExecutionContext
          options.authMethod
        );

        // Add tool results to messages
        for (const result of toolResults) {
          const toolCallId = toolCalls.find(tc => tc.function?.name === result.toolName)?.id || result.toolCallId || result.toolName;
          const resultContent = result.error
            ? `Error: ${result.error}`
            : (typeof result.result === 'string' ? result.result : JSON.stringify(result.result));
          messages.push({
            role: 'tool',
            content: resultContent,
            tool_call_id: toolCallId,
          });

          toolCallsExecuted.push({
            name: result.toolName,
            success: !result.error,
            durationMs: result.executionTimeMs || (Date.now() - toolStartTime),
          });

          emit('agent_tool_result', {
            agentId: config.agentId,
            toolName: result.toolName,
            success: !result.error,
            resultPreview: resultContent.substring(0, 200),
            timestamp: Date.now(),
          });
        }
      }

      // Max turns reached — extract last assistant content
      const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
      const finalContent = lastAssistant?.content || 'Agent reached maximum tool call rounds.';

      emit('agent_complete', {
        agentId: config.agentId, role: config.role, status: 'success',
        output: finalContent.substring(0, 500),
        timestamp: Date.now(),
      });

      if (executionMetrics) {
        registry.completeExecution(executionMetrics.executionId, {
          success: true,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          modelUsed,
          toolCallsInvolved: toolCallsExecuted.map(t => t.name),
        }).catch(() => {});
      }

      return this.buildResult(config, 'success', finalContent, toolCallsExecuted, {
        inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
        modelUsed, fallbackUsed, toolCallRounds,
      });

    } catch (error: any) {
      this.logger.error({
        agentId: config.agentId, role: config.role, error: error.message,
      }, '[AgentSpawn] Sub-agent failed');

      emit('agent_complete', {
        agentId: config.agentId, role: config.role,
        status: 'error', error: error.message,
        timestamp: Date.now(),
      });

      if (executionMetrics) {
        registry.completeExecution(executionMetrics.executionId, {
          success: false,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          modelUsed,
          error: error.message,
        }).catch(() => {});
      }

      return this.buildResult(config, 'error', '', toolCallsExecuted, {
        inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens, durationMs: Date.now() - startTime,
        modelUsed, fallbackUsed, toolCallRounds,
      }, error.message);
    }
  }

  private buildResult(
    config: { agentId: string; role: AgentType },
    status: 'success' | 'error' | 'timeout',
    output: string,
    toolCallsExecuted: SubAgentResult['toolCallsExecuted'],
    metrics: Omit<SubAgentResult['metrics'], 'costCents'>,
    error?: string
  ): SubAgentResult {
    // Estimate cost (simplified — production should use BedrockPricingService)
    const costCents = (metrics.inputTokens * 0.000003 + metrics.outputTokens * 0.000015) * 100;

    return {
      agentId: config.agentId,
      role: config.role,
      status,
      output,
      toolCallsExecuted,
      metrics: { ...metrics, costCents },
      error,
    };
  }

  /**
   * Format aggregated results for the master LLM to synthesize.
   */
  static formatResults(results: SubAgentResult[], strategy: string = 'merge'): string {
    if (strategy === 'first') {
      const first = results.find(r => r.status === 'success');
      return first?.output || 'No agents completed successfully.';
    }

    const parts: string[] = [];
    for (const result of results) {
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

  /**
   * Load multi-model role→model mapping from SystemConfiguration (DB).
   * Returns empty map if multi-model is disabled or not configured.
   */
  private async getMultiModelRoleMap(): Promise<Record<string, { primary: string; fallback?: string }>> {
    try {
      const configRecord = await prisma.systemConfiguration.findFirst({
        where: { key: 'multi_model_config' }
      });

      if (!configRecord?.value) return {};

      const config = configRecord.value as any;
      if (!config.enabled) return {};

      const roleMap: Record<string, { primary: string; fallback?: string }> = {};
      const roles = config.roles || {};

      for (const [role, roleConfig] of Object.entries(roles)) {
        const rc = roleConfig as any;
        if (rc?.enabled && rc?.primaryModel) {
          roleMap[role] = {
            primary: rc.primaryModel,
            fallback: rc.fallbackModel || undefined,
          };
        }
      }

      if (Object.keys(roleMap).length > 0) {
        this.logger.info({ roleMap }, '[AgentSpawn] Using multi-model config from database');
      }

      return roleMap;
    } catch (error) {
      this.logger.warn({ error }, '[AgentSpawn] Failed to load multi-model config, falling back to env vars');
      return {};
    }
  }
}
