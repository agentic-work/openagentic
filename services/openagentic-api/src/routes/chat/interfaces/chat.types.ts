/**
 * Core chat system types and interfaces
 */

export interface ChatUser {
  id: string;
  email?: string;
  name?: string;
  displayName?: string; // User's display name for audit logging
  isAdmin: boolean;
  groups: string[];
  azureOid?: string;
  azureTenantId?: string;
  accessToken?: string; // Azure AD token for OpenAI authentication
  localAccount?: boolean; // True for local accounts, false/undefined for Azure AD users
  authMethod?: string; // 'api-key' | 'azure-ad' | 'local' — original auth method from middleware
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  model?: string;
  messageCount: number;
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  messages?: ChatMessage[];
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  sessionId?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  parentId?: string;
  branchId?: string;
  threadDepth?: number;
  branchTitle?: string;
  isStreaming?: boolean;
  thinkingTime?: number;
  tokenUsage?: TokenUsage | null;
  model?: string; // The actual model used (e.g., 'gpt-4.1-mini-2025-04-14')
  toolCalls?: ToolCall[];
  toolCallId?: string; // For tool response messages
  toolResults?: ToolResult[];
  mcpCalls?: MCPCall[];
  cotSteps?: CoTStep[];
  reasoningTrace?: ReasoningTrace;
  visualizations?: Visualization[];
  prometheusData?: PrometheusMetric[];
  attachments?: Attachment[];
  metadata?: Record<string, any>;
  timestamp: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  promptTokens?: number; // Alias for compatibility
  completionTokens?: number; // Alias for compatibility  
  totalTokens?: number; // Alias for compatibility
  estimatedCost?: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
  executionTime?: number;
}

export interface MCPCall {
  id: string;
  toolName: string;
  serverId: string;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  executionTime: number;
  timestamp: Date;
}

export interface CoTStep {
  id: string;
  type: 'thought' | 'action' | 'observation' | 'reflection';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ReasoningTrace {
  steps: CoTStep[];
  finalAnswer: string;
  confidence: number;
  alternatives?: string[];
}

export interface Visualization {
  id?: string;
  type: 'bar' | 'line' | 'area' | 'pie' | 'radial' | 'gauge' | 'chart' | 'diagram' | 'image' | 'table' | 'math_block' | 'math_inline';
  title?: string;
  data?: any[];
  config?: {
    xAxis?: string;
    yAxis?: string | string[];
    color?: string | string[];
    stacked?: boolean;
    showGrid?: boolean;
    showLegend?: boolean;
    unit?: string;
  };
  // For math visualizations
  latex?: string;
  display?: boolean;
  original?: string;
}

export interface PrometheusMetric {
  name: string;
  value: number;
  unit?: string;
  query?: string;
  timestamp?: string;
  status?: 'healthy' | 'warning' | 'critical';
  trend?: 'up' | 'down' | 'stable';
  trendPercent?: number;
  sparklineData?: number[];
}

export interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url?: string;
  base64Data?: string;
  metadata?: Record<string, any>;
}

// Request/Response types
export interface ChatRequest {
  message: string;
  sessionId: string;
  model?: string;
  enabledTools?: string[];
  autoApproveTools?: boolean;
  attachments?: Attachment[];
  toolCalls?: any[]; // For when we receive tool calls to execute
  responseFormat?: any; // For structured output
  promptTechniques?: string[]; // Enabled prompt techniques from frontend
  enableExtendedThinking?: boolean; // Enable extended thinking for supported models (Claude 3.5+, o1)
  flowContext?: any; // Current workflow state when user is in flows mode (for Flows Agent)
  options?: ChatOptions;
  // Auth token for openagentic-proxy delegation (local JWT or API key)
  rawBearerToken?: string;
  // Audit fields
  userId?: string;
  content?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  systemPromptOverride?: string;
  enableCoT?: boolean;
  enableRAG?: boolean;
  enableSelfConsistency?: boolean;
}

export interface ChatResponse {
  messageId: string;
  sessionId: string;
  content: string;
  tokenUsage: TokenUsage;
  toolCalls?: ToolCall[];
  mcpCalls?: MCPCall[];
  cotSteps?: CoTStep[];
  metadata?: Record<string, any>;
  timestamp: Date;
}

// Streaming types
export interface StreamEvent {
  type: 'stream' | 'tool_call' | 'tool_result' | 'mcp_call' | 'cot_step' | 'done' | 'error';
  data: any;
  timestamp: Date;
}

export interface StreamContext {
  sessionId: string;
  userId: string;
  messageId: string;
  startTime: Date;
  tokenCount: number;
  toolCallCount: number;
  mcpCallCount: number;
}

// Error types
export interface ChatError extends Error {
  code: string;
  message: string;
  details?: Record<string, any>;
  retryable?: boolean;
  timestamp?: Date;
}

export enum ChatErrorCode {
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  INVALID_SESSION = 'INVALID_SESSION',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  MODEL_ERROR = 'MODEL_ERROR',
  MCP_ERROR = 'MCP_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  TOKEN_LIMIT_EXCEEDED = 'TOKEN_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  COMPLETION_FAILED = 'COMPLETION_FAILED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  // Admin Portal SOT Configuration Errors
  PROMPT_NOT_CONFIGURED = 'PROMPT_NOT_CONFIGURED',
  DEFAULT_PROMPT_MISSING = 'DEFAULT_PROMPT_MISSING',
  ADMIN_PORTAL_MISCONFIGURED = 'ADMIN_PORTAL_MISCONFIGURED',
  // Budget errors
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED'
}