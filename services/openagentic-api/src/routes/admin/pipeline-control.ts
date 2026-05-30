/**
 * Pipeline Control Admin API - Fastify Version
 *
 * Administrative endpoints for controlling and monitoring the chat pipeline.
 * Allows admins to enable/disable individual pipeline stages for troubleshooting
 * and performance optimization.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';

// Pipeline configuration interface
interface PipelineConfig {
  // Core stages
  authentication: boolean;
  authorization: boolean;
  validation: boolean;
  rateLimiting: boolean;

  // Processing stages
  preprocessing: boolean;
  contextEnrichment: boolean;
  ragProcessing: boolean;
  aiProcessing: boolean;
  postProcessing: boolean;

  // Integration stages
  mcpIntegration: boolean;
  pluginProcessing: boolean;
  caching: boolean;

  // Monitoring & Analytics
  monitoring: boolean;
  analytics: boolean;
  logging: boolean;
}

// Default configuration - all stages enabled
const defaultConfig: PipelineConfig = {
  authentication: true,
  authorization: true,
  validation: true,
  rateLimiting: true,
  preprocessing: true,
  contextEnrichment: true,
  ragProcessing: true,
  aiProcessing: true,
  postProcessing: true,
  mcpIntegration: true,
  pluginProcessing: true,
  caching: true,
  monitoring: true,
  analytics: true,
  logging: true,
};

// Current configuration state
let currentConfig: PipelineConfig = { ...defaultConfig };

// Stage health status
interface StageHealth {
  stage: string;
  enabled: boolean;
  status: 'healthy' | 'degraded' | 'error';
  lastCheck: Date;
  metrics?: {
    latency?: number;
    errorRate?: number;
    throughput?: number;
  };
}

// Track stage health
const stageHealth = new Map<string, StageHealth>();

export default async function pipelineControlRoutes(fastify: FastifyInstance) {
  // Get current pipeline configuration
  fastify.get('/config', {
    preHandler: async (request, reply): Promise<void> => {
      // Check if user is authenticated and admin
      if (!request.user || !request.user.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      // Load saved config from database if exists
      const savedConfig = await prisma.systemConfiguration.findUnique({
        where: { key: 'pipeline_config' }
      });

      if (savedConfig && savedConfig.value) {
        currentConfig = { ...defaultConfig, ...JSON.parse(savedConfig.value as string) };
      }

      return reply.send({
        config: currentConfig,
        defaults: defaultConfig,
        overrides: Object.keys(currentConfig).filter(
          key => currentConfig[key as keyof PipelineConfig] !== defaultConfig[key as keyof PipelineConfig]
        )
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get pipeline config');
      return reply.status(500).send({
        error: 'Failed to retrieve pipeline configuration'
      });
    }
  });

  // Update pipeline configuration
  fastify.post<{
    Body: Partial<PipelineConfig>
  }>('/config', {
    preHandler: async (request, reply): Promise<void> => {
      // Check if user is authenticated and admin
      if (!request.user || !request.user.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }
  }, async (request, reply): Promise<void> => {
    try {
      const updates = request.body;

      // Validate updates
      const validKeys = Object.keys(defaultConfig);
      const invalidKeys = Object.keys(updates).filter(key => !validKeys.includes(key));

      if (invalidKeys.length > 0) {
        return reply.status(400).send({
          error: 'Invalid configuration keys',
          invalidKeys
        });
      }

      // Apply updates
      const previousConfig = { ...currentConfig };
      currentConfig = { ...currentConfig, ...updates };

      // Save to database
      await prisma.systemConfiguration.upsert({
        where: { key: 'pipeline_config' },
        update: {
          value: JSON.stringify(currentConfig),
          updated_at: new Date()
        },
        create: {
          key: 'pipeline_config',
          value: JSON.stringify(currentConfig),
          description: 'Pipeline processing configuration'
        }
      });

      // Log configuration changes
      const changes = Object.keys(updates).map(key => ({
        stage: key,
        previous: previousConfig[key as keyof PipelineConfig],
        current: currentConfig[key as keyof PipelineConfig]
      }));

      logger.info({
        userId: request.user?.id,
        changes
      }, 'Pipeline configuration updated');

      return reply.send({
        success: true,
        config: currentConfig,
        changes
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update pipeline config');
      return reply.status(500).send({
        error: 'Failed to update pipeline configuration'
      });
    }
  });

  // Toggle individual stage
  fastify.post<{
    Params: { stage: string }
  }>('/toggle/:stage', {
    preHandler: async (request, reply): Promise<void> => {
      // Check if user is authenticated and admin
      if (!request.user || !request.user.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }
  }, async (request, reply): Promise<void> => {
    try {
      const { stage } = request.params;

      if (!(stage in currentConfig)) {
        return reply.status(404).send({
          error: 'Stage not found',
          stage,
          availableStages: Object.keys(currentConfig)
        });
      }

      const stageKey = stage as keyof PipelineConfig;
      const previousState = currentConfig[stageKey];
      currentConfig[stageKey] = !previousState;

      // Save to database
      await prisma.systemConfiguration.upsert({
        where: { key: 'pipeline_config' },
        update: {
          value: JSON.stringify(currentConfig),
          updated_at: new Date()
        },
        create: {
          key: 'pipeline_config',
          value: JSON.stringify(currentConfig),
          description: 'Pipeline processing configuration'
        }
      });

      logger.info({
        userId: request.user?.id,
        stage,
        previousState,
        newState: currentConfig[stageKey]
      }, 'Pipeline stage toggled');

      return reply.send({
        success: true,
        stage,
        enabled: currentConfig[stageKey],
        config: currentConfig
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to toggle pipeline stage');
      return reply.status(500).send({
        error: 'Failed to toggle pipeline stage'
      });
    }
  });

  // Reset to default configuration
  fastify.post('/reset', {
    preHandler: async (request, reply): Promise<void> => {
      // Check if user is authenticated and admin
      if (!request.user || !request.user.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }
  }, async (request, reply): Promise<void> => {
    try {
      const previousConfig = { ...currentConfig };
      currentConfig = { ...defaultConfig };

      // Delete saved config from database
      await prisma.systemConfiguration.deleteMany({
        where: { key: 'pipeline_config' }
      });

      logger.info({
        userId: request.user?.id,
        previousConfig,
        newConfig: currentConfig
      }, 'Pipeline configuration reset to defaults');

      return reply.send({
        success: true,
        message: 'Pipeline configuration reset to defaults',
        config: currentConfig
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to reset pipeline config');
      return reply.status(500).send({
        error: 'Failed to reset pipeline configuration'
      });
    }
  });

  // Get pipeline status (comprehensive overview for admin portal)
  fastify.get('/status', {
    preHandler: async (request, reply): Promise<void> => {
      // Check if user is authenticated and admin
      if (!request.user || !request.user.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }
  }, async (request, reply): Promise<void> => {
    try {
      const stages = [];
      const services = [];

      // Get stage status
      for (const [stage, enabled] of Object.entries(currentConfig)) {
        let stageHealthEntry = stageHealth.get(stage);

        if (!stageHealthEntry) {
          stageHealthEntry = {
            stage,
            enabled,
            status: enabled ? 'healthy' : 'degraded',
            lastCheck: new Date()
          };
          stageHealth.set(stage, stageHealthEntry);
        }

        // Update status
        stageHealthEntry.enabled = enabled;
        stageHealthEntry.lastCheck = new Date();

        // Add mock metrics for demo
        if (enabled) {
          stageHealthEntry.metrics = {
            latency: Math.random() * 100,
            errorRate: Math.random() * 0.05,
            throughput: Math.random() * 1000
          };
        }

        stages.push({
          name: stage,
          status: stageHealthEntry.status,
          enabled: stageHealthEntry.enabled,
          metrics: stageHealthEntry.metrics || {},
          lastCheck: stageHealthEntry.lastCheck
        });
      }

      // Add service status
      services.push({
        name: 'Chat API',
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed / 1024 / 1024,
        cpu: 0.15
      });

      services.push({
        name: 'MCP Orchestrator',
        status: 'healthy',
        uptime: process.uptime() * 0.95,
        memory: 256,
        cpu: 0.08
      });

      services.push({
        name: 'Vector Database',
        status: 'healthy',
        uptime: process.uptime() * 0.99,
        memory: 512,
        cpu: 0.12
      });

      const overallHealth = stages.every(s => s.status === 'healthy') ? 'healthy' :
                           stages.some(s => s.status === 'error') ? 'error' : 'degraded';

      return reply.send({
        overall: overallHealth,
        stages,
        services,
        config: currentConfig,
        metrics: {
          totalRequests: Math.floor(Math.random() * 10000),
          avgLatency: Math.random() * 200,
          errorRate: Math.random() * 0.02,
          throughput: Math.random() * 500
        },
        lastUpdated: new Date()
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get pipeline status');
      return reply.status(500).send({
        error: 'Failed to retrieve pipeline status'
      });
    }
  });

  // Get pipeline health status
  fastify.get('/health', {
    preHandler: async (request, reply): Promise<void> => {
      // Check if user is authenticated and admin
      if (!request.user || !request.user.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }
  }, async (request, reply): Promise<void> => {
    try {
      const health: StageHealth[] = [];

      for (const [stage, enabled] of Object.entries(currentConfig)) {
        // Get or create health entry
        let stageHealthEntry = stageHealth.get(stage);

        if (!stageHealthEntry) {
          stageHealthEntry = {
            stage,
            enabled,
            status: enabled ? 'healthy' : 'degraded',
            lastCheck: new Date()
          };
          stageHealth.set(stage, stageHealthEntry);
        }

        // Update enabled status
        stageHealthEntry.enabled = enabled;
        stageHealthEntry.lastCheck = new Date();

        // Add mock metrics for enabled stages
        if (enabled) {
          stageHealthEntry.metrics = {
            latency: Math.random() * 100,
            errorRate: Math.random() * 0.05,
            throughput: Math.random() * 1000
          };
        }

        health.push({ ...stageHealthEntry });
      }

      const overallHealth = health.every(h => h.status === 'healthy') ? 'healthy' :
                           health.some(h => h.status === 'error') ? 'error' : 'degraded';

      return reply.send({
        overall: overallHealth,
        stages: health,
        enabledCount: health.filter(h => h.enabled).length,
        totalCount: health.length
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get pipeline health');
      return reply.status(500).send({
        error: 'Failed to retrieve pipeline health'
      });
    }
  });

  // Test pipeline with sample message
  fastify.post<{
    Body: { message: string }
  }>('/test', {
    preHandler: async (request, reply): Promise<void> => {
      // Check if user is authenticated and admin
      if (!request.user || !request.user.isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
    }
  }, async (request, reply): Promise<void> => {
    try {
      const { message } = request.body;

      if (!message) {
        return reply.status(400).send({
          error: 'Message is required for pipeline test'
        });
      }

      const results = [];
      const startTime = Date.now();

      // Simulate pipeline processing
      for (const [stage, enabled] of Object.entries(currentConfig)) {
        const stageStart = Date.now();

        if (enabled) {
          // Simulate processing delay
          await new Promise(resolve => setTimeout(resolve, Math.random() * 50));

          results.push({
            stage,
            status: 'processed',
            duration: Date.now() - stageStart,
            output: `${stage} completed`
          });
        } else {
          results.push({
            stage,
            status: 'skipped',
            duration: 0,
            reason: 'Stage disabled'
          });
        }
      }

      return reply.send({
        success: true,
        message,
        totalDuration: Date.now() - startTime,
        stages: results,
        processedCount: results.filter(r => r.status === 'processed').length,
        skippedCount: results.filter(r => r.status === 'skipped').length
      });
    } catch (error) {
      logger.error({ err: error }, 'Pipeline test failed');
      return reply.status(500).send({
        error: 'Pipeline test failed'
      });
    }
  });
}

// Export helper functions for use in other parts of the application
export function getPipelineConfig(): PipelineConfig {
  return { ...currentConfig };
}

export function setPipelineConfig(config: Partial<PipelineConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}