export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  model?: string; // Model used for this response (for badge display)
  tokenUsage?: TokenUsage;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: Record<string, any>;
  mcpCalls?: MCPCall[]; // MCP tool calls made during this response
}

export interface MCPCall {
  id: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, any>;
  result?: any;
  status: 'pending' | 'success' | 'error';
  error?: string;
  duration?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface StreamEvent {
  type: string;
  data: any;
  id?: string;
  retry?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  model?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
  result?: any;
}

export interface ToolResult {
  toolCallId: string;
  result: any;
  error?: string;
}