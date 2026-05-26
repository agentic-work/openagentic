/**
 * AWCode Storage Service
 * Handles persistence of AWCode CLI sessions and messages to PostgreSQL
 *
 * This service stores:
 * - AWCode PTY session metadata (workspace, model, status)
 * - All messages exchanged between user and AI
 * - Tool calls, file operations, and execution results
 * - Token usage and cost tracking
 *
 * Also integrates with Milvus for semantic knowledge indexing
 */

import { PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { awcodeSessionIndexer } from './AWCodeSessionIndexer.js';

export interface AWCodeSessionData {
  id: string;
  userId: string;
  workspacePath?: string;
  model?: string;
  pid?: number;
  status?: 'running' | 'stopped' | 'error';
  title?: string;
  metadata?: Record<string, any>;
}

export interface AWCodeMessageData {
  sessionId: string;
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

export class AWCodeStorageService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = prisma;
  }

  /**
   * Create a new AWCode session in the database
   */
  async createSession(data: AWCodeSessionData): Promise<any> {
    try {
      // Use upsert so a second call with the same id (e.g. when the
      // openagentic-manager reconnects a user to their existing exec pod
      // and returns the same sessionId) doesn't blow up on a
      // Unique-constraint violation. For existing rows we touch
      // last_activity + status so reloads still reflect liveness.
      const session = await this.prisma.aWCodeSession.upsert({
        where: { id: data.id },
        create: {
          id: data.id,
          user_id: data.userId,
          workspace_path: data.workspacePath,
          model: data.model,
          pid: data.pid,
          status: data.status || 'running',
          title: data.title,
          metadata: data.metadata || {},
        },
        update: {
          status: data.status || 'running',
          last_activity: new Date(),
          ...(data.title ? { title: data.title } : {}),
          ...(data.metadata ? { metadata: data.metadata } : {}),
        },
      });

      console.log(`[AWCodeStorage] Upserted session ${data.id} for user ${data.userId}`);
      return session;
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to create session:`, error);
      throw error;
    }
  }

  /**
   * Update session status and metadata
   */
  async updateSession(
    sessionId: string,
    data: Partial<{
      status: string;
      title: string;
      summary: string;
      messageCount: number;
      totalTokens: number;
      totalCost: number;
      toolCallsCount: number;
      filesModified: string[];
      stoppedAt: Date;
      lastActivity: Date;
      metadata: Record<string, any>;
    }>
  ): Promise<any> {
    try {
      const updateData: any = {};

      if (data.status !== undefined) updateData.status = data.status;
      if (data.title !== undefined) updateData.title = data.title;
      if (data.summary !== undefined) updateData.summary = data.summary;
      if (data.messageCount !== undefined) updateData.message_count = data.messageCount;
      if (data.totalTokens !== undefined) updateData.total_tokens = data.totalTokens;
      if (data.totalCost !== undefined) updateData.total_cost = data.totalCost;
      if (data.toolCallsCount !== undefined) updateData.tool_calls_count = data.toolCallsCount;
      if (data.filesModified !== undefined) updateData.files_modified = data.filesModified;
      if (data.stoppedAt !== undefined) updateData.stopped_at = data.stoppedAt;
      if (data.lastActivity !== undefined) updateData.last_activity = data.lastActivity;
      if (data.metadata !== undefined) updateData.metadata = data.metadata;

      const session = await this.prisma.aWCodeSession.update({
        where: { id: sessionId },
        data: updateData,
      });

      return session;
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to update session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<any> {
    try {
      return await this.prisma.aWCodeSession.findUnique({
        where: { id: sessionId },
        include: { messages: true },
      });
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string, limit = 50): Promise<any[]> {
    try {
      return await this.prisma.aWCodeSession.findMany({
        where: { user_id: userId },
        orderBy: { started_at: 'desc' },
        take: limit,
        include: {
          _count: { select: { messages: true } },
        },
      });
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get sessions for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get all active sessions (for admin monitoring)
   */
  async getActiveSessions(): Promise<any[]> {
    try {
      return await this.prisma.aWCodeSession.findMany({
        where: { status: 'running' },
        orderBy: { last_activity: 'desc' },
        include: {
          user: { select: { id: true, email: true, name: true } },
          _count: { select: { messages: true } },
        },
      });
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get active sessions:`, error);
      return [];
    }
  }

  /**
   * Add a message to a session
   */
  async addMessage(data: AWCodeMessageData): Promise<any> {
    try {
      const message = await this.prisma.aWCodeMessage.create({
        data: {
          session_id: data.sessionId,
          role: data.role,
          content: data.content,
          raw_output: data.rawOutput,
          model: data.model,
          tokens: data.tokens || 0,
          tokens_input: data.tokensInput || 0,
          tokens_output: data.tokensOutput || 0,
          cost: data.cost || 0,
          metadata: data.metadata || {},
          tool_calls: data.toolCalls,
          tool_results: data.toolResults,
          tool_name: data.toolName,
          files_read: data.filesRead || [],
          files_written: data.filesWritten || [],
          thinking: data.thinking,
          duration_ms: data.durationMs,
        },
      });

      // Update session metrics
      await this.prisma.aWCodeSession.update({
        where: { id: data.sessionId },
        data: {
          message_count: { increment: 1 },
          total_tokens: { increment: data.tokens || 0 },
          last_activity: new Date(),
          ...(data.toolCalls?.length && { tool_calls_count: { increment: data.toolCalls.length } }),
        },
      });

      return message;
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to add message:`, error);
      throw error;
    }
  }

  /**
   * Get messages for a session
   */
  async getSessionMessages(sessionId: string, limit = 100): Promise<any[]> {
    try {
      return await this.prisma.aWCodeMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'asc' },
        take: limit,
      });
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get messages for session ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Get recent messages for context
   */
  async getRecentMessages(sessionId: string, count = 20): Promise<any[]> {
    try {
      const messages = await this.prisma.aWCodeMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'desc' },
        take: count,
      });
      return messages.reverse(); // Return in chronological order
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get recent messages:`, error);
      return [];
    }
  }

  /**
   * Stop a session and trigger Milvus indexing for knowledge base
   */
  async stopSession(sessionId: string): Promise<any> {
    try {
      const session = await this.prisma.aWCodeSession.update({
        where: { id: sessionId },
        data: {
          status: 'stopped',
          stopped_at: new Date(),
        },
      });

      // Index session to Milvus for semantic search (async, non-blocking)
      this.indexSessionToMilvus(sessionId).catch(err => {
        console.error(`[AWCodeStorage] Milvus indexing failed for ${sessionId}:`, err);
      });

      return session;
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to stop session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Index a completed session to Milvus for knowledge retrieval
   */
  private async indexSessionToMilvus(sessionId: string): Promise<void> {
    try {
      console.log(`[AWCodeStorage] Indexing session ${sessionId} to Milvus...`);
      const success = await awcodeSessionIndexer.indexSession(sessionId);
      if (success) {
        console.log(`[AWCodeStorage] Session ${sessionId} indexed to Milvus successfully`);
      } else {
        console.warn(`[AWCodeStorage] Session ${sessionId} indexing returned false`);
      }
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to index session ${sessionId} to Milvus:`, error);
    }
  }

  /**
   * Get relevant context from past sessions for a new query
   */
  async getRelevantContext(userId: string, query: string, workspacePath?: string): Promise<string> {
    try {
      return await awcodeSessionIndexer.getRelevantContext(userId, query, workspacePath);
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get relevant context:`, error);
      return '';
    }
  }

  /**
   * Search knowledge base for similar solutions
   */
  async searchKnowledge(
    query: string,
    options: {
      userId?: string;
      contentTypes?: string[];
      limit?: number;
      threshold?: number;
    } = {}
  ): Promise<any[]> {
    try {
      return await awcodeSessionIndexer.searchKnowledge(query, options);
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to search knowledge:`, error);
      return [];
    }
  }

  /**
   * Search shared solutions across all users
   */
  async searchSharedSolutions(
    query: string,
    options: { category?: string; limit?: number; threshold?: number } = {}
  ): Promise<any[]> {
    try {
      return await awcodeSessionIndexer.searchSharedSolutions(query, options);
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to search shared solutions:`, error);
      return [];
    }
  }

  /**
   * Share a solution to the shared knowledge base
   */
  async shareSolution(
    sessionId: string,
    userId: string,
    problem: string,
    solution: string,
    category: string,
    tags: string[] = []
  ): Promise<boolean> {
    try {
      return await awcodeSessionIndexer.shareSolution(
        sessionId,
        userId,
        problem,
        solution,
        category,
        tags
      );
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to share solution:`, error);
      return false;
    }
  }

  /**
   * Get knowledge base statistics
   */
  async getKnowledgeStats(): Promise<{ sessions: number; solutions: number }> {
    try {
      return await awcodeSessionIndexer.getStats();
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get knowledge stats:`, error);
      return { sessions: 0, solutions: 0 };
    }
  }

  /**
   * Generate title from first user message
   */
  async generateTitle(sessionId: string): Promise<string | null> {
    try {
      const firstMessage = await this.prisma.aWCodeMessage.findFirst({
        where: { session_id: sessionId, role: 'user' },
        orderBy: { created_at: 'asc' },
      });

      if (!firstMessage?.content) return null;

      // Simple title generation - take first 50 chars of first user message
      const title = firstMessage.content.substring(0, 50).trim();
      const cleanTitle = title.replace(/\n/g, ' ').trim() + (firstMessage.content.length > 50 ? '...' : '');

      await this.prisma.aWCodeSession.update({
        where: { id: sessionId },
        data: { title: cleanTitle },
      });

      return cleanTitle;
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to generate title:`, error);
      return null;
    }
  }

  /**
   * Get session statistics for admin dashboard
   */
  async getSessionStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    totalMessages: number;
    totalTokens: number;
  }> {
    try {
      const [sessionStats, messageStats] = await Promise.all([
        this.prisma.aWCodeSession.aggregate({
          _count: { id: true },
          _sum: { total_tokens: true },
        }),
        this.prisma.aWCodeSession.count({
          where: { status: 'running' },
        }),
      ]);

      const messageCount = await this.prisma.aWCodeMessage.count();

      return {
        totalSessions: sessionStats._count.id || 0,
        activeSessions: messageStats,
        totalMessages: messageCount,
        totalTokens: sessionStats._sum.total_tokens || 0,
      };
    } catch (error) {
      console.error(`[AWCodeStorage] Failed to get session stats:`, error);
      return {
        totalSessions: 0,
        activeSessions: 0,
        totalMessages: 0,
        totalTokens: 0,
      };
    }
  }
}

// Export singleton instance
export const awcodeStorageService = new AWCodeStorageService();
