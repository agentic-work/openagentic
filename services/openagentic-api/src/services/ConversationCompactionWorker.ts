/**
 * Conversation Compaction Worker
 *
 * Background service that:
 * 1. Listens to conversation:completed Redis events
 * 2. Summarizes old conversations using Azure OpenAI
 * 3. Stores compacted summaries in PostgreSQL
 * 4. Manages Redis cache eviction based on TTL
 *
 * ENV vars:
 * - COMPACTION_MODEL: Specific model to use for summarization (e.g., "gpt-4o-mini")
 * - COMPACTION_ENABLED: Enable/disable background compaction (default: true)
 * - COMPACTION_DELAY_HOURS: Hours of inactivity before compacting (default: 1)
 * - AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT: For Azure OpenAI access
 */

import { PrismaClient } from '@prisma/client';
import { AzureOpenAI } from 'openai';
import type { Logger } from 'pino';
import { CompactionEngine } from './context/CompactionEngine.js';

export interface CompactionConfig {
  prisma: PrismaClient;
  redis: any;
  logger: Logger;
  enabled?: boolean;
  delayHours?: number;
}

export interface ConversationSummary {
  sessionId: string;
  userId: string;
  summary: string;
  messageCount: number;
  keyEntities: string[];
  topics: string[];
  importantDecisions: string[];
  timeRange: {
    start: Date;
    end: Date;
  };
}

export class ConversationCompactionWorker {
  private config: CompactionConfig;
  private compactionModel: string;
  private azureOpenAI: AzureOpenAI | null = null;
  private compactionEngine = new CompactionEngine();
  private isRunning = false;
  private isConfigured = false;

  constructor(config: CompactionConfig) {
    this.config = {
      enabled: process.env.COMPACTION_ENABLED !== 'false',
      delayHours: parseInt(process.env.COMPACTION_DELAY_HOURS || '1'),
      ...config
    };

    // Use COMPACTION_MODEL or fall back to default model
    this.compactionModel = process.env.COMPACTION_MODEL || process.env.DEFAULT_MODEL;

    // Heuristic compaction is always available — worker is always configured
    this.isConfigured = true;

    // Optionally initialize Azure OpenAI client if credentials are provided
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;

    if (endpoint && apiKey) {
      try {
        this.azureOpenAI = new AzureOpenAI({
          endpoint,
          apiKey,
          apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
        });
        this.config.logger.info({
          model: this.compactionModel,
          endpoint
        }, '[COMPACTION] ConversationCompactionWorker initialized with Azure OpenAI');
      } catch (error) {
        this.config.logger.error({
          error: error instanceof Error ? error.message : error
        }, '[COMPACTION] Failed to initialize Azure OpenAI client, will use heuristic summarization');
      }
    } else {
      this.config.logger.info('[COMPACTION] Azure OpenAI not configured - using heuristic summarization (always available)');
    }
  }

  /**
   * Start the background worker
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.config.logger.info('[COMPACTION] Worker disabled via COMPACTION_ENABLED=false');
      return;
    }

    if (!this.isConfigured) {
      this.config.logger.warn('[COMPACTION] Worker not configured');
      return;
    }

    this.isRunning = true;
    this.config.logger.info({
      delayHours: this.config.delayHours,
      model: this.compactionModel
    }, '[COMPACTION] 🗜️ Conversation Compaction Worker starting...');

    // Subscribe to Redis conversation events
    const subscriber = this.config.redis.duplicate ?
      await this.config.redis.duplicate() :
      this.config.redis;

    await subscriber.subscribe('conversation:completed', async (message: string) => {
      try {
        const event = JSON.parse(message);
        await this.processCompletedConversation(event);
      } catch (error) {
        this.config.logger.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          message
        }, '[COMPACTION] Failed to process conversation event');
      }
    });

    // Start periodic cleanup job (check every 30 minutes)
    setInterval(() => {
      this.cleanupOldSessions().catch(error => {
        this.config.logger.error({
          error: error instanceof Error ? error.message : 'Unknown error'
        }, '[COMPACTION] Periodic cleanup failed');
      });
    }, 30 * 60 * 1000);

    this.config.logger.info({
      model: this.compactionModel,
      subscribedTo: 'conversation:completed'
    }, '[COMPACTION] ✅ Worker started successfully');
  }


  /**
   * Process a completed conversation event
   */
  private async processCompletedConversation(event: any): Promise<void> {
    try {
      const { sessionId, userId, messages, timestamp } = event;

      if (!sessionId || !userId || !messages) {
        this.config.logger.warn({
          hasSessionId: !!sessionId,
          hasUserId: !!userId,
          hasMessages: !!messages
        }, '[COMPACTION] Invalid conversation event received');
        return;
      }

      this.config.logger.debug({
        sessionId,
        userId,
        messageCount: messages.length
      }, '[COMPACTION] Received conversation:completed event');

      // Schedule compaction after delay period
      const delayMs = this.config.delayHours! * 60 * 60 * 1000;
      setTimeout(async () => {
        await this.compactSession(sessionId, userId, messages);
      }, delayMs);

    } catch (error) {
      this.config.logger.error({
        error: error.message
      }, '[COMPACTION] Failed to process completed conversation');
    }
  }

  /**
   * Compact a conversation session into a summary
   */
  private async compactSession(sessionId: string, userId: string, messages: any[]): Promise<void> {
    try {
      this.config.logger.info({
        sessionId,
        userId,
        messageCount: messages.length
      }, '[COMPACTION] 🗜️ Starting conversation compaction...');

      // Check if session has been active recently (don't compact active sessions)
      const session = await this.config.prisma.chatSession.findUnique({
        where: { id: sessionId },
        select: { updated_at: true }
      });

      if (!session) {
        this.config.logger.debug({ sessionId }, '[COMPACTION] Session not found, skipping');
        return;
      }

      const timeSinceUpdate = Date.now() - session.updated_at.getTime();
      const inactiveThreshold = this.config.delayHours! * 60 * 60 * 1000;

      if (timeSinceUpdate < inactiveThreshold) {
        this.config.logger.debug({
          sessionId,
          timeSinceUpdate: Math.round(timeSinceUpdate / 1000 / 60),
          thresholdMinutes: this.config.delayHours! * 60
        }, '[COMPACTION] Session still active, skipping compaction');
        return;
      }

      // Generate summary using LLM
      const summary = await this.summarizeConversation(messages);

      // Save to database
      await this.saveCompactedSummary(sessionId, userId, summary);

      this.config.logger.info({
        sessionId,
        userId,
        originalMessages: messages.length,
        summaryLength: summary.summary.length,
        keyEntities: summary.keyEntities.length
      }, '[COMPACTION] ✅ Conversation compacted and saved');

    } catch (error) {
      this.config.logger.error({
        error: error.message,
        sessionId,
        userId
      }, '[COMPACTION] Failed to compact session');
    }
  }

  /**
   * Summarize conversation using CompactionEngine (heuristic, always available)
   */
  private async summarizeConversation(messages: any[]): Promise<ConversationSummary> {
    try {
      const structured = this.compactionEngine.generateHeuristicSummary(messages);
      const summaryText = structured.text;

      // Extract time range
      const timestamps = messages
        .map((m: any) => m.timestamp ? new Date(m.timestamp).getTime() : Date.now())
        .sort();

      return {
        sessionId: '', // Will be filled by caller
        userId: '', // Will be filled by caller
        summary: summaryText,
        messageCount: messages.length,
        keyEntities: structured.toolsUsed || [],
        topics: structured.topics || [],
        importantDecisions: structured.keyDecisions || [],
        timeRange: {
          start: new Date(timestamps[0]),
          end: new Date(timestamps[timestamps.length - 1])
        }
      };

    } catch (error) {
      this.config.logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, '[COMPACTION] Failed to summarize conversation');

      // Return basic summary on error
      return {
        sessionId: '',
        userId: '',
        summary: `Conversation with ${messages.length} messages (summarization failed)`,
        messageCount: messages.length,
        keyEntities: [],
        topics: [],
        importantDecisions: [],
        timeRange: {
          start: new Date(),
          end: new Date()
        }
      };
    }
  }

  /**
   * Save compacted summary to database
   */
  private async saveCompactedSummary(
    sessionId: string,
    userId: string,
    summary: ConversationSummary
  ): Promise<void> {
    try {
      await this.config.prisma.conversationSummary.create({
        data: {
          id: `summary_${sessionId}_${Date.now()}`,
          user_id: userId,
          session_id: sessionId,
          summary: summary.summary,
          message_count: summary.messageCount,
          key_entities: summary.keyEntities,
          topics: summary.topics,
          important_decisions: summary.importantDecisions,
          time_range_start: summary.timeRange.start,
          time_range_end: summary.timeRange.end,
          created_at: new Date()
        }
      });

      this.config.logger.debug({
        sessionId,
        userId
      }, '[COMPACTION] Saved compacted summary to database');

    } catch (error) {
      // Check if table doesn't exist yet
      if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
        this.config.logger.warn(
          '[COMPACTION] conversation_summaries table does not exist. Run Prisma migration to create it.'
        );
      } else {
        throw error;
      }
    }
  }

  /**
   * Periodic cleanup of old sessions
   * Removes Redis cache entries for sessions older than 24 hours
   */
  private async cleanupOldSessions(): Promise<void> {
    try {
      this.config.logger.debug('[COMPACTION] Starting periodic session cleanup...');

      // Get all session keys from Redis
      const keys = await this.config.redis.keys('memory:session:*');

      let cleanedCount = 0;
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const key of keys) {
        try {
          const sessionData = await this.config.redis.get(key);
          if (!sessionData) continue;

          const session = JSON.parse(sessionData);
          const age = now - (session.lastActivity || 0);

          if (age > maxAge) {
            await this.config.redis.del(key);
            cleanedCount++;
          }
        } catch (error) {
          // Skip invalid entries
          continue;
        }
      }

      if (cleanedCount > 0) {
        this.config.logger.info({
          cleanedSessions: cleanedCount,
          totalKeys: keys.length
        }, '[COMPACTION] ✅ Cleaned up old Redis session cache entries');
      }

    } catch (error) {
      this.config.logger.error({
        error: error.message
      }, '[COMPACTION] Failed to cleanup old sessions');
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.config.logger.info('[COMPACTION] Worker stopped');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.isRunning && this.isConfigured;
  }
}
