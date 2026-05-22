/**
 * Workflow Type Definitions
 * Inspired by n8n's workflow structure, adapted for OpenAgenticChat
 */

export type NodeType =
  | 'trigger'
  | 'mcp_tool'
  | 'llm_completion'
  | 'code'
  | 'condition'
  | 'loop'
  | 'transform'
  | 'merge'
  | 'http_request'
  | 'approval'
  | 'human_approval'
  | 'wait'
  | 'agent_spawn'
  | 'agent_single'
  | 'agent_pool'
  | 'agent_supervisor'
  | 'a2a'
  | 'synth'
  | 'openagentic'
  | 'openagentic_llm'
  | 'multi_agent'
  | 'slack_message'
  | 'teams_message'
  | 'outlook_email'
  | 'send_email'
  | 'pagerduty_incident'
  | 'servicenow_ticket'
  | 'jira_issue'
  | 'discord_message'
  | 'error_handler'
  | 'user_context'
  | 'text'
  | 'rag_query'
  | 'data_source_query'
  | 'file_upload'
  | 'webhook_response'
  | 'switch'
  | 'sub_workflow'
  | 'parallel'
  | 'reasoning'
  | 'text_splitter'
  | 'embedding'
  | 'vector_store'
  | 'document_loader'
  | 'structured_output'
  | 'guardrails';

export type TriggerType =
  | 'manual'
  | 'schedule'
  | 'chat_message'
  | 'file_upload'
  | 'webhook'
  | 'admin_action';

// Port type system (inspired by LangFlow)
export type PortType = 'any' | 'message' | 'data' | 'json' | 'number' | 'boolean' | 'text' | 'tool' | 'model' | 'embedding';

export interface PortDefinition {
  name: string;
  type: PortType;
  label?: string;
  required?: boolean;
  multiple?: boolean; // accepts multiple connections
}

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Position {
  x: number;
  y: number;
}

export interface NodeData {
  label: string;
  description?: string;
  icon?: string;
  color?: string;

  // MCP Tool specific
  toolName?: string;
  toolServer?: string;
  serverName?: string;
  arguments?: Record<string, any>;

  // LLM Completion specific
  model?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;

  // Code Node specific
  code?: string;
  language?: 'javascript' | 'python' | 'bash';

  // Condition Node specific
  condition?: string;
  operator?: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'regex';

  // Trigger specific
  triggerType?: TriggerType;
  triggerConfig?: {
    cron?: string;
    timezone?: string;
    messagePattern?: string;
    userType?: 'admin' | 'non_admin' | 'all';
    fileTypes?: string[];
  };

  // Transform specific
  transformType?: 'map' | 'filter' | 'reduce' | 'jsonpath';
  transformExpression?: string;

  // Universal Advanced Config (Phase 10)
  disabled?: boolean;
  timeoutMs?: number;
  onError?: 'stop' | 'continue' | 'retry' | 'route_to_error_handler';
  retryPolicy?: {
    maxRetries: number;
    delayMs: number;
    backoff: 'fixed' | 'exponential';
    retryOnPatterns?: string[];
  };
  notes?: string;
  pinnedOutput?: any;
  usePinnedData?: boolean;

  // Agent Node Config (Phase 12)
  persona?: {
    role?: string;
    tone?: 'professional' | 'casual' | 'technical';
    boundaries?: string;
    bootstrapInstructions?: string;
  };
  // 2026-04-19 — intelligenceLevel removed (task #144, slider rip).
  modelOverride?: string;
  maxTurns?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  toolPolicy?: {
    mode: 'allow_all' | 'allow_selected' | 'deny_selected';
    tools?: string[];
  };
  costBudget?: number;
  toolCallLimit?: number;
  requireApproval?: 'none' | 'high_risk' | 'all';
  memoryScope?: 'node' | 'workflow' | 'global';
  persistMemory?: boolean;

  // Error Handler Node (Phase 14)
  errorAction?: 'log' | 'retry' | 'notify' | 'transform';
  notificationChannel?: string;
  errorTransformExpression?: string;

  // User Context Node (Phase 16)
  contextSources?: ('chat' | 'code' | 'workflow' | 'memory')[];
  contextQuery?: string;
  contextMaxTokens?: number;

  // Agent Supervisor Config
  supervisorInstructions?: string;
  supervisorModel?: string;
  maxDelegationRounds?: number;
  allowDynamicWorkers?: boolean;
  workers?: Array<{ role: string; capabilities?: string }>;

  // Multi-Agent / Pool Config
  concurrency?: number;
  aggregationStrategy?: 'first' | 'vote' | 'merge' | 'supervisor_synthesis';
  timeoutPerAgent?: number;

  // Allow string indexing for ReactFlow compatibility
  [key: string]: unknown;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: Position;
  data: NodeData;
  measured?: {
    width?: number;
    height?: number;
  };
  // Allow string indexing for ReactFlow compatibility
  [key: string]: unknown;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: 'default' | 'conditional' | 'error';
  label?: string;
  animated?: boolean;
  style?: Record<string, any>;
  // Allow string indexing for ReactFlow compatibility
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  name?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
}

/**
 * Human-readable legend block authored on template JSON under `meta`.
 * Surfaces in the template gallery card + canvas-side "About this
 * workflow" panel. Persisted server-side in `settings.meta`; the API
 * pulls it out to the top-level `meta` field in transformWorkflow().
 */
export interface WorkflowMeta {
  purpose?: string;
  how_it_works?: string[];
  expected_output?: string;
  useful_when?: string;
  tools_used?: string[];
  version?: string;
  tags?: string[];
}

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  definition?: WorkflowDefinition;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: WorkflowStatus;
  is_public: boolean;
  is_template?: boolean;
  tags?: string[];
  version?: number;
  created_at: string;
  updated_at: string;
  lastExecutedAt?: string;
  executionCount?: number;
  settings?: WorkflowSettings;
  meta?: WorkflowMeta | null;
}

export interface ExecutionLog {
  nodeId: string;
  nodeName: string;
  status: ExecutionStatus;
  startTime: string;
  endTime?: string;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    retryCount?: number;
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  logs: ExecutionLog[];
  result?: any;
  error?: string;
  triggeredBy?: {
    userId: string;
    userName: string;
    trigger: TriggerType;
  };
  metadata?: {
    totalTokens?: number;
    totalCost?: number;
    nodesExecuted?: number;
    nodesTotal?: number;
  };
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'analytics' | 'automation' | 'data_processing' | 'notification' | 'integration';
  definition: WorkflowDefinition;
  icon?: string;
  tags?: string[];
  featured?: boolean;
  adminOnly?: boolean;
}

// Node type configuration for palette
export interface NodeTypeConfig {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
  color: string;
  gradient?: string;
  category: 'trigger' | 'action' | 'logic' | 'ai' | 'data' | 'approval' | 'agents' | 'integration' | 'annotation';
  defaultData: Partial<NodeData>;
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
}

// MCP Tool as Node configuration
export interface MCPToolNode {
  serverId: string;
  serverName: string;
  toolName: string;
  description?: string;
  schema?: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  icon?: string;
  color?: string;
}

// Workflow validation result
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  type: 'missing_connection' | 'invalid_config' | 'circular_dependency' | 'no_trigger';
  message: string;
}

export interface ValidationWarning {
  nodeId?: string;
  type: 'unused_node' | 'missing_error_handling' | 'performance';
  message: string;
}

export interface WorkflowSettings {
  // Execution Defaults
  // 2026-04-19 — defaultIntelligenceLevel removed (task #144, slider rip).
  defaultModel?: string;
  defaultTimeoutMs?: number;
  maxExecutionTimeMs?: number;

  // Cost Controls
  perExecutionBudget?: number;
  dailyBudget?: number;
  monthlyBudget?: number;
  onBudgetExceeded?: 'pause' | 'downgrade' | 'abort';

  // Retry Policy
  defaultRetryCount?: number;
  defaultRetryDelayMs?: number;
  defaultBackoffStrategy?: 'fixed' | 'exponential';

  // Environment Variables
  envVars?: Record<string, string>;

  // Tags & Visibility
  tags?: string[];
  visibility?: 'private' | 'team' | 'public';
}

export interface AdminWorkflowSettings {
  // Execution Limits
  defaultNodeTimeoutMs?: number;
  maxNodeTimeoutMs?: number;
  maxExecutionTimeMs?: number;
  maxNodesPerWorkflow?: number;
  maxConcurrentExecutions?: number;
  maxConcurrentPerUser?: number;
  maxExecutionsPerHourPerUser?: number;

  // Cost Governance
  defaultPerExecutionBudget?: number;
  maxPerExecutionBudget?: number;
  defaultDailyBudgetPerUser?: number;
  defaultMonthlyBudgetPerUser?: number;
  onBudgetExceeded?: 'pause' | 'downgrade' | 'abort';

  // Model Restrictions
  // 2026-04-19 — defaultIntelligenceLevel / maxIntelligenceLevel removed
  // (task #144, slider rip). Per-user × per-model budgets live in
  // UserModelBudgetService (admin console).
  allowedModels?: string[];

  // Agent Restrictions
  maxAgentTurns?: number;
  maxToolCalls?: number;
  agentCostBudgetCap?: number;
  requireApprovalForHighRisk?: boolean;
  highRiskTools?: string[];

  // Node Type Restrictions
  disabledNodeTypes?: string[];

  // Retry Defaults
  defaultRetryCount?: number;
  defaultRetryDelayMs?: number;
  defaultBackoffStrategy?: 'fixed' | 'exponential';

  // Error Handling
  defaultOnError?: 'stop' | 'continue' | 'retry';

  // Memory
  crossModeMemoryEnabled?: boolean;
  memoryRetentionDays?: number;
  maxMemoryEntriesPerUser?: number;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  changelog?: string;
  changeSummary?: string;
  definition: WorkflowDefinition;
  settings?: WorkflowSettings;
  createdAt: string;
  createdBy?: string;
  isActive: boolean;
}
