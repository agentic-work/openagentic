/**
 * Streaming interface types
 */

export interface StreamDelta {
  type: 'content' | 'tool_call' | 'function_call' | 'error' | 'done';
  content?: string;
  toolCall?: any;
  functionCall?: any;
  error?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface StreamContext {
  sessionId: string;
  messageId: string;
  userId: string;
  startTime: Date;
}