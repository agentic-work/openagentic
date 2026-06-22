/**
 * Database Query Batcher
 *
 * Reduces N+1 query problems by batching multiple database operations
 * into efficient bulk operations
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

export class DatabaseBatcher {
  private batchQueue = new Map<string, any[]>();
  private batchTimer: NodeJS.Timeout | null = null;
  private batchPromises = new Map<string, Promise<any>>();

  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
    private options: {
      maxBatchSize?: number;
      batchDelayMs?: number;
    } = {}
  ) {
    this.options.maxBatchSize = this.options.maxBatchSize || 100;
    this.options.batchDelayMs = this.options.batchDelayMs || 10;
  }

  /**
   * Batch multiple session fetches into a single query
   */
  async batchGetSessions(sessionIds: string[]): Promise<Map<string, any>> {
    const startTime = Date.now();

    // OPTIMIZATION: Fetch all sessions with their messages in a single query
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        id: { in: sessionIds },
        deleted_at: null
      },
      include: {
        messages: {
          where: { deleted_at: null },
          orderBy: { created_at: 'asc' },
          take: 100 // Limit messages per session
        }
      }
    });

    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    this.logger.debug({
      sessionCount: sessionIds.length,
      foundCount: sessions.length,
      duration: Date.now() - startTime
    }, 'Batch fetched sessions');

    return sessionMap;
  }

  /**
   * Batch multiple user fetches into a single query
   */
  async batchGetUsers(userIds: string[]): Promise<Map<string, any>> {
    const startTime = Date.now();

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds }
      },
      select: {
        id: true,
        email: true,
        name: true,
        created_at: true
      }
    });

    const userMap = new Map(users.map(u => [u.id, u]));

    this.logger.debug({
      userCount: userIds.length,
      foundCount: users.length,
      duration: Date.now() - startTime
    }, 'Batch fetched users');

    return userMap;
  }

  /**
   * Batch multiple message insertions
   */
  async batchInsertMessages(messages: Array<{
    sessionId: string;
    userId: string;
    role: string;
    content: string;
    metadata?: any;
  }>): Promise<void> {
    const startTime = Date.now();

    const messageData = messages.map(msg => ({
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      session_id: msg.sessionId,
      user_id: msg.userId,
      role: msg.role,
      content: msg.content,
      metadata: msg.metadata || null,
      created_at: new Date(),
      updated_at: new Date()
    }));

    await this.prisma.chatMessage.createMany({
      data: messageData
    });

    this.logger.debug({
      messageCount: messages.length,
      duration: Date.now() - startTime
    }, 'Batch inserted messages');
  }

  /**
   * Batch update session metadata
   */
  async batchUpdateSessions(updates: Array<{
    id: string;
    updates: any;
  }>): Promise<void> {
    const startTime = Date.now();

    // Use transaction for atomic updates
    await this.prisma.$transaction(
      updates.map(update =>
        this.prisma.chatSession.update({
          where: { id: update.id },
          data: {
            ...update.updates,
            updated_at: new Date()
          }
        })
      )
    );

    this.logger.debug({
      updateCount: updates.length,
      duration: Date.now() - startTime
    }, 'Batch updated sessions');
  }

  /**
   * Optimize message retrieval with preloading
   */
  async getMessagesWithPreload(
    sessionIds: string[],
    options: {
      limit?: number;
      includeTokenUsage?: boolean;
      includeToolCalls?: boolean;
    } = {}
  ): Promise<Map<string, any[]>> {
    const startTime = Date.now();

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        session_id: { in: sessionIds },
        deleted_at: null
      },
      select: {
        id: true,
        session_id: true,
        role: true,
        content: true,
        created_at: true,
        token_usage: options.includeTokenUsage || false,
        tool_calls: options.includeToolCalls || false,
        tool_call_id: options.includeToolCalls || false
      },
      orderBy: { created_at: 'asc' },
      take: options.limit
    });

    // Group messages by session
    const messageMap = new Map<string, any[]>();
    for (const sessionId of sessionIds) {
      messageMap.set(sessionId, []);
    }

    for (const message of messages) {
      const sessionMessages = messageMap.get(message.session_id);
      if (sessionMessages) {
        sessionMessages.push(message);
      }
    }

    this.logger.debug({
      sessionCount: sessionIds.length,
      totalMessages: messages.length,
      duration: Date.now() - startTime
    }, 'Batch fetched messages');

    return messageMap;
  }

  /**
   * Optimize session stats calculation
   */
  async batchCalculateSessionStats(sessionIds: string[]): Promise<Map<string, any>> {
    const startTime = Date.now();

    // Use Prisma's proper aggregation instead of raw SQL
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        session_id: { in: sessionIds },
        deleted_at: null
      },
      select: {
        session_id: true,
        token_usage: true
      }
    });

    // Calculate stats in memory to avoid complex Prisma types
    const statsMap = new Map();

    for (const sessionId of sessionIds) {
      const sessionMessages = messages.filter(m => m.session_id === sessionId);
      const totalTokens = sessionMessages.reduce((sum, msg) => {
        const tokens = (msg.token_usage as any)?.totalTokens || 0;
        return sum + tokens;
      }, 0);

      statsMap.set(sessionId, {
        messageCount: sessionMessages.length,
        totalTokens
      });
    }

    this.logger.debug({
      sessionCount: sessionIds.length,
      duration: Date.now() - startTime
    }, 'Batch calculated session stats');

    return statsMap;
  }

  /**
   * Use database connection pooling efficiently
   */
  async executeWithConnection<T>(
    operation: (prisma: PrismaClient) => Promise<T>
  ): Promise<T> {
    // Prisma handles connection pooling internally
    // This wrapper ensures we're using the pool efficiently
    try {
      return await operation(this.prisma);
    } catch (error) {
      this.logger.error({
        error: error.message
      }, 'Database operation failed');
      throw error;
    }
  }

  /**
   * Batch delete with cascade
   */
  async batchSoftDelete(
    sessionIds: string[],
    options: {
      deleteMessages?: boolean;
    } = {}
  ): Promise<void> {
    const startTime = Date.now();

    await this.prisma.$transaction(async tx => {
      // Soft delete messages if requested
      if (options.deleteMessages) {
        await tx.chatMessage.updateMany({
          where: {
            session_id: { in: sessionIds },
            deleted_at: null
          },
          data: {
            deleted_at: new Date(),
            updated_at: new Date()
          }
        });
      }

      // Soft delete sessions
      await tx.chatSession.updateMany({
        where: {
          id: { in: sessionIds },
          deleted_at: null
        },
        data: {
          deleted_at: new Date(),
          updated_at: new Date()
        }
      });
    });

    this.logger.debug({
      sessionCount: sessionIds.length,
      deleteMessages: options.deleteMessages,
      duration: Date.now() - startTime
    }, 'Batch soft deleted sessions');
  }
}