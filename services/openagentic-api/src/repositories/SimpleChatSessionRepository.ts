/**
 * Simplified Chat Session Repository - Ready for gradual integration
 * 
 * This is a minimal, working implementation that can be gradually integrated
 * into ChatStorageService to replace direct Prisma calls.
 */

import { PrismaClient, ChatSession } from '@prisma/client';
import { Redis } from 'ioredis';

export interface CreateChatSessionData {
  id: string;
  title: string;
  userId: string;
  messageCount?: number;
  isActive?: boolean;
  totalTokens?: number;
  totalCost?: number;
  model?: string | null;
}

export interface UpdateChatSessionData {
  title?: string;
  messageCount?: number;
  lastMessageAt?: Date;
}

/**
 * Simplified repository for gradual integration
 */
export class SimpleChatSessionRepository {
  private cache: any | null = null;
  private cacheTTL = 1800; // 30 minutes

  constructor(
    private prisma: PrismaClient,
    private logger: any,
    enableCaching = true
  ) {
    // Initialize Redis cache if available
    if (enableCaching) {
      try {
        const IORedis = require('ioredis');
        const redisHost = process.env.REDIS_HOST || 'redis';
        const redisPort = process.env.REDIS_PORT || '6379';
        const redisUrl = process.env.REDIS_URL || `redis://${redisHost}:${redisPort}`;
        this.cache = new IORedis(redisUrl);
        this.cache.on('error', (error) => {
          this.logger?.warn?.('Redis cache error', { error, repository: 'ChatSession' });
        });
      } catch (error) {
        this.logger?.warn?.('Failed to initialize Redis cache', { error });
        this.cache = null;
      }
    }
  }

  private getCacheKey(suffix: string): string {
    return `chat:${suffix}`;
  }

  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.cache) return null;
    try {
      const cached = await this.cache.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger?.warn?.('Cache get error', { key, error });
      return null;
    }
  }

  private async setCache(key: string, value: any, ttl = this.cacheTTL): Promise<void> {
    if (!this.cache) return;
    try {
      // Use set with EX option instead of deprecated setex
      await this.cache.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger?.warn?.('Cache set error', { key, error });
    }
  }

  private async invalidateCache(sessionId?: string): Promise<void> {
    if (!this.cache) return;
    try {
      if (sessionId) {
        await this.cache.del(this.getCacheKey(sessionId));
      }
      // Invalidate user session lists
      const pattern = this.getCacheKey('user:*');
      const keys = await this.cache.keys(pattern);
      if (keys.length > 0) {
        await this.cache.del(...keys);
      }
    } catch (error) {
      this.logger?.warn?.('Cache invalidation error', { sessionId, error });
    }
  }

  /**
   * Find session by ID with caching
   */
  async findById(sessionId: string): Promise<ChatSession | null> {
    // Check cache first
    const cacheKey = this.getCacheKey(sessionId);
    const cached = await this.getFromCache<ChatSession>(cacheKey);
    if (cached) {
      this.logger?.debug?.('Cache hit for session', { sessionId });
      return cached;
    }

    // Fetch from database
    try {
      const session = await this.prisma.chatSession.findFirst({
        where: {
          id: sessionId,
          deleted_at: null
        }
      });

      // Cache result if found
      if (session) {
        await this.setCache(cacheKey, session);
        this.logger?.debug?.('Cached session', { sessionId });
      }

      return session;
    } catch (error) {
      this.logger?.error?.('Failed to find session by ID', { sessionId, error });
      throw error;
    }
  }

  /**
   * Find sessions by user ID with caching
   */
  async findByUserId(userId: string, limit = 50): Promise<ChatSession[]> {
    const cacheKey = this.getCacheKey(`user:${userId}`);
    const cached = await this.getFromCache<ChatSession[]>(cacheKey);
    
    if (cached) {
      this.logger?.debug?.('Cache hit for user sessions', { userId });
      return cached;
    }

    try {
      const sessions = await this.prisma.chatSession.findMany({
        where: {
          user_id: userId,
          deleted_at: null
        },
        orderBy: { updated_at: 'desc' },
        take: limit
      });

      // Cache for 10 minutes (shorter for user lists)
      await this.setCache(cacheKey, sessions, 600);
      this.logger?.debug?.('Cached user sessions', { userId, count: sessions.length });

      return sessions;
    } catch (error) {
      this.logger?.error?.('Failed to find sessions by user', { userId, error });
      throw error;
    }
  }

  /**
   * Create new session
   */
  async create(data: CreateChatSessionData): Promise<ChatSession> {
    try {
      const session = await this.prisma.chatSession.create({
        data: {
          id: data.id,
          title: data.title,
          user_id: data.userId,
          message_count: data.messageCount || 0,
          is_active: data.isActive !== false,
          total_tokens: data.totalTokens || 0,
          total_cost: data.totalCost || 0,
          model: data.model || null
        }
      });

      // Invalidate user's session list cache
      await this.invalidateCache();
      
      this.logger?.info?.('Created session', { sessionId: session.id, userId: data.userId });
      return session;
    } catch (error) {
      this.logger?.error?.('Failed to create session', { data, error });
      throw error;
    }
  }

  /**
   * Update session
   */
  async update(sessionId: string, data: UpdateChatSessionData): Promise<ChatSession> {
    try {
      const session = await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          ...data,
          updated_at: new Date()
        }
      });

      // Invalidate caches
      await this.invalidateCache(sessionId);
      
      this.logger?.info?.('Updated session', { sessionId });
      return session;
    } catch (error) {
      this.logger?.error?.('Failed to update session', { sessionId, data, error });
      throw error;
    }
  }

  /**
   * Soft delete session and its messages
   */
  async deleteWithMessages(sessionId: string): Promise<void> {
    try {
      const deletedAt = new Date();
      
      // Soft delete messages first
      await this.prisma.chatMessage.updateMany({
        where: {
          session_id: sessionId,
          deleted_at: null
        },
        data: {
          deleted_at: deletedAt,
          updated_at: deletedAt
        }
      });

      // Soft delete session
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          deleted_at: deletedAt,
          updated_at: deletedAt
        }
      });

      // Invalidate caches
      await this.invalidateCache(sessionId);
      
      this.logger?.info?.('Deleted session with messages', { sessionId });
    } catch (error) {
      this.logger?.error?.('Failed to delete session with messages', { sessionId, error });
      throw error;
    }
  }

  /**
   * Update last message metadata
   */
  async updateLastMessage(sessionId: string, messageCount: number): Promise<void> {
    try {
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          message_count: messageCount,
          updated_at: new Date()
        }
      });

      // Invalidate cache
      await this.invalidateCache(sessionId);
      
      this.logger?.debug?.('Updated session last message', { sessionId, messageCount });
    } catch (error) {
      this.logger?.error?.('Failed to update last message', { sessionId, error });
      throw error;
    }
  }
}