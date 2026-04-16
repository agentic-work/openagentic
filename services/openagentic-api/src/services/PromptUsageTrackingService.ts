/**
 * Prompt Usage Tracking Service
 *
 * Tracks which prompts, templates, and context injections are used in each chat request/response.
 * Provides live metrics for admin portal showing exactly which prompts were applied per session.
 */

import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

export interface PromptUsageData {
  userId: string;
  sessionId: string;
  messageId?: string;

  // Template Information
  baseTemplateId?: number;
  baseTemplateName?: string;
  domainTemplateId?: number;
  domainTemplateName?: string;

  // System Prompt
  systemPrompt?: string;
  systemPromptLength?: number;

  // Techniques
  techniquesApplied?: string[];
  tokensAdded?: number;

  // Context Injections
  hasFormatting?: boolean;
  hasMcpContext?: boolean;
  hasRagContext?: boolean;
  hasMemoryContext?: boolean;
  hasAzureSdkDocs?: boolean;

  // Context Counts
  ragDocsCount?: number;
  ragChatsCount?: number;
  memoryCount?: number;
  mcpToolsCount?: number;

  // Metadata
  metadata?: Record<string, any>;
}

export class PromptUsageTrackingService {
  constructor(private logger: Logger) {
    this.logger = logger.child({ service: 'PromptUsageTrackingService' });
  }

  /**
   * Track prompt usage for a chat request/response
   */
  async trackPromptUsage(data: PromptUsageData): Promise<void> {
    try {
      await prisma.promptUsage.create({
        data: {
          user_id: data.userId,
          session_id: data.sessionId,
          message_id: data.messageId,

          // Template info
          base_template_id: data.baseTemplateId,
          base_template_name: data.baseTemplateName,
          domain_template_id: data.domainTemplateId,
          domain_template_name: data.domainTemplateName,

          // System prompt
          system_prompt: data.systemPrompt,
          system_prompt_length: data.systemPromptLength || data.systemPrompt?.length || 0,

          // Techniques
          techniques_applied: data.techniquesApplied || [],
          tokens_added: data.tokensAdded || 0,

          // Context injections
          has_formatting: data.hasFormatting || false,
          has_mcp_context: data.hasMcpContext || false,
          has_rag_context: data.hasRagContext || false,
          has_memory_context: data.hasMemoryContext || false,
          has_azure_sdk_docs: data.hasAzureSdkDocs || false,

          // Context counts
          rag_docs_count: data.ragDocsCount || 0,
          rag_chats_count: data.ragChatsCount || 0,
          memory_count: data.memoryCount || 0,
          mcp_tools_count: data.mcpToolsCount || 0,

          // Metadata
          metadata: data.metadata || {}
        }
      });

      this.logger.debug({
        userId: data.userId,
        sessionId: data.sessionId,
        messageId: data.messageId,
        baseTemplate: data.baseTemplateName,
        domainTemplate: data.domainTemplateName,
        techniquesCount: data.techniquesApplied?.length || 0,
        hasRag: data.hasRagContext,
        hasMemory: data.hasMemoryContext
      }, 'Prompt usage tracked successfully');

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId: data.userId,
        sessionId: data.sessionId
      }, 'Failed to track prompt usage');
      // Don't throw - tracking failures shouldn't break the chat flow
    }
  }

  /**
   * Get prompt usage for a specific session
   */
  async getSessionPromptUsage(sessionId: string): Promise<any[]> {
    try {
      return await prisma.promptUsage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'asc' }
      });
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        sessionId
      }, 'Failed to get session prompt usage');
      return [];
    }
  }

  /**
   * Get prompt usage metrics for a time range
   */
  async getPromptUsageMetrics(timeRange: string = '7d'): Promise<any> {
    try {
      // Calculate date range
      let startDate: Date | undefined;
      const now = new Date();

      switch (timeRange) {
        case '24h':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
          startDate = undefined;
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      const whereClause: any = {};
      if (startDate) {
        whereClause.created_at = { gte: startDate };
      }

      const usageRecords = await prisma.promptUsage.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' }
      });

      // Aggregate statistics
      const stats = {
        totalRecords: usageRecords.length,
        uniqueSessions: new Set(usageRecords.map(r => r.session_id)).size,
        uniqueUsers: new Set(usageRecords.map(r => r.user_id)).size,

        // Template usage
        baseTemplateUsage: this.countOccurrences(usageRecords.map(r => r.base_template_name).filter(Boolean)),
        domainTemplateUsage: this.countOccurrences(usageRecords.map(r => r.domain_template_name).filter(Boolean)),

        // Techniques usage
        techniquesUsage: this.countArrayOccurrences(usageRecords.map(r => r.techniques_applied).filter(Boolean)),

        // Context injections
        contextStats: {
          formattingInjections: usageRecords.filter(r => r.has_formatting).length,
          mcpContextInjections: usageRecords.filter(r => r.has_mcp_context).length,
          ragContextInjections: usageRecords.filter(r => r.has_rag_context).length,
          memoryContextInjections: usageRecords.filter(r => r.has_memory_context).length,
          azureSdkDocsInjections: usageRecords.filter(r => r.has_azure_sdk_docs).length
        },

        // Average counts
        avgRagDocsCount: this.calculateAverage(usageRecords.map(r => r.rag_docs_count || 0)),
        avgRagChatsCount: this.calculateAverage(usageRecords.map(r => r.rag_chats_count || 0)),
        avgMemoryCount: this.calculateAverage(usageRecords.map(r => r.memory_count || 0)),
        avgMcpToolsCount: this.calculateAverage(usageRecords.map(r => r.mcp_tools_count || 0)),

        // Token stats
        avgTokensAdded: this.calculateAverage(usageRecords.map(r => r.tokens_added || 0)),
        totalTokensAdded: usageRecords.reduce((sum, r) => sum + (r.tokens_added || 0), 0),

        // System prompt stats
        avgSystemPromptLength: this.calculateAverage(usageRecords.map(r => r.system_prompt_length || 0))
      };

      return {
        stats,
        records: usageRecords
      };

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        timeRange
      }, 'Failed to get prompt usage metrics');
      throw error;
    }
  }

  /**
   * Helper: Count occurrences of items in an array
   */
  private countOccurrences(items: string[]): Record<string, number> {
    return items.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Helper: Count occurrences of items across multiple arrays
   */
  private countArrayOccurrences(arrays: string[][]): Record<string, number> {
    const allItems = arrays.flat();
    return this.countOccurrences(allItems);
  }

  /**
   * Helper: Calculate average of numbers
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return sum / numbers.length;
  }
}
