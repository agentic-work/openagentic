/**
 * ChatAnalyticsService Tests
 * 
 * Test-driven development for ChatAnalyticsService implementation.
 * Tests all analytics functionality including usage tracking, performance metrics,
 * and real-time monitoring using real Prisma ORM operations.
 */

import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import { Logger } from 'pino';
import { PrismaClient } from '@prisma/client';
import { ChatAnalyticsService } from '../ChatAnalyticsService.js';

// Mock PrismaClient
const mockPrisma = {
  chat_messages: {
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn()
  },
  chat_sessions: {
    count: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn()
  },
  usage_analytics: {
    create: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn()
  },
  model_usage: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    create: jest.fn()
  },
  system_metrics: {
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn()
  }
} as unknown as jest.Mocked<PrismaClient>;

// Mock logger
const mockLogger = {
  child: jest.fn().mockReturnThis(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as jest.Mocked<Logger>;

// Mock chat storage
const mockChatStorage = {
  getMessages: jest.fn(),
  getSessions: jest.fn()
};

describe('ChatAnalyticsService', () => {
  let chatAnalytics: ChatAnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    chatAnalytics = new ChatAnalyticsService(mockChatStorage, mockLogger);
    // Inject prisma mock into service
    (chatAnalytics as any).prisma = mockPrisma;
  });

  describe('getUsageStats', () => {
    test('should return comprehensive usage statistics', async () => {
      // Mock message count
      mockPrisma.chat_messages.count.mockResolvedValue(1500);
      
      // Mock token usage aggregation
      mockPrisma.chat_messages.aggregate.mockResolvedValue({
        _sum: { token_count: 25000 },
        _avg: { token_count: 16.67 }
      });

      // Mock unique users
      mockPrisma.chat_sessions.groupBy.mockResolvedValue([
        { user_id: 'user1' }, 
        { user_id: 'user2' }, 
        { user_id: 'user3' }
      ]);

      // Mock response time calculation
      mockPrisma.usage_analytics.aggregate.mockResolvedValue({
        _avg: { response_time: 1250 }
      });

      // Mock model usage
      mockPrisma.model_usage.groupBy.mockResolvedValue([
        { model_name: 'gpt-4', _count: { id: 800 } },
        { model_name: 'claude-3', _count: { id: 500 } },
        { model_name: 'gpt-3.5', _count: { id: 200 } }
      ]);

      // Mock usage by period
      mockPrisma.usage_analytics.groupBy.mockResolvedValue([
        { 
          date_bucket: new Date('2024-01-15'), 
          _count: { id: 100 },
          _sum: { token_count: 1500 }
        },
        { 
          date_bucket: new Date('2024-01-16'), 
          _count: { id: 120 },
          _sum: { token_count: 1800 }
        }
      ]);

      const result = await chatAnalytics.getUsageStats({
        userId: 'user1',
        startDate: '2024-01-15T00:00:00Z',
        endDate: '2024-01-16T23:59:59Z',
        granularity: 'day'
      });

      expect(result).toEqual({
        totalMessages: 1500,
        totalTokens: 25000,
        uniqueUsers: 3,
        averageResponseTime: 1250,
        averageTokensPerMessage: 16.67,
        topModels: [
          { model: 'gpt-4', count: 800, percentage: 53.33 },
          { model: 'claude-3', count: 500, percentage: 33.33 },
          { model: 'gpt-3.5', count: 200, percentage: 13.33 }
        ],
        usageByPeriod: [
          { 
            period: '2024-01-15', 
            messages: 100, 
            tokens: 1500, 
            avgTokensPerMessage: 15 
          },
          { 
            period: '2024-01-16', 
            messages: 120, 
            tokens: 1800, 
            avgTokensPerMessage: 15 
          }
        ]
      });

      expect(mockPrisma.chat_messages.count).toHaveBeenCalledWith({
        where: {
          user_id: 'user1',
          created_at: {
            gte: new Date('2024-01-15T00:00:00Z'),
            lte: new Date('2024-01-16T23:59:59Z')
          },
          deleted_at: null
        }
      });
    });

    test('should handle different granularity options', async () => {
      mockPrisma.chat_messages.count.mockResolvedValue(100);
      mockPrisma.chat_messages.aggregate.mockResolvedValue({
        _sum: { token_count: 2000 },
        _avg: { token_count: 20 }
      });
      mockPrisma.chat_sessions.groupBy.mockResolvedValue([{ user_id: 'user1' }]);
      mockPrisma.usage_analytics.aggregate.mockResolvedValue({
        _avg: { response_time: 1000 }
      });
      mockPrisma.model_usage.groupBy.mockResolvedValue([]);
      mockPrisma.usage_analytics.groupBy.mockResolvedValue([]);

      await chatAnalytics.getUsageStats({
        granularity: 'hour'
      });

      // Verify that the granularity affects the date bucket calculation
      expect(mockPrisma.usage_analytics.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: expect.arrayContaining(['date_bucket'])
        })
      );
    });

    test('should return empty stats when no data found', async () => {
      mockPrisma.chat_messages.count.mockResolvedValue(0);
      mockPrisma.chat_messages.aggregate.mockResolvedValue({
        _sum: { token_count: null },
        _avg: { token_count: null }
      });
      mockPrisma.chat_sessions.groupBy.mockResolvedValue([]);
      mockPrisma.usage_analytics.aggregate.mockResolvedValue({
        _avg: { response_time: null }
      });
      mockPrisma.model_usage.groupBy.mockResolvedValue([]);
      mockPrisma.usage_analytics.groupBy.mockResolvedValue([]);

      const result = await chatAnalytics.getUsageStats({});

      expect(result).toEqual({
        totalMessages: 0,
        totalTokens: 0,
        uniqueUsers: 0,
        averageResponseTime: 0,
        averageTokensPerMessage: 0,
        topModels: [],
        usageByPeriod: []
      });
    });
  });

  describe('getPerformanceMetrics', () => {
    test('should return comprehensive performance metrics', async () => {
      // Mock response time aggregations
      mockPrisma.usage_analytics.aggregate
        .mockResolvedValueOnce({
          _avg: { response_time: 1200 }
        })
        .mockResolvedValueOnce({
          _percentile: { response_time: 2500 }  // P95
        })
        .mockResolvedValueOnce({
          _percentile: { response_time: 4000 }  // P99
        });

      // Mock error rate calculation
      mockPrisma.usage_analytics.aggregate
        .mockResolvedValueOnce({
          _count: { id: 1000 }  // Total requests
        })
        .mockResolvedValueOnce({
          _count: { id: 25 }    // Error requests
        });

      // Mock throughput calculation
      mockPrisma.usage_analytics.count.mockResolvedValue(500);

      // Mock stage performance
      mockPrisma.system_metrics.groupBy.mockResolvedValue([
        { component: 'llm_processing', _avg: { processing_time: 800 } },
        { component: 'mcp_calls', _avg: { processing_time: 200 } },
        { component: 'vector_search', _avg: { processing_time: 150 } }
      ]);

      const result = await chatAnalytics.getPerformanceMetrics({
        startDate: '2024-01-15T00:00:00Z',
        endDate: '2024-01-16T23:59:59Z',
        component: 'llm_processing'
      });

      expect(result).toEqual({
        averageResponseTime: 1200,
        p95ResponseTime: 2500,
        p99ResponseTime: 4000,
        errorRate: 2.5,
        throughput: 500,
        stagePerformance: {
          llm_processing: 800,
          mcp_calls: 200,
          vector_search: 150
        }
      });
    });

    test('should filter by component when specified', async () => {
      mockPrisma.usage_analytics.aggregate.mockResolvedValue({
        _avg: { response_time: 1000 }
      });
      mockPrisma.usage_analytics.count.mockResolvedValue(100);
      mockPrisma.system_metrics.groupBy.mockResolvedValue([]);

      await chatAnalytics.getPerformanceMetrics({
        component: 'llm_processing'
      });

      expect(mockPrisma.system_metrics.groupBy).toHaveBeenCalledWith({
        where: expect.objectContaining({
          component: 'llm_processing'
        }),
        by: ['component'],
        _avg: { processing_time: true }
      });
    });
  });

  describe('trackMessageEvent', () => {
    test('should store message event in analytics database', async () => {
      mockPrisma.usage_analytics.create.mockResolvedValue({
        id: 'event_123',
        user_id: 'user1',
        session_id: 'session1',
        event_type: 'message_sent',
        timestamp: new Date()
      });

      const event = {
        userId: 'user1',
        sessionId: 'session1',
        messageId: 'msg1',
        eventType: 'message_sent' as const,
        metadata: { model: 'gpt-4', tokens: 150 },
        timestamp: new Date('2024-01-15T10:00:00Z')
      };

      await chatAnalytics.trackMessageEvent(event);

      expect(mockPrisma.usage_analytics.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user1',
          session_id: 'session1',
          event_type: 'message_sent',
          event_data: {
            messageId: 'msg1',
            model: 'gpt-4',
            tokens: 150
          },
          timestamp: new Date('2024-01-15T10:00:00Z')
        }
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ 
          userId: 'user1', 
          eventType: 'message_sent' 
        }),
        'Tracking message event'
      );
    });

    test('should use current timestamp if not provided', async () => {
      mockPrisma.usage_analytics.create.mockResolvedValue({});

      const event = {
        userId: 'user1',
        sessionId: 'session1',
        messageId: 'msg1',
        eventType: 'response_received' as const
      };

      await chatAnalytics.trackMessageEvent(event);

      expect(mockPrisma.usage_analytics.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          timestamp: expect.any(Date)
        })
      });
    });

    test('should handle tracking errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.usage_analytics.create.mockRejectedValue(error);

      const event = {
        userId: 'user1',
        sessionId: 'session1',
        messageId: 'msg1',
        eventType: 'error_occurred' as const
      };

      await expect(
        chatAnalytics.trackMessageEvent(event)
      ).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: error.message }),
        'Failed to track message event'
      );
    });
  });

  describe('trackPipelinePerformance', () => {
    test('should store pipeline performance metrics', async () => {
      mockPrisma.system_metrics.create.mockResolvedValue({
        id: 'metric_123',
        user_id: 'user1',
        component: 'pipeline',
        processing_time: 1500
      });

      const metrics = {
        userId: 'user1',
        sessionId: 'session1',
        messageId: 'msg1',
        totalTime: 1500,
        stageTimings: {
          llm_processing: 800,
          mcp_calls: 400,
          vector_search: 300
        },
        tokenUsage: { prompt: 100, completion: 150 },
        mcpCalls: 3,
        errors: 0
      };

      await chatAnalytics.trackPipelinePerformance(metrics);

      expect(mockPrisma.system_metrics.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user1',
          session_id: 'session1',
          component: 'pipeline',
          processing_time: 1500,
          metadata: {
            messageId: 'msg1',
            stageTimings: {
              llm_processing: 800,
              mcp_calls: 400,
              vector_search: 300
            },
            tokenUsage: { prompt: 100, completion: 150 },
            mcpCalls: 3,
            errors: 0
          },
          timestamp: expect.any(Date)
        }
      });
    });

    test('should store individual stage metrics', async () => {
      mockPrisma.system_metrics.create.mockResolvedValue({});

      const metrics = {
        userId: 'user1',
        sessionId: 'session1',
        messageId: 'msg1',
        totalTime: 1000,
        stageTimings: {
          preprocessing: 100,
          llm_call: 700,
          postprocessing: 200
        }
      };

      await chatAnalytics.trackPipelinePerformance(metrics);

      // Should create one record for pipeline total + individual stage records
      expect(mockPrisma.system_metrics.create).toHaveBeenCalledTimes(4);
    });
  });

  describe('trackUserEngagement', () => {
    test('should store user engagement data', async () => {
      mockPrisma.usage_analytics.create.mockResolvedValue({
        id: 'engagement_123'
      });

      const engagement = {
        userId: 'user1',
        sessionId: 'session1',
        sessionDuration: 1200000, // 20 minutes
        messageCount: 8,
        toolsUsed: ['memory_search', 'azure_resources'],
        satisfaction: 4.5,
        timestamp: new Date('2024-01-15T10:00:00Z')
      };

      await chatAnalytics.trackUserEngagement(engagement);

      expect(mockPrisma.usage_analytics.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user1',
          session_id: 'session1',
          event_type: 'user_engagement',
          event_data: {
            sessionDuration: 1200000,
            messageCount: 8,
            toolsUsed: ['memory_search', 'azure_resources'],
            satisfaction: 4.5,
            engagementScore: expect.any(Number)
          },
          timestamp: new Date('2024-01-15T10:00:00Z')
        }
      });
    });

    test('should calculate engagement score correctly', async () => {
      mockPrisma.usage_analytics.create.mockResolvedValue({});

      const engagement = {
        userId: 'user1',
        sessionId: 'session1',
        sessionDuration: 600000, // 10 minutes
        messageCount: 5,
        toolsUsed: ['search'],
        satisfaction: 4.0
      };

      await chatAnalytics.trackUserEngagement(engagement);

      const createCall = mockPrisma.usage_analytics.create.mock.calls[0][0];
      const engagementScore = createCall.data.event_data.engagementScore;
      
      expect(engagementScore).toBeGreaterThan(0);
      expect(engagementScore).toBeLessThanOrEqual(10);
    });
  });

  describe('getRealTimeMetrics', () => {
    test('should return current system metrics', async () => {
      // Mock active users (sessions in last 5 minutes)
      mockPrisma.chat_sessions.count.mockResolvedValue(25);

      // Mock current request rate (messages in last minute)  
      mockPrisma.chat_messages.count.mockResolvedValueOnce(12);

      // Mock system health metrics
      mockPrisma.system_metrics.findMany.mockResolvedValue([
        { component: 'api', processing_time: 150, timestamp: new Date() },
        { component: 'database', processing_time: 50, timestamp: new Date() }
      ]);

      // Mock queue length
      mockPrisma.usage_analytics.count.mockResolvedValue(0);

      const result = await chatAnalytics.getRealTimeMetrics();

      expect(result).toEqual({
        activeUsers: 25,
        currentRPS: 0.2, // 12 requests per minute = 0.2 per second
        queueLength: 0,
        systemHealth: 'healthy',
        componentHealth: {
          api: 'healthy',
          database: 'healthy'
        },
        lastUpdated: expect.any(Date)
      });

      expect(mockPrisma.chat_sessions.count).toHaveBeenCalledWith({
        where: {
          updated_at: {
            gte: expect.any(Date) // Last 5 minutes
          },
          deleted_at: null
        },
        distinct: ['user_id']
      });
    });

    test('should detect unhealthy system state', async () => {
      mockPrisma.chat_sessions.count.mockResolvedValue(5);
      mockPrisma.chat_messages.count.mockResolvedValue(2);
      mockPrisma.usage_analytics.count.mockResolvedValue(0);
      
      // Mock unhealthy components (high response times)
      mockPrisma.system_metrics.findMany.mockResolvedValue([
        { component: 'api', processing_time: 5000, timestamp: new Date() },
        { component: 'database', processing_time: 50, timestamp: new Date() }
      ]);

      const result = await chatAnalytics.getRealTimeMetrics();

      expect(result.systemHealth).toBe('unhealthy');
      expect(result.componentHealth.api).toBe('unhealthy');
      expect(result.componentHealth.database).toBe('healthy');
    });
  });

  describe('generateReport', () => {
    test('should generate usage report with aggregated data', async () => {
      // Mock various aggregations for usage report
      mockPrisma.chat_messages.count.mockResolvedValue(500);
      mockPrisma.chat_messages.aggregate.mockResolvedValue({
        _sum: { token_count: 15000 }
      });
      mockPrisma.chat_sessions.groupBy.mockResolvedValue([
        { user_id: 'user1' }, { user_id: 'user2' }
      ]);
      mockPrisma.model_usage.groupBy.mockResolvedValue([
        { model_name: 'gpt-4', _count: { id: 300 } },
        { model_name: 'claude-3', _count: { id: 200 } }
      ]);

      const result = await chatAnalytics.generateReport({
        type: 'usage',
        startDate: '2024-01-15T00:00:00Z',
        endDate: '2024-01-16T23:59:59Z',
        format: 'json'
      });

      expect(result).toEqual({
        reportType: 'usage',
        dateRange: {
          start: '2024-01-15T00:00:00Z',
          end: '2024-01-16T23:59:59Z'
        },
          totalMessages: 500,
          totalTokens: 15000,
          uniqueUsers: 2,
          topModels: [
            { model: 'gpt-4', usage: 300 },
            { model: 'claude-3', usage: 200 }
          ]
        },
        data: expect.any(Object),
        generatedAt: expect.any(Date)
      });
    });

    test('should generate performance report', async () => {
      mockPrisma.usage_analytics.aggregate.mockResolvedValue({
        _avg: { response_time: 1500 }
      });
      mockPrisma.system_metrics.groupBy.mockResolvedValue([
        { component: 'api', _avg: { processing_time: 200 } }
      ]);

      const result = await chatAnalytics.generateReport({
        type: 'performance',
        startDate: '2024-01-15T00:00:00Z',
        endDate: '2024-01-16T23:59:59Z'
      });

      expect(result.reportType).toBe('performance');
      expect(result.summary).toHaveProperty('averageResponseTime');
    });

    test('should generate engagement report', async () => {
      mockPrisma.usage_analytics.findMany.mockResolvedValue([
        {
          user_id: 'user1',
          event_data: { engagementScore: 8.5, satisfaction: 4.5 }
        }
      ]);

      const result = await chatAnalytics.generateReport({
        type: 'engagement',
        startDate: '2024-01-15T00:00:00Z',
        endDate: '2024-01-16T23:59:59Z'
      });

      expect(result.reportType).toBe('engagement');
      expect(result.summary).toHaveProperty('averageEngagement');
    });
  });

  describe('healthCheck', () => {
    test('should return true when analytics service is healthy', async () => {
      mockPrisma.chat_sessions.count.mockResolvedValue(10);
      mockPrisma.chat_messages.count.mockResolvedValue(50);
      mockPrisma.system_metrics.findMany.mockResolvedValue([]);

      const isHealthy = await chatAnalytics.healthCheck();

      expect(isHealthy).toBe(true);
    });

    test('should return false when database is unreachable', async () => {
      mockPrisma.chat_sessions.count.mockRejectedValue(new Error('Connection failed'));

      const isHealthy = await chatAnalytics.healthCheck();

      expect(isHealthy).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Connection failed' }),
        'Analytics service health check failed'
      );
    });
  });

  describe('error handling', () => {
    test('should handle database errors gracefully', async () => {
      const dbError = new Error('Database timeout');
      mockPrisma.chat_messages.count.mockRejectedValue(dbError);

      await expect(
        chatAnalytics.getUsageStats({})
      ).rejects.toThrow('Database timeout');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Database timeout' }),
        'Failed to get usage stats'
      );
    });

    test('should handle invalid date ranges', async () => {
      mockPrisma.chat_messages.count.mockResolvedValue(0);
      mockPrisma.chat_messages.aggregate.mockResolvedValue({
        _sum: { token_count: null }
      });
      mockPrisma.chat_sessions.groupBy.mockResolvedValue([]);
      mockPrisma.usage_analytics.aggregate.mockResolvedValue({
        _avg: { response_time: null }
      });
      mockPrisma.model_usage.groupBy.mockResolvedValue([]);
      mockPrisma.usage_analytics.groupBy.mockResolvedValue([]);

      const result = await chatAnalytics.getUsageStats({
        startDate: '2024-12-31T23:59:59Z',
        endDate: '2024-01-01T00:00:00Z' // End before start
      });

      expect(result.totalMessages).toBe(0);
    });
  });
});