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

/**
 * Persistence Client
 * Sends session and message data to the main API for database storage
 */

import axios from 'axios';
import type { UserSession } from './types';

// API base URL - configurable via environment
const API_BASE_URL = process.env.OPENAGENTIC_API_URL || 'http://openagentic-api:8000';

export interface MessageData {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  rawOutput?: string;
  model?: string;
  tokens?: number;
  tokensInput?: number;
  tokensOutput?: number;
  cost?: number;
  metadata?: Record<string, any>;
  toolCalls?: any[];
  toolResults?: any[];
  toolName?: string;
  filesRead?: string[];
  filesWritten?: string[];
  thinking?: string;
  durationMs?: number;
}

/**
 * Create a session in the database
 */
export async function persistSession(session: UserSession): Promise<void> {
  try {
    await axios.post(`${API_BASE_URL}/api/awcode/sessions`, {
      sessionId: session.id,
      userId: session.userId,
      workspacePath: session.workspacePath,
      model: session.model,
      pid: session.pid,
      status: session.status,
    });
    console.log(`[Persistence] Session ${session.id} persisted to database`);
  } catch (error: any) {
    console.error(`[Persistence] Failed to persist session ${session.id}:`, error.message);
    // Don't throw - session should continue even if persistence fails
  }
}

/**
 * Update session status in the database
 */
export async function updateSessionStatus(
  sessionId: string,
  status: string,
  additionalData?: Record<string, any>
): Promise<void> {
  try {
    await axios.patch(`${API_BASE_URL}/api/awcode/sessions/${sessionId}`, {
      status,
      lastActivity: new Date().toISOString(),
      ...additionalData,
    });
    console.log(`[Persistence] Session ${sessionId} status updated to ${status}`);
  } catch (error: any) {
    console.error(`[Persistence] Failed to update session ${sessionId}:`, error.message);
  }
}

/**
 * Mark session as stopped in the database
 */
export async function stopSession(sessionId: string): Promise<void> {
  try {
    await axios.post(`${API_BASE_URL}/api/awcode/sessions/${sessionId}/stop`);
    console.log(`[Persistence] Session ${sessionId} marked as stopped`);
  } catch (error: any) {
    console.error(`[Persistence] Failed to stop session ${sessionId}:`, error.message);
  }
}

/**
 * Add a message to a session in the database
 */
export async function persistMessage(
  sessionId: string,
  message: MessageData
): Promise<void> {
  try {
    await axios.post(`${API_BASE_URL}/api/awcode/sessions/${sessionId}/messages`, message);
    console.log(`[Persistence] Message added to session ${sessionId} (role: ${message.role})`);
  } catch (error: any) {
    console.error(`[Persistence] Failed to persist message:`, error.message);
  }
}

/**
 * Add multiple messages to a session in the database (batch)
 */
export async function persistMessages(
  sessionId: string,
  messages: MessageData[]
): Promise<void> {
  try {
    await axios.post(`${API_BASE_URL}/api/awcode/sessions/${sessionId}/messages/batch`, {
      messages,
    });
    console.log(`[Persistence] ${messages.length} messages added to session ${sessionId}`);
  } catch (error: any) {
    console.error(`[Persistence] Failed to persist batch messages:`, error.message);
  }
}

/**
 * Message parser for AWCode CLI output
 * Attempts to parse structured messages from raw PTY output
 */
export function parseAWCodeOutput(rawOutput: string): MessageData | null {
  // Look for JSON-LD structured output from AWCode CLI
  const jsonMatch = rawOutput.match(/\{[\s\S]*?"type":\s*"(text|tool_call|tool_result|thinking)"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.type === 'text') {
        return {
          role: 'assistant',
          content: parsed.content,
          model: parsed.model,
          tokens: parsed.tokens,
        };
      }
      if (parsed.type === 'tool_call') {
        return {
          role: 'assistant',
          toolCalls: [parsed],
        };
      }
      if (parsed.type === 'tool_result') {
        return {
          role: 'tool',
          toolName: parsed.tool,
          toolResults: [parsed],
        };
      }
      if (parsed.type === 'thinking') {
        return {
          role: 'assistant',
          thinking: parsed.content,
        };
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  // For non-structured output, just capture as raw
  return null;
}

/**
 * Batch parser for accumulating output and extracting messages
 */
export class OutputMessageParser {
  private buffer: string = '';
  private sessionId: string;
  private lastMessageTime: number = 0;
  private pendingMessages: MessageData[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushInterval = 5000; // Flush every 5 seconds

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Add output to the buffer and try to extract messages
   */
  addOutput(output: string): void {
    this.buffer += output;
    this.lastMessageTime = Date.now();

    // Try to parse structured messages
    const message = parseAWCodeOutput(this.buffer);
    if (message) {
      this.pendingMessages.push(message);
      this.buffer = ''; // Clear buffer after successful parse
    }

    // Schedule flush if not already scheduled
    if (!this.flushTimer && this.pendingMessages.length > 0) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  /**
   * Flush pending messages to the database
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingMessages.length === 0) {
      return;
    }

    const messages = [...this.pendingMessages];
    this.pendingMessages = [];

    // If we have a buffer that wasn't parsed, save it as raw output
    if (this.buffer.trim().length > 100) { // Only save substantial output
      messages.push({
        role: 'assistant',
        rawOutput: this.buffer.trim(),
      });
      this.buffer = '';
    }

    if (messages.length > 0) {
      await persistMessages(this.sessionId, messages);
    }
  }

  /**
   * Force flush and cleanup
   */
  async cleanup(): Promise<void> {
    // Capture any remaining buffer
    if (this.buffer.trim().length > 0) {
      this.pendingMessages.push({
        role: 'assistant',
        rawOutput: this.buffer.trim(),
      });
      this.buffer = '';
    }
    await this.flush();
  }
}
