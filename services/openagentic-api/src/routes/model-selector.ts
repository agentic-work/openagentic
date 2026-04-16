/**
 * Dynamic Model Selection Routes
 * 
 * Administrative endpoints for monitoring and managing MCP Proxy models.
 * Provides model discovery, health checks, and testing capabilities.
 * 
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ChatCompletionService } from './chat/services/ChatCompletionService.js';
import { authMiddleware, adminMiddleware, type AuthenticatedRequest } from '../middleware/unifiedAuth.js';
import { pino } from 'pino';

export async function modelSelectorRoutes(fastify: FastifyInstance) {
  // Create a temporary completion service instance for admin endpoints
  const logger = pino({ name: 'model-selector-admin' });
  const completionService = new ChatCompletionService(logger);
  
  // Get LLM provider health status
  fastify.get('/model-selector/status', {
    preHandler: [authMiddleware, adminMiddleware]
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      // Get MCP Proxy health status
      const healthStatus = await completionService.getHealthStatus();
      
      // Get available models
      const models = await completionService.getAvailableModels();
      
      return reply.send({
        mcpProxy: healthStatus,
        models: {
          total: models.length,
          available: models.map(m => ({
            id: m.id,
            provider: m.id.split('/')[0] || 'unknown',
            name: m.id.split('/').slice(1).join('/') || m.id
          }))
        }
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get MCP Proxy status');
      return reply.code(500).send({
        error: 'Failed to get MCP Proxy status'
      });
    }
  });

  // Get detailed model information
  fastify.get('/model-selector/models/:modelId', {
    preHandler: [authMiddleware, adminMiddleware]
  }, async (request: AuthenticatedRequest & { params: { modelId: string } }, reply: FastifyReply) => {
    try {
      const { modelId } = request.params;

      // Get model info from MCP Proxy
      const modelInfo = await completionService.getModelInfo(modelId);
      
      if (!modelInfo) {
        return reply.code(404).send({
          error: 'Model not found',
          modelId
        });
      }
      
      return reply.send(modelInfo);
    } catch (error) {
      request.log.error({ error }, 'Failed to get model info');
      return reply.code(500).send({
        error: 'Failed to get model information'
      });
    }
  });

  // Refresh models list (MCP Proxy automatically discovers models)
  fastify.post('/model-selector/refresh', {
    preHandler: [authMiddleware, adminMiddleware]
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      // With MCP Proxy, models are discovered from the config file
      // Just get the current list to verify
      const models = await completionService.getAvailableModels();
      
      return reply.send({
        message: 'Available models refreshed from config',
        modelCount: models.length,
        models: models.map(m => m.id)
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to refresh models');
      return reply.code(500).send({
        error: 'Failed to refresh models'
      });
    }
  });

  // Test a specific model
  fastify.post('/model-selector/test', {
    preHandler: [authMiddleware, adminMiddleware]
  }, async (request: AuthenticatedRequest & { body: { model: string; prompt?: string } }, reply: FastifyReply) => {
    try {
      const { model, prompt = 'Hello, this is a test.' } = request.body;

      // Make a test request to MCP Proxy
      const testRequest = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        stream: false
      };
      
      const startTime = Date.now();
      const response = await completionService.createChatCompletion(testRequest);
      const responseTime = Date.now() - startTime;
      
      return reply.send({
        success: true,
        model,
        responseTime,
        response: response.choices[0]?.message?.content,
        usage: response.usage
      });
    } catch (error: any) {
      request.log.error({ error }, 'Model test failed');
      return reply.code(500).send({
        error: 'Model test failed',
        message: error.message
      });
    }
  });
}