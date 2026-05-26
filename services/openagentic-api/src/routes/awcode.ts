/**
 * AWCode API Routes (Fastify)
 * Internal API endpoints for AWCode manager to persist sessions and messages
 *
 * These endpoints are called by the awcode-manager service to:
 * - Create/update sessions when PTY processes are spawned
 * - Store messages as they're sent/received
 * - Update session status on exit
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { awcodeStorageService, AWCodeSessionData, AWCodeMessageData } from '../services/AWCodeStorageService.js';

export default async function awcodeRoutes(fastify: FastifyInstance) {
  /**
   * POST /sessions
   * Create a new AWCode session (called when PTY is spawned)
   */
  fastify.post('/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const sessionData: AWCodeSessionData = {
        id: body.sessionId,
        userId: body.userId,
        workspacePath: body.workspacePath,
        model: body.model,
        pid: body.pid,
        status: body.status || 'running',
        title: body.title,
        metadata: body.metadata,
      };

      const session = await awcodeStorageService.createSession(sessionData);
      return { success: true, session };
    } catch (error: any) {
      console.error('[AWCode API] Failed to create session:', error);
      return reply.status(500).send({ error: error.message || 'Failed to create session' });
    }
  });

  /**
   * PATCH /sessions/:sessionId
   * Update session status/metadata
   */
  fastify.patch('/sessions/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as any;
      const updateData = {
        status: body.status,
        title: body.title,
        summary: body.summary,
        messageCount: body.messageCount,
        totalTokens: body.totalTokens,
        totalCost: body.totalCost,
        toolCallsCount: body.toolCallsCount,
        filesModified: body.filesModified,
        stoppedAt: body.stoppedAt ? new Date(body.stoppedAt) : undefined,
        lastActivity: body.lastActivity ? new Date(body.lastActivity) : new Date(),
        metadata: body.metadata,
      };

      const session = await awcodeStorageService.updateSession(sessionId, updateData);
      return { success: true, session };
    } catch (error: any) {
      console.error('[AWCode API] Failed to update session:', error);
      return reply.status(500).send({ error: error.message || 'Failed to update session' });
    }
  });

  /**
   * POST /sessions/:sessionId/stop
   * Stop a session (called when PTY exits)
   */
  fastify.post('/sessions/:sessionId/stop', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const session = await awcodeStorageService.stopSession(sessionId);
      return { success: true, session };
    } catch (error: any) {
      console.error('[AWCode API] Failed to stop session:', error);
      return reply.status(500).send({ error: error.message || 'Failed to stop session' });
    }
  });

  /**
   * GET /sessions/:sessionId
   * Get session with messages
   */
  fastify.get('/sessions/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const session = await awcodeStorageService.getSession(sessionId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      return { session };
    } catch (error: any) {
      console.error('[AWCode API] Failed to get session:', error);
      return reply.status(500).send({ error: error.message || 'Failed to get session' });
    }
  });

  /**
   * POST /sessions/:sessionId/messages
   * Add a message to a session
   */
  fastify.post('/sessions/:sessionId/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as any;
      const messageData: AWCodeMessageData = {
        sessionId,
        role: body.role,
        content: body.content,
        rawOutput: body.rawOutput,
        model: body.model,
        tokens: body.tokens,
        tokensInput: body.tokensInput,
        tokensOutput: body.tokensOutput,
        cost: body.cost,
        metadata: body.metadata,
        toolCalls: body.toolCalls,
        toolResults: body.toolResults,
        toolName: body.toolName,
        filesRead: body.filesRead,
        filesWritten: body.filesWritten,
        thinking: body.thinking,
        durationMs: body.durationMs,
      };

      const message = await awcodeStorageService.addMessage(messageData);
      return { success: true, message };
    } catch (error: any) {
      console.error('[AWCode API] Failed to add message:', error);
      return reply.status(500).send({ error: error.message || 'Failed to add message' });
    }
  });

  /**
   * POST /sessions/:sessionId/messages/batch
   * Add multiple messages at once (for efficiency)
   */
  fastify.post('/sessions/:sessionId/messages/batch', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as any;
      const messages: AWCodeMessageData[] = body.messages;

      if (!Array.isArray(messages)) {
        return reply.status(400).send({ error: 'messages must be an array' });
      }

      // Verify session exists before adding messages
      const session = await awcodeStorageService.getSession(sessionId);
      if (!session) {
        console.error(`[AWCode API] Session ${sessionId} not found, cannot add messages`);
        return reply.status(404).send({
          error: 'Session not found',
          message: `Session ${sessionId} does not exist. Create a session first.`,
          sessionId
        });
      }

      const results = [];
      for (const msg of messages) {
        const messageData: AWCodeMessageData = {
          ...msg,
          sessionId,
        };
        const message = await awcodeStorageService.addMessage(messageData);
        results.push(message);
      }

      return { success: true, messages: results, count: results.length };
    } catch (error: any) {
      console.error('[AWCode API] Failed to add batch messages:', error);
      return reply.status(500).send({ error: error.message || 'Failed to add messages' });
    }
  });

  /**
   * GET /sessions/:sessionId/messages
   * Get messages for a session
   */
  fastify.get('/sessions/:sessionId/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const query = request.query as { limit?: string; recent?: string };
      const limit = parseInt(query.limit || '100');

      let messages;
      if (query.recent === 'true') {
        messages = await awcodeStorageService.getRecentMessages(sessionId, limit);
      } else {
        messages = await awcodeStorageService.getSessionMessages(sessionId, limit);
      }

      return { messages };
    } catch (error: any) {
      console.error('[AWCode API] Failed to get messages:', error);
      return reply.status(500).send({ error: error.message || 'Failed to get messages' });
    }
  });

  /**
   * GET /users/:userId/sessions
   * Get sessions for a user
   */
  fastify.get('/users/:userId/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.params as { userId: string };
      const query = request.query as { limit?: string };
      const limit = parseInt(query.limit || '50');

      const sessions = await awcodeStorageService.getUserSessions(userId, limit);
      return { sessions };
    } catch (error: any) {
      console.error('[AWCode API] Failed to get user sessions:', error);
      return reply.status(500).send({ error: error.message || 'Failed to get sessions' });
    }
  });

  // ============================================================================
  // Knowledge Base Routes - Milvus Integration for Semantic Search
  // ============================================================================

  /**
   * POST /knowledge/search
   * Search the knowledge base for similar solutions
   */
  fastify.post('/knowledge/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { query, userId, contentTypes, limit = 10, threshold = 0.5 } = body;

      if (!query) {
        return reply.status(400).send({ error: 'query is required' });
      }

      const results = await awcodeStorageService.searchKnowledge(query, {
        userId,
        contentTypes,
        limit,
        threshold,
      });

      return { results, count: results.length };
    } catch (error: any) {
      console.error('[AWCode API] Knowledge search failed:', error);
      return reply.status(500).send({ error: error.message || 'Knowledge search failed' });
    }
  });

  /**
   * POST /knowledge/context
   * Get relevant context from past sessions for a new query
   */
  fastify.post('/knowledge/context', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { userId, query, workspacePath } = body;

      if (!userId || !query) {
        return reply.status(400).send({ error: 'userId and query are required' });
      }

      const context = await awcodeStorageService.getRelevantContext(userId, query, workspacePath);
      return { context, hasContext: context.length > 0 };
    } catch (error: any) {
      console.error('[AWCode API] Context retrieval failed:', error);
      return reply.status(500).send({ error: error.message || 'Context retrieval failed' });
    }
  });

  /**
   * POST /solutions/search
   * Search shared solutions across all users
   */
  fastify.post('/solutions/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { query, category, limit = 10, threshold = 0.5 } = body;

      if (!query) {
        return reply.status(400).send({ error: 'query is required' });
      }

      const results = await awcodeStorageService.searchSharedSolutions(query, {
        category,
        limit,
        threshold,
      });

      return { results, count: results.length };
    } catch (error: any) {
      console.error('[AWCode API] Solutions search failed:', error);
      return reply.status(500).send({ error: error.message || 'Solutions search failed' });
    }
  });

  /**
   * POST /solutions/share
   * Share a solution to the shared knowledge base
   */
  fastify.post('/solutions/share', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { sessionId, userId, problem, solution, category, tags = [] } = body;

      if (!sessionId || !userId || !problem || !solution || !category) {
        return reply.status(400).send({
          error: 'sessionId, userId, problem, solution, and category are required',
        });
      }

      const success = await awcodeStorageService.shareSolution(
        sessionId,
        userId,
        problem,
        solution,
        category,
        tags
      );

      return { success };
    } catch (error: any) {
      console.error('[AWCode API] Share solution failed:', error);
      return reply.status(500).send({ error: error.message || 'Share solution failed' });
    }
  });

  /**
   * GET /knowledge/stats
   * Get knowledge base statistics
   */
  fastify.get('/knowledge/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await awcodeStorageService.getKnowledgeStats();
      return stats;
    } catch (error: any) {
      console.error('[AWCode API] Failed to get knowledge stats:', error);
      return reply.status(500).send({ error: error.message || 'Failed to get stats' });
    }
  });

  /**
   * POST /sessions/:sessionId/index
   * Manually trigger indexing for a session (e.g., for re-indexing)
   */
  fastify.post('/sessions/:sessionId/index', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };

      // Import the indexer directly for manual indexing
      const { awcodeSessionIndexer } = await import('../services/AWCodeSessionIndexer.js');
      const success = await awcodeSessionIndexer.indexSession(sessionId);

      return { success, sessionId };
    } catch (error: any) {
      console.error('[AWCode API] Manual indexing failed:', error);
      return reply.status(500).send({ error: error.message || 'Indexing failed' });
    }
  });
}
