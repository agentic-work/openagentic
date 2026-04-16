/**
 * Multi-Model Orchestration Pipeline Stage
 *
 * Replaces or wraps the CompletionStage when multi-model is enabled.
 * Coordinates between reasoning, tool execution, and synthesis models.
 */

import { PipelineStage, PipelineContext, PipelineConfig } from './pipeline.types.js';
import {
  MultiModelOrchestrator,
  MultiModelConfig,
  ModelRole,
  getDefaultMultiModelConfig
} from '../../../services/multi-model/index.js';
import { llmMetricsService, LLMRequestMetrics } from '../../../services/LLMMetricsService.js';

/**
 * Multi-Model Orchestration Stage
 *
 * This stage can:
 * 1. Replace the CompletionStage when multi-model is fully enabled
 * 2. Wrap the CompletionStage for graceful fallback
 *
 * Configuration is controlled by:
 * - ENABLE_MULTI_MODEL environment variable (build-time)
 * - SystemConfiguration 'multi_model_config' (runtime)
 * - Intelligence slider position
 */
export class MultiModelOrchestrationStage implements PipelineStage {
  readonly name = 'multi-model-orchestration';

  private orchestrator: MultiModelOrchestrator;
  private cachedConfig: MultiModelConfig | null = null;
  private configCacheTime: number = 0;
  private readonly CONFIG_CACHE_TTL_MS = 60000; // 1 minute cache

  constructor() {
    this.orchestrator = new MultiModelOrchestrator();
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const { logger, sliderConfig } = context;

    // 1. Check if multi-model is enabled
    const multiModelConfig = await this.getMultiModelConfig(context);

    if (!multiModelConfig.enabled) {
      logger.debug(
        { source: multiModelConfig.source },
        '[MULTI-MODEL] Disabled, delegating to single model completion'
      );
      return this.delegateToSingleModel(context);
    }

    // CRITICAL: Set the runtime config on the orchestrator BEFORE analyzing
    // This ensures analyzeRequest uses the database config, not defaults
    this.orchestrator.setRuntimeConfig(multiModelConfig);

    // 2. Analyze request to determine if multi-model is beneficial
    const routingDecision = await this.orchestrator.analyzeRequest(
      context.preparedMessages || context.messages,
      context.availableTools || [],
      sliderConfig
    );

    logger.info({
      useMultiModel: routingDecision.useMultiModel,
      reason: routingDecision.reason,
      complexity: routingDecision.taskAnalysis.complexity,
      requiresReasoning: routingDecision.taskAnalysis.requiresReasoning,
      requiresTools: routingDecision.taskAnalysis.requiresTools,
      executionPlan: routingDecision.executionPlan
    }, '[MULTI-MODEL] Routing decision');

    if (!routingDecision.useMultiModel) {
      // Simple request - use single model
      if (routingDecision.singleModelFallback) {
        context.request.model = routingDecision.singleModelFallback.model;
        context.modelSelectionReason = routingDecision.reason;
      }
      return this.delegateToSingleModel(context);
    }

    // 3. Execute multi-model orchestration
    const orchestrationId = `mmo-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    logger.info({
      orchestrationId,
      executionPlan: routingDecision.executionPlan
    }, '[MULTI-MODEL] Starting orchestration');

    // Emit orchestration start event
    context.emit('multi_model_start', {
      orchestrationId,
      executionPlan: routingDecision.executionPlan,
      timestamp: Date.now()
    });

    try {
      // Set provider manager from context if available
      // CRITICAL FIX: context.completionService IS the ProviderManager, not an object containing one
      if (context.completionService && typeof context.completionService.createCompletion === 'function') {
        this.orchestrator.setProviderManager(context.completionService);
        (context as any).logger?.info({
          orchestrationId,
          providerManagerSet: true
        }, '[MULTI-MODEL] ✅ ProviderManager set on orchestrator');
      } else {
        (context as any).logger?.warn({
          orchestrationId,
          hasCompletionService: !!context.completionService,
          completionServiceType: typeof context.completionService
        }, '[MULTI-MODEL] ⚠️ ProviderManager NOT available - will use simulated responses');
      }

      // When forceFinalCompletion is set, don't pass tools so LLM must synthesize a response
      const toolsToSend = context.forceFinalCompletion ? undefined : context.availableTools;

      if (context.forceFinalCompletion) {
        // Log via context logger if available
        (context as any).logger?.info({
          orchestrationId,
          forceFinalCompletion: true
        }, '[MULTI-MODEL] Forced final completion - excluding tools to require synthesis');
      }

      const result = await this.orchestrator.orchestrate({
        orchestrationId,
        messages: context.preparedMessages || context.messages,
        systemPrompt: context.systemPrompt,
        tools: toolsToSend,
        sliderConfig,
        config: multiModelConfig,
        emit: (event: string, data: unknown) => context.emit(event, data)
      });

      // Update context with results
      context.response = result.finalResponse;

      // CRITICAL FIX: Extract ACTUAL model names from costBreakdown instead of role names
      // The costBreakdown contains the real model identifier for each role executed
      const modelsUsed: string[] = [];
      for (const role of result.rolesExecuted) {
        const roleBreakdown = result.costBreakdown[role];
        if (roleBreakdown?.model) {
          modelsUsed.push(roleBreakdown.model);
        }
      }
      const modelString = modelsUsed.length > 0 ? modelsUsed.join(' → ') : 'multi-model';

      // CRITICAL FIX: Push assistant message to context.messages so response stage can save it
      // Without this, multi-model responses were not being persisted to PostgreSQL!
      const assistantMessageId = `multi_model_${orchestrationId}`;
      const assistantMessage = {
        id: assistantMessageId,
        role: 'assistant' as const,
        content: result.finalResponse,
        timestamp: new Date(),
        model: modelString,
        tokenUsage: {
          prompt_tokens: result.metrics.totalInputTokens,
          completion_tokens: result.metrics.totalOutputTokens,
          total_tokens: result.metrics.totalInputTokens + result.metrics.totalOutputTokens
        },
        metadata: {
          multiModel: true,
          orchestrationId,
          rolesExecuted: result.rolesExecuted,
          costBreakdown: result.costBreakdown
        }
      };
      context.messages.push(assistantMessage);

      logger.info({
        messageId: assistantMessageId,
        contentLength: result.finalResponse?.length || 0,
        rolesExecuted: result.rolesExecuted
      }, '[MULTI-MODEL] ✅ Assistant message added to context.messages for database persistence');

      // Merge MCP calls
      context.mcpCalls = [
        ...(context.mcpCalls || []),
        ...result.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          serverName: tc.provider || 'multi-model',
          result: {
            success: !tc.error,
            data: tc.result,
            error: tc.error,
            executionTime: tc.duration
          },
          timestamp: tc.timestamp
        }))
      ];

      // Store multi-model metadata
      context.metadata = {
        ...context.metadata,
        multiModel: {
          orchestrationId,
          rolesExecuted: result.rolesExecuted,
          handoffCount: result.handoffCount,
          costBreakdown: result.costBreakdown,
          totalCost: result.totalCost,
          totalDuration: result.totalDuration,
          metrics: result.metrics
        }
      };

      // Update model selection reason - use actual model names
      context.modelSelectionReason = `Multi-model: ${modelString}`;

      // Emit completion event
      context.emit('multi_model_complete', {
        orchestrationId,
        success: true,
        rolesExecuted: result.rolesExecuted,
        handoffCount: result.handoffCount,
        totalCost: result.totalCost,
        totalDuration: result.totalDuration,
        timestamp: Date.now()
      });

      // Emit standard completion_complete event for compatibility
      context.emit('completion_complete', {
        messageId: context.messageId,
        content: result.finalResponse,
        model: modelString,
        provider: 'multi-model',
        usage: {
          promptTokens: result.metrics.totalInputTokens,
          completionTokens: result.metrics.totalOutputTokens,
          thinkingTokens: result.metrics.totalThinkingTokens,
          totalTokens: result.metrics.totalInputTokens + result.metrics.totalOutputTokens
        },
        estimatedCost: result.totalCost,
        multiModel: true
      });

      // Log LLM metrics for cost tracking in admin dashboard
      // CRITICAL: This ensures multi-model requests show up in cost analytics
      // CRITICAL FIX: Use actual model names and extract primary provider from first role
      const primaryRole = result.rolesExecuted[0];
      const primaryBreakdown = result.costBreakdown[primaryRole];
      const primaryProvider = primaryBreakdown?.model?.includes('gemini') ? 'vertex-ai' :
        primaryBreakdown?.model?.includes('claude') ? 'aws-bedrock' :
        primaryBreakdown?.model?.includes('gpt') ? 'azure-openai' : 'multi-model';

      try {
        const metrics: LLMRequestMetrics = {
          userId: context.user?.id,
          sessionId: context.session?.id,
          messageId: context.messageId,

          providerType: primaryProvider,
          providerName: 'multi-model-orchestrator',
          model: modelsUsed[0] || 'multi-model',  // Use first/primary model for pricing lookup

          requestType: 'chat',
          streaming: true,

          promptTokens: result.metrics.totalInputTokens,
          completionTokens: result.metrics.totalOutputTokens,
          totalTokens: result.metrics.totalInputTokens + result.metrics.totalOutputTokens,
          reasoningTokens: result.metrics.totalThinkingTokens,

          latencyMs: result.totalDuration,
          totalDurationMs: result.totalDuration,

          toolCallsCount: result.toolCalls?.length || 0,
          toolNames: result.toolCalls?.map(tc => tc.name) || [],

          status: 'success',

          providerMetadata: {
            orchestrationId,
            rolesExecuted: result.rolesExecuted,
            handoffCount: result.handoffCount,
            costBreakdown: result.costBreakdown
          },

          requestStartedAt: context.startTime,
          requestCompletedAt: new Date()
        };

        llmMetricsService.logRequest(metrics).then(logId => {
          if (logId) {
            logger.debug({
              logId,
              model: metrics.model,
              totalTokens: metrics.totalTokens,
              estimatedCost: result.totalCost
            }, '[MULTI-MODEL] 📊 LLM request logged to database for cost tracking');
          }
        }).catch(err => {
          logger.warn({ error: err.message }, '[MULTI-MODEL] Failed to log LLM request metrics');
        });
      } catch (metricsError: any) {
        logger.warn({ error: metricsError.message }, '[MULTI-MODEL] Failed to create metrics object');
      }

      logger.info({
        orchestrationId,
        rolesExecuted: result.rolesExecuted,
        handoffCount: result.handoffCount,
        totalCost: result.totalCost,
        totalDuration: result.totalDuration
      }, '[MULTI-MODEL] Orchestration completed successfully');

      return context;

    } catch (error: any) {
      logger.error({
        orchestrationId,
        error: error.message,
        stack: error.stack
      }, '[MULTI-MODEL] Orchestration failed, falling back to single model');

      // Emit error event
      context.emit('multi_model_error', {
        orchestrationId,
        error: error.message,
        timestamp: Date.now()
      });

      // Fallback to single model
      return this.executeFallback(context, multiModelConfig);
    }
  }

  /**
   * Get multi-model configuration from various sources
   * CRITICAL: Admin panel is the ONLY control. Default is single model mode.
   */
  private async getMultiModelConfig(context: PipelineContext): Promise<MultiModelConfig> {
    // NO ENV VAR CHECK - Admin panel is the authoritative source
    // Default: single model mode (enabled: false)

    // 2. Check if config is cached
    const now = Date.now();
    if (this.cachedConfig && now - this.configCacheTime < this.CONFIG_CACHE_TTL_MS) {
      context.logger.debug({
        cachedEnabled: this.cachedConfig.enabled,
        cacheAge: now - this.configCacheTime
      }, '[MULTI-MODEL] Using cached config');
      // Apply slider-based adjustments to cached config
      return this.applySliderAdjustments(this.cachedConfig, context.sliderConfig?.position);
    }

    // 3. Get runtime config from database (SystemConfiguration table)
    // CONSOLIDATED: Now reads from pipeline_config.stages.multiModel instead of multi_model_config
    // This ensures Pipeline Settings UI and actual behavior are in sync
    let runtimeConfig: Partial<MultiModelConfig> | null = null;

    try {
      const { prisma } = await import('../../../utils/prisma.js');

      // First try pipeline_config (primary source - set by Pipeline Settings UI)
      const pipelineConfigRecord = await prisma.systemConfiguration.findFirst({
        where: { key: 'pipeline_config' }
      });

      if (pipelineConfigRecord?.value) {
        const pipelineConfig = pipelineConfigRecord.value as any;
        const multiModelStage = pipelineConfig?.stages?.multiModel;

        if (multiModelStage) {
          // Map pipeline_config format to MultiModelConfig format
          runtimeConfig = {
            enabled: multiModelStage.enabled,
            roles: {
              reasoning: {
                role: 'reasoning',
                enabled: true,
                primaryModel: multiModelStage.roles?.reasoning?.primaryModel,
                fallbackModel: multiModelStage.roles?.reasoning?.fallbackModel,
                temperature: multiModelStage.roles?.reasoning?.temperature ?? 0.7,
                thinkingBudget: multiModelStage.roles?.reasoning?.thinkingBudget ?? 8000,
              },
              tool_execution: {
                role: 'tool_execution',
                enabled: true,
                primaryModel: multiModelStage.roles?.toolExecution?.primaryModel,
                fallbackModel: multiModelStage.roles?.toolExecution?.fallbackModel,
                temperature: multiModelStage.roles?.toolExecution?.temperature ?? 0.3,
              },
              synthesis: {
                role: 'synthesis',
                enabled: true,
                primaryModel: multiModelStage.roles?.synthesis?.primaryModel,
                fallbackModel: multiModelStage.roles?.synthesis?.fallbackModel,
                temperature: multiModelStage.roles?.synthesis?.temperature ?? 0.5,
              },
              fallback: {
                role: 'fallback',
                enabled: true,
                primaryModel: multiModelStage.roles?.fallback?.primaryModel,
                temperature: multiModelStage.roles?.fallback?.temperature ?? 0.5,
              },
            },
            routing: {
              complexityThreshold: multiModelStage.routing?.complexityThreshold ?? 60,
              alwaysMultiModelPatterns: multiModelStage.routing?.alwaysMultiModelPatterns ?? [],
              maxHandoffs: multiModelStage.routing?.maxHandoffs ?? 5,
              preferCheaperToolModel: multiModelStage.routing?.preferCheaperToolModel ?? true,
            },
            sliderOverrides: {
              enableAbovePosition: multiModelStage.sliderThreshold ?? 70,
              scaleBySlider: true,
            },
          } as Partial<MultiModelConfig>;

          context.logger.info({
            runtimeEnabled: runtimeConfig.enabled,
            source: 'pipeline_config',
            reasoningModel: runtimeConfig.roles?.reasoning?.primaryModel,
            synthesisModel: runtimeConfig.roles?.synthesis?.primaryModel,
          }, '[MULTI-MODEL] Loaded config from pipeline_config (consolidated)');
        }
      }

      // Fallback: Check legacy multi_model_config if pipeline_config doesn't have multiModel
      if (!runtimeConfig) {
        const legacyConfigRecord = await prisma.systemConfiguration.findFirst({
          where: { key: 'multi_model_config' }
        });

        if (legacyConfigRecord?.value) {
          runtimeConfig = legacyConfigRecord.value as Partial<MultiModelConfig>;
          context.logger.info({
            runtimeEnabled: runtimeConfig.enabled,
            source: 'multi_model_config (legacy)'
          }, '[MULTI-MODEL] Loaded config from legacy multi_model_config');
        }
      }

      if (!runtimeConfig) {
        context.logger.debug('[MULTI-MODEL] No runtime config in database');
      }
    } catch (error) {
      context.logger.warn({ error }, '[MULTI-MODEL] Failed to get runtime config from database');
    }

    // Check if runtime toggle is explicitly disabled
    if (runtimeConfig && runtimeConfig.enabled === false) {
      context.logger.info('[MULTI-MODEL] Disabled by runtime toggle in database');
      return {
        ...getDefaultMultiModelConfig(),
        enabled: false,
        source: 'runtime' as const
      };
    }

    // 4. Check slider position threshold (only if no explicit runtime enable)
    const sliderPosition = context.sliderConfig?.position ?? 50;
    const defaultConfig = getDefaultMultiModelConfig();
    const sliderThreshold = runtimeConfig?.sliderOverrides?.enableAbovePosition ??
      defaultConfig.sliderOverrides.enableAbovePosition;

    // If runtime config explicitly enables multi-model, skip slider threshold check
    const runtimeExplicitlyEnabled = runtimeConfig?.enabled === true;

    if (!runtimeExplicitlyEnabled && sliderPosition < sliderThreshold) {
      context.logger.debug({
        sliderPosition,
        sliderThreshold
      }, '[MULTI-MODEL] Slider position below threshold');
      return {
        ...defaultConfig,
        enabled: false,
        source: 'default' as const
      };
    }

    // 5. Get full config with admin role assignments
    const adminConfig = await this.orchestrator.getAdminRoleAssignments(sliderPosition);

    const finalConfig: MultiModelConfig = {
      enabled: true,
      source: runtimeConfig ? 'runtime' : 'admin',
      roles: {
        ...adminConfig.roles,
        ...(runtimeConfig?.roles || {})
      },
      routing: {
        ...defaultConfig.routing,
        ...(runtimeConfig?.routing || {})
      },
      sliderOverrides: {
        ...defaultConfig.sliderOverrides,
        ...(runtimeConfig?.sliderOverrides || {})
      }
    };

    context.logger.info({
      enabled: finalConfig.enabled,
      source: finalConfig.source,
      roles: Object.keys(finalConfig.roles)
    }, '[MULTI-MODEL] Final config resolved');

    // Cache the config
    this.cachedConfig = finalConfig;
    this.configCacheTime = now;

    return finalConfig;
  }

  /**
   * Apply slider-based adjustments to config
   */
  private applySliderAdjustments(
    config: MultiModelConfig,
    sliderPosition?: number
  ): MultiModelConfig {
    if (!sliderPosition || !config.sliderOverrides.scaleBySlider) {
      return config;
    }

    // Clone config to avoid mutation
    const adjusted = JSON.parse(JSON.stringify(config)) as MultiModelConfig;

    // Scale thinking budget by slider position
    if (sliderPosition >= 80) {
      adjusted.roles[ModelRole.REASONING].thinkingBudget =
        Math.min(32000, (adjusted.roles[ModelRole.REASONING].thinkingBudget || 8000) * 2);
    }

    return adjusted;
  }

  /**
   * Delegate to single-model completion
   */
  private async delegateToSingleModel(context: PipelineContext): Promise<PipelineContext> {
    // Import and use existing CompletionStage
    const { CompletionStage } = await import('./completion-simple.stage.js');
    const completionStage = new CompletionStage();
    return completionStage.execute(context);
  }

  /**
   * Execute fallback using the fallback model
   */
  private async executeFallback(
    context: PipelineContext,
    config: MultiModelConfig
  ): Promise<PipelineContext> {
    const fallbackRole = config.roles[ModelRole.FALLBACK];

    context.request.model = fallbackRole.primaryModel;
    context.modelSelectionReason = 'Multi-model fallback after error';

    context.logger.info({
      fallbackModel: fallbackRole.primaryModel
    }, '[MULTI-MODEL] Executing fallback');

    return this.delegateToSingleModel(context);
  }
}

export default MultiModelOrchestrationStage;
