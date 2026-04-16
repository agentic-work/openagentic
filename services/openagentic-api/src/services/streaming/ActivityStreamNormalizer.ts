/**
 * OpenAgentic Activity Stream Normalizer
 *
 * Normalizes thinking/reasoning, tool execution, and model activity from all
 * supported LLM providers into a consistent event stream for inline
 * activity display.
 *
 * Version: openagentic-activity-streaming-2025-01
 */

import { EventEmitter } from 'events';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface ActivitySession {
  sessionId: string;
  messageId: string;
  model: string;
  provider: string;
  startTime: number;

  // Thinking state
  thinkingId?: string;
  thinkingAccumulated: string;
  thinkingTokens: number;
  thinkingStartTime?: number;
  thinkingSignature?: string;
  inThinkTag?: boolean;

  // Content state
  contentAccumulated: string;
  contentSequence: number;

  // Tool state
  activeTools: Map<string, {
    name: string;
    accumulated: string;
    sequence: number;
    startTime: number;
  }>;

  // Block tracking (for Anthropic content_block events)
  blockTypes: Map<number, 'thinking' | 'text' | 'tool_use'>;
  currentToolCallId?: string;

  // Metrics
  inputTokens: number;
  outputTokens: number;
  ttft?: number;
}

export interface ProviderCapabilities {
  thinking: boolean;
  thinkingStreamed: boolean;
  toolUse: boolean;
  toolStreaming: boolean;
}

export type ThinkingMode = 'extended' | 'chain_of_thought' | 'summary' | 'hidden';
export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'error';

// ============================================================
// EVENT INTERFACES
// ============================================================

export interface ActivityStartEvent {
  type: 'activity_start';
  sessionId: string;
  messageId: string;
  model: string;
  provider: string;
  capabilities: ProviderCapabilities;
  timestamp: number;
}

export interface ThinkingStartEvent {
  type: 'thinking_start';
  sessionId: string;
  thinkingId: string;
  model: string;
  provider: string;
  thinkingMode: ThinkingMode;
  timestamp: number;
}

export interface ThinkingDeltaEvent {
  type: 'thinking_delta';
  sessionId: string;
  thinkingId: string;
  delta: string;
  accumulated: string;
  sequenceNumber: number;
  tokenCount?: number;
  elapsedMs?: number;
  timestamp: number;
}

export interface ThinkingCompleteEvent {
  type: 'thinking_complete';
  sessionId: string;
  thinkingId: string;
  content: string;
  tokenCount: number;
  durationMs: number;
  signature?: string;
  wasHidden: boolean;
  summary?: string;
  timestamp: number;
}

export interface ContentDeltaEvent {
  type: 'content_delta';
  sessionId: string;
  delta: string;
  accumulated: string;
  sequenceNumber: number;
  timestamp: number;
}

export interface ToolStartEvent {
  type: 'tool_start';
  sessionId: string;
  toolCallId: string;
  toolName: string;
  toolIndex: number;
  model: string;
  provider: string;
  timestamp: number;
}

export interface ToolDeltaEvent {
  type: 'tool_delta';
  sessionId: string;
  toolCallId: string;
  delta: string;
  accumulated: string;
  jsonPath?: string;
  sequenceNumber: number;
  isValidJson: boolean;
  timestamp: number;
}

export interface ToolCompleteEvent {
  type: 'tool_complete';
  sessionId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  argumentsRaw: string;
  durationMs: number;
  timestamp: number;
}

export interface ToolResultEvent {
  type: 'tool_result';
  sessionId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
  success: boolean;
  error?: string;
  executionMs: number;
  timestamp: number;
}

// Todo update event - emitted when TodoWrite tool is used
export interface TodoUpdateEvent {
  type: 'todo_update';
  sessionId: string;
  todos: {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm?: string;
  }[];
  timestamp: number;
}

export interface ModelInfoEvent {
  type: 'model_info';
  sessionId: string;
  model: string;
  modelShort: string;
  provider: string;
  role?: string;
  capabilities: {
    maxTokens: number;
    supportsThinking: boolean;
    supportsTools: boolean;
    supportsImages: boolean;
  };
  timestamp: number;
}

export interface MetricsUpdateEvent {
  type: 'metrics_update';
  sessionId: string;
  tokens: {
    input: number;
    output: number;
    thinking?: number;
    total: number;
  };
  cost?: {
    inputCost: number;
    outputCost: number;
    thinkingCost?: number;
    totalCost: number;
    currency: 'USD';
  };
  timing: {
    ttft?: number;
    elapsed: number;
    tokensPerSecond: number;
  };
  timestamp: number;
}

export interface ActivityCompleteEvent {
  type: 'activity_complete';
  sessionId: string;
  messageId: string;
  model: string;
  provider: string;
  tokens: {
    input: number;
    output: number;
    thinking?: number;
    total: number;
  };
  cost?: {
    totalCost: number;
    currency: 'USD';
  };
  timing: {
    ttft: number;
    totalMs: number;
    thinkingMs?: number;
    contentMs?: number;
  };
  hadThinking: boolean;
  thinkingTokens?: number;
  toolCallCount: number;
  stopReason: StopReason;
  timestamp: number;
}

// Union type for all events
export type ActivityEvent =
  | ActivityStartEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingCompleteEvent
  | ContentDeltaEvent
  | ToolStartEvent
  | ToolDeltaEvent
  | ToolCompleteEvent
  | ToolResultEvent
  | TodoUpdateEvent
  | ModelInfoEvent
  | MetricsUpdateEvent
  | ActivityCompleteEvent;

// ============================================================
// MAIN NORMALIZER CLASS
// ============================================================

export class ActivityStreamNormalizer extends EventEmitter {
  private sessions: Map<string, ActivitySession> = new Map();

  /**
   * Start a new activity session
   */
  startSession(messageId: string, model: string, provider: string): string {
    const sessionId = `openagentic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const capabilities = this.getProviderCapabilities(provider, model);

    const session: ActivitySession = {
      sessionId,
      messageId,
      model,
      provider,
      startTime: Date.now(),
      thinkingAccumulated: '',
      thinkingTokens: 0,
      contentAccumulated: '',
      contentSequence: 0,
      activeTools: new Map(),
      blockTypes: new Map(),
      inputTokens: 0,
      outputTokens: 0
    };

    this.sessions.set(sessionId, session);

    const event: ActivityStartEvent = {
      type: 'activity_start',
      sessionId,
      messageId,
      model,
      provider,
      capabilities,
      timestamp: Date.now()
    };

    this.emit('activity_start', event);
    return sessionId;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): ActivitySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get provider capabilities based on model
   */
  private getProviderCapabilities(provider: string, model: string): ProviderCapabilities {
    const modelLower = model.toLowerCase();

    // Claude models (Anthropic, Bedrock, Vertex)
    if (modelLower.includes('claude')) {
      return {
        thinking: true,
        thinkingStreamed: true,
        toolUse: true,
        toolStreaming: true
      };
    }

    // OpenAI o1/o3 models (hidden reasoning)
    if (modelLower.includes('o1') || modelLower.includes('o3')) {
      return {
        thinking: true,
        thinkingStreamed: false,
        toolUse: true,
        toolStreaming: true
      };
    }

    // Gemini thinking models
    if (modelLower.includes('gemini') &&
        (modelLower.includes('2.5') || modelLower.includes('3') || modelLower.includes('thinking'))) {
      return {
        thinking: true,
        thinkingStreamed: true,
        toolUse: true,
        toolStreaming: true
      };
    }

    // DeepSeek R1 / Reasoner
    if (modelLower.includes('deepseek-r') || modelLower.includes('reasoner')) {
      return {
        thinking: true,
        thinkingStreamed: true,
        toolUse: true,
        toolStreaming: true
      };
    }

    // Default (GPT-4, Llama, Mistral, etc.)
    return {
      thinking: false,
      thinkingStreamed: false,
      toolUse: true,
      toolStreaming: true
    };
  }

  // ============================================================
  // ANTHROPIC/CLAUDE HANDLERS
  // ============================================================

  handleAnthropicEvent(sessionId: string, event: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const eventType = event.type as string;

    // content_block_start
    if (eventType === 'content_block_start') {
      const contentBlock = event.content_block as Record<string, unknown>;
      const index = event.index as number;
      const blockType = contentBlock?.type as string;

      session.blockTypes.set(index, blockType as 'thinking' | 'text' | 'tool_use');

      if (blockType === 'thinking') {
        this.startThinking(sessionId, 'extended');
      } else if (blockType === 'tool_use') {
        const toolId = contentBlock.id as string;
        const toolName = contentBlock.name as string;
        session.currentToolCallId = toolId || `anthropic-${index}`;
        this.startTool(sessionId, session.currentToolCallId, toolName);
      }
    }

    // content_block_delta
    if (eventType === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown>;
      const deltaType = delta?.type as string;
      const index = event.index as number;

      if (deltaType === 'thinking_delta') {
        this.addThinkingDelta(sessionId, (delta.thinking as string) || '');
      } else if (deltaType === 'text_delta') {
        this.addContentDelta(sessionId, (delta.text as string) || '');
      } else if (deltaType === 'input_json_delta') {
        const toolCallId = session.currentToolCallId || `anthropic-${index}`;
        this.addToolDelta(sessionId, toolCallId, (delta.partial_json as string) || '');
      } else if (deltaType === 'signature_delta') {
        session.thinkingSignature = delta.signature as string;
      }
    }

    // content_block_stop
    if (eventType === 'content_block_stop') {
      const index = event.index as number;
      const blockType = session.blockTypes.get(index);

      if (blockType === 'thinking' && session.thinkingId) {
        this.completeThinking(sessionId);
      } else if (blockType === 'tool_use' && session.currentToolCallId) {
        const toolCallId = session.currentToolCallId;
        const tool = session.activeTools.get(toolCallId);
        if (tool) {
          this.completeTool(sessionId, toolCallId, tool.accumulated);
        }
        session.currentToolCallId = undefined;
      }
    }

    // message_delta (usage info)
    if (eventType === 'message_delta') {
      const usage = event.usage as Record<string, number> | undefined;
      if (usage) {
        this.updateMetrics(sessionId, {
          input: usage.input_tokens,
          output: usage.output_tokens
        });
      }
    }
  }

  // ============================================================
  // OPENAI HANDLERS
  // ============================================================

  handleOpenAIEvent(sessionId: string, event: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const eventType = event.type as string;

    // response.output_item.added (tool start)
    if (eventType === 'response.output_item.added') {
      const item = event.item as Record<string, unknown>;
      if (item?.type === 'function_call') {
        const toolCallId = (item.id as string) || `openai-${event.output_index}`;
        const toolName = item.name as string;
        this.startTool(sessionId, toolCallId, toolName);
      }
    }

    // response.function_call_arguments.delta
    if (eventType === 'response.function_call_arguments.delta') {
      const toolCallId = (event.item_id as string) || `openai-${event.output_index}`;
      this.addToolDelta(sessionId, toolCallId, (event.delta as string) || '');
    }

    // response.function_call_arguments.done
    if (eventType === 'response.function_call_arguments.done') {
      const toolCallId = (event.item_id as string) || `openai-${event.output_index}`;
      this.completeTool(sessionId, toolCallId, event.arguments as string);
    }

    // Text content delta (standard OpenAI format)
    if (eventType === 'response.content_part.delta') {
      const delta = event.delta as Record<string, unknown>;
      const content = delta?.text as string || '';
      if (content) {
        this.addContentDelta(sessionId, content);
      }
    }

    // Handle standard choices format
    const choices = event.choices as Array<{ delta?: { content?: string } }>;
    if (choices?.[0]?.delta?.content) {
      this.addContentDelta(sessionId, choices[0].delta.content);
    }

    // Usage info (includes hidden reasoning_tokens for o1)
    const usage = event.usage as Record<string, number> | undefined;
    if (usage) {
      this.updateMetrics(sessionId, {
        input: usage.prompt_tokens || usage.input_tokens,
        output: usage.completion_tokens || usage.output_tokens,
        thinking: usage.reasoning_tokens
      });

      // For o1 models, emit thinking_complete with hidden flag
      if (usage.reasoning_tokens && !session.thinkingId) {
        const completeEvent: ThinkingCompleteEvent = {
          type: 'thinking_complete',
          sessionId,
          thinkingId: `${sessionId}-hidden`,
          content: '',
          tokenCount: usage.reasoning_tokens,
          durationMs: 0,
          wasHidden: true,
          summary: `Model used ${usage.reasoning_tokens} reasoning tokens`,
          timestamp: Date.now()
        };
        this.emit('thinking_complete', completeEvent);
      }
    }
  }

  // ============================================================
  // GEMINI HANDLERS
  // ============================================================

  handleGeminiEvent(sessionId: string, chunk: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const candidates = chunk.candidates as Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: Record<string, unknown> }> };
    }>;
    const candidate = candidates?.[0];
    if (!candidate?.content?.parts) return;

    for (const part of candidate.content.parts) {
      if (part.thought) {
        // This is a thought summary
        if (!session.thinkingId) {
          this.startThinking(sessionId, 'summary');
        }
        this.addThinkingDelta(sessionId, part.text || '');
      } else if (part.functionCall) {
        // Tool call with possible partialArgs
        const fc = part.functionCall as {
          name?: string;
          partialArgs?: Array<{ jsonPath?: string; value?: unknown }>;
          willContinue?: boolean;
          args?: Record<string, unknown>;
        };
        const toolCallId = `gemini-${fc.name}`;

        if (!session.activeTools.has(toolCallId)) {
          this.startTool(sessionId, toolCallId, fc.name || '');
        }

        if (fc.partialArgs) {
          for (const arg of fc.partialArgs) {
            this.addToolDelta(sessionId, toolCallId, JSON.stringify(arg), arg.jsonPath);
          }
        }

        if (!fc.willContinue && fc.args) {
          this.completeTool(sessionId, toolCallId, JSON.stringify(fc.args));
        }
      } else if (part.text) {
        // Regular content
        if (session.thinkingId) {
          this.completeThinking(sessionId);
        }
        this.addContentDelta(sessionId, part.text);
      }
    }

    // Usage metadata
    const usageMetadata = chunk.usageMetadata as {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
    if (usageMetadata) {
      this.updateMetrics(sessionId, {
        input: usageMetadata.promptTokenCount,
        output: usageMetadata.candidatesTokenCount,
        thinking: usageMetadata.thoughtsTokenCount
      });
    }
  }

  // ============================================================
  // DEEPSEEK HANDLERS
  // ============================================================

  handleDeepSeekEvent(sessionId: string, event: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const choices = event.choices as Array<{
      delta?: { reasoning_content?: string; content?: string };
    }>;
    const delta = choices?.[0]?.delta;
    if (!delta) return;

    // DeepSeek R1 uses reasoning_content field
    if (delta.reasoning_content) {
      if (!session.thinkingId) {
        this.startThinking(sessionId, 'chain_of_thought');
      }
      this.addThinkingDelta(sessionId, delta.reasoning_content);
    }

    // Or uses <think> tags in content
    if (delta.content) {
      const content = delta.content;

      // Check for think tags
      if (content.includes('<think>') || session.inThinkTag) {
        const { thinking, response, stillInTag } = this.parseThinkTags(
          content, session.inThinkTag || false
        );

        session.inThinkTag = stillInTag;

        if (thinking) {
          if (!session.thinkingId) {
            this.startThinking(sessionId, 'chain_of_thought');
          }
          this.addThinkingDelta(sessionId, thinking);
        }

        if (response) {
          if (session.thinkingId) {
            this.completeThinking(sessionId);
          }
          this.addContentDelta(sessionId, response);
        }
      } else {
        // Regular content
        this.addContentDelta(sessionId, content);
      }
    }

    // Usage
    const usage = event.usage as Record<string, number> | undefined;
    if (usage) {
      this.updateMetrics(sessionId, {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        thinking: usage.reasoning_tokens
      });
    }
  }

  // ============================================================
  // OLLAMA HANDLERS (OpenAI-compatible + think tags)
  // ============================================================

  handleOllamaEvent(sessionId: string, event: Record<string, unknown>): void {
    // Ollama uses OpenAI format, delegate and parse think tags
    this.handleDeepSeekEvent(sessionId, event);
  }

  // ============================================================
  // BEDROCK HANDLERS
  // ============================================================

  handleBedrockEvent(sessionId: string, event: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Bedrock Claude uses similar format to Anthropic
    // Check for delta.thinking or delta.reasoning
    const delta = event.delta as Record<string, unknown> | undefined;

    if (delta?.thinking || delta?.reasoning) {
      const thinkingContent = (delta.thinking || delta.reasoning) as string;
      if (!session.thinkingId) {
        this.startThinking(sessionId, 'extended');
      }
      this.addThinkingDelta(sessionId, thinkingContent);
    }

    if (delta?.text) {
      this.addContentDelta(sessionId, delta.text as string);
    }

    // Handle Anthropic-style events passed through Bedrock
    if (event.type) {
      this.handleAnthropicEvent(sessionId, event);
    }
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  private startThinking(sessionId: string, mode: ThinkingMode): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.thinkingId = `${sessionId}-think-${Date.now()}`;
    session.thinkingStartTime = Date.now();
    session.thinkingAccumulated = '';

    const event: ThinkingStartEvent = {
      type: 'thinking_start',
      sessionId,
      thinkingId: session.thinkingId,
      model: session.model,
      provider: session.provider,
      thinkingMode: mode,
      timestamp: Date.now()
    };

    this.emit('thinking_start', event);
  }

  private addThinkingDelta(sessionId: string, delta: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.thinkingId) return;

    session.thinkingAccumulated += delta;
    session.thinkingTokens = Math.ceil(session.thinkingAccumulated.length / 4);

    const event: ThinkingDeltaEvent = {
      type: 'thinking_delta',
      sessionId,
      thinkingId: session.thinkingId,
      delta,
      accumulated: session.thinkingAccumulated,
      sequenceNumber: session.thinkingTokens,
      tokenCount: session.thinkingTokens,
      elapsedMs: Date.now() - (session.thinkingStartTime || session.startTime),
      timestamp: Date.now()
    };

    this.emit('thinking_delta', event);
  }

  private completeThinking(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.thinkingId) return;

    const event: ThinkingCompleteEvent = {
      type: 'thinking_complete',
      sessionId,
      thinkingId: session.thinkingId,
      content: session.thinkingAccumulated,
      tokenCount: session.thinkingTokens,
      durationMs: Date.now() - (session.thinkingStartTime || session.startTime),
      signature: session.thinkingSignature,
      wasHidden: false,
      timestamp: Date.now()
    };

    this.emit('thinking_complete', event);
    session.thinkingId = undefined;
  }

  private addContentDelta(sessionId: string, delta: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Track TTFT
    if (!session.ttft && delta) {
      session.ttft = Date.now() - session.startTime;
    }

    session.contentAccumulated += delta;
    session.contentSequence++;

    const event: ContentDeltaEvent = {
      type: 'content_delta',
      sessionId,
      delta,
      accumulated: session.contentAccumulated,
      sequenceNumber: session.contentSequence,
      timestamp: Date.now()
    };

    this.emit('content_delta', event);
  }

  private startTool(sessionId: string, toolCallId: string, toolName: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.activeTools.set(toolCallId, {
      name: toolName,
      accumulated: '',
      sequence: 0,
      startTime: Date.now()
    });

    const event: ToolStartEvent = {
      type: 'tool_start',
      sessionId,
      toolCallId,
      toolName,
      toolIndex: session.activeTools.size - 1,
      model: session.model,
      provider: session.provider,
      timestamp: Date.now()
    };

    this.emit('tool_start', event);
  }

  private addToolDelta(sessionId: string, toolCallId: string, delta: string, jsonPath?: string): void {
    const session = this.sessions.get(sessionId);
    const tool = session?.activeTools.get(toolCallId);
    if (!tool) return;

    tool.accumulated += delta;
    tool.sequence++;

    const event: ToolDeltaEvent = {
      type: 'tool_delta',
      sessionId,
      toolCallId,
      delta,
      accumulated: tool.accumulated,
      jsonPath,
      sequenceNumber: tool.sequence,
      isValidJson: this.isValidJson(tool.accumulated),
      timestamp: Date.now()
    };

    this.emit('tool_delta', event);
  }

  private completeTool(sessionId: string, toolCallId: string, argsRaw?: string): void {
    const session = this.sessions.get(sessionId);
    const tool = session?.activeTools.get(toolCallId);
    if (!tool) return;

    const finalArgs = argsRaw || tool.accumulated;
    let parsedArgs: Record<string, unknown> = {};

    try {
      parsedArgs = JSON.parse(finalArgs);
    } catch {
      // Keep empty object
    }

    const event: ToolCompleteEvent = {
      type: 'tool_complete',
      sessionId,
      toolCallId,
      toolName: tool.name,
      arguments: parsedArgs,
      argumentsRaw: finalArgs,
      durationMs: Date.now() - tool.startTime,
      timestamp: Date.now()
    };

    this.emit('tool_complete', event);

    // Emit todo_update event when TodoWrite tool is used
    if (tool.name.toLowerCase() === 'todowrite' || tool.name.toLowerCase() === 'todo_write') {
      this.emitTodoUpdate(sessionId, parsedArgs);
    }
  }

  /**
   * Emit a todo_update event from TodoWrite tool arguments
   */
  private emitTodoUpdate(sessionId: string, args: Record<string, unknown>): void {
    // Extract todos from arguments - TodoWrite passes { todos: [...] }
    const rawTodos = args.todos;
    if (!rawTodos || !Array.isArray(rawTodos)) {
      return;
    }

    const todos = rawTodos.map((t: any, index: number) => ({
      id: t.id || `todo-${index}-${Date.now()}`,
      content: t.content || '',
      status: t.status || 'pending',
      activeForm: t.activeForm,
    }));

    const event: TodoUpdateEvent = {
      type: 'todo_update',
      sessionId,
      todos,
      timestamp: Date.now(),
    };

    this.emit('todo_update', event);
  }

  /**
   * Record a tool result
   */
  recordToolResult(
    sessionId: string,
    toolCallId: string,
    result: unknown,
    success: boolean,
    error?: string,
    executionMs?: number
  ): void {
    const session = this.sessions.get(sessionId);
    const tool = session?.activeTools.get(toolCallId);
    if (!tool) return;

    const event: ToolResultEvent = {
      type: 'tool_result',
      sessionId,
      toolCallId,
      toolName: tool.name,
      result,
      success,
      error,
      executionMs: executionMs || Date.now() - tool.startTime,
      timestamp: Date.now()
    };

    this.emit('tool_result', event);
  }

  /**
   * Emit model info event
   */
  emitModelInfo(
    sessionId: string,
    modelInfo: Omit<ModelInfoEvent, 'type' | 'sessionId' | 'timestamp'>
  ): void {
    const event: ModelInfoEvent = {
      type: 'model_info',
      sessionId,
      ...modelInfo,
      timestamp: Date.now()
    };

    this.emit('model_info', event);
  }

  private updateMetrics(sessionId: string, tokens: {
    input?: number;
    output?: number;
    thinking?: number;
  }): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (tokens.input) session.inputTokens = tokens.input;
    if (tokens.output) session.outputTokens = tokens.output;
    if (tokens.thinking) session.thinkingTokens = tokens.thinking;

    const event: MetricsUpdateEvent = {
      type: 'metrics_update',
      sessionId,
      tokens: {
        input: session.inputTokens,
        output: session.outputTokens,
        thinking: session.thinkingTokens,
        total: session.inputTokens + session.outputTokens + session.thinkingTokens
      },
      timing: {
        ttft: session.ttft,
        elapsed: Date.now() - session.startTime,
        tokensPerSecond: session.outputTokens / ((Date.now() - session.startTime) / 1000) || 0
      },
      timestamp: Date.now()
    };

    this.emit('metrics_update', event);
  }

  /**
   * Complete the activity session
   */
  completeSession(sessionId: string, stopReason: StopReason = 'end_turn'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Complete any pending thinking
    if (session.thinkingId) {
      this.completeThinking(sessionId);
    }

    const event: ActivityCompleteEvent = {
      type: 'activity_complete',
      sessionId,
      messageId: session.messageId,
      model: session.model,
      provider: session.provider,
      tokens: {
        input: session.inputTokens,
        output: session.outputTokens,
        thinking: session.thinkingTokens,
        total: session.inputTokens + session.outputTokens + session.thinkingTokens
      },
      timing: {
        ttft: session.ttft || 0,
        totalMs: Date.now() - session.startTime,
        thinkingMs: session.thinkingStartTime
          ? (Date.now() - session.thinkingStartTime)
          : undefined
      },
      hadThinking: session.thinkingTokens > 0,
      thinkingTokens: session.thinkingTokens,
      toolCallCount: session.activeTools.size,
      stopReason,
      timestamp: Date.now()
    };

    this.emit('activity_complete', event);
    this.sessions.delete(sessionId);
  }

  private isValidJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  private parseThinkTags(content: string, wasInTag: boolean): {
    thinking: string;
    response: string;
    stillInTag: boolean;
  } {
    let thinking = '';
    let response = '';
    let stillInTag = wasInTag;

    // Simple state machine for <think>...</think> parsing
    let remaining = content;

    while (remaining.length > 0) {
      if (stillInTag) {
        const endIdx = remaining.indexOf('</think>');
        if (endIdx >= 0) {
          thinking += remaining.slice(0, endIdx);
          remaining = remaining.slice(endIdx + 8);
          stillInTag = false;
        } else {
          thinking += remaining;
          remaining = '';
        }
      } else {
        const startIdx = remaining.indexOf('<think>');
        if (startIdx >= 0) {
          response += remaining.slice(0, startIdx);
          remaining = remaining.slice(startIdx + 7);
          stillInTag = true;
        } else {
          response += remaining;
          remaining = '';
        }
      }
    }

    return { thinking, response, stillInTag };
  }
}

// Export singleton instance
export const activityNormalizer = new ActivityStreamNormalizer();
