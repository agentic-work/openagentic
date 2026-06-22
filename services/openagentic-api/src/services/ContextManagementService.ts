/**
 * Context Management Service
 *
 * Manages context window usage for chat sessions, providing:
 * - Token counting and context tracking per session
 * - Automatic silent compaction when approaching limits
 * - Context summarization for long conversations
 * - Smart message pruning while preserving important context
 *
 * The service works silently in the background, so users can work on huge
 * context sessions without interruption.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { MODEL_CONTEXT_WINDOWS, getContextWindow } from '../config/model-catalogs.js';

const logger = loggers.services;

/**
 * Simple token counter using character-based approximation
 * Most models average ~4 characters per token for English text
 * This is good enough for context management decisions
 */
function approximateTokenCount(text: string): number {
  if (!text) return 0;
  // Average ~4 chars per token for English, ~2 for code with more symbols
  // Use 3.5 as a reasonable middle ground
  return Math.ceil(text.length / 3.5);
}

// Context window limits — re-exported from centralized model catalogs
export const MODEL_CONTEXT_LIMITS: Record<string, number> = MODEL_CONTEXT_WINDOWS;

// Thresholds for context management
const COMPACTION_WARNING_THRESHOLD = 0.7; // 70% - start preparing for compaction
const COMPACTION_TRIGGER_THRESHOLD = 0.85; // 85% - trigger compaction
const COMPACTION_AGGRESSIVE_THRESHOLD = 0.95; // 95% - aggressive compaction

export interface ContextUsage {
  sessionId: string;
  currentTokens: number;
  maxTokens: number;
  usagePercentage: number;
  messagesCount: number;
  oldestMessageTime?: Date;
  newestMessageTime?: Date;
  needsCompaction: boolean;
  compactionLevel: 'none' | 'light' | 'medium' | 'aggressive';
}

export interface CompactionResult {
  sessionId: string;
  messagesRemoved: number;
  messagesSummarized: number;
  tokensFreed: number;
  newTokenCount: number;
  compactionLevel: string;
  timestamp: Date;
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  metadata?: any;
  tokenCount?: number;
  isImportant?: boolean;
}

export class ContextManagementService {
  private sessionContextCache: Map<string, ContextUsage> = new Map();
  private compactionInProgress: Set<string> = new Set();

  /**
   * Count tokens in a message using character-based approximation
   */
  countTokens(text: string): number {
    return approximateTokenCount(text);
  }

  /**
   * Get context limit for a model
   */
  getModelContextLimit(model: string): number {
    return getContextWindow(model);
  }

  /**
   * Calculate context usage for a session
   */
  async getContextUsage(sessionId: string, model?: string): Promise<ContextUsage> {
    try {
      // Get session messages
      const messages = await prisma.chatMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          content: true,
          role: true,
          created_at: true,
          metadata: true,
        },
      });

      // Get session info for model if not provided
      if (!model) {
        const session = await prisma.chatSession.findUnique({
          where: { id: sessionId },
          select: { metadata: true },
        });
        model = (session?.metadata as any)?.model || 'default';
      }

      const maxTokens = this.getModelContextLimit(model);

      // Calculate total tokens
      let totalTokens = 0;
      for (const msg of messages) {
        totalTokens += this.countTokens(msg.content);
      }

      const usagePercentage = (totalTokens / maxTokens) * 100;

      // Determine compaction level needed
      let compactionLevel: ContextUsage['compactionLevel'] = 'none';
      let needsCompaction = false;

      if (usagePercentage >= COMPACTION_AGGRESSIVE_THRESHOLD * 100) {
        compactionLevel = 'aggressive';
        needsCompaction = true;
      } else if (usagePercentage >= COMPACTION_TRIGGER_THRESHOLD * 100) {
        compactionLevel = 'medium';
        needsCompaction = true;
      } else if (usagePercentage >= COMPACTION_WARNING_THRESHOLD * 100) {
        compactionLevel = 'light';
        needsCompaction = true;
      }

      const usage: ContextUsage = {
        sessionId,
        currentTokens: totalTokens,
        maxTokens,
        usagePercentage,
        messagesCount: messages.length,
        oldestMessageTime: messages[0]?.created_at,
        newestMessageTime: messages[messages.length - 1]?.created_at,
        needsCompaction,
        compactionLevel,
      };

      // Cache the usage
      this.sessionContextCache.set(sessionId, usage);

      return usage;
    } catch (error) {
      logger.error({ error, sessionId }, '[ContextMgmt] Failed to get context usage');
      throw error;
    }
  }

  /**
   * Silently compact a session's context
   * This runs in the background without blocking the user
   */
  async compactContext(sessionId: string, model?: string): Promise<CompactionResult | null> {
    // Prevent concurrent compaction of same session
    if (this.compactionInProgress.has(sessionId)) {
      logger.debug({ sessionId }, '[ContextMgmt] Compaction already in progress');
      return null;
    }

    this.compactionInProgress.add(sessionId);

    try {
      const usage = await this.getContextUsage(sessionId, model);

      if (!usage.needsCompaction) {
        return null;
      }

      logger.info({ sessionId, usage }, '[ContextMgmt] Starting silent compaction');

      // Get all messages
      const messages = await prisma.chatMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'asc' },
      });

      let messagesRemoved = 0;
      let messagesSummarized = 0;
      let tokensFreed = 0;

      // Determine compaction strategy based on level
      switch (usage.compactionLevel) {
        case 'light':
          // Light: Remove older system messages, keep user/assistant exchanges
          const lightResult = await this.lightCompaction(sessionId, messages);
          messagesRemoved = lightResult.removed;
          tokensFreed = lightResult.tokensFreed;
          break;

        case 'medium':
          // Medium: Summarize older conversation chunks
          const mediumResult = await this.mediumCompaction(sessionId, messages, usage.maxTokens);
          messagesRemoved = mediumResult.removed;
          messagesSummarized = mediumResult.summarized;
          tokensFreed = mediumResult.tokensFreed;
          break;

        case 'aggressive':
          // Aggressive: Summarize most of the conversation, keep only recent context
          const aggressiveResult = await this.aggressiveCompaction(sessionId, messages, usage.maxTokens);
          messagesRemoved = aggressiveResult.removed;
          messagesSummarized = aggressiveResult.summarized;
          tokensFreed = aggressiveResult.tokensFreed;
          break;
      }

      // Recalculate context usage
      const newUsage = await this.getContextUsage(sessionId, model);

      const result: CompactionResult = {
        sessionId,
        messagesRemoved,
        messagesSummarized,
        tokensFreed,
        newTokenCount: newUsage.currentTokens,
        compactionLevel: usage.compactionLevel,
        timestamp: new Date(),
      };

      logger.info({ sessionId, result }, '[ContextMgmt] Compaction completed silently');

      // Store compaction record for auditing
      await this.recordCompaction(result);

      return result;
    } catch (error) {
      logger.error({ error, sessionId }, '[ContextMgmt] Compaction failed');
      throw error;
    } finally {
      this.compactionInProgress.delete(sessionId);
    }
  }

  /**
   * Light compaction: Remove non-essential older messages
   */
  private async lightCompaction(
    sessionId: string,
    messages: any[]
  ): Promise<{ removed: number; tokensFreed: number }> {
    let removed = 0;
    let tokensFreed = 0;

    // Keep first 10% and last 50% of messages
    const keepFirstCount = Math.max(2, Math.floor(messages.length * 0.1));
    const keepLastCount = Math.max(5, Math.floor(messages.length * 0.5));

    const toRemove: string[] = [];

    for (let i = keepFirstCount; i < messages.length - keepLastCount; i++) {
      const msg = messages[i];

      // Don't remove user messages that seem important
      if (this.isImportantMessage(msg)) {
        continue;
      }

      toRemove.push(msg.id);
      tokensFreed += this.countTokens(msg.content);
    }

    if (toRemove.length > 0) {
      // Mark as compacted rather than deleting (for potential recovery)
      await prisma.chatMessage.updateMany({
        where: { id: { in: toRemove } },
        data: {
          metadata: {
            compacted: true,
            compactedAt: new Date().toISOString(),
          },
        },
      });
      removed = toRemove.length;
    }

    return { removed, tokensFreed };
  }

  /**
   * Medium compaction: Summarize older conversation sections
   */
  private async mediumCompaction(
    sessionId: string,
    messages: any[],
    maxTokens: number
  ): Promise<{ removed: number; summarized: number; tokensFreed: number }> {
    let removed = 0;
    let summarized = 0;
    let tokensFreed = 0;

    // Keep last 30% of messages intact
    const keepLastCount = Math.max(5, Math.floor(messages.length * 0.3));
    const messagesToProcess = messages.slice(0, messages.length - keepLastCount);

    if (messagesToProcess.length < 5) {
      return { removed, summarized, tokensFreed };
    }

    // Group messages into chunks of ~5000 tokens each
    const chunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentChunkTokens = 0;

    for (const msg of messagesToProcess) {
      const tokens = this.countTokens(msg.content);

      if (currentChunkTokens + tokens > 5000 && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [msg];
        currentChunkTokens = tokens;
      } else {
        currentChunk.push(msg);
        currentChunkTokens += tokens;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // Summarize each chunk (create summary placeholders)
    for (const chunk of chunks) {
      if (chunk.length < 2) continue;

      // Create a summary message
      const chunkContent = chunk.map(m => `[${m.role}]: ${m.content.substring(0, 200)}`).join('\n');
      const summary = `[CONTEXT SUMMARY: ${chunk.length} messages from ${chunk[0].created_at.toISOString()} to ${chunk[chunk.length - 1].created_at.toISOString()}]\n${this.generateBriefSummary(chunkContent)}`;

      // Insert summary message
      await prisma.chatMessage.create({
        data: {
          session_id: sessionId,
          role: 'system',
          content: summary,
          created_at: chunk[0].created_at, // Use timestamp of first message
          metadata: {
            type: 'context_summary',
            summarizedMessageIds: chunk.map(m => m.id),
            summarizedCount: chunk.length,
          },
        },
      });

      summarized += chunk.length;

      // Calculate tokens freed
      for (const msg of chunk) {
        tokensFreed += this.countTokens(msg.content);
      }
      tokensFreed -= this.countTokens(summary);

      // Mark original messages as summarized
      await prisma.chatMessage.updateMany({
        where: { id: { in: chunk.map(m => m.id) } },
        data: {
          metadata: {
            summarized: true,
            summarizedAt: new Date().toISOString(),
          },
        },
      });

      removed += chunk.length;
    }

    return { removed, summarized, tokensFreed };
  }

  /**
   * Aggressive compaction: Keep only essential recent context
   */
  private async aggressiveCompaction(
    sessionId: string,
    messages: any[],
    maxTokens: number
  ): Promise<{ removed: number; summarized: number; tokensFreed: number }> {
    let removed = 0;
    let summarized = 0;
    let tokensFreed = 0;

    // Keep only last 10 messages plus any important messages
    const keepLastCount = 10;
    const recentMessages = messages.slice(-keepLastCount);
    const olderMessages = messages.slice(0, -keepLastCount);

    // Find important messages in older set
    const importantOlderMessages = olderMessages.filter(m => this.isImportantMessage(m));

    // Create a comprehensive summary of all older messages
    if (olderMessages.length > 0) {
      const olderContent = olderMessages.map(m => `[${m.role}]: ${m.content.substring(0, 100)}`).join('\n');
      const comprehensiveSummary = `[COMPREHENSIVE CONTEXT SUMMARY]\nThis conversation previously covered ${olderMessages.length} messages.\nKey topics: ${this.extractKeyTopics(olderContent)}\n\n${importantOlderMessages.map(m => `IMPORTANT: ${m.content.substring(0, 200)}`).join('\n')}`;

      // Insert comprehensive summary at the beginning
      await prisma.chatMessage.create({
        data: {
          session_id: sessionId,
          role: 'system',
          content: comprehensiveSummary,
          created_at: olderMessages[0].created_at,
          metadata: {
            type: 'comprehensive_summary',
            summarizedMessageIds: olderMessages.map(m => m.id),
            summarizedCount: olderMessages.length,
          },
        },
      });

      summarized = olderMessages.length;

      // Calculate tokens freed
      for (const msg of olderMessages) {
        tokensFreed += this.countTokens(msg.content);
      }
      tokensFreed -= this.countTokens(comprehensiveSummary);

      // Mark all older messages as compacted
      await prisma.chatMessage.updateMany({
        where: { id: { in: olderMessages.map(m => m.id) } },
        data: {
          metadata: {
            aggressivelyCompacted: true,
            compactedAt: new Date().toISOString(),
          },
        },
      });

      removed = olderMessages.length;
    }

    return { removed, summarized, tokensFreed };
  }

  /**
   * Check if a message is important and should be preserved
   */
  private isImportantMessage(message: any): boolean {
    const content = message.content.toLowerCase();

    // Important patterns
    const importantPatterns = [
      /\b(important|critical|remember|note|key point|must|requirement)\b/i,
      /\b(error|bug|fix|issue|problem)\b/i,
      /\b(api key|password|secret|credential)\b/i, // Don't summarize security-related
      /\b(final answer|conclusion|solution)\b/i,
    ];

    // Check metadata for importance flag
    if (message.metadata?.isImportant) {
      return true;
    }

    // Check content patterns
    return importantPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Generate a brief summary of content
   */
  private generateBriefSummary(content: string): string {
    // Simple extraction-based summary
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const summary = sentences.slice(0, 3).join('. ');
    return summary.length > 500 ? summary.substring(0, 497) + '...' : summary + '.';
  }

  /**
   * Extract key topics from content
   */
  private extractKeyTopics(content: string): string {
    // Simple keyword extraction
    const words = content.toLowerCase().split(/\s+/);
    const wordFreq = new Map<string, number>();

    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'it', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'at', 'by', 'with', 'that', 'this', 'from', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'user', 'assistant', 'system']);

    for (const word of words) {
      const cleaned = word.replace(/[^a-z0-9]/g, '');
      if (cleaned.length > 3 && !stopWords.has(cleaned)) {
        wordFreq.set(cleaned, (wordFreq.get(cleaned) || 0) + 1);
      }
    }

    // Get top 5 keywords
    const sorted = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]);
    const topKeywords = sorted.slice(0, 5).map(([word]) => word);

    return topKeywords.join(', ');
  }

  /**
   * Record compaction for auditing
   */
  private async recordCompaction(result: CompactionResult): Promise<void> {
    try {
      // Store in system configuration or a dedicated table
      await prisma.systemConfiguration.upsert({
        where: { key: `context_compaction_${result.sessionId}_${Date.now()}` },
        create: {
          key: `context_compaction_${result.sessionId}_${Date.now()}`,
          value: JSON.stringify(result),
          description: 'Context compaction record',
        },
        update: {
          value: JSON.stringify(result),
        },
      });
    } catch (error) {
      logger.warn({ error }, '[ContextMgmt] Failed to record compaction');
    }
  }

  /**
   * Check and potentially compact a session (called during chat pipeline)
   * Returns compaction result if compaction was performed, null otherwise.
   * Accepts an optional streamCallback to emit SSE events to the client.
   */
  async checkAndCompact(
    sessionId: string,
    model?: string,
    streamCallback?: (event: { type: string; data: any }) => void | Promise<void>
  ): Promise<CompactionResult | null> {
    try {
      const usage = await this.getContextUsage(sessionId, model);

      if (usage.needsCompaction) {
        const result = await this.compactContext(sessionId, model);

        // Emit SSE event if compaction occurred and streamCallback is provided
        if (result && streamCallback) {
          const freedPercent = usage.maxTokens > 0
            ? Math.round((result.tokensFreed / usage.maxTokens) * 100)
            : 0;

          try {
            await Promise.resolve(streamCallback({
              type: 'context_compacted',
              data: {
                freedPercent,
                tokensFreed: result.tokensFreed,
                messagesRemoved: result.messagesRemoved,
                messagesSummarized: result.messagesSummarized,
                compactionLevel: result.compactionLevel,
              }
            }));
          } catch (err) {
            logger.warn({ err, sessionId }, '[ContextMgmt] Failed to emit context_compacted event');
          }
        }

        return result;
      }

      return null;
    } catch (error) {
      logger.error({ error, sessionId }, '[ContextMgmt] Check and compact failed');
      return null;
    }
  }

  /**
   * Get messages for context (filters out compacted messages)
   */
  async getActiveContextMessages(sessionId: string): Promise<SessionMessage[]> {
    const messages = await prisma.chatMessage.findMany({
      where: {
        session_id: sessionId,
        OR: [
          // Include messages without compacted flag
          { metadata: { path: ['compacted'], equals: null } },
          { metadata: { path: ['compacted'], equals: false } },
          // Include summary messages
          { metadata: { path: ['type'], string_contains: 'summary' } },
        ],
      },
      orderBy: { created_at: 'asc' },
    });

    return messages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      createdAt: m.created_at,
      metadata: m.metadata,
      tokenCount: this.countTokens(m.content),
    }));
  }

  /**
   * Get context usage for multiple sessions (admin view)
   */
  async getMultipleSessionsUsage(sessionIds: string[]): Promise<Map<string, ContextUsage>> {
    const usageMap = new Map<string, ContextUsage>();

    for (const sessionId of sessionIds) {
      try {
        const usage = await this.getContextUsage(sessionId);
        usageMap.set(sessionId, usage);
      } catch {
        // Skip failed sessions
      }
    }

    return usageMap;
  }

  /**
   * Get all sessions that need compaction
   */
  async getSessionsNeedingCompaction(): Promise<ContextUsage[]> {
    // Get all active sessions
    const sessions = await prisma.chatSession.findMany({
      where: { is_active: true },
      select: { id: true },
    });

    const needingCompaction: ContextUsage[] = [];

    for (const session of sessions) {
      try {
        const usage = await this.getContextUsage(session.id);
        if (usage.needsCompaction) {
          needingCompaction.push(usage);
        }
      } catch {
        // Skip failed sessions
      }
    }

    return needingCompaction;
  }

  /**
   * Clear context cache for a session
   */
  clearCache(sessionId?: string): void {
    if (sessionId) {
      this.sessionContextCache.delete(sessionId);
    } else {
      this.sessionContextCache.clear();
    }
  }

  /**
   * Get compaction metrics for admin dashboard
   * Returns aggregated statistics about context window usage and compaction
   */
  async getCompactionMetrics(options: {
    startDate?: Date;
    endDate?: Date;
    sessionType?: 'chat' | 'all';
  } = {}): Promise<{
    summary: {
      totalCompactions: number;
      totalTokensFreed: number;
      totalMessagesRemoved: number;
      totalMessagesSummarized: number;
      avgTokensFreedPerCompaction: number;
    };
    byLevel: {
      light: number;
      medium: number;
      aggressive: number;
    };
    byDay: Array<{
      date: string;
      compactions: number;
      tokensFreed: number;
    }>;
    recentCompactions: Array<{
      sessionId: string;
      level: string;
      tokensFreed: number;
      messagesRemoved: number;
      timestamp: Date;
    }>;
    activeSessions: {
      total: number;
      approachingLimit: number;
      needsCompaction: number;
      healthy: number;
    };
    contextUsageDistribution: {
      under50: number;
      from50to70: number;
      from70to85: number;
      from85to95: number;
      over95: number;
    };
  }> {
    const { startDate, endDate } = options;

    // Default to last 30 days
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();

    try {
      // Get compaction records from system configuration
      const compactionRecords = await prisma.systemConfiguration.findMany({
        where: {
          key: { startsWith: 'context_compaction_' },
          created_at: {
            gte: start,
            lte: end,
          },
        },
        orderBy: { created_at: 'desc' },
      });

      // Parse compaction results
      const results: CompactionResult[] = compactionRecords.map(r => {
        try {
          // r.value is JsonValue - if it's already an object, return it directly
          // if it's a string, parse it
          if (typeof r.value === 'string') {
            return JSON.parse(r.value) as CompactionResult;
          }
          // Cast through unknown for JsonValue -> CompactionResult
          return r.value as unknown as CompactionResult;
        } catch {
          return null;
        }
      }).filter((r): r is CompactionResult => r !== null);

      // Calculate summary metrics
      let totalTokensFreed = 0;
      let totalMessagesRemoved = 0;
      let totalMessagesSummarized = 0;
      const byLevel = { light: 0, medium: 0, aggressive: 0 };
      const byDayMap = new Map<string, { compactions: number; tokensFreed: number }>();

      for (const result of results) {
        totalTokensFreed += result.tokensFreed || 0;
        totalMessagesRemoved += result.messagesRemoved || 0;
        totalMessagesSummarized += result.messagesSummarized || 0;

        // Count by level
        if (result.compactionLevel === 'light') byLevel.light++;
        else if (result.compactionLevel === 'medium') byLevel.medium++;
        else if (result.compactionLevel === 'aggressive') byLevel.aggressive++;

        // Group by day
        const day = new Date(result.timestamp).toISOString().split('T')[0];
        const dayStats = byDayMap.get(day) || { compactions: 0, tokensFreed: 0 };
        dayStats.compactions++;
        dayStats.tokensFreed += result.tokensFreed || 0;
        byDayMap.set(day, dayStats);
      }

      // Get active session stats
      const activeSessions = await prisma.chatSession.findMany({
        where: { is_active: true },
        select: { id: true, metadata: true },
      });

      // Code Mode is removed in the OSS edition.
      const codeModeSessions: Array<{ id: string; model: string }> = [];

      // Calculate context usage distribution
      const usageDistribution = {
        under50: 0,
        from50to70: 0,
        from70to85: 0,
        from85to95: 0,
        over95: 0,
      };
      let approachingLimit = 0;
      let needsCompaction = 0;

      // Sample up to 100 sessions for usage calculation (performance)
      const sessionsToCheck = [...activeSessions.slice(0, 50), ...codeModeSessions.slice(0, 50)];

      for (const session of sessionsToCheck) {
        try {
          const usage = this.sessionContextCache.get(session.id) || await this.getContextUsage(session.id);

          if (usage.usagePercentage < 50) usageDistribution.under50++;
          else if (usage.usagePercentage < 70) usageDistribution.from50to70++;
          else if (usage.usagePercentage < 85) usageDistribution.from70to85++;
          else if (usage.usagePercentage < 95) usageDistribution.from85to95++;
          else usageDistribution.over95++;

          if (usage.usagePercentage >= 70) approachingLimit++;
          if (usage.needsCompaction) needsCompaction++;
        } catch {
          // Skip failed sessions
        }
      }

      const healthy = sessionsToCheck.length - approachingLimit;

      // Recent compactions (last 20)
      const recentCompactions = results.slice(0, 20).map(r => ({
        sessionId: r.sessionId,
        level: r.compactionLevel,
        tokensFreed: r.tokensFreed,
        messagesRemoved: r.messagesRemoved,
        timestamp: new Date(r.timestamp),
      }));

      // Convert byDay map to sorted array
      const byDay = Array.from(byDayMap.entries())
        .map(([date, stats]) => ({ date, ...stats }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        summary: {
          totalCompactions: results.length,
          totalTokensFreed,
          totalMessagesRemoved,
          totalMessagesSummarized,
          avgTokensFreedPerCompaction: results.length > 0
            ? Math.round(totalTokensFreed / results.length)
            : 0,
        },
        byLevel,
        byDay,
        recentCompactions,
        activeSessions: {
          total: activeSessions.length + codeModeSessions.length,
          approachingLimit,
          needsCompaction,
          healthy,
        },
        contextUsageDistribution: usageDistribution,
      };
    } catch (error) {
      logger.error({ error }, '[ContextMgmt] Failed to get compaction metrics');
      throw error;
    }
  }
}

// Singleton instance
export const contextManagementService = new ContextManagementService();
