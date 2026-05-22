/**
 * Model roles in the multi-model collaboration system
 */
export enum ModelRole {
  /** Complex analysis, planning, decision-making - uses premium models */
  REASONING = 'reasoning',
  /** MCP tool calls, function execution - can use cheaper models */
  TOOL_EXECUTION = 'tool_execution',
  /** Final response generation after reasoning/tools - balanced model */
  SYNTHESIS = 'synthesis',
  /** Error recovery, retry scenarios - reliable fallback model */
  FALLBACK = 'fallback'
}

/**
 * Configuration for a specific model role
 */
export interface ModelRoleConfig {
  role: ModelRole;
  enabled: boolean;
  /** Primary model for this role (e.g., 'claude-opus-4', 'gemini-2.5-pro') */
  primaryModel: string;
  /** Fallback model if primary fails (e.g., 'claude-sonnet-4', 'gpt-4o') */
  fallbackModel?: string;
  /** Provider hint: 'vertex-ai', 'azure-openai', 'anthropic', etc. */
  provider?: string;
  /** Max tokens for this role */
  maxTokens?: number;
  /** Temperature setting */
  temperature?: number;
  /** Thinking budget for extended thinking models */
  thinkingBudget?: number;
  /** Max cost per role execution in USD */
  costLimit?: number;
  /** Max execution time in milliseconds */
  timeoutMs?: number;

  /** Role-specific options */
  options?: {
    /** Enable extended thinking for reasoning role */
    enableThinking?: boolean;
    /** Stream tool calls for tool execution role */
    streamTools?: boolean;
    /** Maintain tool call chain across handoffs */
    preserveToolContext?: boolean;
  };
}

/**
 * Complete multi-model collaboration configuration
 */
export interface MultiModelConfig {
  /** Whether multi-model is enabled */
  enabled: boolean;
  /** Where this config came from */
  source: 'feature_flag' | 'runtime' | 'admin' | 'default';

  /** Role assignments - which model handles each role */
  roles: {
    [ModelRole.REASONING]: ModelRoleConfig;
    [ModelRole.TOOL_EXECUTION]: ModelRoleConfig;
    [ModelRole.SYNTHESIS]: ModelRoleConfig;
    [ModelRole.FALLBACK]: ModelRoleConfig;
  };

  /** Routing strategy configuration */
  routing: {
    /** Complexity threshold (0-100) to trigger multi-model */
    complexityThreshold: number;
    /** Patterns that always trigger multi-model */
    alwaysMultiModelPatterns: string[];
    /** Prefer cheaper model for tool execution */
    preferCheaperToolModel: boolean;
    /** Maximum handoffs before forcing synthesis */
    maxHandoffs: number;
  };

  /**
   * Per-request slider overrides for multi-model dispatch. Optional; null/
   * undefined means use the role-config defaults. The pipeline reads
   * `enableAbovePosition` (slider threshold past which multi-model
   * activates) and `scaleBySlider` (whether to scale handoff count by
   * slider position).
   */
  sliderOverrides?: {
    enableAbovePosition?: number;
    scaleBySlider?: boolean;
  };
}

/**
 * Tool call record with execution metadata
 */
export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  model: string;
  provider: string;
  duration: number;
  timestamp: Date;
}

/**
 * Execution context passed between model handoffs
 */
export interface ModelHandoffContext {
  /** Unique ID for the entire multi-model request */
  orchestrationId: string;

  /** Current execution state */
  currentRole: ModelRole;
  handoffCount: number;

  /** Accumulated reasoning output */
  reasoningOutput?: {
    analysis: string;
    plan?: string;
    decisions?: Array<{ decision: string; confidence: number }>;
    thinkingContent?: string;
  };

  /** Accumulated tool execution output */
  toolExecutionOutput?: {
    toolCalls: ToolCallRecord[];
    /** Preserved tool call ID chain for multi-turn */
    toolCallIdChain: string[];
  };

  /** Input for synthesis role */
  synthesisInput?: {
    originalQuery: string;
    reasoningContext?: string;
    toolResults?: unknown[];
  };

  /** Error tracking */
  errors: Array<{
    role: ModelRole;
    model: string;
    error: string;
    timestamp: Date;
    retryable: boolean;
  }>;

  /** Cost tracking per role */
  costBreakdown: {
    [role in ModelRole]?: {
      inputTokens: number;
      outputTokens: number;
      thinkingTokens?: number;
      estimatedCost: number;
      model: string;
    };
  };

  /** Timing per role */
  roleTimings: {
    [role in ModelRole]?: {
      startTime: Date;
      endTime?: Date;
      durationMs?: number;
    };
  };
}

/**
 * Request for a specific model role
 */
export interface ModelRoleRequest {
  role: ModelRole;
  context: ModelHandoffContext;

  /** The input for this role */
  input: {
    messages: unknown[];
    systemPrompt?: string;
    tools?: unknown[];
    previousRoleOutput?: unknown;
  };

  /** Override config for this specific request */
  overrideConfig?: Partial<ModelRoleConfig>;
}

/**
 * Response from a model role execution
 */
export interface ModelRoleResponse {
  role: ModelRole;
  model: string;
  provider: string;

  /** The output from this role */
  output: {
    content?: string;
    toolCalls?: unknown[];
    thinkingContent?: string;
    finishReason: string;
  };

  /** Metrics for this role execution */
  metrics: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
    durationMs: number;
    estimatedCost: number;
    timeToFirstToken?: number;
  };

  /** What to do next */
  nextAction: 'handoff' | 'complete' | 'retry' | 'fallback';
  nextRole?: ModelRole;

  /** Updated context for handoff */
  updatedContext: ModelHandoffContext;
}

/**
 * Routing decision for a request
 */
export interface MultiModelRoutingDecision {
  useMultiModel: boolean;
  reason: string;

  /** If multi-model, the execution plan */
  executionPlan?: {
    roles: ModelRole[];
    estimatedCost: number;
    estimatedDurationMs: number;
  };

  /** If single model, which one */
  singleModelFallback?: {
    model: string;
    provider: string;
  };

  /** Task analysis that led to this decision */
  taskAnalysis: {
    complexity: 'simple' | 'moderate' | 'complex' | 'expert';
    requiresReasoning: boolean;
    requiresTools: boolean;
    toolCount: number;
    estimatedTokens: number;
  };
}

/**
 * SSE events for multi-model streaming
 */
export interface MultiModelSSEEvent {
  type:
    | 'orchestration_start'
    | 'role_start'
    | 'role_thinking'
    | 'role_stream'
    | 'role_tool_call'
    | 'role_complete'
    | 'handoff'
    | 'orchestration_complete'
    | 'orchestration_error';

  data: {
    orchestrationId: string;
    role?: ModelRole;
    model?: string;
    content?: string;
    toolCall?: unknown;
    metrics?: unknown;
    error?: string;
    timestamp: number;
  };
}

/**
 * Admin portal model role assignment
 */
export interface AdminModelRoleAssignment {
  id: string;
  role: ModelRole;
  model: string;
  provider: string;
  priority: number;
  enabled: boolean;
  sliderMinPosition: number;
  sliderMaxPosition: number;
  costPerRequest?: number;
  options?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * Orchestration request parameters
 */
export interface OrchestrationRequest {
  orchestrationId: string;
  messages: unknown[];
  systemPrompt?: string;
  tools?: unknown[];
  // Orchestrator decides from message complexity + tool shape.
  config: MultiModelConfig;
  /** Per-request slider state (position + per-tier overrides). Optional. */
  sliderConfig?: { position?: number; overrides?: Record<string, unknown> };
  emit: (event: string, data: unknown) => void;
}

/**
 * Orchestration result
 */
export interface OrchestrationResult {
  finalResponse: string;
  toolCalls: ToolCallRecord[];
  rolesExecuted: ModelRole[];
  handoffCount: number;
  costBreakdown: ModelHandoffContext['costBreakdown'];
  totalCost: number;
  totalDuration: number;
  metrics: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
  };
}

/**
 * Default multi-model configuration. Models come from env vars when present;
 * the `getDefaultMultiModelConfig()` function returns a CONFIG SNAPSHOT and
 * must never throw — admin GET /multi-model/config relies on that to render
 * a "not configured" state. Runtime callers that actually use these models
 * must validate primaryModel before invoking the provider. (#368)
 */
export function getDefaultMultiModelConfig(): MultiModelConfig {
  return {
    enabled: false,
    source: 'default',
    roles: {
      [ModelRole.REASONING]: {
        role: ModelRole.REASONING,
        enabled: true,
        primaryModel: process.env.MULTI_MODEL_REASONING_PRIMARY || '',
        fallbackModel: process.env.MULTI_MODEL_REASONING_FALLBACK,
        temperature: parseFloat(process.env.MULTI_MODEL_REASONING_TEMP || '0.7'),
        thinkingBudget: parseInt(process.env.MULTI_MODEL_REASONING_THINKING_BUDGET || '8000', 10),
        options: {
          enableThinking: process.env.MULTI_MODEL_REASONING_ENABLE_THINKING !== 'false'
        }
      },
      [ModelRole.TOOL_EXECUTION]: {
        role: ModelRole.TOOL_EXECUTION,
        enabled: true,
        primaryModel: process.env.MULTI_MODEL_TOOL_PRIMARY || '',
        fallbackModel: process.env.MULTI_MODEL_TOOL_FALLBACK,
        temperature: parseFloat(process.env.MULTI_MODEL_TOOL_TEMP || '0.3'),
        options: {
          streamTools: true,
          preserveToolContext: true
        }
      },
      [ModelRole.SYNTHESIS]: {
        role: ModelRole.SYNTHESIS,
        enabled: true,
        primaryModel: process.env.MULTI_MODEL_SYNTHESIS_PRIMARY || '',
        fallbackModel: process.env.MULTI_MODEL_SYNTHESIS_FALLBACK,
        temperature: parseFloat(process.env.MULTI_MODEL_SYNTHESIS_TEMP || '0.5')
      },
      [ModelRole.FALLBACK]: {
        role: ModelRole.FALLBACK,
        enabled: true,
        primaryModel: process.env.MULTI_MODEL_FALLBACK_PRIMARY || '',
        temperature: parseFloat(process.env.MULTI_MODEL_FALLBACK_TEMP || '0.5')
      }
    },
    routing: {
      complexityThreshold: parseInt(process.env.MULTI_MODEL_COMPLEXITY_THRESHOLD || '60', 10),
      alwaysMultiModelPatterns: (process.env.MULTI_MODEL_TRIGGER_PATTERNS || 'analyze,compare,audit,comprehensive,investigate').split(','),
      preferCheaperToolModel: process.env.MULTI_MODEL_PREFER_CHEAP_TOOLS !== 'false',
      maxHandoffs: parseInt(process.env.MULTI_MODEL_MAX_HANDOFFS || '5', 10)
    }
  };
}
