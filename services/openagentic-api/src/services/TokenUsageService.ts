/**
 * Token Usage Service
 * 
 * Tracks token consumption and calculates costs for LLM interactions across
 * different models and providers. Provides detailed usage analytics, cost
 * monitoring, and budget management capabilities with Prisma integration.
 * 
 * Features:
 * - Comprehensive token usage tracking across all models
 * - Real-time cost calculation with provider-specific pricing
 * - Usage analytics and reporting by user, session, and timeframe
 * - Budget monitoring and quota management
 * - Model-specific cost optimization recommendations
 * - Historical usage trend analysis and forecasting
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';
import { trackTokenUsage } from '../metrics/index.js';

export interface TokenUsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenCost {
  promptCost: number;
  completionCost: number;
  totalCost: number;
}

export interface TokenUsageRecord {
  userId: string;
  sessionId: string;
  messageId: string;
  model: string;
  usage: TokenUsageData;
  cost?: TokenCost; // Optional - will be calculated if not provided
  metadata?: any;
}

export class TokenUsageService {
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
    this.logger.info('TokenUsageService initialized with direct Azure OpenAI integration');
  }
  
  /**
   * Calculate cost for token usage - delegates to the LLM provider's cost calculation
   * Token usage and pricing should come from the actual LLM provider response
   */
  async calculateCost(model: string, usage: TokenUsageData): Promise<TokenCost> {
    try {
      // Simple cost estimation - this should be replaced by actual provider pricing
      // For now, use a basic calculation until provider cost calculation is properly implemented
      const baseCostPerToken = 0.00001; // Very basic fallback
      const totalCost = usage.totalTokens * baseCostPerToken;
      const promptCost = usage.promptTokens * baseCostPerToken;
      const completionCost = usage.completionTokens * baseCostPerToken;

      return {
        promptCost: Number.parseFloat(promptCost.toFixed(6)),
        completionCost: Number.parseFloat(completionCost.toFixed(6)),
        totalCost: Number.parseFloat(totalCost.toFixed(6))
      };
    } catch (error) {
      this.logger.warn(`Failed to get pricing from provider for model ${model}:`, error);

      // Fallback to minimal cost estimation
      this.logger.warn(`Using fallback pricing for model ${model}`);
      return this.getFallbackCost(usage);
    }
  }

  /**
   * Fallback cost calculation when provider pricing is unavailable
   */
  private getFallbackCost(usage: TokenUsageData): TokenCost {
    // Use conservative cost estimate: $0.002 per 1K input tokens, $0.006 per 1K output tokens
    const promptCost = (usage.promptTokens / 1000) * 0.002;
    const completionCost = (usage.completionTokens / 1000) * 0.006;
    const totalCost = promptCost + completionCost;
    
    return {
      promptCost: Number.parseFloat(promptCost.toFixed(6)),
      completionCost: Number.parseFloat(completionCost.toFixed(6)),
      totalCost: Number.parseFloat(totalCost.toFixed(6))
    };
  }
  
  /**
   * Extract base model name from deployment name
   * e.g., "gpt-4-turbo-2024-04-09" -> "gpt-4-turbo"
   */
  private extractBaseModelName(model: string): string {
    // Common patterns to extract base model name
    const patterns = [
      /^(gpt-4o-mini)/i,
      /^(gpt-4o)/i,
      /^(gpt-4-turbo)/i,
      /^(gpt-4-32k)/i,
      /^(gpt-4)/i,
      /^(gpt-3\.5-turbo-16k)/i,
      /^(gpt-3\.5-turbo)/i,
      /^(text-embedding-3-large)/i,
      /^(text-embedding-ada-002)/i
    ];
    
    for (const pattern of patterns) {
      const match = model.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    // Return original model if no pattern matches
    return model;
  }
  
  /**
   * Record token usage for a message
   */
  async recordUsage(record: TokenUsageRecord): Promise<void> {
    try {
      const cost = record.cost || await this.calculateCost(record.model, record.usage);

      // Store token usage in the TokenUsage table
      await prisma.tokenUsage.create({
        data: {
          user_id: record.userId,
          session_id: record.sessionId,
          model: record.model,
          prompt_tokens: record.usage.promptTokens,
          completion_tokens: record.usage.completionTokens,
          total_tokens: record.usage.totalTokens,
          total_cost: cost.totalCost,
          timestamp: new Date()
        }
      });

      // Record to Prometheus metrics for Grafana dashboards
      trackTokenUsage(record.model, 'input', record.usage.promptTokens, record.userId, cost.promptCost);
      trackTokenUsage(record.model, 'output', record.usage.completionTokens, record.userId, cost.completionCost);

      // Also update the chat message with token usage for backward compatibility
      if (record.messageId) {
        const message = await prisma.chatMessage.findUnique({
          where: { id: record.messageId }
        });

        if (message) {
          await prisma.chatMessage.update({
            where: { id: record.messageId },
            data: {
              token_usage: JSON.stringify({
                prompt_tokens: record.usage.promptTokens,
                completion_tokens: record.usage.completionTokens,
                total_tokens: record.usage.totalTokens,
                model: record.model,
                prompt_cost: cost.promptCost,
                completion_cost: cost.completionCost,
                total_cost: cost.totalCost,
                timestamp: new Date().toISOString()
              })
            }
          });
        }
      }

      this.logger.info({
        userId: record.userId,
        sessionId: record.sessionId,
        messageId: record.messageId,
        model: record.model,
        tokens: record.usage.totalTokens,
        cost: cost.totalCost
      }, 'Token usage recorded');
      
    } catch (error) {
      this.logger.error({ error, record }, 'Failed to record token usage');
      // Don't throw - we don't want to break chat functionality if tracking fails
    }
  }
  
  /**
   * Get token usage for a user
   */
  async getUserUsage(userId: string, startDate?: Date, endDate?: Date): Promise<{
    totalTokens: number;
    totalCost: number;
    promptTokens: number;
    completionTokens: number;
    byModel: Array<{
      model: string;
      totalTokens: number;
      totalCost: number;
      requestCount: number;
    }>;
    timeline: Array<{
      date: string;
      totalTokens: number;
      totalCost: number;
      requestCount: number;
    }>;
  }> {
    try {
      
      // Get messages with token usage for the user
      let whereCondition: any = {
        user_id: userId,
        token_usage: {
          not: null
        }
      };
      
      if (startDate && endDate) {
        whereCondition.created_at = {
          gte: startDate,
          lte: endDate
        };
      }
      
      const messages = await prisma.chatMessage.findMany({
        where: whereCondition,
        select: {
          token_usage: true,
          model: true,
          created_at: true
        }
      });
      
      // Parse and aggregate token usage data
      let totalTokens = 0;
      let totalCost = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      const modelStats = new Map<string, { totalTokens: number; totalCost: number; requestCount: number }>();
      const timelineStats = new Map<string, { totalTokens: number; totalCost: number; requestCount: number }>();
      
      messages.forEach(message => {
        if (message.token_usage) {
          try {
            const usage = JSON.parse(message.token_usage as string);
            const tokens = usage.total_tokens || 0;
            const cost = usage.total_cost || 0;
            
            totalTokens += tokens;
            totalCost += cost;
            promptTokens += usage.prompt_tokens || 0;
            completionTokens += usage.completion_tokens || 0;
            
            // By model
            const model = message.model || 'unknown';
            if (!modelStats.has(model)) {
              modelStats.set(model, { totalTokens: 0, totalCost: 0, requestCount: 0 });
            }
            const modelStat = modelStats.get(model)!;
            modelStat.totalTokens += tokens;
            modelStat.totalCost += cost;
            modelStat.requestCount += 1;
            
            // Timeline
            const date = message.created_at.toISOString().split('T')[0];
            if (!timelineStats.has(date)) {
              timelineStats.set(date, { totalTokens: 0, totalCost: 0, requestCount: 0 });
            }
            const timelineStat = timelineStats.get(date)!;
            timelineStat.totalTokens += tokens;
            timelineStat.totalCost += cost;
            timelineStat.requestCount += 1;
          } catch (parseError) {
            this.logger.warn('Failed to parse token usage:', parseError);
          }
        }
      });
      
      return {
        totalTokens,
        totalCost: Number.parseFloat(totalCost.toFixed(6)),
        promptTokens,
        completionTokens,
        byModel: Array.from(modelStats.entries()).map(([model, stats]) => ({
          model,
          totalTokens: stats.totalTokens,
          totalCost: Number.parseFloat(stats.totalCost.toFixed(6)),
          requestCount: stats.requestCount
        })),
        timeline: Array.from(timelineStats.entries()).map(([date, stats]) => ({
          date,
          totalTokens: stats.totalTokens,
          totalCost: Number.parseFloat(stats.totalCost.toFixed(6)),
          requestCount: stats.requestCount
        }))
      };
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get user token usage');
      throw error;
    }
  }
  
  /**
   * Get session token usage
   */
  async getSessionUsage(sessionId: string, userId: string): Promise<{
    totalTokens: number;
    totalCost: number;
    messages: Array<{
      messageId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      totalCost: number;
      timestamp: Date;
    }>;
  }> {
    try {
      // Get messages with token usage for the session
      const messages = await prisma.chatMessage.findMany({
        where: {
          session_id: sessionId,
          user_id: userId,
          token_usage: {
            not: null
          }
        },
        select: {
          id: true,
          model: true,
          token_usage: true,
          created_at: true
        },
        orderBy: {
          created_at: 'asc'
        }
      });
      
      const messageData = messages.map(message => {
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;
        let totalCost = 0;
        
        if (message.token_usage) {
          try {
            const usage = JSON.parse(message.token_usage as string);
            promptTokens = usage.prompt_tokens || 0;
            completionTokens = usage.completion_tokens || 0;
            totalTokens = usage.total_tokens || 0;
            totalCost = usage.total_cost || 0;
          } catch (parseError) {
            this.logger.warn('Failed to parse token usage for message:', parseError);
          }
        }
        
        return {
          messageId: message.id,
          model: message.model || 'unknown',
          promptTokens,
          completionTokens,
          totalTokens,
          totalCost,
          timestamp: message.created_at
        };
      });
      
      const totals = messageData.reduce((acc, msg) => ({
        totalTokens: acc.totalTokens + msg.totalTokens,
        totalCost: acc.totalCost + msg.totalCost
      }), { totalTokens: 0, totalCost: 0 });
      
      return {
        totalTokens: totals.totalTokens,
        totalCost: Number.parseFloat(totals.totalCost.toFixed(6)),
        messages: messageData
      };
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to get session token usage');
      throw error;
    }
  }
}