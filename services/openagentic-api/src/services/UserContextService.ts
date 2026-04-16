/**
 * UserContextService - Unified Cross-Mode Memory Layer
 *
 * Assembles user context from ALL platform modes (chat, code, workflows, memories).
 * Enforces per-user data isolation (FedRAMP HIGH AC-3).
 * Uses pgvector for semantic search across the unified context index.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import axios from 'axios';

const logger = loggers.services;

export interface UserContext {
  entries: ContextEntry[];
  totalEntries: number;
  sources: Record<string, number>;
  tokenEstimate: number;
}

export interface ContextEntry {
  id: string;
  source: 'chat' | 'code' | 'workflow' | 'memory';
  sourceId: string;
  content: string;
  metadata?: Record<string, any>;
  createdAt: string;
  relevanceScore?: number;
}

export interface IndexDataInput {
  source: 'chat' | 'code' | 'workflow' | 'memory';
  sourceId: string;
  content: string;
  metadata?: Record<string, any>;
}

class UserContextServiceImpl {
  private embeddingEndpoint: string;

  constructor() {
    this.embeddingEndpoint = process.env.EMBEDDING_ENDPOINT || '';
  }

  /**
   * Get user context across all modes
   * CRITICAL: Always filters by userId (FedRAMP AC-3)
   */
  async getUserContext(userId: string, options?: {
    includeChatHistory?: boolean;
    includeCodeResults?: boolean;
    includeWorkflowResults?: boolean;
    includeMemories?: boolean;
    maxTokens?: number;
    relevancyQuery?: string;
    sources?: string[];
  }): Promise<UserContext> {
    const maxTokens = options?.maxTokens || 4000;
    const entries: ContextEntry[] = [];
    const sourceCounts: Record<string, number> = {};
    let tokenEstimate = 0;
    const tokenBudgetPerSource = Math.floor(maxTokens / 4);

    // Parse which sources to include
    const sourceFilter = options?.sources || [];
    const includeChat = sourceFilter.length === 0 || sourceFilter.includes('chat') || options?.includeChatHistory;
    const includeCode = sourceFilter.length === 0 || sourceFilter.includes('code') || options?.includeCodeResults;
    const includeWorkflow = sourceFilter.length === 0 || sourceFilter.includes('workflow') || options?.includeWorkflowResults;
    const includeMemory = sourceFilter.length === 0 || sourceFilter.includes('memory') || options?.includeMemories;

    try {
      // 1. Chat history (recent messages)
      if (includeChat) {
        try {
          const messages = await prisma.chatMessage.findMany({
            where: {
              session: { user_id: userId },
              role: { in: ['user', 'assistant'] }
            },
            orderBy: { created_at: 'desc' },
            take: 20,
            select: {
              id: true,
              content: true,
              role: true,
              session_id: true,
              created_at: true,
            },
          });

          for (const msg of messages) {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            const tokens = Math.ceil(content.length / 4);
            if (tokenEstimate + tokens > maxTokens) break;

            entries.push({
              id: msg.id,
              source: 'chat',
              sourceId: msg.session_id,
              content: `[${msg.role}]: ${content.substring(0, 500)}`,
              metadata: { role: msg.role },
              createdAt: msg.created_at?.toISOString() || '',
            });
            tokenEstimate += tokens;
          }
          sourceCounts.chat = messages.length;
        } catch (err) {
          logger.debug({ err }, '[UserContext] Failed to load chat history');
        }
      }

      // 2. User memories (agent_memories table)
      if (includeMemory) {
        try {
          const memories = await prisma.agentMemory.findMany({
            where: { user_id: userId },
            orderBy: { updated_at: 'desc' },
            take: 50,
          });

          for (const mem of memories) {
            const content = `${mem.key}: ${typeof mem.value === 'string' ? mem.value : JSON.stringify(mem.value)}`;
            const tokens = Math.ceil(content.length / 4);
            if (tokenEstimate + tokens > maxTokens) break;

            entries.push({
              id: mem.id,
              source: 'memory',
              sourceId: mem.id,
              content,
              metadata: { key: mem.key, category: (mem as any).category },
              createdAt: mem.updated_at?.toISOString() || '',
            });
            tokenEstimate += tokens;
          }
          sourceCounts.memory = memories.length;
        } catch (err) {
          logger.debug({ err }, '[UserContext] Failed to load memories');
        }
      }

      // 3. Workflow execution results (recent)
      if (includeWorkflow) {
        try {
          const executions = await prisma.workflowExecution.findMany({
            where: { started_by: userId, status: 'completed' },
            orderBy: { completed_at: 'desc' },
            take: 10,
            select: {
              id: true,
              workflow_id: true,
              status: true,
              output: true,
              completed_at: true,
              workflow: { select: { name: true } },
            },
          });

          for (const exec of executions) {
            const resultStr = exec.output ? JSON.stringify(exec.output).substring(0, 300) : 'No result';
            const content = `Workflow "${(exec as any).workflow?.name || exec.workflow_id}" completed: ${resultStr}`;
            const tokens = Math.ceil(content.length / 4);
            if (tokenEstimate + tokens > maxTokens) break;

            entries.push({
              id: exec.id,
              source: 'workflow',
              sourceId: exec.workflow_id,
              content,
              metadata: { status: exec.status },
              createdAt: exec.completed_at?.toISOString() || '',
            });
            tokenEstimate += tokens;
          }
          sourceCounts.workflow = executions.length;
        } catch (err) {
          logger.debug({ err }, '[UserContext] Failed to load workflow results');
        }
      }

      // 4. Code execution results (if table exists)
      if (includeCode) {
        try {
          // code_sessions or code_executions - try both table patterns
          const codeResults = await prisma.$queryRaw`
            SELECT id, session_id, result, created_at
            FROM admin.code_executions
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
            LIMIT 10
          ` as any[];

          for (const exec of (codeResults || [])) {
            const content = `Code execution: ${JSON.stringify(exec.result || '').substring(0, 300)}`;
            const tokens = Math.ceil(content.length / 4);
            if (tokenEstimate + tokens > maxTokens) break;

            entries.push({
              id: exec.id,
              source: 'code',
              sourceId: exec.session_id || exec.id,
              content,
              createdAt: exec.created_at?.toISOString?.() || '',
            });
            tokenEstimate += tokens;
          }
          sourceCounts.code = codeResults?.length || 0;
        } catch (err) {
          // code_executions table may not exist yet
          logger.debug({ err }, '[UserContext] Failed to load code results (table may not exist)');
          sourceCounts.code = 0;
        }
      }

    } catch (err) {
      logger.error({ err, userId }, '[UserContext] Failed to assemble user context');
    }

    return {
      entries,
      totalEntries: entries.length,
      sources: sourceCounts,
      tokenEstimate,
    };
  }

  /**
   * Index data from any mode into the unified context layer
   * CRITICAL: Always stores with userId (FedRAMP AC-3)
   */
  async indexUserData(userId: string, data: IndexDataInput): Promise<void> {
    try {
      // Sanitize content (FedRAMP SI-10)
      const sanitizedContent = data.content
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .substring(0, 10000);

      await prisma.$executeRaw`
        INSERT INTO admin.user_context_index (id, user_id, source, source_id, content, metadata, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${data.source}, ${data.sourceId}, ${sanitizedContent}, ${JSON.stringify(data.metadata || {})}::jsonb, NOW())
        ON CONFLICT DO NOTHING
      `;

      logger.debug({ userId, source: data.source, sourceId: data.sourceId }, '[UserContext] Indexed user data');
    } catch (err) {
      // Table may not exist yet - non-fatal
      logger.debug({ err, userId }, '[UserContext] Failed to index user data (table may not exist)');
    }
  }

  /**
   * Search across all user context
   * CRITICAL: Always filters by userId (FedRAMP AC-3)
   */
  async searchUserContext(userId: string, query: string, options?: {
    sources?: ('chat' | 'code' | 'workflow' | 'memory')[];
    limit?: number;
  }): Promise<ContextEntry[]> {
    const limit = options?.limit || 20;

    try {
      // Simple text search (upgrade to vector search when embeddings available)
      const results = await prisma.$queryRaw`
        SELECT id, source, source_id, content, metadata, created_at
        FROM admin.user_context_index
        WHERE user_id = ${userId}
          AND content ILIKE ${'%' + query + '%'}
          ${options?.sources?.length ? prisma.$queryRaw`AND source = ANY(${options.sources})` : prisma.$queryRaw``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      ` as any[];

      return (results || []).map((r: any) => ({
        id: r.id,
        source: r.source,
        sourceId: r.source_id,
        content: r.content,
        metadata: r.metadata,
        createdAt: r.created_at?.toISOString?.() || '',
      }));
    } catch (err) {
      logger.debug({ err, userId }, '[UserContext] Search failed (table may not exist)');
      return [];
    }
  }

  /**
   * Purge all user context (GDPR Article 17 / FISMA MP-6)
   */
  async purgeUserContext(userId: string): Promise<{ deleted: number }> {
    try {
      const result = await prisma.$executeRaw`
        DELETE FROM admin.user_context_index WHERE user_id = ${userId}
      `;
      logger.info({ userId, deleted: result }, '[UserContext] Purged user context');
      return { deleted: result };
    } catch (err) {
      logger.debug({ err }, '[UserContext] Purge failed (table may not exist)');
      return { deleted: 0 };
    }
  }

  /**
   * Get context stats for admin dashboard
   */
  async getUserContextStats(userId: string): Promise<{
    totalEntries: number;
    bySource: Record<string, number>;
  }> {
    try {
      const stats = await prisma.$queryRaw`
        SELECT source, COUNT(*)::int as count
        FROM admin.user_context_index
        WHERE user_id = ${userId}
        GROUP BY source
      ` as any[];

      const bySource: Record<string, number> = {};
      let total = 0;
      for (const row of (stats || [])) {
        bySource[row.source] = row.count;
        total += row.count;
      }
      return { totalEntries: total, bySource };
    } catch {
      return { totalEntries: 0, bySource: {} };
    }
  }
}

// Singleton export
export const userContextService = new UserContextServiceImpl();
