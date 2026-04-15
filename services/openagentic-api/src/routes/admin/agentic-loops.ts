/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Agents Admin API
 *
 * Admin endpoints for managing platform agents.
 * Provides full observability, metrics, and configuration capabilities.
 *
 * Features:
 * - List all registered agents with their status and metrics
 * - Configure model selection per agent type
 * - View execution history and debug traces
 * - Real-time dashboard metrics
 * - Alert configuration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { adminMiddleware } from '../../middleware/unifiedAuth.js';
import {
  getAgentRegistry,
  type AgentType,
  type AgentModelConfig
} from '../../services/AgentRegistry.js';
import { getDataLayerService } from '../../services/DataLayerService.js';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const AgentTypeEnum = z.enum([
  'data_query',
  'data_extraction',
  'tool_orchestration',
  'reasoning',
  'summarization',
  'code_execution',
  'planning',
  'validation',
  'synthesis',
  'custom'
]);

const UpdateModelConfigSchema = z.object({
  primaryModel: z.string().optional(),
  fallbackModel: z.string().optional(),
  maxTokens: z.number().min(100).max(200000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinkingEnabled: z.boolean().optional(),
  thinkingBudget: z.number().min(0).max(100000).optional(),
  costBudgetPerCall: z.number().min(0).max(10000).optional(),
  timeoutMs: z.number().min(1000).max(600000).optional(),
  retryAttempts: z.number().min(0).max(10).optional()
});

const UpdateAgentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  modelConfig: UpdateModelConfigSchema.optional(),
  rateLimit: z.object({
    maxPerMinute: z.number().min(1).max(10000).optional(),
    maxPerHour: z.number().min(1).max(100000).optional(),
    maxConcurrent: z.number().min(1).max(100).optional()
  }).optional(),
  alerts: z.object({
    errorRateThreshold: z.number().min(0).max(100).optional(),
    latencyThreshold: z.number().min(0).max(600000).optional(),
    costThreshold: z.number().min(0).max(1000000).optional()
  }).optional(),
  logging: z.object({
    verboseLogging: z.boolean().optional(),
    logInputs: z.boolean().optional(),
    logOutputs: z.boolean().optional(),
    sampleRate: z.number().min(0).max(1).optional()
  }).optional()
});

const ExecutionHistoryQuerySchema = z.object({
  agentType: AgentTypeEnum.optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  success: z.boolean().optional(),
  fromTime: z.string().datetime().optional(),
  toTime: z.string().datetime().optional(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0)
});

const StatsQuerySchema = z.object({
  period: z.enum(['hour', 'day', 'week', 'month']).default('day')
});

// =============================================================================
// ROUTES
// =============================================================================

export default async function agentAdminRoutes(fastify: FastifyInstance) {
  const registry = getAgentRegistry();
  const dataLayer = getDataLayerService();

  // ===========================================================================
  // DASHBOARD - Real-time metrics overview
  // ===========================================================================

  fastify.get('/admin/agentic/dashboard', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Get real-time dashboard metrics',
      description: 'Returns aggregated metrics for all agents, execution counts, costs, and error rates',
      response: {
        200: {
          type: 'object',
          properties: {
            agents: { type: 'array', items: { type: 'object', additionalProperties: true } },
            totalExecutionsToday: { type: 'number' },
            totalCostToday: { type: 'number' },
            errorRateToday: { type: 'number' },
            activeExecutions: { type: 'number' }
          }
        },
        500: { type: 'object', properties: { error: { type: 'string' } } }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = await registry.getDashboardMetrics();

      logger.info({
        totalAgents: metrics.agents.length,
        totalExecutions: metrics.totalExecutionsToday,
        activeExecutions: metrics.activeExecutions
      }, 'Admin dashboard metrics requested');

      return reply.send(metrics);
    } catch (error) {
      logger.error({ error }, 'Failed to get dashboard metrics');
      return reply.status(500).send({ error: 'Failed to get dashboard metrics' });
    }
  });

  // ===========================================================================
  // AGENTS - List and manage registered agents
  // ===========================================================================

  fastify.get('/admin/agentic/agents', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'List all registered agents',
      description: 'Returns all platform agents with their configurations and current status',
      response: {
        200: {
          type: 'object',
          properties: {
            agents: { type: 'array', items: { type: 'object', additionalProperties: true } },
            total: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const agents = registry.listAgents();

    logger.debug({ agentCount: agents.length }, 'Listed all agents');

    return reply.send({
      agents,
      total: agents.length
    });
  });

  fastify.get('/admin/agentic/agents/:agentId', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Get agent details',
      description: 'Returns detailed configuration and stats for a specific agent',
      params: {
        type: 'object',
        properties: {
          agentId: { type: 'string' }
        },
        required: ['agentId']
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } }
      }
    }
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    const { agentId } = request.params;
    const agents = registry.listAgents();
    const agent = agents.find(a => a.id === agentId);

    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    // Get stats for this agent
    const stats = await registry.getAgentStats(agent.type, 'day');

    return reply.send({
      agent,
      stats
    });
  });

  fastify.patch('/admin/agentic/agents/:agentId', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Update agent configuration',
      description: 'Update model, rate limits, alerts, or logging settings for an agent',
      params: {
        type: 'object',
        properties: {
          agentId: { type: 'string' }
        },
        required: ['agentId']
      },
      body: {
        type: 'object',
        additionalProperties: true
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } }
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { agentId: string }; Body: unknown }>,
    reply: FastifyReply
  ) => {
    const { agentId } = request.params;

    try {
      const updates = UpdateAgentConfigSchema.parse(request.body);

      // Update model config if provided
      if (updates.modelConfig) {
        const updated = await registry.updateAgentModel(agentId, updates.modelConfig);
        if (!updated) {
          return reply.status(404).send({ error: 'Agent not found' });
        }

        logger.info({
          agentId,
          updates: updates.modelConfig
        }, 'Agent configuration updated');

        return reply.send({
          success: true,
          agent: updated
        });
      }

      return reply.send({ success: true, message: 'No updates applied' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: error.errors
        });
      }
      throw error;
    }
  });

  // ===========================================================================
  // AGENT TYPE CONFIG - Manage model config by agent type
  // ===========================================================================

  fastify.get('/admin/agentic/config/:agentType', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Get model config for agent type',
      description: 'Returns the current model configuration for a specific agent type',
      params: {
        type: 'object',
        properties: {
          agentType: { type: 'string' }
        },
        required: ['agentType']
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } }
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { agentType: string } }>,
    reply: FastifyReply
  ) => {
    const { agentType } = request.params;

    try {
      const validType = AgentTypeEnum.parse(agentType) as AgentType;
      const config = registry.getModelConfig(validType);

      return reply.send({
        agentType: validType,
        config
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid agent type',
          validTypes: AgentTypeEnum.options
        });
      }
      throw error;
    }
  });

  fastify.put('/admin/agentic/config/:agentType/model', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Update model for agent type',
      description: 'Change the primary and fallback models for an agent type',
      params: {
        type: 'object',
        properties: {
          agentType: { type: 'string' }
        },
        required: ['agentType']
      },
      body: {
        type: 'object',
        properties: {
          primaryModel: { type: 'string' },
          fallbackModel: { type: 'string' }
        },
        required: ['primaryModel']
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } }
      }
    }
  }, async (
    request: FastifyRequest<{
      Params: { agentType: string };
      Body: { primaryModel: string; fallbackModel?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { agentType } = request.params;
    const { primaryModel, fallbackModel } = request.body;

    try {
      const validType = AgentTypeEnum.parse(agentType) as AgentType;

      // Find agent of this type and update
      const agent = registry.getAgentByType(validType);
      if (!agent) {
        return reply.status(404).send({ error: 'No agent found for this type' });
      }

      const updated = await registry.updateAgentModel(agent.id, {
        primaryModel,
        fallbackModel
      });

      logger.info({
        agentType: validType,
        primaryModel,
        fallbackModel
      }, 'Agent type model updated');

      return reply.send({
        success: true,
        agentType: validType,
        config: updated?.config.modelConfig
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid agent type',
          validTypes: AgentTypeEnum.options
        });
      }
      throw error;
    }
  });

  // ===========================================================================
  // STATS - Get agent statistics
  // ===========================================================================

  fastify.get('/admin/agentic/stats/:agentType', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Get statistics for agent type',
      description: 'Returns aggregated statistics for executions, latency, tokens, and costs',
      params: {
        type: 'object',
        properties: {
          agentType: { type: 'string' }
        },
        required: ['agentType']
      },
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['hour', 'day', 'week', 'month'] }
        }
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } }
      }
    }
  }, async (
    request: FastifyRequest<{
      Params: { agentType: string };
      Querystring: { period?: 'hour' | 'day' | 'week' | 'month' };
    }>,
    reply: FastifyReply
  ) => {
    const { agentType } = request.params;
    const { period = 'day' } = request.query;

    try {
      const validType = AgentTypeEnum.parse(agentType) as AgentType;
      const stats = await registry.getAgentStats(validType, period);

      return reply.send(stats);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid agent type',
          validTypes: AgentTypeEnum.options
        });
      }
      throw error;
    }
  });

  // ===========================================================================
  // EXECUTIONS - View execution history
  // ===========================================================================

  fastify.get('/admin/agentic/executions', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Get execution history',
      description: 'Returns paginated execution history with optional filters',
      querystring: {
        type: 'object',
        properties: {
          agentType: { type: 'string' },
          sessionId: { type: 'string' },
          userId: { type: 'string' },
          success: { type: 'boolean' },
          fromTime: { type: 'string', format: 'date-time' },
          toTime: { type: 'string', format: 'date-time' },
          limit: { type: 'number', minimum: 1, maximum: 1000 },
          offset: { type: 'number', minimum: 0 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            executions: { type: 'array', items: { type: 'object', additionalProperties: true } },
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' }
          }
        }
      }
    }
  }, async (
    request: FastifyRequest<{ Querystring: z.infer<typeof ExecutionHistoryQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = ExecutionHistoryQuerySchema.parse(request.query);

      const filters: {
        agentType?: AgentType;
        sessionId?: string;
        userId?: string;
        success?: boolean;
        fromTime?: Date;
        toTime?: Date;
      } = {};

      if (query.agentType) filters.agentType = query.agentType as AgentType;
      if (query.sessionId) filters.sessionId = query.sessionId;
      if (query.userId) filters.userId = query.userId;
      if (query.success !== undefined) filters.success = query.success;
      if (query.fromTime) filters.fromTime = new Date(query.fromTime);
      if (query.toTime) filters.toTime = new Date(query.toTime);

      const executions = await registry.getExecutionHistory(
        filters,
        query.limit,
        query.offset
      );

      return reply.send({
        executions,
        total: executions.length,
        limit: query.limit,
        offset: query.offset
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: error.errors
        });
      }
      throw error;
    }
  });

  fastify.get('/admin/agentic/executions/:executionId', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Get execution details',
      description: 'Returns full details for a specific execution including trace info',
      params: {
        type: 'object',
        properties: {
          executionId: { type: 'string' }
        },
        required: ['executionId']
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', properties: { error: { type: 'string' } } }
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { executionId: string } }>,
    reply: FastifyReply
  ) => {
    const { executionId } = request.params;

    const executions = await registry.getExecutionHistory(
      {},
      1000,
      0
    );
    const execution = executions.find(e => e.executionId === executionId);

    if (!execution) {
      return reply.status(404).send({ error: 'Execution not found' });
    }

    // Get related datasets if any
    const datasets: string[] = [];
    for (const datasetId of execution.datasetIdsAccessed) {
      const info = await dataLayer.getDatasetInfo(datasetId);
      if (info) datasets.push(info);
    }

    return reply.send({
      execution,
      relatedDatasets: datasets
    });
  });

  // ===========================================================================
  // DATA LAYER - View stored datasets
  // ===========================================================================

  fastify.get('/admin/agentic/datasets', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Get data layer statistics',
      description: 'Returns statistics about stored datasets in the data layer',
      response: {
        200: { type: 'object', additionalProperties: true }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await dataLayer.getStats();
    return reply.send(stats);
  });

  fastify.post('/admin/agentic/datasets/cleanup', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'Cleanup expired datasets',
      description: 'Removes expired datasets from the data layer',
      response: {
        200: {
          type: 'object',
          properties: {
            cleaned: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const cleaned = await dataLayer.cleanup();

    logger.info({ cleaned }, 'Data layer cleanup completed');

    return reply.send({ cleaned });
  });

  // ===========================================================================
  // MODELS - List available models for agents
  // ===========================================================================

  fastify.get('/admin/agentic/models', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Agents'],
      summary: 'List available models for agents',
      description: 'Returns all models that can be assigned to agents with their capabilities',
      response: {
        200: {
          type: 'object',
          properties: {
            models: { type: 'array', items: { type: 'object', additionalProperties: true } }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const providers = await prisma.lLMProvider.findMany({
        where: {
          enabled: true,
          deleted_at: null,
        },
        orderBy: [
          { priority: 'asc' },
          { display_name: 'asc' },
        ],
      });

      const models = providers.map((p) => {
        const providerConfig = (p.provider_config as any) || {};
        const capabilities = (p.capabilities as any) || {};
        const modelConfig = (p.model_config as any) || {};

        const modelId =
          providerConfig.modelId ||
          providerConfig.model ||
          providerConfig.deployment ||
          p.name;

        const capList: string[] = [];
        if (capabilities.chat !== false) capList.push('reasoning');
        if (capabilities.tools !== false) capList.push('tool_use');
        if (capabilities.vision) capList.push('vision');
        if (capabilities.streaming !== false) capList.push('code');
        if (capabilities.thinking) capList.push('thinking');

        // Derive recommended agent types from capabilities
        const recommendedFor: string[] = [];
        if (capList.includes('tool_use')) recommendedFor.push('tool_orchestration');
        if (capList.includes('reasoning')) recommendedFor.push('reasoning');
        if (capList.includes('code')) recommendedFor.push('code_execution');
        if (capList.includes('thinking')) recommendedFor.push('planning');
        // Lightweight models (high priority number = lower cost) suit data tasks
        if (p.priority >= 3) {
          recommendedFor.push('data_query', 'summarization', 'validation');
        } else {
          recommendedFor.push('synthesis', 'data_extraction');
        }

        return {
          id: modelId,
          provider: p.provider_type,
          name: p.display_name || modelId,
          capabilities: capList,
          maxTokens: modelConfig.maxTokens || 8192,
          recommendedFor,
          status: p.status,
          providerId: p.id,
        };
      });

      return reply.send({ models });
    } catch (error) {
      logger.error({ error }, 'Failed to load models from database');
      return reply.status(500).send({ error: 'Failed to load models' });
    }
  });

  logger.info('Agent admin routes registered');
}
