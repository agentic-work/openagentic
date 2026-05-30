// THIS IS THE SINGLE SOURCE OF TRUTH FOR CHAT MESSAGES
// DO NOT CREATE ANY OTHER ChatMessage INTERFACE ANYWHERE ELSE
export interface ChatMessage {
  attachments?: boolean;
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string; // ALWAYS A STRING - ISO format
  model?: string; // Model used to generate the message
  modelTag?: string; // First-hyphen prefix of `model` (e.g. "claude") — header pill family
  modelId?: string; // Remainder after the first hyphen (e.g. "opus-4-7") — header pill id half
  toolCallId?: string;
  toolName?: string;
  toolCalls?: any[]; // Array of tool calls made
  toolResults?: any[]; // Array of tool execution results
  mcpCalls?: any[]; // Array of MCP function calls
  // cotSteps removed - replaced with sequential-thinking MCP
  thinkingSteps?: ThinkingStep[]; // Thinking process steps (from streaming)
  reasoningTrace?: ReasoningTrace | string; // Complete reasoning trace
  tokenUsage?: TokenUsage;
  metadata?: any;
  imageUrl?: string; // For image attachments
  // Enhanced content properties
  thinkingTime?: number; // in milliseconds
  prometheusData?: PrometheusData[];
  visualizations?: VisualizationData[];
  isStreaming?: boolean; // Indicates if message is currently being streamed
  // Message status and error handling
  status?: 'sending' | 'sent' | 'error' | 'streaming' | 'completed';
  error?: string; // Error message if status is 'error'
  // Image attachments
  attachedImages?: Array<{
    name: string;
    data: string;
    mimeType: string;
  }>;
  // Revised prompt for image generation
  revisedPrompt?: string;
  // Conversation branching
  parentId?: string; // ID of parent message in thread
  branchId?: string; // Unique identifier for this branch
  threadDepth?: number; // Depth level in the conversation tree
  branchTitle?: string; // Optional title for the branch
  children?: string[]; // IDs of child messages/branches
  /**
   * Sev-0 #924/#925/#926 — canonical ContentBlock[] in wire-emit order.
   * Carries the full chronology (thinking, text, tool_use, viz_render,
   * app_render, streaming_table, follow_up, sub_agent, hitl_approval,
   * tool_round, tool_result) so the post-`done` DOM matches the live
   * stream byte-for-byte, and survives session reload by way of the
   * server-side `chat_messages.content_blocks` Json column.
   */
  content_blocks?: any[];
}

export interface ThinkingStep {
  id: string;
  type: 'analysis' | 'consideration' | 'decision' | 'observation';
  content: string;
  timestamp: string;
}

// CoTStep interface removed - replaced with sequential-thinking MCP

export interface ReasoningTrace {
  id: string;
  model: string;
  prompt: string;
  reasoning: string;
  conclusion: string;
  confidence: number;
  // steps: CoTStep[] - removed
  totalTokens: number;
  processingTime: number;
  timestamp: string;
}

export interface PrometheusData {
  metric: string;
  value: any;
  query?: string;
  timestamp?: string;
  status?: 'healthy' | 'warning' | 'critical';
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
  sparkline?: number[];
}

export interface VisualizationData {
  type: 'bar' | 'line' | 'area' | 'pie' | 'radial' | 'gauge';
  title: string;
  data: any[];
  config?: {
    xAxis?: string;
    yAxis?: string | string[];
    color?: string | string[];
    stacked?: boolean;
    showGrid?: boolean;
    showLegend?: boolean;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    currency: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  isLocal?: boolean; // True if session hasn't been saved to DB yet
}

export interface TokenStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  chartData: Array<{
    timestamp: string;
    promptTokens: number;
    completionTokens: number;
    tokens: number;
  }>;
}

export interface Settings {
  // Theme settings
  theme: 'light' | 'dark';
  accentColor: string;
  // General settings - simplified to only what's actually used
  general: {
    showTypingIndicators: boolean; // Used in ChatMessages component
    enableKeyboardShortcuts?: boolean; // Used in SettingsDropdown
    autoSaveConversations?: boolean; // Used in SettingsDropdown
  };
  // Appearance settings
  appearance: {
    showMessageTimestamps: boolean;
    enableAnimations: boolean;
    compactMessageLayout: boolean;
  };
  // MCP Tools settings
  tools: {
    enabledTools: string[];
  };
  // Multimedia settings - keep only what's actively used
  multimedia: {
    enableImagePaste: boolean;
    imageAnalysisEnabled: boolean;
    maxImageSize: number;
    supportedImageFormats: string[];
    preferredVisionModel: string;
  };
  // Audio settings - simplified
  audio: {
    enableTextToSpeech: boolean;
    voiceLanguage: string;
    speechSpeed: number;
  };
}

export interface WebSocketMessage {
  type: 'message' | 'stream' | 'done' | 'error' | 'pong';
  message?: ChatMessage;
  content?: string;
  error?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: {
    endpoint: string;
    deployment: string;
    model: string;
    apiVersion: string;
    responseTime: string;
    features: {
      chat: boolean;
      tools: boolean;
      tokenUsage: boolean;
    };
    warnings: string[];
  };
}

export interface NavigationItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

export interface Theme {
  name: 'light' | 'dark';
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
}

export interface ToolApprovalRequest {
  approvalId: string;
  tool: {
    name: string;
    description: string;
    arguments: any;
  };
}

export interface ConversationBranch {
  id: string;
  title: string;
  parentMessageId: string;
  rootMessageId: string;
  depth: number;
  messages: ChatMessage[];
  createdAt: string;
  isActive: boolean;
}

export interface BranchCreationOptions {
  messageId: string;
  title?: string;
  prompt?: string;
  continueFromMessage?: boolean;
}
