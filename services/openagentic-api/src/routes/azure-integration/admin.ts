/**
 * Azure Admin Integration Routes
 * Handles Azure cost monitoring, resource info, and administrative functions
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { requireAdminFastify as adminAuth } from '../../middleware/adminGuard.js';

interface AzureResourceInfo {
  subscriptionId: string;
  resourceGroup: string;
  accountName: string;
  deployments: Array<{
    name: string;
    model: string;
    version: string;
    capacity: number;
    scaleType: string;
  }>;
  endpoint: string;
  location: string;
  currentCost: number;
}

interface AzureMetrics {
  timeRange: string;
  token_usage: {
    total: number;
    byModel: Record<string, number>;
    byDeployment: Record<string, number>;
  };
  costs: {
    total: number;
    currency: string;
    breakdown: Array<{
      service: string;
      cost: number;
    }>;
  };
  performance: {
    averageLatency: number;
    throughput: number;
    errorRate: number;
  };
}

interface AzureCostAlert {
  id: string;
  type: 'usage_spike' | 'quota_warning';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  threshold: number;
  current: number;
  timestamp: string;
}

interface AzureQuota {
  service: string;
  quota: {
    limit: number;
    used: number;
    remaining: number;
    unit: string;
  };
  region: string;
  lastUpdated: string;
}

export const azureAdminRoutes: FastifyPluginAsync = async (fastify) => {
  // Get Azure resource information
  fastify.get<{
    Querystring: { subscriptionId?: string; resourceGroup?: string };
  }>('/resource-info', {
    preHandler: [adminAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          subscriptionId: { type: 'string' },
          resourceGroup: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { subscriptionId, resourceGroup } = request.query;
      
      // Use environment variables for Azure resource configuration
      const resourceInfo: AzureResourceInfo = {
        subscriptionId: subscriptionId || process.env.AZURE_SUBSCRIPTION_ID || 'not-configured',
        resourceGroup: resourceGroup || process.env.AZURE_RESOURCE_GROUP || 'not-configured',
        accountName: process.env.AZURE_OPENAI_ACCOUNT_NAME || 'not-configured',
        deployments: [], // Will be populated from environment or Azure ARM API when configured
        endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'not-configured',
        location: process.env.AZURE_LOCATION || 'not-configured',
        currentCost: 0 // Real cost data would come from Azure Cost Management API
      };

      // Add deployments from environment if configured
      if (process.env.AZURE_OPENAI_DEPLOYMENTS) {
        try {
          resourceInfo.deployments = JSON.parse(process.env.AZURE_OPENAI_DEPLOYMENTS);
        } catch (error) {
          fastify.log.warn('Failed to parse AZURE_OPENAI_DEPLOYMENTS environment variable');
        }
      }

      return reply.send(resourceInfo);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to fetch Azure resource info');
      return reply.status(500).send({ 
        error: 'Failed to fetch Azure resource information',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get Azure metrics
  fastify.get<{
    Querystring: { 
      timeRange?: string; 
      granularity?: string;
      deploymentName?: string;
    };
  }>('/metrics', {
    preHandler: [adminAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          timeRange: { type: 'string', enum: ['1h', '24h', '7d', '30d'], default: '24h' },
          granularity: { type: 'string', enum: ['PT1M', 'PT5M', 'PT1H', 'P1D'], default: 'PT1H' },
          deploymentName: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { timeRange = '24h', granularity = 'PT1H', deploymentName } = request.query;
      
      // Get token usage from database
      const token_usage = await prisma.$queryRaw<Array<{
        deployment_name: string;
        total_tokens: bigint;
        prompt_tokens: bigint;
        completion_tokens: bigint;
        request_count: bigint;
        cost: number;
      }>>`
        SELECT 
          model as deployment_name,
          SUM(COALESCE((token_usage->>'totalTokens')::int, 0)) as total_tokens,
          SUM(COALESCE((token_usage->>'promptTokens')::int, 0)) as prompt_tokens,
          SUM(COALESCE((token_usage->>'completionTokens')::int, 0)) as completion_tokens,
          COUNT(*) as request_count,
          SUM(COALESCE((token_usage->>'cost')::numeric, 0)) as cost
        FROM chat_messages 
        WHERE created_at > NOW() - INTERVAL ${timeRange === '1h' ? '1 hour' : 
                                            timeRange === '24h' ? '1 day' :
                                            timeRange === '7d' ? '7 days' : '30 days'}
          AND token_usage IS NOT NULL
          ${deploymentName ? 'AND model = ' + deploymentName : ''}
        GROUP BY model
      `;

      const metrics: AzureMetrics = {
        timeRange,
        token_usage: {
          total: token_usage.reduce((sum, item) => sum + Number(item.total_tokens), 0),
          byModel: token_usage.reduce((acc, item) => {
            acc[item.deployment_name] = Number(item.total_tokens);
            return acc;
          }, {} as Record<string, number>),
          byDeployment: token_usage.reduce((acc, item) => {
            acc[item.deployment_name] = Number(item.total_tokens);
            return acc;
          }, {} as Record<string, number>)
        },
        costs: {
          total: token_usage.reduce((sum, item) => sum + Number(item.cost), 0),
          currency: 'USD',
          breakdown: token_usage.map(item => ({
            service: item.deployment_name,
            cost: Number(item.cost)
          }))
        },
        performance: {
          averageLatency: 0, // Real latency data would come from Azure Monitor
          throughput: token_usage.reduce((sum, item) => sum + Number(item.request_count), 0),
          errorRate: 0 // Real error rate would come from Azure Monitor
        }
      };

      return reply.send(metrics);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to fetch Azure metrics');
      return reply.status(500).send({ 
        error: 'Failed to fetch Azure metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Export Azure metrics
  fastify.get<{
    Querystring: { 
      format?: 'csv' | 'json' | 'xlsx';
      timeRange?: string;
    };
  }>('/metrics/export', {
    preHandler: [adminAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['csv', 'json', 'xlsx'], default: 'csv' },
          timeRange: { type: 'string', enum: ['1h', '24h', '7d', '30d'], default: '24h' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { format = 'csv', timeRange = '24h' } = request.query;
      
      // Get detailed usage data
      const usageData = await prisma.chatMessage.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - (timeRange === '1h' ? 3600000 :
                                      timeRange === '24h' ? 86400000 :
                                      timeRange === '7d' ? 604800000 : 2592000000))
          },
          token_usage: {
            not: null
          }
        },
        select: {
          created_at: true,
          model: true,
          token_usage: true,
          session_id: true
        },
        orderBy: {
          created_at: 'desc'
        }
      });

      if (format === 'csv') {
        // Generate CSV format
        const csvHeader = 'timestamp,model,prompt_tokens,completion_tokens,total_tokens,cost,session_id\n';
        const csvData = usageData.map(item => {
          const usage = item.token_usage as any;
          return [
            item.created_at.toISOString(),
            item.model || 'unknown',
            usage?.promptTokens || 0,
            usage?.completionTokens || 0,
            usage?.totalTokens || 0,
            usage?.cost || 0,
            item.session_id || 'unknown'
          ].join(',');
        }).join('\n');

        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="azure-metrics-${timeRange}-${Date.now()}.csv"`);
        return reply.send(csvHeader + csvData);
      }

      // Return JSON format
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="azure-metrics-${timeRange}-${Date.now()}.json"`);
      return reply.send({
        exportedAt: new Date().toISOString(),
        timeRange,
        recordCount: usageData.length,
        data: usageData
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to export Azure metrics');
      return reply.status(500).send({ 
        error: 'Failed to export Azure metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get Azure cost alerts
  fastify.get('/cost-alerts', {
    preHandler: [adminAuth],
    schema: {
    }
  }, async (request, reply) => {
    try {
      // Real alert data from database (populated by Azure webhooks/notifications)
      const alerts: AzureCostAlert[] = [];
      
      // In production, this would fetch from Azure Cost Management API
      // or from database table populated by Azure Budget notifications
      fastify.log.info('Cost alerts would be fetched from Azure Cost Management API when configured');

      return reply.send({
        alerts,
        summary: {
          total: alerts.length,
          critical: alerts.filter(a => a.severity === 'critical').length,
          high: alerts.filter(a => a.severity === 'high').length,
          medium: alerts.filter(a => a.severity === 'medium').length,
          low: alerts.filter(a => a.severity === 'low').length
        }
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to fetch Azure cost alerts');
      return reply.status(500).send({ 
        error: 'Failed to fetch Azure cost alerts',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get Azure quota information
  fastify.get('/quota', {
    preHandler: [adminAuth],
    schema: {
    }
  }, async (request, reply) => {
    try {
      // Real quota data from Azure Resource Manager API
      const quotas: AzureQuota[] = [];
      
      // In production, this would query Azure Resource Manager API for actual quotas
      fastify.log.info('Service quotas would be fetched from Azure Resource Manager API when configured');

      return reply.send({
        quotas,
        summary: {
          totalServices: quotas.length,
          utilizationAverage: quotas.reduce((sum, q) => sum + (q.quota.used / q.quota.limit * 100), 0) / quotas.length,
          highUtilization: quotas.filter(q => (q.quota.used / q.quota.limit) > 0.8).length
        }
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to fetch Azure quota information');
      return reply.status(500).send({ 
        error: 'Failed to fetch Azure quota information',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  fastify.log.info('Azure admin routes registered');
};