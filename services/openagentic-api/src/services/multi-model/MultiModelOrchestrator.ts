/**
 * Multi-Model Orchestrator
 *
 * Coordinates multiple LLM models within a single chat request for
 * optimal cost, speed, and quality. Manages model role assignments,
 * handoffs, and context preservation.
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import pino from 'pino';
import {
  ModelRole,
  ModelHandoffContext,
  MultiModelConfig,
  MultiModelRoutingDecision,
  OrchestrationRequest,
  OrchestrationResult,
  ModelRoleConfig,
  ModelRoleResponse,
  getDefaultMultiModelConfig
} from './MultiModelOrchestrator.types.js';
import { MultiModelHandoffController } from './MultiModelHandoffController.js';

// Import from existing services
import type { ProviderManager } from '../llm-providers/ProviderManager.js';
import type { CompletionRequest, CompletionResponse } from '../llm-providers/ILLMProvider.js';

/**
 * Multi-Model Orchestrator Service
 *
 * Orchestrates requests across multiple LLM models based on role:
 * - Reasoning: Complex analysis and planning
 * - Tool Execution: MCP function calls
 * - Synthesis: Final response generation
 * - Fallback: Error recovery
 */
export class MultiModelOrchestrator {
  private logger: pino.Logger;
  private handoffController: MultiModelHandoffController;
  private providerManager: ProviderManager | null = null;
  private runtimeConfig: MultiModelConfig | null = null;

  constructor() {
    this.logger = pino({ name: 'MultiModelOrchestrator' });
    this.handoffController = new MultiModelHandoffController();
  }

  /**
   * Set the provider manager for LLM calls
   */
  setProviderManager(manager: ProviderManager): void {
    this.providerManager = manager;
  }

  /**
   * Get runtime configuration from database/cache
   */
  async getRuntimeConfig(): Promise<MultiModelConfig | null> {
    // This would be fetched from SystemConfiguration table
    // For now, return cached config or null
    return this.runtimeConfig;
  }

  /**
   * Set runtime configuration
   */
  setRuntimeConfig(config: MultiModelConfig): void {
    this.runtimeConfig = config;
  }

  /**
   * Get admin-configured role assignments based on slider position
   * All models are configured via environment variables with tier suffixes
   */
  async getAdminRoleAssignments(sliderPosition: number): Promise<{ roles: MultiModelConfig['roles'] }> {
    // This would query ModelRoleAssignment table filtered by slider position
    // For now, return roles from environment variables based on tier
    const baseConfig = getDefaultMultiModelConfig();

    // Determine tier based on slider position
    let tier: 'ECONOMY' | 'BALANCED' | 'PREMIUM';
    if (sliderPosition < 75) {
      tier = 'ECONOMY';
    } else if (sliderPosition < 90) {
      tier = 'BALANCED';
    } else {
      tier = 'PREMIUM';
    }

    // Override models from tier-specific env vars if set
    const reasoningModel = process.env[`MULTI_MODEL_${tier}_REASONING`];
    const toolModel = process.env[`MULTI_MODEL_${tier}_TOOL`];
    const synthesisModel = process.env[`MULTI_MODEL_${tier}_SYNTHESIS`];

    if (reasoningModel) {
      baseConfig.roles[ModelRole.REASONING].primaryModel = reasoningModel;
    }
    if (toolModel) {
      baseConfig.roles[ModelRole.TOOL_EXECUTION].primaryModel = toolModel;
    }
    if (synthesisModel) {
      baseConfig.roles[ModelRole.SYNTHESIS].primaryModel = synthesisModel;
    }

    // Premium tier: enable extended thinking with higher budget
    if (tier === 'PREMIUM') {
      baseConfig.roles[ModelRole.REASONING].options = {
        ...baseConfig.roles[ModelRole.REASONING].options,
        enableThinking: true
      };
      baseConfig.roles[ModelRole.REASONING].thinkingBudget =
        parseInt(process.env.MULTI_MODEL_PREMIUM_THINKING_BUDGET || '16000', 10);
    }

    return { roles: baseConfig.roles };
  }

  /**
   * Analyze request to determine if multi-model is beneficial
   */
  async analyzeRequest(
    messages: unknown[],
    availableTools: unknown[],
    sliderConfig?: { position: number }
  ): Promise<MultiModelRoutingDecision> {
    const lastMessage = messages[messages.length - 1] as { content?: string } | undefined;
    const query = typeof lastMessage?.content === 'string' ? lastMessage.content : '';

    // Analyze query complexity
    const complexity = this.analyzeComplexity(query);
    const requiresTools = availableTools.length > 0 && this.checkIfToolsLikelyNeeded(query);
    const requiresReasoning = complexity === 'complex' || complexity === 'expert';

    // Estimate tokens
    const estimatedTokens = this.estimateTokens(messages);

    // Get routing config
    const config = this.runtimeConfig || getDefaultMultiModelConfig();

    // Check if multi-model patterns match
    const matchesPattern = config.routing.alwaysMultiModelPatterns.some(
      pattern => query.toLowerCase().includes(pattern.toLowerCase())
    );

    // CRITICAL FIX: Check if admin has explicitly enabled multi-model via runtime config
    // When forceEnabled is true OR source is 'runtime' with enabled=true, always use multi-model
    const adminForceEnabled = config.enabled &&
      ((config as any).forceEnabled === true || (config as any).source === 'runtime');

    // Decision logic
    let useMultiModel = false;
    let reason = '';

    if (!config.enabled) {
      reason = 'Multi-model disabled by configuration';
    } else if (adminForceEnabled) {
      // CRITICAL: When admin explicitly enables multi-model, USE IT for all queries
      useMultiModel = true;
      reason = 'Multi-model forced by admin configuration';
    } else if (matchesPattern) {
      useMultiModel = true;
      reason = 'Query matches multi-model trigger pattern';
    } else if (requiresReasoning && requiresTools) {
      useMultiModel = true;
      reason = 'Complex query requiring both reasoning and tools';
    } else if (complexity === 'expert') {
      useMultiModel = true;
      reason = 'Expert-level complexity detected';
    } else if (sliderConfig && sliderConfig.position >= config.sliderOverrides.enableAbovePosition) {
      if (complexity === 'complex') {
        useMultiModel = true;
        reason = 'Slider position and complexity warrant multi-model';
      }
    }

    if (!useMultiModel && complexity === 'simple') {
      reason = 'Simple query - single model sufficient';
    } else if (!useMultiModel && complexity === 'moderate') {
      reason = 'Moderate query - single model adequate';
    }

    // Build execution plan if multi-model
    let executionPlan: MultiModelRoutingDecision['executionPlan'] | undefined;
    if (useMultiModel) {
      const roles: ModelRole[] = [];

      if (requiresReasoning) {
        roles.push(ModelRole.REASONING);
      }
      if (requiresTools) {
        roles.push(ModelRole.TOOL_EXECUTION);
      }
      roles.push(ModelRole.SYNTHESIS);

      executionPlan = {
        roles,
        estimatedCost: this.estimateCost(roles, estimatedTokens),
        estimatedDurationMs: this.estimateDuration(roles)
      };
    }

    return {
      useMultiModel,
      reason,
      executionPlan,
      singleModelFallback: useMultiModel ? undefined : {
        model: this.getSingleModelForComplexity(complexity),
        provider: 'auto'
      },
      taskAnalysis: {
        complexity,
        requiresReasoning,
        requiresTools,
        toolCount: availableTools.length,
        estimatedTokens
      }
    };
  }

  /**
   * Execute multi-model orchestration
   */
  async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const { orchestrationId, messages, systemPrompt, tools, config, emit } = request;

    this.logger.info({
      orchestrationId,
      messageCount: messages.length,
      toolCount: tools?.length || 0
    }, '[ORCHESTRATE] Starting multi-model orchestration');

    // Initialize context
    let context = this.handoffController.createInitialContext(orchestrationId);

    // Track roles executed
    const rolesExecuted: ModelRole[] = [];
    let finalResponse = '';

    // Determine initial role based on config
    const routingDecision = await this.analyzeRequest(messages, tools || [], request.sliderConfig);
    const executionPlan = routingDecision.executionPlan || {
      roles: [ModelRole.SYNTHESIS],
      estimatedCost: 0,
      estimatedDurationMs: 1000
    };

    emit('orchestration_start', {
      orchestrationId,
      executionPlan,
      timestamp: Date.now()
    });

    try {
      // Execute each role in the plan
      for (const role of executionPlan.roles) {
        if (context.handoffCount >= config.routing.maxHandoffs) {
          this.logger.warn({ orchestrationId, handoffs: context.handoffCount }, 'Max handoffs reached, forcing synthesis');
          break;
        }

        const roleConfig = config.roles[role];
        if (!roleConfig.enabled) {
          continue;
        }

        rolesExecuted.push(role);

        // Start role timing
        context.roleTimings[role] = { startTime: new Date() };

        emit('role_start', {
          orchestrationId,
          role,
          model: roleConfig.primaryModel,
          timestamp: Date.now()
        });

        // Build messages for this role
        const roleMessages = this.buildMessagesForRole(role, messages, context, systemPrompt);

        // Execute role
        const response = await this.executeRole({
          role,
          roleConfig,
          messages: roleMessages,
          tools: role === ModelRole.TOOL_EXECUTION ? tools : undefined,
          context,
          emit
        });

        // Handle response
        if (response.output.content) {
          finalResponse = response.output.content;
        }

        // Stream thinking content if available
        if (response.output.thinkingContent) {
          emit('role_thinking', {
            orchestrationId,
            role,
            content: response.output.thinkingContent,
            timestamp: Date.now()
          });
        }

        emit('role_complete', {
          orchestrationId,
          role,
          model: response.model,
          metrics: response.metrics,
          timestamp: Date.now()
        });

        // CRITICAL FIX: Always update costBreakdown for each role, not just on handoffs
        // This ensures the final role (e.g., synthesis) also has its cost and model recorded
        context.costBreakdown = {
          ...context.costBreakdown,
          [role]: {
            inputTokens: response.metrics.inputTokens,
            outputTokens: response.metrics.outputTokens,
            thinkingTokens: response.metrics.thinkingTokens,
            estimatedCost: response.metrics.estimatedCost,
            model: response.model
          }
        };

        // Determine next action
        const nextAction = this.handoffController.determineNextAction(
          response,
          context,
          config.routing.maxHandoffs
        );

        if (nextAction.action === 'complete') {
          break;
        }

        if (nextAction.action === 'handoff' && nextAction.nextRole) {
          context = this.handoffController.prepareHandoff(context, response, nextAction.nextRole);

          emit('handoff', {
            orchestrationId,
            fromRole: role,
            toRole: nextAction.nextRole,
            handoffCount: context.handoffCount,
            timestamp: Date.now()
          });
        }

        if (nextAction.action === 'fallback') {
          // Execute fallback
          context.currentRole = ModelRole.FALLBACK;
          const fallbackResponse = await this.executeRole({
            role: ModelRole.FALLBACK,
            roleConfig: config.roles[ModelRole.FALLBACK],
            messages: this.handoffController.buildSynthesisMessages(messages, context, systemPrompt),
            context,
            emit
          });

          if (fallbackResponse.output.content) {
            finalResponse = fallbackResponse.output.content;
          }
          rolesExecuted.push(ModelRole.FALLBACK);
          break;
        }

        // Update context with response
        context = response.updatedContext;
      }

      // Calculate totals
      const tokenTotals = this.handoffController.getTotalTokens(context);
      const totalCost = this.handoffController.getTotalCost(context);
      const totalDuration = this.handoffController.getTotalDuration(context);

      emit('orchestration_complete', {
        orchestrationId,
        rolesExecuted,
        handoffCount: context.handoffCount,
        totalCost,
        totalDuration,
        timestamp: Date.now()
      });

      return {
        finalResponse,
        toolCalls: context.toolExecutionOutput?.toolCalls || [],
        rolesExecuted,
        handoffCount: context.handoffCount,
        costBreakdown: context.costBreakdown,
        totalCost,
        totalDuration,
        metrics: {
          totalInputTokens: tokenTotals.inputTokens,
          totalOutputTokens: tokenTotals.outputTokens,
          totalThinkingTokens: tokenTotals.thinkingTokens
        }
      };

    } catch (error: any) {
      this.logger.error({
        orchestrationId,
        error: error.message,
        stack: error.stack
      }, '[ORCHESTRATE] Orchestration failed');

      emit('orchestration_error', {
        orchestrationId,
        error: error.message,
        rolesExecuted,
        timestamp: Date.now()
      });

      throw error;
    }
  }

  /**
   * Execute a single role
   */
  private async executeRole(params: {
    role: ModelRole;
    roleConfig: ModelRoleConfig;
    messages: unknown[];
    tools?: unknown[];
    context: ModelHandoffContext;
    emit: (event: string, data: unknown) => void;
  }): Promise<ModelRoleResponse> {
    const { role, roleConfig, messages, tools, context, emit } = params;
    const startTime = Date.now();

    this.logger.info({
      role,
      model: roleConfig.primaryModel,
      messageCount: messages.length,
      toolCount: tools?.length || 0
    }, '[EXECUTE-ROLE] Executing role');

    // Build completion request
    const request: Partial<CompletionRequest> & { thinking?: any } = {
      model: roleConfig.primaryModel,
      messages: messages as CompletionRequest['messages'],
      temperature: roleConfig.temperature,
      max_tokens: roleConfig.maxTokens,
      stream: true
    };

    // Add tools for tool execution role
    if (role === ModelRole.TOOL_EXECUTION && tools) {
      request.tools = tools as CompletionRequest['tools'];
    }

    // Add thinking config for reasoning role (extended thinking feature)
    if (role === ModelRole.REASONING && roleConfig.options?.enableThinking) {
      request.thinking = {
        type: 'enabled',
        budget_tokens: roleConfig.thinkingBudget || 8000 // Use snake_case for provider compatibility
      };
    }

    try {
      // Execute via ProviderManager if available
      let response: CompletionResponse;

      if (this.providerManager) {
        const result = await this.providerManager.createCompletion(
          request as CompletionRequest,
          roleConfig.provider
        );

        // Handle streaming response
        if (Symbol.asyncIterator in Object(result)) {
          response = await this.collectStreamingResponse(
            result as AsyncGenerator<any>,
            emit,
            context.orchestrationId,
            role
          );
        } else {
          response = result as CompletionResponse;
        }
      } else {
        // Fallback for testing - simulate response
        response = {
          id: `sim_${Date.now()}`,
          object: 'chat.completion',
          created: Date.now(),
          model: roleConfig.primaryModel,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: `[${role}] Simulated response - ProviderManager not available`
            },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        } as CompletionResponse;
      }

      const durationMs = Date.now() - startTime;

      // Extract content from choices
      const responseContent = response.choices?.[0]?.message?.content;
      const finishReason = response.choices?.[0]?.finish_reason || 'stop';
      const toolCalls = response.choices?.[0]?.message?.tool_calls;

      // Build role response
      const roleResponse: ModelRoleResponse = {
        role,
        model: roleConfig.primaryModel,
        provider: roleConfig.provider || 'auto',
        output: {
          content: responseContent,
          toolCalls: toolCalls,
          thinkingContent: (response as any).thinking?.content,
          finishReason
        },
        metrics: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
          thinkingTokens: (response as any).usage?.thinkingTokens,
          durationMs,
          estimatedCost: this.estimateCostFromUsage(
            response.usage?.prompt_tokens || 0,
            response.usage?.completion_tokens || 0,
            roleConfig.primaryModel
          ),
          timeToFirstToken: (response as any).timeToFirstToken
        },
        nextAction: 'handoff',
        updatedContext: context
      };

      return roleResponse;

    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      this.logger.error({
        role,
        model: roleConfig.primaryModel,
        error: error.message
      }, '[EXECUTE-ROLE] Role execution failed');

      // Try fallback model if available
      if (roleConfig.fallbackModel && roleConfig.fallbackModel !== roleConfig.primaryModel) {
        this.logger.info({
          role,
          fallbackModel: roleConfig.fallbackModel
        }, '[EXECUTE-ROLE] Trying fallback model');

        return this.executeRole({
          ...params,
          roleConfig: {
            ...roleConfig,
            primaryModel: roleConfig.fallbackModel,
            fallbackModel: undefined
          }
        });
      }

      // Return error response
      return {
        role,
        model: roleConfig.primaryModel,
        provider: roleConfig.provider || 'auto',
        output: {
          content: undefined,
          finishReason: 'error'
        },
        metrics: {
          inputTokens: 0,
          outputTokens: 0,
          durationMs,
          estimatedCost: 0
        },
        nextAction: 'fallback',
        updatedContext: this.handoffController.recordError(
          context,
          role,
          roleConfig.primaryModel,
          error.message,
          true
        )
      };
    }
  }

  /**
   * Collect streaming response into final response
   * Handles both direct format and OpenAI-compatible format (choices[0].delta)
   */
  private async collectStreamingResponse(
    stream: AsyncGenerator<any>,
    emit: (event: string, data: unknown) => void,
    orchestrationId: string,
    role: ModelRole
  ): Promise<CompletionResponse> {
    let content = '';
    let toolCalls: unknown[] = [];
    let thinking = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = 'stop';
    let timeToFirstToken: number | undefined;
    const startTime = Date.now();

    for await (const chunk of stream) {
      // Extract delta from OpenAI-compatible format (choices[0].delta) OR direct format
      const choiceDelta = chunk.choices?.[0]?.delta;
      const directDelta = chunk.delta;
      const delta = choiceDelta || directDelta;

      // Track time to first content (handles OpenAI, Anthropic, and direct formats)
      if (!timeToFirstToken && (
        delta?.content ||
        chunk.content ||
        (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta' && chunk.delta?.text)
      )) {
        timeToFirstToken = Date.now() - startTime;
      }

      // Handle content from OpenAI format (choices[0].delta.content)
      if (delta?.content) {
        content += delta.content;

        emit('role_stream', {
          orchestrationId,
          role,
          content: delta.content,
          timestamp: Date.now()
        });
      }
      // Handle Anthropic content_block_delta format (used by Bedrock provider)
      // CRITICAL: Bedrock provider emits { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } }
      else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta' && chunk.delta?.text) {
        content += chunk.delta.text;

        emit('role_stream', {
          orchestrationId,
          role,
          content: chunk.delta.text,
          timestamp: Date.now()
        });
      }
      // Handle direct content format
      else if (chunk.type === 'content' || chunk.content) {
        const contentValue = chunk.content || '';
        content += contentValue;

        emit('role_stream', {
          orchestrationId,
          role,
          content: contentValue,
          timestamp: Date.now()
        });
      }

      // Handle thinking content from Bedrock (delta.thinking or delta.reasoning)
      if (delta?.thinking || delta?.reasoning) {
        const thinkingDelta = delta.thinking || delta.reasoning;
        thinking += thinkingDelta;

        // CRITICAL FIX: Emit thinking events in real-time for UI display
        emit('role_thinking', {
          orchestrationId,
          role,
          content: thinkingDelta,
          accumulated: thinking,
          timestamp: Date.now()
        });
      }
      // Handle Anthropic content_block_delta format for thinking (used by Bedrock provider)
      // CRITICAL: Bedrock provider emits { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '...' } }
      else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'thinking_delta' && chunk.delta?.thinking) {
        const thinkingDelta = chunk.delta.thinking;
        thinking += thinkingDelta;

        emit('role_thinking', {
          orchestrationId,
          role,
          content: thinkingDelta,
          accumulated: thinking,
          timestamp: Date.now()
        });
      }
      // Handle thinking block start marker
      else if (delta?.thinking_started) {
        // Thinking block started, content will follow
        emit('role_thinking', {
          orchestrationId,
          role,
          content: '',
          accumulated: thinking,
          status: 'started',
          timestamp: Date.now()
        });
      }
      // Handle direct thinking format
      else if (chunk.type === 'thinking' || chunk.thinking) {
        const thinkingContent = chunk.thinking || chunk.content || '';
        thinking += thinkingContent;

        // CRITICAL FIX: Emit thinking events in real-time for UI display
        emit('role_thinking', {
          orchestrationId,
          role,
          content: thinkingContent,
          accumulated: thinking,
          timestamp: Date.now()
        });
      }

      // Handle tool calls from OpenAI format
      if (delta?.tool_calls) {
        toolCalls.push(...delta.tool_calls);

        for (const tc of delta.tool_calls) {
          emit('role_tool_call', {
            orchestrationId,
            role,
            toolCall: tc,
            timestamp: Date.now()
          });
        }
      }
      // Handle direct tool call format
      else if (chunk.type === 'tool_call' || chunk.toolCalls) {
        const newCalls = chunk.toolCalls || [chunk.toolCall];
        toolCalls.push(...newCalls);

        for (const tc of newCalls) {
          emit('role_tool_call', {
            orchestrationId,
            role,
            toolCall: tc,
            timestamp: Date.now()
          });
        }
      }

      // Handle usage from either format
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.promptTokens || chunk.usage.prompt_tokens || chunk.usage.input_tokens || 0,
          completionTokens: chunk.usage.completionTokens || chunk.usage.completion_tokens || chunk.usage.output_tokens || 0,
          totalTokens: (chunk.usage.promptTokens || chunk.usage.prompt_tokens || 0) + (chunk.usage.completionTokens || chunk.usage.completion_tokens || 0)
        };
      }

      // Handle finish reason from either format
      const chunkFinishReason = chunk.choices?.[0]?.finish_reason || chunk.finishReason || chunk.finish_reason;
      if (chunkFinishReason) {
        finishReason = chunkFinishReason;
      }
    }

    this.logger.info({
      orchestrationId,
      role,
      contentLength: content.length,
      thinkingLength: thinking.length,
      toolCallCount: toolCalls.length,
      finishReason,
      usage
    }, '[COLLECT-STREAM] Stream collection complete');

    // CRITICAL: Return in OpenAI-compatible format so executeRole can extract content correctly
    // executeRole looks for choices[0].message.content, NOT top-level content
    return {
      id: `stream_${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: 'multi-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: finishReason
      }],
      usage: {
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens
      },
      thinking: thinking ? { content: thinking } : undefined,
      timeToFirstToken
    } as unknown as CompletionResponse;
  }

  /**
   * Build messages for a specific role
   */
  private buildMessagesForRole(
    role: ModelRole,
    originalMessages: unknown[],
    context: ModelHandoffContext,
    systemPrompt?: string
  ): unknown[] {
    switch (role) {
      case ModelRole.REASONING:
        return this.handoffController.buildReasoningMessages(originalMessages, systemPrompt);

      case ModelRole.TOOL_EXECUTION:
        return this.handoffController.buildToolExecutionMessages(
          originalMessages,
          context,
          systemPrompt
        );

      case ModelRole.SYNTHESIS:
        return this.handoffController.buildSynthesisMessages(
          originalMessages,
          context,
          systemPrompt
        );

      case ModelRole.FALLBACK:
        return this.handoffController.buildSynthesisMessages(
          originalMessages,
          context,
          systemPrompt
        );

      default:
        return originalMessages;
    }
  }

  // ============================================================
  // Helper methods
  // ============================================================

  private analyzeComplexity(query: string): 'simple' | 'moderate' | 'complex' | 'expert' {
    const length = query.length;
    const words = query.split(/\s+/).length;
    const sentences = query.split(/[.!?]+/).length;

    // Expert-level indicators
    const expertIndicators = [
      'analyze',
      'compare',
      'investigate',
      'audit',
      'comprehensive',
      'deep dive',
      'architecture',
      'optimize',
      'refactor',
      'debug',
      'security'
    ];

    const hasExpertIndicator = expertIndicators.some(
      ind => query.toLowerCase().includes(ind)
    );

    // Complex indicators
    const complexIndicators = [
      'explain',
      'how does',
      'why does',
      'implement',
      'create',
      'build',
      'design'
    ];

    const hasComplexIndicator = complexIndicators.some(
      ind => query.toLowerCase().includes(ind)
    );

    // Scoring
    if (hasExpertIndicator && words > 20) {
      return 'expert';
    }

    if (hasComplexIndicator || words > 50 || sentences > 3) {
      return 'complex';
    }

    if (words > 15 || sentences > 2) {
      return 'moderate';
    }

    return 'simple';
  }

  private checkIfToolsLikelyNeeded(query: string): boolean {
    const toolIndicators = [
      'search',
      'find',
      'look up',
      'fetch',
      'get',
      'list',
      'show me',
      'what is',
      'current',
      'latest',
      'today',
      'now',
      'real-time',
      'live'
    ];

    return toolIndicators.some(ind => query.toLowerCase().includes(ind));
  }

  private estimateTokens(messages: unknown[]): number {
    // Rough estimation: 4 characters per token
    const totalChars = messages.reduce<number>((sum, msg: any) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return sum + (content?.length || 0);
    }, 0);

    return Math.ceil(totalChars / 4);
  }

  private estimateCost(roles: ModelRole[], estimatedTokens: number): number {
    // Rough cost estimation based on roles
    const costPerRole: Record<ModelRole, number> = {
      [ModelRole.REASONING]: 0.015, // $15/1M tokens for Opus
      [ModelRole.TOOL_EXECUTION]: 0.003, // $3/1M tokens for Sonnet
      [ModelRole.SYNTHESIS]: 0.003, // $3/1M tokens for Sonnet
      [ModelRole.FALLBACK]: 0.00025 // $0.25/1M tokens for Flash
    };

    return roles.reduce((sum, role) => {
      return sum + costPerRole[role] * (estimatedTokens / 1000000);
    }, 0);
  }

  private estimateDuration(roles: ModelRole[]): number {
    // Rough duration estimation per role
    const durationPerRole: Record<ModelRole, number> = {
      [ModelRole.REASONING]: 5000,
      [ModelRole.TOOL_EXECUTION]: 3000,
      [ModelRole.SYNTHESIS]: 2000,
      [ModelRole.FALLBACK]: 1500
    };

    return roles.reduce((sum, role) => sum + durationPerRole[role], 0);
  }

  private getSingleModelForComplexity(
    complexity: 'simple' | 'moderate' | 'complex' | 'expert'
  ): string {
    // All models configured via environment variables
    switch (complexity) {
      case 'simple':
        return process.env.MULTI_MODEL_SIMPLE_MODEL || process.env.MULTI_MODEL_FALLBACK_PRIMARY || '';
      case 'moderate':
        return process.env.MULTI_MODEL_MODERATE_MODEL || process.env.MULTI_MODEL_TOOL_PRIMARY || '';
      case 'complex':
        return process.env.MULTI_MODEL_COMPLEX_MODEL || process.env.MULTI_MODEL_SYNTHESIS_PRIMARY || '';
      case 'expert':
        return process.env.MULTI_MODEL_EXPERT_MODEL || process.env.MULTI_MODEL_REASONING_PRIMARY || '';
    }
  }

  private estimateCostFromUsage(
    inputTokens: number,
    outputTokens: number,
    model: string
  ): number {
    // Cost per 1M tokens - loaded from env vars or use conservative defaults
    // Format: MULTI_MODEL_COST_<MODEL_NAME>=input,output (e.g., MULTI_MODEL_COST_CLAUDE_OPUS_4=15,75)
    const envKey = `MULTI_MODEL_COST_${model.toUpperCase().replace(/[-.]/g, '_')}`;
    const costEnv = process.env[envKey];

    let inputCost = 3; // Default conservative estimate
    let outputCost = 15;

    if (costEnv) {
      const [inp, out] = costEnv.split(',').map(Number);
      if (!isNaN(inp) && !isNaN(out)) {
        inputCost = inp;
        outputCost = out;
      }
    }

    return (
      (inputTokens / 1000000) * inputCost +
      (outputTokens / 1000000) * outputCost
    );
  }
}
