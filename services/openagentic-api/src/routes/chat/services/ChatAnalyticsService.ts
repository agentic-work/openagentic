/**
 * Chat Analytics Service
 * 
 * Handles usage tracking, performance metrics, and analytics data
 * using real Prisma ORM operations for production-ready analytics.
 */

import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../utils/prisma.js';
import type { Logger } from 'pino';

export interface UsageStats {
  totalMessages: number;
  totalTokens: number;
  uniqueUsers: number;
  averageResponseTime: number;
  averageTokensPerMessage: number;
  topModels: Array<{
    model: string;
    count: number;
    percentage: number;
  }>;
  usageByPeriod: Array<{
    period: string;
    messages: number;
    tokens: number;
    avgTokensPerMessage: number;
  }>;
}

export interface PerformanceMetrics {
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  throughput: number;
  stagePerformance: Record<string, number>;
}

export interface RealTimeMetrics {
  activeUsers: number;
  currentRPS: number;
  queueLength: number;
  systemHealth: 'healthy' | 'degraded' | 'unhealthy';
  componentHealth: Record<string, 'healthy' | 'degraded' | 'unhealthy'>;
  lastUpdated: Date;
}

export class ChatAnalyticsService {
  private prisma: PrismaClient;

  constructor(
    private chatStorage: any,
    private logger: any
  ) {
    this.logger = logger.child({ service: 'ChatAnalyticsService' }) as Logger;
    this.prisma = prisma;
  }

  /**
   * Get usage statistics using real Prisma ORM queries
   */
  async getUsageStats(query: {
    userId?: string;
    startDate?: string;
    endDate?: string;
    granularity?: 'hour' | 'day' | 'week' | 'month';
  }): Promise<UsageStats> {
    try {
      this.logger.debug({ query }, 'Getting usage stats');
      
      // Build date filters
      const whereClause: any = {
        deleted_at: null
      };
      
      if (query.userId) {
        whereClause.user_id = query.userId;
      }
      
      if (query.startDate || query.endDate) {
        whereClause.created_at = {};
        if (query.startDate) {
          whereClause.created_at.gte = new Date(query.startDate);
        }
        if (query.endDate) {
          whereClause.created_at.lte = new Date(query.endDate);
        }
      }

      // Get total message count
      const totalMessages = await this.prisma.chatMessage.count({
        where: whereClause
      });

      // Get token usage aggregation from TokenUsage table
      const tokenWhereClause: any = {};
      if (query.startDate || query.endDate) {
        tokenWhereClause.timestamp = {};
        if (query.startDate) {
          tokenWhereClause.timestamp.gte = new Date(query.startDate);
        }
        if (query.endDate) {
          tokenWhereClause.timestamp.lte = new Date(query.endDate);
        }
      }
      if (query.userId) {
        tokenWhereClause.user_id = query.userId;
      }

      const tokenAggregation = await this.prisma.tokenUsage.aggregate({
        where: tokenWhereClause,
        _sum: { total_tokens: true },
        _avg: { total_tokens: true }
      });

      const totalTokens = tokenAggregation._sum.total_tokens || 0;
      const averageTokensPerMessage = tokenAggregation._avg.total_tokens || 0;

      // Get unique users count
      const uniqueUsersData = await this.prisma.chatSession.groupBy({
        by: ['user_id'],
        where: {
          created_at: whereClause.created_at,
          deleted_at: null
        }
      });
      const uniqueUsers = uniqueUsersData.length;

      // Get average response time from chat metrics
      const responseTimeAgg = await this.prisma.chatMetrics.aggregate({
        where: {
          created_at: whereClause.created_at
        },
        _avg: { response_time: true }
      });
      const averageResponseTime = responseTimeAgg._avg.response_time || 0;

      // Get top models usage
      const modelUsage = await this.prisma.tokenUsage.groupBy({
        by: ['model'],
        where: tokenWhereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      });

      const topModels = modelUsage.map(usage => ({
        model: usage.model,
        count: usage._count.id,
        percentage: totalMessages > 0 ? Number(((usage._count.id / totalMessages) * 100).toFixed(2)) : 0
      }));

      // Get usage by time period - simplified to daily aggregation
      const tokenUsageData = await this.prisma.tokenUsage.findMany({
        where: tokenWhereClause,
        select: {
          timestamp: true,
          total_tokens: true
        },
        orderBy: { timestamp: 'asc' }
      });

      // Group by day manually since timestamp groupBy is complex
      const dailyGroups = new Map<string, {count: number, tokens: number}>();
      tokenUsageData.forEach(record => {
        const day = this.createDateBucket(record.timestamp, query.granularity || 'day');
        const existing = dailyGroups.get(day) || {count: 0, tokens: 0};
        dailyGroups.set(day, {
          count: existing.count + 1,
          tokens: existing.tokens + record.total_tokens
        });
      });

      const usageByPeriod = Array.from(dailyGroups.entries()).map(([period, data]) => ({
        period,
        messages: data.count,
        tokens: data.tokens,
        avgTokensPerMessage: data.count > 0 ? Math.round(data.tokens / data.count) : 0
      }));

      return {
        totalMessages,
        totalTokens,
        uniqueUsers,
        averageResponseTime,
        averageTokensPerMessage,
        topModels,
        usageByPeriod
      };
      
    } catch (error) {
      this.logger.error({ 
        query,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to get usage stats');
      
      throw error;
    }
  }

  /**
   * Get performance metrics using real Prisma ORM queries
   */
  async getPerformanceMetrics(query: {
    startDate?: string;
    endDate?: string;
    component?: string;
  }): Promise<PerformanceMetrics> {
    try {
      this.logger.debug({ query }, 'Getting performance metrics');
      
      // Build date filters
      const timeFilter: any = {};
      if (query.startDate || query.endDate) {
        if (query.startDate) {
          timeFilter.gte = new Date(query.startDate);
        }
        if (query.endDate) {
          timeFilter.lte = new Date(query.endDate);
        }
      }

      // Get average response time from chat metrics
      const avgResponseTime = await this.prisma.chatMetrics.aggregate({
        where: {
          created_at: timeFilter
        },
        _avg: { response_time: true }
      });

      // Calculate percentiles (simplified - in production would use raw SQL for exact percentiles)
      const responseTimes = await this.prisma.chatMetrics.findMany({
        where: {
          created_at: timeFilter
        },
        select: { response_time: true },
        orderBy: { response_time: 'asc' }
      });

      const p95ResponseTime = this.calculatePercentile(responseTimes.map(r => r.response_time), 95);
      const p99ResponseTime = this.calculatePercentile(responseTimes.map(r => r.response_time), 99);

      // Calculate error rate from user activity
      const totalRequests = await this.prisma.userActivity.aggregate({
        where: {
          timestamp: timeFilter
        },
        _count: { id: true }
      });

      const errorRequests = await this.prisma.userActivity.aggregate({
        where: {
          activity_type: 'error_occurred',
          timestamp: timeFilter
        },
        _count: { id: true }
      });

      const errorRate = totalRequests._count.id > 0 
        ? Number(((errorRequests._count.id / totalRequests._count.id) * 100).toFixed(2))
        : 0;

      // Calculate throughput (requests per hour)
      const hoursDiff = this.getHoursDifference(query.startDate, query.endDate);
      const throughput = hoursDiff > 0 ? Math.round(totalRequests._count.id / hoursDiff) : 0;

      // Get stage performance metrics
      const stageMetricsWhere: any = {
        timestamp: timeFilter
      };
      if (query.component) {
        stageMetricsWhere.service_name = query.component;
      }

      const stageMetrics = await this.prisma.performanceMetrics.groupBy({
        by: ['service_name'],
        where: stageMetricsWhere,
        _avg: { metric_value: true }
      });

      const stagePerformance: Record<string, number> = {};
      stageMetrics.forEach(metric => {
        if (metric.service_name) {
          stagePerformance[metric.service_name] = Number(metric._avg.metric_value || 0);
        }
      });

      return {
        averageResponseTime: avgResponseTime._avg.response_time || 0,
        p95ResponseTime,
        p99ResponseTime,
        errorRate,
        throughput,
        stagePerformance
      };
      
    } catch (error) {
      this.logger.error({ 
        query,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to get performance metrics');
      
      throw error;
    }
  }

  /**
   * Track message event using real Prisma ORM operations
   */
  async trackMessageEvent(event: {
    userId: string;
    sessionId: string;
    messageId: string;
    eventType: 'message_sent' | 'response_received' | 'error_occurred';
    metadata?: Record<string, any>;
    timestamp?: Date;
  }): Promise<void> {
    try {
      this.logger.debug({ 
        userId: event.userId,
        eventType: event.eventType 
      }, 'Tracking message event');
      
      // Store event in analytics database using Prisma
      await this.prisma.usageAnalytics.create({
        data: {
          user_id: event.userId,
          session_id: event.sessionId,
          event_type: event.eventType,
          event_data: {
            messageId: event.messageId,
            responseTime: event.metadata?.responseTime,
            tokens: event.metadata?.tokens,
            ...event.metadata
          },
          timestamp: event.timestamp || new Date()
        }
      });

      // Update real-time metrics cache if needed
      if (event.eventType === 'error_occurred') {
        await this.updateSystemHealth(event.userId, 'error');
      }

      this.logger.debug({ 
        userId: event.userId,
        eventType: event.eventType,
        messageId: event.messageId 
      }, 'Message event tracked successfully');
      
    } catch (error) {
      this.logger.error({ 
        event,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to track message event');
    }
  }

  /**
   * Track pipeline performance using real Prisma ORM operations
   */
  async trackPipelinePerformance(metrics: {
    userId: string;
    sessionId: string;
    messageId: string;
    totalTime: number;
    stageTimings: Record<string, number>;
    tokenUsage?: any;
    mcpCalls?: number;
    errors?: number;
  }): Promise<void> {
    try {
      this.logger.debug({ 
        userId: metrics.userId,
        totalTime: metrics.totalTime,
        stageCount: Object.keys(metrics.stageTimings).length 
      }, 'Tracking pipeline performance');
      
      // Store overall pipeline performance
      await this.prisma.performanceMetrics.create({
        data: {
          metric_name: 'pipeline_performance',
          metric_value: metrics.totalTime,
          metric_type: 'duration_ms',
          service_name: 'chat_pipeline',
          measurement_unit: 'milliseconds',
          metadata: {
            userId: metrics.userId,
            sessionId: metrics.sessionId,
            messageId: metrics.messageId,
            stageTimings: metrics.stageTimings,
            tokenUsage: metrics.tokenUsage,
            mcpCalls: metrics.mcpCalls,
            errors: metrics.errors
          },
          timestamp: new Date()
        }
      });

      // Store individual stage performance metrics
      const stageMetrics = Object.entries(metrics.stageTimings).map(([stage, timing]) => ({
        metric_name: `stage_${stage}`,
        metric_value: timing,
        metric_type: 'duration_ms',
        service_name: 'chat_pipeline',
        measurement_unit: 'milliseconds',
        metadata: {
          userId: metrics.userId,
          sessionId: metrics.sessionId,
          messageId: metrics.messageId,
          pipelineTotal: metrics.totalTime,
          stage: stage
        },
        timestamp: new Date()
      }));

      if (stageMetrics.length > 0) {
        await this.prisma.performanceMetrics.createMany({
          data: stageMetrics
        });
      }

      // Update model usage tracking if token usage provided
      if (metrics.tokenUsage && metrics.tokenUsage.model) {
        await this.prisma.tokenUsage.create({
          data: {
            user_id: metrics.userId,
            session_id: metrics.sessionId,
            model: metrics.tokenUsage.model,
            prompt_tokens: metrics.tokenUsage.prompt || 0,
            completion_tokens: metrics.tokenUsage.completion || 0,
            total_tokens: (metrics.tokenUsage.prompt || 0) + (metrics.tokenUsage.completion || 0),
            total_cost: metrics.tokenUsage.cost || 0,
            timestamp: new Date()
          }
        });
      }

      this.logger.debug({ 
        userId: metrics.userId,
        totalTime: metrics.totalTime,
        stagesTracked: Object.keys(metrics.stageTimings).length
      }, 'Pipeline performance tracked successfully');
      
    } catch (error) {
      this.logger.error({ 
        metrics,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to track pipeline performance');
    }
  }

  /**
   * Track user engagement using real Prisma ORM operations
   */
  async trackUserEngagement(engagement: {
    userId: string;
    sessionId: string;
    sessionDuration?: number;
    messageCount?: number;
    toolsUsed?: string[];
    satisfaction?: number;
    timestamp?: Date;
  }): Promise<void> {
    try {
      this.logger.debug({ 
        userId: engagement.userId,
        messageCount: engagement.messageCount 
      }, 'Tracking user engagement');
      
      // Calculate engagement score based on multiple factors
      const engagementScore = this.calculateEngagementScore({
        sessionDuration: engagement.sessionDuration || 0,
        messageCount: engagement.messageCount || 0,
        toolsUsed: engagement.toolsUsed || [],
        satisfaction: engagement.satisfaction || 0
      });

      // Store engagement data using Prisma
      await this.prisma.usageAnalytics.create({
        data: {
          user_id: engagement.userId,
          session_id: engagement.sessionId,
          event_type: 'user_engagement',
          event_data: {
            sessionDuration: engagement.sessionDuration,
            messageCount: engagement.messageCount,
            toolsUsed: engagement.toolsUsed,
            satisfaction: engagement.satisfaction,
            engagementScore
          },
          timestamp: engagement.timestamp || new Date()
        }
      });

      // Update user profile engagement metrics if available
      await this.updateUserEngagementProfile(engagement.userId, {
        lastActiveAt: engagement.timestamp || new Date(),
        totalSessions: 1,
        averageEngagement: engagementScore,
        satisfaction: engagement.satisfaction
      });

      this.logger.debug({ 
        userId: engagement.userId,
        engagementScore,
        messageCount: engagement.messageCount
      }, 'User engagement tracked successfully');
      
    } catch (error) {
      this.logger.error({ 
        engagement,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to track user engagement');
    }
  }

  /**
   * Get real-time metrics using Prisma ORM queries
   */
  async getRealTimeMetrics(): Promise<RealTimeMetrics> {
    try {
      this.logger.debug('Getting real-time metrics');
      
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      // Get active users (sessions updated in last 5 minutes)
      const activeSessions = await this.prisma.chatSession.groupBy({
        by: ['user_id'],
        where: {
          updated_at: {
            gte: fiveMinutesAgo
          },
          deleted_at: null
        }
      });
      const activeUsersCount = activeSessions.length;

      // Get current request rate (messages in last minute)
      const recentMessagesCount = await this.prisma.chatMessage.count({
        where: {
          created_at: {
            gte: oneMinuteAgo
          },
          deleted_at: null
        }
      });
      const currentRPS = Number((recentMessagesCount / 60).toFixed(2));

      // Get system health from recent metrics
      const recentSystemMetrics = await this.prisma.performanceMetrics.findMany({
        where: {
          timestamp: {
            gte: fiveMinutesAgo
          }
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: 100
      });

      // Calculate component health
      const componentHealth: Record<string, 'healthy' | 'degraded' | 'unhealthy'> = {};
      const componentGroups = this.groupBy(recentSystemMetrics, 'service_name');
      
      Object.entries(componentGroups).forEach(([component, metrics]) => {
        const avgMetricValue = (metrics as any[]).reduce((sum, metric) => sum + Number(metric.metric_value || 0), 0) / (metrics as any[]).length;
        
        if (avgMetricValue < 1000) {
          componentHealth[component || 'unknown'] = 'healthy';
        } else if (avgMetricValue < 3000) {
          componentHealth[component || 'unknown'] = 'degraded';
        } else {
          componentHealth[component || 'unknown'] = 'unhealthy';
        }
      });

      // Determine overall system health
      const healthValues = Object.values(componentHealth);
      let systemHealth: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (healthValues.includes('unhealthy')) {
        systemHealth = 'unhealthy';
      } else if (healthValues.includes('degraded')) {
        systemHealth = 'degraded';
      }

      // Get queue length (approximate from pending analytics events)
      const queueLength = await this.prisma.userActivity.count({
        where: {
          activity_type: 'queue_item',
          timestamp: {
            gte: oneMinuteAgo
          }
        }
      });

      const realTimeMetrics: RealTimeMetrics = {
        activeUsers: activeUsersCount,
        currentRPS,
        queueLength,
        systemHealth,
        componentHealth,
        lastUpdated: now
      };

      this.logger.debug({ 
        activeUsers: activeUsersCount,
        currentRPS,
        systemHealth 
      }, 'Real-time metrics calculated');
      
      return realTimeMetrics;
      
    } catch (error) {
      this.logger.error({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to get real-time metrics');
      
      throw error;
    }
  }

  /**
   * Generate analytics report
   */
  async generateReport(options: {
    type: 'usage' | 'performance' | 'engagement';
    startDate: string;
    endDate: string;
    userId?: string;
    format?: 'json' | 'csv';
  }): Promise<any> {
    try {
      this.logger.info({ 
        type: options.type,
        startDate: options.startDate,
        endDate: options.endDate 
      }, 'Generating analytics report');
      
      const startDate = new Date(options.startDate);
      const endDate = new Date(options.endDate);
      
      const whereClause: any = {
        created_at: {
          gte: startDate,
          lte: endDate
        },
        deleted_at: null
      };
      
      if (options.userId) {
        whereClause.user_id = options.userId;
      }

      let reportData: any = {};
      
      if (options.type === 'usage') {
        // Generate usage report
        const [totalMessages, tokenAgg, uniqueUsers, modelUsage] = await Promise.all([
          this.prisma.chatMessage.count({ where: whereClause }),
          this.prisma.tokenUsage.aggregate({ 
            where: { 
              timestamp: whereClause.created_at,
              user_id: options.userId 
            },
            _sum: { total_tokens: true },
            _avg: { total_tokens: true }
          }),
          this.prisma.chatSession.groupBy({
            by: ['user_id'],
            where: {
              created_at: whereClause.created_at,
              deleted_at: null
            }
          }),
          this.prisma.tokenUsage.groupBy({
            by: ['model'],
            where: { 
              timestamp: whereClause.created_at,
              user_id: options.userId 
            },
            _count: { id: true },
            _sum: { total_tokens: true, total_cost: true },
            orderBy: { _count: { id: 'desc' } }
          })
        ]);
        
        // Get usage by period separately to avoid complex timestamp grouping
        const tokenUsageData = await this.prisma.tokenUsage.findMany({
          where: { 
            timestamp: whereClause.created_at,
            user_id: options.userId 
          },
          select: { timestamp: true, total_tokens: true },
          orderBy: { timestamp: 'asc' }
        });
        
        // Group by day manually
        const dailyUsageMap = new Map<string, {count: number, tokens: number}>();
        tokenUsageData.forEach(record => {
          const day = record.timestamp.toISOString().split('T')[0];
          const existing = dailyUsageMap.get(day) || {count: 0, tokens: 0};
          dailyUsageMap.set(day, {
            count: existing.count + 1,
            tokens: existing.tokens + record.total_tokens
          });
        });
        
        const usageByPeriod = Array.from(dailyUsageMap.entries()).map(([day, data]) => ({
          date: day,
          messages: data.count,
          tokens: data.tokens
        }));
        
        reportData = {
          summary: {
            totalMessages,
            totalTokens: tokenAgg._sum.total_tokens || 0,
            averageTokensPerMessage: tokenAgg._avg.total_tokens || 0,
            uniqueUsers: uniqueUsers.length,
            topModels: modelUsage.slice(0, 5).map(model => ({
              model: model.model,
              usage: model._count.id,
              tokens: model._sum.total_tokens || 0,
              cost: Number(model._sum.total_cost || 0)
            })),
            dailyUsage: usageByPeriod
          }
        };
        
      } else if (options.type === 'performance') {
        // Generate performance report
        const [avgResponseTime, systemMetrics, errorStats] = await Promise.all([
          this.prisma.chatMetrics.aggregate({
            where: {
              created_at: whereClause.created_at
            },
            _avg: { response_time: true },
            _count: { id: true }
          }),
          this.prisma.performanceMetrics.groupBy({
            by: ['service_name'],
            where: { timestamp: whereClause.created_at },
            _avg: { metric_value: true },
            _count: { id: true }
          }),
          this.prisma.userActivity.aggregate({
            where: {
              activity_type: 'error_occurred',
              timestamp: whereClause.created_at
            },
            _count: { id: true }
          })
        ]);
        
        const totalRequests = avgResponseTime._count.id;
        const errorCount = errorStats._count.id;
        
        reportData = {
          summary: {
            averageResponseTime: avgResponseTime._avg.response_time || 0,
            totalRequests,
            errorRate: totalRequests > 0 ? Number(((errorCount / totalRequests) * 100).toFixed(2)) : 0,
            componentPerformance: systemMetrics.map(metric => ({
              component: metric.service_name,
              averageTime: Number(metric._avg.metric_value || 0),
              requestCount: metric._count.id
            }))
          }
        };
        
      } else if (options.type === 'engagement') {
        // Generate engagement report
        const engagementData = await this.prisma.usageAnalytics.findMany({
          where: {
            event_type: 'user_engagement',
            timestamp: whereClause.created_at
          },
          select: {
            user_id: true,
            event_data: true,
            timestamp: true
          }
        });
        
        const avgEngagement = engagementData.reduce((sum, record) => {
          const score = (record.event_data as any)?.engagementScore || 0;
          return sum + score;
        }, 0) / (engagementData.length || 1);
        
        const avgSatisfaction = engagementData.reduce((sum, record) => {
          const satisfaction = (record.event_data as any)?.satisfaction || 0;
          return sum + satisfaction;
        }, 0) / (engagementData.length || 1);
        
        reportData = {
          summary: {
            totalEngagementEvents: engagementData.length,
            averageEngagement: Number(avgEngagement.toFixed(2)),
            averageSatisfaction: Number(avgSatisfaction.toFixed(2)),
            uniqueUsers: new Set(engagementData.map(e => e.user_id)).size
          },
          trends: engagementData.map(event => ({
            userId: event.user_id,
            timestamp: event.timestamp,
            engagement: (event.event_data as any)?.engagementScore || 0,
            satisfaction: (event.event_data as any)?.satisfaction || 0
          }))
        };
      }
      
      const report = {
        reportType: options.type,
        dateRange: {
          start: options.startDate,
          end: options.endDate
        },
        ...reportData,
        generatedAt: new Date(),
        format: options.format || 'json'
      };
      
      // Format as CSV if requested
      if (options.format === 'csv') {
        report.csvData = this.convertToCSV(reportData);
      }
      
      this.logger.info({ 
        type: options.type,
        recordCount: Object.keys(reportData).length 
      }, 'Analytics report generated successfully');
      
      return report;
      
    } catch (error) {
      this.logger.error({ 
        options,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to generate analytics report');
      
      throw error;
    }
  }

  /**
   * Health check for analytics service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic analytics functionality
      const metrics = await this.getRealTimeMetrics();
      return !!metrics;
      
    } catch (error) {
      this.logger.error({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Analytics service health check failed');
      
      return false;
    }
  }

  // Private helper methods

  private getDateBucketFormat(granularity: string): string {
    switch (granularity) {
      case 'hour':
        return 'YYYY-MM-DD HH:00:00';
      case 'day':
        return 'YYYY-MM-DD';
      case 'week':
        return 'YYYY-\\WW';
      case 'month':
        return 'YYYY-MM';
      default:
        return 'YYYY-MM-DD';
    }
  }

  private formatDateBucket(dateBucket: any, granularity: string): string {
    const date = new Date(dateBucket);
    switch (granularity) {
      case 'hour':
        return date.toISOString().slice(0, 13) + ':00:00';
      case 'day':
        return date.toISOString().slice(0, 10);
      case 'week':
        const weekNum = Math.ceil((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
        return `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
      case 'month':
        return date.toISOString().slice(0, 7);
      default:
        return date.toISOString().slice(0, 10);
    }
  }

  private createDateBucket(timestamp: Date, granularity: string): string {
    const date = new Date(timestamp);
    switch (granularity) {
      case 'hour':
        return date.toISOString().slice(0, 13) + ':00:00';
      case 'day':
        return date.toISOString().slice(0, 10);
      case 'week':
        const weekNum = Math.ceil((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
        return `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
      case 'month':
        return date.toISOString().slice(0, 7);
      default:
        return date.toISOString().slice(0, 10);
    }
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sorted[lower];
    }
    
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  private getHoursDifference(startDate?: string, endDate?: string): number {
    if (!startDate || !endDate) {
      return 24; // Default to 24 hours
    }
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  }

  private calculateEngagementScore(engagement: {
    sessionDuration: number;
    messageCount: number;
    toolsUsed: string[];
    satisfaction: number;
  }): number {
    // Normalize session duration (max 30 minutes = 3 points)
    const durationScore = Math.min(engagement.sessionDuration / (30 * 60 * 1000), 1) * 3;
    
    // Normalize message count (max 20 messages = 3 points)
    const messageScore = Math.min(engagement.messageCount / 20, 1) * 3;
    
    // Tool usage score (max 5 tools = 2 points)
    const toolScore = Math.min(engagement.toolsUsed.length / 5, 1) * 2;
    
    // Satisfaction score (max 5 = 2 points)
    const satisfactionScore = Math.min(engagement.satisfaction / 5, 1) * 2;
    
    return Number((durationScore + messageScore + toolScore + satisfactionScore).toFixed(2));
  }

  private async updateSystemHealth(userId: string, eventType: string): Promise<void> {
    try {
      // Update system health metrics based on events
      // For errors, we could track system degradation
      if (eventType === 'error') {
        await this.prisma.systemHealth.create({
          data: {
            service_name: 'chat_analytics',
            status: 'degraded',
            response_time_ms: 0,
            error_rate: 1.0,
            metadata: {
              userId,
              eventType,
              severity: 'warning',
              timestamp: new Date()
            },
            timestamp: new Date()
          }
        });
      }
    } catch (error) {
      this.logger.debug({ error, userId, eventType }, 'Failed to update system health');
    }
  }

  private async updateUserEngagementProfile(userId: string, profile: {
    lastActiveAt: Date;
    totalSessions: number;
    averageEngagement: number;
    satisfaction?: number;
  }): Promise<void> {
    try {
      // Store user engagement profile data
      // Since we don't have a dedicated user_profiles table, we'll store this as user activity
      await this.prisma.userActivity.create({
        data: {
          user_id: userId,
          activity_type: 'user_profile_update',
          activity_data: {
            lastActiveAt: profile.lastActiveAt,
            totalSessions: profile.totalSessions,
            averageEngagement: profile.averageEngagement,
            satisfaction: profile.satisfaction
          },
          timestamp: new Date()
        }
      });
    } catch (error) {
      this.logger.debug({ error, userId }, 'Failed to update user engagement profile');
    }
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((groups, item) => {
      const groupKey = String(item[key]);
      groups[groupKey] = groups[groupKey] || [];
      groups[groupKey].push(item);
      return groups;
    }, {} as Record<string, T[]>);
  }

  private convertToCSV(data: any): string {
    // Simple CSV conversion for report data
    try {
      if (!data || typeof data !== 'object') {
        return '';
      }
      
      const rows: string[] = [];
      
      // Add summary data as CSV
      if (data.summary) {
        rows.push('Metric,Value');
        Object.entries(data.summary).forEach(([key, value]) => {
          if (typeof value === 'object' && Array.isArray(value)) {
            // Handle arrays by joining
            rows.push(`${key},"${JSON.stringify(value)}"`);
          } else {
            rows.push(`${key},${value}`);
          }
        });
      }
      
      return rows.join('\n');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to convert data to CSV');
      return '';
    }
  }
}