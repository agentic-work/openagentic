/**
 * System Capabilities Discovery Routes
 * 
 * Provides endpoints for discovering available AI models, MCP tools,
 * and system capabilities with intelligent routing recommendations.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { OpenAI } from 'openai';
import { CapabilityIntegration } from '../services/CapabilityIntegration.js';
import { loggers } from '../utils/logger.js';
import type { ExtendedTaskRequirements } from '../services/ModelCapabilitiesService.js';
import { prisma } from '../utils/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';

// Initialize LLM client based on configured provider (Azure, Vertex, Bedrock, etc.)
// All configuration comes from environment variables - NO HARDCODING
import { AzureOpenAI } from 'openai';

// Create provider-agnostic client for model discovery (optional)
// Configuration comes entirely from environment variables
let azureClient: AzureOpenAI | null = null;
try {
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_VERSION) {
    azureClient = new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION
    });
  }
} catch (error) {
  loggers.services.warn('Azure OpenAI client not available for capabilities discovery');
}

// Mock orchestrator client for now (will be replaced with real one)
const orchestratorClient = {
  listServers: async () => [],
  getServerTools: async () => [],
  executeTool: async () => ({})
};

// Get capability integration instance - using Prisma instead of Pool
// Pass null if Azure client not configured - CapabilityIntegration will handle gracefully
const capabilityIntegration = azureClient ? CapabilityIntegration.getInstance(
  azureClient,
  orchestratorClient,
  loggers.services
) : null;

export const capabilityRoutes: FastifyPluginAsync = async (fastify, opts) => {
  
  // Initialize capabilities on startup
  fastify.addHook('onReady', async () => {
    if (!capabilityIntegration) {
      loggers.routes.info('Capability integration not available - Azure OpenAI not configured');
      return;
    }
    try {
      await capabilityIntegration.initialize();
      loggers.routes.info('Capability integration initialized');
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to initialize capabilities');
    }
  });

  /**
   * Get capability catalog
   */
    // Prisma client imported above

fastify.get('/catalog', async (request, reply) => {
    try {
      const { format = 'json' } = request.query as { format?: string };
      
      if (!['json', 'yaml', 'markdown'].includes(format)) {
        return reply.status(400).send({ 
          error: 'Invalid format. Must be json, yaml, or markdown' 
        });
      }

      const catalog = await capabilityIntegration.exportCatalog(format as any);
      
      // Set appropriate content type
      const contentType = format === 'json' ? 'application/json' :
                         format === 'yaml' ? 'text/yaml' :
                         'text/markdown';
      
      reply.type(contentType);
      return reply.send(catalog);
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get capability catalog');
      return reply.status(500).send({ error: 'Failed to get catalog' });
    }
  });

  /**
   * Recommend capabilities for requirements
   */
  fastify.post('/recommend', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const requirements = request.body as ExtendedTaskRequirements;
      
      if (!requirements.capabilities || requirements.capabilities.length === 0) {
        return reply.status(400).send({ 
          error: 'Requirements must include at least one capability' 
        });
      }

      const { capabilitiesService } = capabilityIntegration.getServices();
      const recommendation = await capabilitiesService.recommendCapabilities(requirements);
      
      return reply.send({
        model: {
          id: recommendation.primary?.id,
          name: recommendation.primary?.name,
          type: recommendation.primary?.type,
          provider: recommendation.primary?.provider
        },
        tools: recommendation.tools?.map(t => ({
          id: t.toolId,
          name: t.toolName,
          provider: t.provider
        })),
        workflow: recommendation.workflow,
        estimatedCost: recommendation.estimatedCost,
        estimatedLatency: recommendation.estimatedLatency,
        confidence: recommendation.confidence
      });
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to recommend capabilities');
      return reply.status(500).send({ error: 'Failed to get recommendations' });
    }
  });

  /**
   * Analyze message to determine requirements
   */
  fastify.post('/analyze', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { message, attachments } = request.body as {
        message: string;
        attachments?: any[];
      };
      
      if (!message) {
        return reply.status(400).send({ error: 'Message is required' });
      }

      // Analyze message requirements (placeholder implementation)
      const requirements = {
        modelType: 'standard',
        capabilities: ['text_generation'],
        attachmentSupport: attachments && attachments.length > 0,
        estimatedTokens: Math.ceil(message.length / 4)
      };
      
      return reply.send(requirements);
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to analyze message');
      return reply.status(500).send({ error: 'Failed to analyze message' });
    }
  });

  /**
   * Select model for a message
   */
  fastify.post('/select-model', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { message, attachments, preferences } = request.body as {
        message: string;
        attachments?: any[];
        preferences?: any;
      };
      
      if (!message) {
        return reply.status(400).send({ error: 'Message is required' });
      }

      const selection = await capabilityIntegration.selectModelForMessage(
        message,
        attachments,
        preferences
      );
      
      return reply.send(selection);
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to select model');
      return reply.status(500).send({ error: 'Failed to select model' });
    }
  });

  /**
   * Get vision-capable models
   */
  fastify.get('/models/vision', async (request, reply) => {
    try {
      const { tasks, minScore = 0.7 } = request.query as {
        tasks?: string;
        minScore?: number;
      };
      
      const { capabilitiesService } = capabilityIntegration.getServices();
      const taskArray = tasks ? tasks.split(',') : [];
      
      const models = capabilitiesService.getVisionModels(taskArray, Number(minScore));
      
      return reply.send(models.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        visionCapabilities: m.capabilities.vision?.map(vc => ({
          id: vc.id,
          name: vc.name,
          score: vc.score,
          specialFeatures: vc.specialFeatures
        }))
      })));
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get vision models');
      return reply.status(500).send({ error: 'Failed to get vision models' });
    }
  });

  /**
   * Get image generation models
   */
  fastify.get('/models/image-gen', async (request, reply) => {
    try {
      const { styles, minQuality = 0.7 } = request.query as {
        styles?: string;
        minQuality?: number;
      };
      
      const { capabilitiesService } = capabilityIntegration.getServices();
      const styleArray = styles ? styles.split(',') : [];
      
      const models = capabilitiesService.getImageGenModels(styleArray, Number(minQuality));
      
      return reply.send(models.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        imageGenCapabilities: m.capabilities.imageGeneration?.map(ig => ({
          id: ig.id,
          name: ig.name,
          qualityMetrics: ig.qualityMetrics,
          styleCapabilities: ig.styleCapabilities
        }))
      })));
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get image generation models');
      return reply.status(500).send({ error: 'Failed to get image generation models' });
    }
  });

  /**
   * Get MCP tools
   */
  fastify.get('/tools/mcp', async (request, reply) => {
    try {
      const { categories, minReliability = 0.9 } = request.query as {
        categories?: string;
        minReliability?: number;
      };
      
      const { capabilitiesService } = capabilityIntegration.getServices();
      const categoryArray = categories ? categories.split(',') : [];
      
      const tools = capabilitiesService.getMCPTools(categoryArray, Number(minReliability));
      
      return reply.send(tools.map(t => ({
        id: t.toolId,
        name: t.toolName,
        provider: t.provider,
        operations: t.operations.length,
        reliability: t.reliability,
        categories: [...new Set(t.operations.map(op => op.category))]
      })));
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get MCP tools');
      return reply.status(500).send({ error: 'Failed to get MCP tools' });
    }
  });

  /**
   * Refresh capability discovery
   */
  fastify.post('/refresh', { preHandler: adminMiddleware }, async (request, reply) => {
    try {
      // Re-initialize to refresh capabilities
      await capabilityIntegration.initialize();
      
      return reply.send({ 
        success: true,
        message: 'Capability discovery refreshed'
      });
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to refresh capabilities');
      return reply.status(500).send({ error: 'Failed to refresh capabilities' });
    }
  });

  /**
   * Get capability statistics
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      // Get stats from database using Prisma
      const modelCount = await prisma.modelCapability.count();
      const toolCount = await prisma.mCPToolCapabilities.count();
      
      // Get usage stats from past 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentUsage = await prisma.usageAnalytics.findMany({
        where: {
          timestamp: {
            gte: yesterday
          }
        }
      });
      
      const successfulUsage = recentUsage; // Simplified - success field not in UsageAnalytics
      const routingEntries = await prisma.modelRoutingDecision.findMany({
        where: {
          created_at: {
            gte: yesterday
          }
        }
      });
      
      return reply.send({
        models: {
          count: modelCount,
          capabilities: modelCount // Simplified for now
        },
        tools: {
          count: toolCount,
          total: toolCount
        },
        usage: {
          last24h: recentUsage.length,
          successRate: recentUsage.length > 0 ? successfulUsage.length / recentUsage.length : 0,
          avgLatency: 0, // latency_ms not available in UsageAnalytics
          avgCost: 0     // total_cost not available in UsageAnalytics
        },
        routing: {
          last24h: routingEntries.length,
          uniqueModels: new Set(routingEntries.map(r => r.model_to)).size,
          avgConfidence: 0, // Not available in current schema
          fallbackRate: 0   // Not available in current schema
        }
      });
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get capability stats');
      return reply.status(500).send({ error: 'Failed to get stats' });
    }
  });

  /**
   * Update capability performance (called after usage)
   */
  fastify.post('/performance', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { capabilityId, performance } = request.body as {
        capabilityId: string;
        performance: {
          success: boolean;
          quality?: number;
          latency: number;
          cost: number;
        };
      };
      
      if (!capabilityId || !performance) {
        return reply.status(400).send({ 
          error: 'capabilityId and performance are required' 
        });
      }

      await capabilityIntegration.updateCapabilityPerformance(
        capabilityId,
        performance
      );
      
      return reply.send({ success: true });
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to update performance');
      return reply.status(500).send({ error: 'Failed to update performance' });
    }
  });
};

export default capabilityRoutes;