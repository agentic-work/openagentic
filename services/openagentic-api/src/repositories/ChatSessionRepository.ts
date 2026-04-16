/**
 * Chat Session Repository
 * 
 * Handles database operations for chat sessions with caching
 * Extends BaseRepository for consistent patterns
 */

import { ChatSession } from '@prisma/client';
import { BaseRepository, QueryOptions } from './BaseRepository.js';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

export interface ChatSessionWithMessages extends ChatSession {
  messages?: Array<{
    id: string;
    content: string;
    role: 'user' | 'assistant' | 'system';
    toolCalls?: any[];
    created_at: Date;
  }>;
}

export interface CreateChatSessionData {
  title?: string;
  userId: string;
  metadata?: any;
  settings?: any;
}

export interface UpdateChatSessionData {
  title?: string;
  metadata?: any;
  settings?: any;
  lastMessageAt?: Date;
  messageCount?: number;
}

export interface ChatSessionFilters {
  userId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  title?: string;
  limit?: number;
  offset?: number;
  includeMessages?: boolean;
}

/**
 * Repository for ChatSession model with specialized queries
 */
export class ChatSessionRepository extends BaseRepository<ChatSession> {
  constructor(prisma: PrismaClient, logger?: Logger) {
    super(prisma, 'chatSession', {
      defaultTTL: 1800, // 30 minutes for chat sessions
      keyPrefix: 'chat',
      enableCaching: true
    }, logger);
  }

  /**
   * Override findById to exclude soft-deleted sessions
   */
  async findById(id: string, options: QueryOptions = {}): Promise<ChatSession | null> {
    const db = options.transaction || this.prisma;
    const cacheKey = this.getCacheKey(`${this.modelName}:${id}`);

    try {
      // Check cache first (unless in transaction)
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger?.debug?.('Cache hit', { key: cacheKey, repository: this.modelName });
          return cached as ChatSession;
        }
      }

      // Fetch from database excluding soft-deleted records
      const result = await (db as any).chatSession.findFirst({
        where: { 
          id,
          deleted_at: null // Exclude soft-deleted sessions
        }
      });

      // Cache result if found
      if (result && this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, result, ttl);
        this.logger?.debug?.('Cached result', { key: cacheKey, ttl, repository: this.modelName });
      }

      return result;
    } catch (error) {
      this.logger?.error?.('Failed to find by ID', { 
        id, 
        error, 
        repository: this.modelName 
      });
      throw error;
    }
  }

  /**
   * Find sessions by user with caching
   */
  async findByUserId(
    userId: string, 
    options: QueryOptions & { includeMessages?: boolean } = {}
  ): Promise<ChatSessionWithMessages[]> {
    const includeMessages = options.includeMessages || false;
    const cacheKey = this.getCacheKey(`user:${userId}:messages:${includeMessages}`);
    
    try {
      // Check cache first
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit for user sessions', { userId, includeMessages });
          return cached as ChatSessionWithMessages[];
        }
      }

      const db = options.transaction || this.prisma;
      const sessions = await (db as any).chatSession.findMany({
        where: {
          user_id: userId,
          deleted_at: null // Exclude soft-deleted sessions
        },
        include: includeMessages ? {
          messages: {
            select: {
              id: true,
              content: true,
              role: true,
              toolCalls: true,
              created_at: true
            },
            orderBy: { created_at: 'asc' }
          }
        } : false,
        orderBy: { updated_at: 'desc' }
      });

      // Cache results
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, sessions, ttl);
        this.logger.debug('Cached user sessions', { 
          userId, 
          count: sessions.length, 
          includeMessages 
        });
      }

      return sessions;

    } catch (error) {
      this.logger.error('Failed to find sessions by user', { userId, error });
      throw error;
    }
  }

  /**
   * Find recent sessions across all users (admin function)
   */
  async findRecentSessions(
    filters: ChatSessionFilters = {},
    options: QueryOptions = {}
  ): Promise<ChatSessionWithMessages[]> {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const cacheKey = this.getCacheKey(`recent:${limit}:${offset}`);

    try {
      // Build where clause
      const whereClause: any = {
        deleted_at: null // Exclude soft-deleted sessions
      };
      if (filters.userId) whereClause.user_id = filters.userId;
      if (filters.createdAfter) {
        whereClause.created_at = { gte: filters.createdAfter };
      }
      if (filters.createdBefore) {
        whereClause.created_at = { 
          ...whereClause.created_at,
          lte: filters.createdBefore 
        };
      }
      if (filters.title) {
        whereClause.title = { contains: filters.title, mode: 'insensitive' };
      }

      const db = options.transaction || this.prisma;
      const sessions = await (db as any).chatSession.findMany({
        where: whereClause,
        include: filters.includeMessages ? {
          messages: {
            select: {
              id: true,
              content: true,
              role: true,
              created_at: true
            },
            take: 10, // Limit messages in list view
            orderBy: { created_at: 'desc' }
          }
        } : false,
        orderBy: { updated_at: 'desc' },
        take: limit,
        skip: offset
      });

      return sessions;

    } catch (error) {
      this.logger.error('Failed to find recent sessions', { filters, error });
      throw error;
    }
  }

  /**
   * Update session with last message metadata
   */
  async updateLastMessage(
    sessionId: string,
    messageCount: number,
    options: QueryOptions = {}
  ): Promise<ChatSession> {
    try {
      const updateData: UpdateChatSessionData = {
        lastMessageAt: new Date(),
        messageCount
      };

      const result = await this.update(sessionId, updateData, options);
      
      this.logger.info('Updated session last message', { 
        sessionId, 
        messageCount 
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to update last message', { sessionId, error });
      throw error;
    }
  }

  /**
   * Delete session and all related messages
   */
  async deleteWithMessages(sessionId: string, options: QueryOptions = {}): Promise<void> {
    const db = options.transaction || this.prisma;

    try {
      // Delete messages first (foreign key constraint)
      await (db as any).message.deleteMany({
        where: { sessionId }
      });

      // Delete session
      await this.delete(sessionId, options);
      
      this.logger.info('Deleted session with messages', { sessionId });

    } catch (error) {
      this.logger.error('Failed to delete session with messages', { sessionId, error });
      throw error;
    }
  }

  /**
   * Get session statistics for a user
   */
  async getUserStats(userId: string): Promise<{
    totalSessions: number;
    totalMessages: number;
    lastActivity: Date | null;
  }> {
    try {
      const stats = await this.prisma.$queryRaw<Array<{
        total_sessions: bigint;
        total_messages: bigint;
        last_activity: Date | null;
      }>>`
        SELECT 
          COUNT(DISTINCT cs.id) as total_sessions,
          COUNT(m.id) as total_messages,
          MAX(cs.updated_at) as last_activity
        FROM chat_sessions cs
        LEFT JOIN messages m ON m.session_id = cs.id
        WHERE cs.user_id = ${userId}
      `;

      const result = stats[0];
      return {
        totalSessions: Number(result.total_sessions),
        totalMessages: Number(result.total_messages),
        lastActivity: result.last_activity
      };

    } catch (error) {
      this.logger.error('Failed to get user stats', { userId, error });
      throw error;
    }
  }

  /**
   * Override cache invalidation to clear user-specific caches
   */
  protected async invalidateCache(sessionId?: string): Promise<void> {
    if (!this.cache) return;

    try {
      // Get session to find userId before invalidating
      if (sessionId) {
        const session = await this.prisma.chatSession.findUnique({
          where: { id: sessionId },
          select: { user_id: true }
        });

        if (session) {
          // Invalidate user-specific caches
          const userPattern = this.getCacheKey(`user:${session.user_id}:*`);
          const userKeys = await this.cache.keys(userPattern);
          if (userKeys.length > 0) {
            await this.cache.del(...userKeys);
          }
        }
      }

      // Call parent invalidation
      await super.invalidateCache(sessionId);

      // Also invalidate recent sessions cache
      const recentPattern = this.getCacheKey('recent:*');
      const recentKeys = await this.cache.keys(recentPattern);
      if (recentKeys.length > 0) {
        await this.cache.del(...recentKeys);
      }

    } catch (error) {
      this.logger.warn('Cache invalidation error in ChatSessionRepository', { 
        sessionId, 
        error 
      });
    }
  }
}