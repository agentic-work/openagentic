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
 * Code Mode Session Service
 * Manages code mode sessions with full message persistence and context windowing
 *
 * Features:
 * - Session creation/resumption with AWCodeSession storage
 * - Message persistence to AWCodeMessage
 * - Context windowing with automatic summarization
 * - Token counting and cost tracking
 * - Session history loading with context reconstruction
 */

import { prisma } from '../utils/prisma.js';
import { awcodeStorageService, AWCodeMessageData } from './AWCodeStorageService.js';
import { ProviderManager } from './llm-providers/ProviderManager.js';
import { MODELS } from '../config/models.js';
import { getContextWindow } from '../config/model-catalogs.js';
import type { Logger } from 'pino';
import { v4 as uuidv4 } from 'uuid';

// Context window configuration
const CONTEXT_CONFIG = {
  // Default max tokens for context (can be overridden per model)
  DEFAULT_MAX_CONTEXT_TOKENS: 128000,
  // Trigger compaction at this percentage of max context
  COMPACTION_THRESHOLD: 0.75,
  // Keep this many recent messages after compaction
  RECENT_MESSAGES_TO_KEEP: 10,
  // Minimum messages before considering compaction
  MIN_MESSAGES_FOR_COMPACTION: 20,
  // Target token count after compaction
  TARGET_COMPACTION_RATIO: 0.4,
};

// Model context windows are now centralized in config/model-catalogs.ts
// Use getContextWindow(modelId) instead of a local map.

export interface CodeModeMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[];  // Can be string or Anthropic content blocks
  toolCalls?: any[];
  toolCallId?: string;
  thinking?: string;
  tokensInput?: number;
  tokensOutput?: number;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface CodeModeSession {
  id: string;
  userId: string;
  model: string;
  workspacePath: string;
  title?: string;
  status: 'active' | 'idle' | 'stopped' | 'error';
  messageCount: number;
  totalTokens: number;
  createdAt: Date;
  lastActivity: Date;
}

export interface ContextWindow {
  messages: CodeModeMessage[];
  totalTokens: number;
  isCompacted: boolean;
  summaryIncluded: boolean;
}

export class CodeModeSessionService {
  private logger: Logger;
  private providerManager: ProviderManager;

  constructor(logger: Logger, providerManager: ProviderManager) {
    this.logger = logger;
    this.providerManager = providerManager;
  }

  /**
   * Create a new code mode session
   */
  async createSession(
    userId: string,
    options: {
      model?: string;
      workspacePath?: string;
      title?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<CodeModeSession> {
    const sessionId = uuidv4();
    const model = options.model || process.env.DEFAULT_CODE_MODEL || MODELS.code;
    const workspacePath = options.workspacePath || '/workspace';

    this.logger.info({ sessionId, userId, model, workspacePath }, '[CodeModeSession] Creating new session');

    try {
      await awcodeStorageService.createSession({
        id: sessionId,
        userId,
        workspacePath,
        model,
        status: 'running',
        title: options.title,
        metadata: options.metadata,
      });

      return {
        id: sessionId,
        userId,
        model,
        workspacePath,
        title: options.title,
        status: 'active',
        messageCount: 0,
        totalTokens: 0,
        createdAt: new Date(),
        lastActivity: new Date(),
      };
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, '[CodeModeSession] Failed to create session');
      throw error;
    }
  }

  /**
   * Get an existing session
   */
  async getSession(sessionId: string, userId?: string): Promise<CodeModeSession | null> {
    try {
      const session = await awcodeStorageService.getSession(sessionId);

      if (!session) return null;

      // Verify user ownership if userId provided
      if (userId && session.user_id !== userId) {
        this.logger.warn({ sessionId, userId, ownerId: session.user_id }, '[CodeModeSession] User does not own session');
        return null;
      }

      return {
        id: session.id,
        userId: session.user_id,
        model: session.model || MODELS.code,
        workspacePath: session.workspace_path || '/workspace',
        title: session.title,
        status: session.status as any,
        messageCount: session.message_count || 0,
        totalTokens: session.total_tokens || 0,
        createdAt: session.started_at || session.created_at,
        lastActivity: session.last_activity,
      };
    } catch (error) {
      this.logger.error({ error, sessionId }, '[CodeModeSession] Failed to get session');
      return null;
    }
  }

  /**
   * Get user's sessions
   */
  async getUserSessions(userId: string, limit = 50): Promise<CodeModeSession[]> {
    try {
      const sessions = await awcodeStorageService.getUserSessions(userId, limit);

      return sessions.map(s => ({
        id: s.id,
        userId: s.user_id,
        model: s.model || 'unknown',
        workspacePath: s.workspace_path || '/workspace',
        title: s.title,
        status: s.status as any,
        messageCount: s.message_count || s._count?.messages || 0,
        totalTokens: s.total_tokens || 0,
        createdAt: s.started_at || s.created_at,
        lastActivity: s.last_activity,
      }));
    } catch (error) {
      this.logger.error({ error, userId }, '[CodeModeSession] Failed to get user sessions');
      return [];
    }
  }

  /**
   * Add a message to a session
   */
  async addMessage(
    sessionId: string,
    message: Omit<CodeModeMessage, 'id' | 'createdAt'>
  ): Promise<CodeModeMessage> {
    const messageId = uuidv4();

    this.logger.debug({
      sessionId,
      role: message.role,
      contentLength: typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content).length,
      hasToolCalls: !!message.toolCalls?.length,
    }, '[CodeModeSession] Adding message');

    try {
      const messageData: AWCodeMessageData = {
        sessionId,
        role: message.role,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        tokensInput: message.tokensInput,
        tokensOutput: message.tokensOutput,
        tokens: (message.tokensInput || 0) + (message.tokensOutput || 0),
        toolCalls: message.toolCalls,
        toolName: message.toolCallId ? 'tool_response' : undefined,
        thinking: message.thinking,
        metadata: {
          ...message.metadata,
          contentBlocks: Array.isArray(message.content) ? message.content : undefined,
        },
      };

      await awcodeStorageService.addMessage(messageData);

      return {
        id: messageId,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
        toolCallId: message.toolCallId,
        thinking: message.thinking,
        tokensInput: message.tokensInput,
        tokensOutput: message.tokensOutput,
        createdAt: new Date(),
        metadata: message.metadata,
      };
    } catch (error) {
      this.logger.error({ error, sessionId }, '[CodeModeSession] Failed to add message');
      throw error;
    }
  }

  /**
   * Get messages for a session with optional context windowing
   */
  async getSessionMessages(
    sessionId: string,
    options: {
      limit?: number;
      includeCompacted?: boolean;
      forLLM?: boolean;  // If true, applies context windowing
    } = {}
  ): Promise<CodeModeMessage[]> {
    try {
      const rawMessages = await awcodeStorageService.getSessionMessages(sessionId, options.limit || 1000);

      const messages: CodeModeMessage[] = rawMessages.map(m => ({
        id: m.id,
        role: m.role as any,
        content: this.parseContent(m.content, m.metadata),
        toolCalls: m.tool_calls,
        toolCallId: m.tool_name === 'tool_response' ? m.metadata?.toolCallId : undefined,
        thinking: m.thinking,
        tokensInput: m.tokens_input,
        tokensOutput: m.tokens_output,
        createdAt: m.created_at,
        metadata: m.metadata,
      }));

      // If not for LLM context, return all messages
      if (!options.forLLM) {
        return messages;
      }

      // Apply context windowing for LLM
      const session = await this.getSession(sessionId);
      const contextWindow = await this.getContextWindow(sessionId, session?.model);

      return contextWindow.messages;
    } catch (error) {
      this.logger.error({ error, sessionId }, '[CodeModeSession] Failed to get session messages');
      return [];
    }
  }

  /**
   * Parse stored content back to original format
   */
  private parseContent(content: string | null, metadata: any): string | any[] {
    if (!content) return '';

    // Check if content blocks are stored in metadata
    if (metadata?.contentBlocks && Array.isArray(metadata.contentBlocks)) {
      return metadata.contentBlocks;
    }

    // Try to parse as JSON (content blocks)
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Not JSON, return as string
    }

    return content;
  }

  /**
   * Get context window with automatic compaction if needed
   */
  async getContextWindow(
    sessionId: string,
    model?: string
  ): Promise<ContextWindow> {
    const maxTokens = this.getMaxContextTokens(model);
    const compactionThreshold = Math.floor(maxTokens * CONTEXT_CONFIG.COMPACTION_THRESHOLD);

    // Get all messages
    const allMessages = await this.getSessionMessages(sessionId, { forLLM: false });

    // Calculate total tokens
    let totalTokens = 0;
    for (const msg of allMessages) {
      totalTokens += (msg.tokensInput || 0) + (msg.tokensOutput || 0);
      // Estimate if no token count
      if (!msg.tokensInput && !msg.tokensOutput) {
        const contentLength = typeof msg.content === 'string'
          ? msg.content.length
          : JSON.stringify(msg.content).length;
        totalTokens += Math.ceil(contentLength / 4); // Rough estimate
      }
    }

    this.logger.debug({
      sessionId,
      totalTokens,
      maxTokens,
      compactionThreshold,
      messageCount: allMessages.length,
    }, '[CodeModeSession] Context window status');

    // Check if compaction needed
    if (totalTokens > compactionThreshold && allMessages.length >= CONTEXT_CONFIG.MIN_MESSAGES_FOR_COMPACTION) {
      return await this.compactContext(sessionId, allMessages, maxTokens, model);
    }

    return {
      messages: allMessages,
      totalTokens,
      isCompacted: false,
      summaryIncluded: false,
    };
  }

  /**
   * Compact context by summarizing older messages
   */
  private async compactContext(
    sessionId: string,
    messages: CodeModeMessage[],
    maxTokens: number,
    model?: string
  ): Promise<ContextWindow> {
    const targetTokens = Math.floor(maxTokens * CONTEXT_CONFIG.TARGET_COMPACTION_RATIO);
    const recentCount = CONTEXT_CONFIG.RECENT_MESSAGES_TO_KEEP;

    this.logger.info({
      sessionId,
      totalMessages: messages.length,
      targetTokens,
      recentCount,
    }, '[CodeModeSession] Compacting context');

    // Split messages: older ones to summarize, recent ones to keep
    const olderMessages = messages.slice(0, -recentCount);
    const recentMessages = messages.slice(-recentCount);

    // Check if there's an existing summary in older messages
    const existingSummary = olderMessages.find(m =>
      m.role === 'system' && m.metadata?.isCompactionSummary
    );

    // Generate summary of older messages
    const summaryContent = await this.generateContextSummary(
      olderMessages.filter(m => !m.metadata?.isCompactionSummary),
      existingSummary?.content as string,
      model
    );

    // Create summary message
    const summaryMessage: CodeModeMessage = {
      id: uuidv4(),
      role: 'system',
      content: `[Conversation Summary]\n${summaryContent}\n\n[Recent conversation continues below]`,
      createdAt: new Date(),
      metadata: {
        isCompactionSummary: true,
        summarizedMessageCount: olderMessages.length,
        compactedAt: new Date().toISOString(),
      },
    };

    // Store the compaction summary as a message
    await this.addMessage(sessionId, {
      role: 'system',
      content: summaryMessage.content,
      metadata: summaryMessage.metadata,
    });

    const compactedMessages = [summaryMessage, ...recentMessages];

    // Estimate new token count
    const summaryTokens = Math.ceil(summaryContent.length / 4);
    let recentTokens = 0;
    for (const msg of recentMessages) {
      recentTokens += (msg.tokensInput || 0) + (msg.tokensOutput || 0);
      if (!msg.tokensInput && !msg.tokensOutput) {
        const len = typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;
        recentTokens += Math.ceil(len / 4);
      }
    }

    this.logger.info({
      sessionId,
      originalMessages: messages.length,
      compactedMessages: compactedMessages.length,
      estimatedTokens: summaryTokens + recentTokens,
    }, '[CodeModeSession] Context compacted');

    return {
      messages: compactedMessages,
      totalTokens: summaryTokens + recentTokens,
      isCompacted: true,
      summaryIncluded: true,
    };
  }

  /**
   * Generate a summary of conversation history
   */
  private async generateContextSummary(
    messages: CodeModeMessage[],
    existingSummary: string | undefined,
    model?: string
  ): Promise<string> {
    // Build conversation text for summarization
    const conversationText = messages
      .filter(m => m.role !== 'system' || !m.metadata?.isCompactionSummary)
      .map(m => {
        const content = typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content);
        const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role;
        return `${role}: ${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`;
      })
      .join('\n\n');

    const summaryPrompt = existingSummary
      ? `You are summarizing a coding conversation. Here is the previous summary:\n\n${existingSummary}\n\nAnd here are new messages to incorporate:\n\n${conversationText}\n\nCreate an updated, comprehensive summary that captures:\n1. What the user is trying to accomplish\n2. Key technical decisions and implementations\n3. Files created or modified\n4. Important context for continuing the work\n\nKeep the summary concise but informative (max 500 words).`
      : `Summarize this coding conversation, capturing:\n1. What the user is trying to accomplish\n2. Key technical decisions and implementations\n3. Files created or modified\n4. Important context for continuing the work\n\nConversation:\n${conversationText}\n\nProvide a concise summary (max 500 words).`;

    try {
      // Use a fast model for summarization
      const summaryModel = process.env.COMPACTION_MODEL || MODELS.compaction;

      const response = await this.providerManager.createCompletion({
        model: summaryModel,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that summarizes coding conversations concisely.' },
          { role: 'user', content: summaryPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.3,
        stream: false,
      }) as any;

      return response.choices?.[0]?.message?.content || 'Summary generation failed.';
    } catch (error) {
      this.logger.error({ error }, '[CodeModeSession] Failed to generate summary');
      // Fallback: create a basic summary
      return `Conversation with ${messages.length} messages. Topics discussed: coding assistance.`;
    }
  }

  /**
   * Get max context tokens for a model
   */
  private getMaxContextTokens(model?: string): number {
    if (!model) return CONTEXT_CONFIG.DEFAULT_MAX_CONTEXT_TOKENS;
    return getContextWindow(model);
  }

  /**
   * Update session status
   */
  async updateSessionStatus(
    sessionId: string,
    status: 'active' | 'idle' | 'stopped' | 'error'
  ): Promise<void> {
    try {
      await awcodeStorageService.updateSession(sessionId, {
        status,
        lastActivity: new Date(),
        ...(status === 'stopped' && { stoppedAt: new Date() }),
      });
    } catch (error) {
      this.logger.error({ error, sessionId, status }, '[CodeModeSession] Failed to update status');
    }
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    this.logger.info({ sessionId }, '[CodeModeSession] Stopping session');
    await awcodeStorageService.stopSession(sessionId);
  }

  /**
   * Delete a session (soft delete)
   */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId, userId);
      if (!session) {
        return false;
      }

      await awcodeStorageService.updateSession(sessionId, {
        status: 'stopped',
        stoppedAt: new Date(),
      });

      this.logger.info({ sessionId, userId }, '[CodeModeSession] Session deleted');
      return true;
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, '[CodeModeSession] Failed to delete session');
      return false;
    }
  }

  /**
   * Resume a session - loads context window for continuation
   */
  async resumeSession(
    sessionId: string,
    userId: string
  ): Promise<{
    session: CodeModeSession;
    contextWindow: ContextWindow;
  } | null> {
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return null;
    }

    // Update session status
    await this.updateSessionStatus(sessionId, 'active');

    // Get context window with messages
    const contextWindow = await this.getContextWindow(sessionId, session.model);

    this.logger.info({
      sessionId,
      messageCount: contextWindow.messages.length,
      isCompacted: contextWindow.isCompacted,
      totalTokens: contextWindow.totalTokens,
    }, '[CodeModeSession] Session resumed');

    return {
      session: { ...session, status: 'active' },
      contextWindow,
    };
  }

  /**
   * Estimate tokens for content
   */
  estimateTokens(content: string | any[]): number {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    // Rough estimate: ~4 chars per token for English text
    return Math.ceil(text.length / 4);
  }
}

// Export singleton factory
let instance: CodeModeSessionService | null = null;

export function getCodeModeSessionService(
  logger: Logger,
  providerManager: ProviderManager
): CodeModeSessionService {
  if (!instance) {
    instance = new CodeModeSessionService(logger, providerManager);
  }
  return instance;
}
