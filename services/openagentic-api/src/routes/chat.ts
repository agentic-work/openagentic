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
 * Chat Routes
 * 
 * Handles all chat-related operations including sessions, messages, and streaming.
 * Provides endpoints for session management, message persistence, and real-time chat.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ChatService } from '../services/ChatService.js';
import { ChatRAGService } from '../services/ChatRAGService.js';
import { getRedisClient, initializeRedis } from '../utils/redis-client.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { logger } from '../utils/logger.js';

// Validation schemas
const CreateSessionSchema = z.object({
  title: z.string().optional().default('New Chat'),
  metadata: z.record(z.any()).optional()
});

const UpdateSessionSchema = z.object({
  title: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

const SendMessageSchema = z.object({
  message: z.string(),
  sessionId: z.string(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  stream: z.boolean().optional().default(true)
});

export default async function chatRoutes(fastify: FastifyInstance) {
  const chatService = new ChatService(fastify.prisma, logger);

  // Initialize Redis client directly instead of using deprecated CacheManager
  const redisClient = getRedisClient();
  await initializeRedis(logger);

  // Get all sessions for a user
  fastify.get('/chat/sessions', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId || (request.query as any).userId;
    
    if (!userId) {
      return reply.code(401).send({ error: 'User ID required - user not authenticated' });
    }

    try {
      // Check cache first
      const cacheKey = `sessions:${userId}`;
      logger.debug(`[REDIS] Checking cache for key: ${cacheKey}, redisClient connected: ${redisClient.isConnected()}`);
      let sessions = redisClient.isConnected() ? await redisClient.get(cacheKey) : null;

      if (sessions) {
        logger.info(`[REDIS HIT] Found cached sessions for user ${userId}`);
      } else {
        logger.debug(`[REDIS MISS] No cached sessions for user ${userId}, fetching from DB`);
        sessions = await fastify.prisma.chatSession.findMany({
          where: {
            user_id: userId,
            deleted_at: null  // Filter out soft deleted sessions
          },
          orderBy: { updated_at: 'desc' },
          include: {
            _count: {
              select: { messages: true }
            }
          }
        });
        
        // Cache sessions for 5 minutes
        if (redisClient.isConnected()) {
          const cached = await redisClient.set(cacheKey, sessions, 300);
          logger.debug(`[REDIS SET] Cached sessions for key: ${cacheKey}, success: ${cached}`);
        } else {
          logger.warn('[REDIS] Redis not connected, skipping cache set');
        }
      }

      // Auto-create first session for new users (API handles this, not UI)
      if (sessions.length === 0) {
        logger.info({ userId }, 'First-time user detected, creating initial session');
        const newSession = await fastify.prisma.chatSession.create({
          data: {
            id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            user_id: userId as string,
            title: 'New Chat',
            metadata: {}
          },
          include: {
            _count: {
              select: { messages: true }
            }
          }
        });
        sessions = [newSession];
        logger.info({ userId, sessionId: newSession.id }, 'Created initial session for new user');
        
        // Invalidate user sessions cache since we created a new session
        if (redisClient.isConnected()) {
          await redisClient.del(cacheKey);
        }
      }

      // Get last active session
      const lastActiveSession = sessions[0];

      return reply.send({
        sessions: sessions.map(s => ({
          id: s.id,
          title: s.title,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
          messageCount: s._count.messages,
          metadata: s.metadata
        })),
        lastActiveSessionId: lastActiveSession?.id
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get sessions');
      return reply.code(500).send({ error: 'Failed to get sessions' });
    }
  });

  // Get a specific session with messages
  fastify.get('/chat/sessions/:sessionId', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    const { sessionId } = request.params;
    const user = (request as any).user;
    const userId = user?.id || user?.userId;

    try {
      const session = await fastify.prisma.chatSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
          deleted_at: null  // Filter out soft deleted sessions
        },
        include: {
          messages: {
            orderBy: { created_at: 'asc' }
          }
        }
      });

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      return reply.send({
        session: {
          id: session.id,
          title: session.title,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          metadata: session.metadata,
          messages: session.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.created_at, // UI expects 'timestamp' field
            createdAt: m.created_at,
            model: m.model,
            metadata: m.metadata,
            // CRITICAL: Include all fields for UI parity with live sessions
            mcpCalls: m.mcp_calls,
            toolCalls: m.tool_calls,
            toolResults: m.tool_results,
            toolCallId: m.tool_call_id,
            tokenUsage: m.token_usage,
            visualizations: m.visualizations,
            prometheusData: m.prometheus_data
          }))
        }
      });
    } catch (error) {
      logger.error({ error, sessionId, userId }, 'Failed to get session');
      return reply.code(500).send({ error: 'Failed to get session' });
    }
  });

  // Create a new session
  fastify.post('/chat/sessions', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const body = CreateSessionSchema.parse(request.body);

    try {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const session = await fastify.prisma.chatSession.create({
        data: {
          id: sessionId,
          user_id: userId,
          title: body.title,
          metadata: body.metadata || {},
          summary: '',
          total_tokens: 0,
          model: process.env.DEFAULT_MODEL || 'default',
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      logger.info({ userId, sessionId }, 'Created new session');

      return reply.send({
        session: {
          id: session.id,
          title: session.title,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          messageCount: 0,
          metadata: session.metadata
        }
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to create session');
      return reply.code(500).send({ error: 'Failed to create session' });
    }
  });

  // Update a session
  fastify.patch('/chat/sessions/:sessionId', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    const { sessionId } = request.params;
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const body = UpdateSessionSchema.parse(request.body);

    try {
      const session = await fastify.prisma.chatSession.update({
        where: { 
          id: sessionId
        },
        data: {
          ...(body.title && { title: body.title }),
          ...(body.metadata && { metadata: body.metadata }),
          updated_at: new Date()
        }
      });

      return reply.send({
        session: {
          id: session.id,
          title: session.title,
          updatedAt: session.updated_at
        }
      });
    } catch (error) {
      logger.error({ error, sessionId, userId }, 'Failed to update session');
      return reply.code(500).send({ error: 'Failed to update session' });
    }
  });

  // Delete a session (soft delete)
  fastify.delete('/chat/sessions/:sessionId', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    const { sessionId } = request.params;
    const user = (request as any).user;
    const userId = user?.id || user?.userId;

    try {
      // Soft delete the session by setting deleted_at
      const deletedSession = await fastify.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          deleted_at: new Date(),
          is_active: false
        }
      });

      // Invalidate cache for user sessions
      const cacheKey = `sessions:${userId}`;
      if (redisClient.isConnected()) {
        await redisClient.del(cacheKey);
      }

      logger.info({ userId, sessionId }, 'Soft deleted session');

      return reply.send({
        success: true,
        session: {
          id: deletedSession.id,
          deletedAt: deletedSession.deleted_at
        }
      });
    } catch (error) {
      logger.error({ error, sessionId, userId }, 'Failed to delete session');
      return reply.code(500).send({ error: 'Failed to delete session' });
    }
  });

  // Get messages for a session
  fastify.get('/chat/sessions/:sessionId/messages', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    const { sessionId } = request.params;
    const user = (request as any).user;
    const userId = user?.id || user?.userId;

    try {
      const messages = await fastify.prisma.chatMessage.findMany({
        where: {
          session_id: sessionId,
          user_id: userId
        },
        orderBy: { created_at: 'asc' }
      });

      return reply.send({
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.created_at,
          metadata: m.metadata
        }))
      });
    } catch (error) {
      logger.error({ error, sessionId, userId }, 'Failed to get messages');
      return reply.code(500).send({ error: 'Failed to get messages' });
    }
  });

  // Save a message
  fastify.post('/chat/messages', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const body = request.body as any;

    try {
      const message = await fastify.prisma.chatMessage.create({
        data: {
          id: uuidv4(),
          session_id: body.sessionId,
          user_id: userId,
          role: body.role,
          content: body.content,
          model: body.model || process.env.DEFAULT_MODEL || 'default',
          tokens: body.tokens || 0,
          metadata: body.metadata || {},
          created_at: new Date()
        }
      });

      // Update session's updated_at
      await fastify.prisma.chatSession.update({
        where: { id: body.sessionId },
        data: { updated_at: new Date() }
      });

      return reply.send({
        message: {
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.created_at
        }
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to save message');
      return reply.code(500).send({ error: 'Failed to save message' });
    }
  });

  // Stream chat endpoint (SSE)
  fastify.post('/chat/stream', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const body = SendMessageSchema.parse(request.body);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no' // CRITICAL: Disable NGINX buffering for SSE streaming
    });

    try {
      // Save user message
      await fastify.prisma.chatMessage.create({
        data: {
          id: uuidv4(),
          session_id: body.sessionId,
          user_id: userId,
          role: 'user',
          content: body.message,
          model: body.model || process.env.DEFAULT_MODEL || 'default',
          tokens: 0,
          metadata: {},
          created_at: new Date()
        }
      });

      // Get session context
      const messages = await fastify.prisma.chatMessage.findMany({
        where: {
          session_id: body.sessionId,
          user_id: userId
        },
        orderBy: { created_at: 'asc' },
        take: 20 // Last 20 messages for context
      });

      // RAG: Search knowledge bases for relevant context
      const ragService = new ChatRAGService(logger);
      const userMessage = body.message || messages[messages.length - 1]?.content || '';
      const ragContext = await ragService.getRAGContext(userMessage, userId, 5);

      // Build messages with RAG context injected as system prompt
      const chatMessages = messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }));

      // Inject RAG context as a system message at the beginning
      if (ragContext.systemPromptInjection) {
        chatMessages.unshift({
          role: 'system',
          content: ragContext.systemPromptInjection
        });
        logger.info({ userId, ragResults: ragContext.results.length, ragTimeMs: ragContext.searchTimeMs }, '[Chat] RAG context injected');
      }

      // Stream response from ChatService
      await chatService.streamChat({
        messages: chatMessages,
        model: body.model || process.env.DEFAULT_MODEL || 'default',
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        userId,
        sessionId: body.sessionId,
        stream: reply.raw
      });

    } catch (error) {
      logger.error({ error, userId }, 'Failed to stream chat');
      reply.raw.write(`data: ${JSON.stringify({ error: 'Failed to process message' })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  // Knowledge Base: Ingest content into shared or private Milvus collection
  fastify.post('/chat/knowledge/ingest', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    // For internal service calls, use X-User-Id header to identify the actual user
    const xUserId = request.headers['x-user-id'] as string;
    const userId = (user?.id?.startsWith('service-') && xUserId) ? xUserId : (user?.id || user?.userId);
    const body = request.body as any;

    if (!body?.content || !body?.collection) {
      return reply.code(400).send({ error: 'content and collection (shared|private) are required' });
    }

    try {
      const ragService = new ChatRAGService(logger);
      const result = await ragService.ingestContent(
        body.content,
        body.collection as 'shared' | 'private',
        userId,
        body.metadata || {}
      );
      return reply.send({ success: true, ...result });
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Knowledge ingestion failed');
      return reply.code(500).send({ error: 'Ingestion failed', message: error.message });
    }
  });

  // Knowledge Base: Search knowledge bases
  fastify.post('/chat/knowledge/search', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const body = request.body as any;

    if (!body?.query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    try {
      const ragService = new ChatRAGService(logger);
      const result = await ragService.getRAGContext(body.query, userId, body.topK || 5);
      return reply.send({ success: true, results: result.results, searchTimeMs: result.searchTimeMs });
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Knowledge search failed');
      return reply.code(500).send({ error: 'Search failed', message: error.message });
    }
  });

  // Clear all sessions for a user (for testing)
  fastify.delete('/chat/sessions', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;

    try {
      // Delete all messages
      await fastify.prisma.chatMessage.deleteMany({
        where: { user_id: userId }
      });

      // Delete all sessions
      await fastify.prisma.chatSession.deleteMany({
        where: { user_id: userId }
      });

      logger.info({ userId }, 'Cleared all sessions');

      return reply.send({ success: true });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to clear sessions');
      return reply.code(500).send({ error: 'Failed to clear sessions' });
    }
  });
}