/**
 * TypeScript interfaces for OpenAgenticCode
 */

export interface CodeSession {
  id: string;
  userId: string;
  containerId: string;
  model: string;
  workspacePath: string;
  createdAt: Date;
  lastActivity: Date;
  status: 'active' | 'stopped' | 'error';
}

export interface CodeMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'thinking';
  content: string;
  tool?: string;
  params?: any;
  result?: any;
  timestamp: Date;
}

export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  children?: FileNode[];
  expanded?: boolean;
}

export interface ToolCall {
  id: string;
  tool: string;
  params: any;
  result?: any;
  status: 'pending' | 'executing' | 'completed' | 'error';
  timestamp: Date;
}

export interface AgenticEvent {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'file_change' | 'error' | 'done';
  content?: string;
  tool?: string;
  params?: any;
  result?: any;
  path?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  supportsTools: boolean;
}
