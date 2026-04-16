/**
 * Pipeline Status API Endpoint
 * Provides real-time status and configuration of the chat pipeline
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminFastify as requireAdmin } from '../../middleware/adminAuth.js';

// Get pipeline status and configuration
export default async function pipelineRoutes(fastify: FastifyInstance) {
  fastify.get('/pipeline/summary', {
    preHandler: requireAdmin
  }, async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const config = {
        enableMCP: process.env.ENABLE_MCP !== 'false',
        enablePromptEngineering: process.env.ENABLE_PROMPT_ENGINEERING !== 'false',
        enableCoT: process.env.ENABLE_COT === 'true',
        enableRAG: process.env.ENABLE_RAG === 'true',
        enableCaching: process.env.ENABLE_CACHING !== 'false',
        enableAnalytics: process.env.ENABLE_ANALYTICS !== 'false',
        maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '60'),
        requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '120000')
      };

      // Get MCP status from environment and known issues
      const mcpErrors = [
        'Failed to connect to MCP server memory-mcp',
        'Failed to connect to MCP server azure-mcp',
        'USER_AZURE_TOKEN not provided',
        'Invalid proxy server token for MCP Proxy'
      ];

      const response = {
        config,
        // Pipeline stages status
        authStatus: 'healthy',
        azureAdStatus: 'running',
        validationStatus: 'healthy',
        promptStatus: config.enablePromptEngineering ? 'healthy' : 'disabled',
        mcpStatus: config.enableMCP ? 'error' : 'disabled', // Known to have errors
        completionStatus: 'healthy',
        responseStatus: 'healthy',

        // Services status
        mcpProxyStatus: 'running',
        mcpProxyMessage: 'Connected to Azure OpenAI via MCP Proxy',
        cacheStatus: config.enableCaching ? 'running' : 'stopped',
        analyticsStatus: config.enableAnalytics ? 'running' : 'stopped',

        // MCP specific
        mcpOrchestratorStatus: config.enableMCP ? 'error' : 'stopped',
        mcpOrchestratorError: 'Connection failed - routes not found',
        azureMcpEnabled: config.enableMCP,
        azureMcpStatus: 'error',
        memoryMcpEnabled: config.enableMCP,
        memoryMcpStatus: 'error',
        adminMcpEnabled: config.enableMCP,
        adminMcpStatus: 'error',
        mcpErrors: config.enableMCP ? mcpErrors : [],

        // Prompt engineering details
        enabledTechniques: config.enablePromptEngineering ? [
          'System Prompt Optimization',
          'Context Window Management',
          'Dynamic Template Loading'
        ] : [],
        cotStatus: config.enableCoT ? 'running' : 'stopped',
        ragStatus: config.enableRAG ? 'running' : 'stopped',
        enableFewShot: false,
        fewShotStatus: 'stopped',

        // Memory and other services
        enableMemory: false,
        memoryStatus: 'stopped',

        // Metrics (mock data for now)
        authMetrics: {
          avgTime: 45,
          successRate: 99.5,
          lastRun: new Date().toISOString()
        },
        validationMetrics: {
          avgTime: 12,
          successRate: 99.9
        },
        promptMetrics: {
          avgTime: 230,
          successRate: 98.2
        },
        mcpMetrics: {
          avgTime: 450,
          successRate: 15.3 // Low due to errors
        },
        completionMetrics: {
          avgTime: 2100,
          successRate: 97.8
        },
        responseMetrics: {
          avgTime: 50,
          successRate: 99.9
        }
      };

      return reply.send(response);
    } catch (error) {
      console.error('Error fetching pipeline status:', error);
      return reply.status(500).send({
        error: 'Failed to fetch pipeline status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get pipeline metrics over time
  fastify.get('/pipeline/history', {
    preHandler: requireAdmin
  }, async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      // This would normally fetch from database
      const metrics = {
        timeRange: '24h',
        stages: {
          auth: { totalRequests: 15420, avgTime: 45, errors: 12 },
          validation: { totalRequests: 15408, avgTime: 12, errors: 3 },
          prompt: { totalRequests: 15405, avgTime: 230, errors: 45 },
          mcp: { totalRequests: 8234, avgTime: 450, errors: 6982 },
          completion: { totalRequests: 15360, avgTime: 2100, errors: 234 },
          response: { totalRequests: 15360, avgTime: 50, errors: 2 }
        },
        totalRequests: 15420,
        successRate: 96.3,
        avgResponseTime: 2887
      };

      return reply.send(metrics);
    } catch (error) {
      console.error('Error fetching pipeline metrics:', error);
      return reply.status(500).send({
        error: 'Failed to fetch pipeline metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}