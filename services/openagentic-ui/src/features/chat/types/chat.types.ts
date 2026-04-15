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