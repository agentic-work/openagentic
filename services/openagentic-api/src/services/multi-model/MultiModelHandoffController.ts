/**
 * Multi-Model Handoff Controller
 *
 * Manages context preservation and handoffs between model roles
 * in the multi-model collaboration system.
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import {
  ModelRole,
  ModelHandoffContext,
  ModelRoleResponse,
  ToolCallRecord
} from './MultiModelOrchestrator.types.js';

/**
 * Manages context preservation and handoffs between model roles
 */
export class MultiModelHandoffController {
  /**
   * Create initial handoff context for a new orchestration
   */
  createInitialContext(orchestrationId: string): ModelHandoffContext {
    return {
      orchestrationId,
      currentRole: ModelRole.REASONING,
      handoffCount: 0,
      toolExecutionOutput: {
        toolCalls: [],
        toolCallIdChain: []
      },
      errors: [],
      costBreakdown: {},
      roleTimings: {}
    };
  }

  /**
   * Prepare context for handoff to next role
   */
  prepareHandoff(
    context: ModelHandoffContext,
    fromResponse: ModelRoleResponse,
    toRole: ModelRole
  ): ModelHandoffContext {
    const updated: ModelHandoffContext = {
      ...context,
      handoffCount: context.handoffCount + 1,
      currentRole: toRole
    };

    // Preserve role-specific output based on what role just completed
    switch (fromResponse.role) {
      case ModelRole.REASONING:
        updated.reasoningOutput = {
          analysis: fromResponse.output.content || '',
          thinkingContent: fromResponse.output.thinkingContent
        };
        break;

      case ModelRole.TOOL_EXECUTION:
        if (fromResponse.output.toolCalls && Array.isArray(fromResponse.output.toolCalls)) {
          const newToolCalls: ToolCallRecord[] = fromResponse.output.toolCalls.map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name || tc.name,
            arguments: tc.function?.arguments
              ? (typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments)
              : tc.arguments,
            result: tc.result,
            error: tc.error,
            model: fromResponse.model,
            provider: fromResponse.provider,
            duration: fromResponse.metrics.durationMs,
            timestamp: new Date()
          }));

          updated.toolExecutionOutput = {
            toolCalls: [
              ...(context.toolExecutionOutput?.toolCalls || []),
              ...newToolCalls
            ],
            // CRITICAL: Preserve tool call ID chain for multi-turn conversations
            toolCallIdChain: [
              ...(context.toolExecutionOutput?.toolCallIdChain || []),
              ...newToolCalls.map(tc => tc.id)
            ]
          };
        }
        break;

      case ModelRole.SYNTHESIS:
        // Synthesis is typically the final step, but update context anyway
        if (fromResponse.output.content) {
          updated.synthesisInput = {
            originalQuery: context.synthesisInput?.originalQuery || '',
            reasoningContext: context.reasoningOutput?.analysis,
            toolResults: context.toolExecutionOutput?.toolCalls.map(tc => tc.result)
          };
        }
        break;
    }

    // Update cost breakdown for the completed role
    updated.costBreakdown = {
      ...context.costBreakdown,
      [fromResponse.role]: {
        inputTokens: fromResponse.metrics.inputTokens,
        outputTokens: fromResponse.metrics.outputTokens,
        thinkingTokens: fromResponse.metrics.thinkingTokens,
        estimatedCost: fromResponse.metrics.estimatedCost,
        model: fromResponse.model
      }
    };

    // Update timing for completed role
    if (context.roleTimings[fromResponse.role]) {
      updated.roleTimings = {
        ...context.roleTimings,
        [fromResponse.role]: {
          ...context.roleTimings[fromResponse.role],
          endTime: new Date(),
          durationMs: fromResponse.metrics.durationMs
        }
      };
    }

    // Start timing for next role
    updated.roleTimings = {
      ...updated.roleTimings,
      [toRole]: {
        startTime: new Date()
      }
    };

    return updated;
  }

  /**
   * Record an error that occurred during role execution
   */
  recordError(
    context: ModelHandoffContext,
    role: ModelRole,
    model: string,
    error: string,
    retryable: boolean
  ): ModelHandoffContext {
    return {
      ...context,
      errors: [
        ...context.errors,
        {
          role,
          model,
          error,
          timestamp: new Date(),
          retryable
        }
      ]
    };
  }

  /**
   * Build messages for the reasoning role
   */
  buildReasoningMessages(
    originalMessages: unknown[],
    systemPrompt?: string
  ): unknown[] {
    const messages: unknown[] = [];

    // Add system prompt if provided, enhanced for reasoning
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: `${systemPrompt}\n\n` +
          `You are in REASONING mode. Your job is to:\n` +
          `1. Analyze the user's request thoroughly\n` +
          `2. Identify what information or tools are needed\n` +
          `3. Create a clear plan for how to respond\n` +
          `4. If tools are needed, describe which tools and why\n\n` +
          `Think step by step and be thorough in your analysis.`
      });
    }

    // Add original conversation
    messages.push(...(originalMessages as unknown[]));

    return messages;
  }

  /**
   * Build messages for the tool execution role
   */
  buildToolExecutionMessages(
    originalMessages: unknown[],
    context: ModelHandoffContext,
    systemPrompt?: string
  ): unknown[] {
    const messages: unknown[] = [];

    // Add system prompt enhanced for tool execution
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: `${systemPrompt}\n\n` +
          `You are in TOOL EXECUTION mode. Focus on:\n` +
          `1. Calling the necessary tools to gather information\n` +
          `2. Using efficient tool calls (batch when possible)\n` +
          `3. Handling tool errors gracefully\n\n` +
          `Do not generate long explanations - focus on tool execution.`
      });
    }

    // Add original conversation
    messages.push(...(originalMessages as unknown[]));

    // Add reasoning context if available
    if (context.reasoningOutput?.analysis) {
      messages.push({
        role: 'assistant',
        content: `Based on my analysis, I need to execute the following tools:\n\n${context.reasoningOutput.analysis}`
      });
    }

    return messages;
  }

  /**
   * Build messages for synthesis role with full context from previous roles
   */
  buildSynthesisMessages(
    originalMessages: unknown[],
    context: ModelHandoffContext,
    systemPrompt?: string
  ): unknown[] {
    const messages: unknown[] = [];

    // Add system prompt enhanced for synthesis
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: `${systemPrompt}\n\n` +
          `You are in SYNTHESIS mode. Your job is to:\n` +
          `1. Combine the analysis and tool results into a clear, helpful response\n` +
          `2. Present information in a well-organized format\n` +
          `3. Be concise but thorough\n` +
          `4. Acknowledge any limitations or missing information\n\n` +
          `Provide the final answer to the user's question.`
      });
    }

    // Add original conversation
    messages.push(...(originalMessages as unknown[]));

    // Add reasoning context if available (as assistant thinking)
    if (context.reasoningOutput?.analysis) {
      messages.push({
        role: 'assistant',
        content: `[Analysis]\n${context.reasoningOutput.analysis}`
      });
    }

    // Add tool results if available - CRITICAL for proper context
    if (context.toolExecutionOutput?.toolCalls.length) {
      for (const tc of context.toolExecutionOutput.toolCalls) {
        // Add assistant message with tool call
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments)
            }
          }]
        });

        // Add tool result
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: tc.result
            ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result))
            : tc.error || 'No result'
        });
      }
    }

    return messages;
  }

  /**
   * Get total cost from context
   */
  getTotalCost(context: ModelHandoffContext): number {
    return Object.values(context.costBreakdown).reduce(
      (sum, role) => sum + (role?.estimatedCost || 0),
      0
    );
  }

  /**
   * Get total duration from context
   */
  getTotalDuration(context: ModelHandoffContext): number {
    return Object.values(context.roleTimings).reduce(
      (sum, role) => sum + (role?.durationMs || 0),
      0
    );
  }

  /**
   * Get total tokens from context
   */
  getTotalTokens(context: ModelHandoffContext): {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
  } {
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0
    };

    for (const role of Object.values(context.costBreakdown)) {
      if (role) {
        totals.inputTokens += role.inputTokens || 0;
        totals.outputTokens += role.outputTokens || 0;
        totals.thinkingTokens += role.thinkingTokens || 0;
      }
    }

    return totals;
  }

  /**
   * Determine next action based on response
   */
  determineNextAction(
    response: ModelRoleResponse,
    context: ModelHandoffContext,
    maxHandoffs: number
  ): { action: 'handoff' | 'complete' | 'fallback'; nextRole?: ModelRole } {
    // Check if we've hit max handoffs
    if (context.handoffCount >= maxHandoffs) {
      return { action: 'complete' };
    }

    // Check if there are tool calls to execute
    if (response.output.toolCalls && response.output.toolCalls.length > 0) {
      // If we just finished tool execution, go to synthesis
      if (response.role === ModelRole.TOOL_EXECUTION) {
        return { action: 'handoff', nextRole: ModelRole.SYNTHESIS };
      }
      // If reasoning produced tool calls, go to tool execution
      return { action: 'handoff', nextRole: ModelRole.TOOL_EXECUTION };
    }

    // Check finish reason
    if (response.output.finishReason === 'stop' || response.output.finishReason === 'end_turn') {
      // If we have content and we're in synthesis, we're done
      if (response.role === ModelRole.SYNTHESIS && response.output.content) {
        return { action: 'complete' };
      }
      // If we have content from reasoning but no tools needed, go straight to synthesis
      if (response.role === ModelRole.REASONING && response.output.content) {
        // Check if tools are needed based on content
        const needsTools = this.checkIfToolsNeeded(response.output.content);
        if (needsTools) {
          return { action: 'handoff', nextRole: ModelRole.TOOL_EXECUTION };
        }
        return { action: 'handoff', nextRole: ModelRole.SYNTHESIS };
      }
    }

    // If we got here from tool execution, go to synthesis
    if (response.role === ModelRole.TOOL_EXECUTION) {
      return { action: 'handoff', nextRole: ModelRole.SYNTHESIS };
    }

    // Default: complete
    return { action: 'complete' };
  }

  /**
   * Simple heuristic to check if reasoning output suggests tools are needed
   */
  private checkIfToolsNeeded(content: string): boolean {
    const toolIndicators = [
      'need to search',
      'need to look up',
      'need to query',
      'need to fetch',
      'need to call',
      'should search',
      'should look up',
      'should query',
      'should fetch',
      'will search',
      'will look up',
      'will query',
      'will fetch',
      'let me search',
      'let me look up',
      'let me query',
      'let me fetch',
      'I need to use',
      'using the',
      'calling the'
    ];

    const lowerContent = content.toLowerCase();
    return toolIndicators.some(indicator => lowerContent.includes(indicator));
  }
}
