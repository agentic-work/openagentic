/**
 * Enhanced Admin Portal Routes
 * Advanced admin functionality: prompt versioning and pipeline management
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, adminMiddleware, AuthenticatedRequest } from '../middleware/unifiedAuth.js';
import { promptVersionService } from '../services/PromptVersionService.js';
import { pipelineService } from '../services/PipelineService.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

// Use the unified AuthenticatedRequest type
type AuthRequest = AuthenticatedRequest;

export const adminPortalEnhancedRoutes: FastifyPluginAsync = async (fastify) => {

  // Apply auth middleware as any to avoid type issues
  const authHandlers = [authMiddleware as any, adminMiddleware as any];

  // ============================================================================
  // PROMPT VERSION MANAGEMENT ROUTES
  // ============================================================================

  // Create a new prompt version
  fastify.post('/prompts/versions', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { templateId, content, variables } = request.body as any;
      
      if (!templateId || !content) {
        return reply.code(400).send({ 
          success: false, 
          error: 'Template ID and content are required' 
        });
      }

      const version = await promptVersionService.createVersion({
        templateId,
        content,
        variables,
        createdBy: request.user!.id
      });
      
      return reply.send({ success: true, data: version });
    } catch (error) {
      logger.error('Failed to create prompt version', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to create prompt version' 
      });
    }
  });

  // Test a prompt version
  fastify.post('/prompts/versions/:versionId/test', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { versionId } = request.params as any;
      const { testCases } = request.body as any;
      
      if (!testCases || !Array.isArray(testCases)) {
        return reply.code(400).send({ 
          success: false, 
          error: 'Test cases array is required' 
        });
      }

      const results = await promptVersionService.testVersion(versionId, testCases);
      return reply.send({ success: true, data: results });
    } catch (error) {
      logger.error('Failed to test prompt version', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to test prompt version' 
      });
    }
  });

  // Activate a prompt version
  fastify.post('/prompts/versions/:versionId/activate', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { versionId } = request.params as any;
      const version = await promptVersionService.activateVersion(versionId);
      
      logger.info('Prompt version activated', {
        versionId,
        userId: request.user!.id
      });
      
      return reply.send({ success: true, data: version });
    } catch (error) {
      logger.error('Failed to activate prompt version', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to activate prompt version' 
      });
    }
  });

  // Rollback to a previous version
  fastify.post('/prompts/:templateId/rollback', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { templateId } = request.params as any;
      const { versionNumber } = request.body as any;
      
      if (!versionNumber) {
        return reply.code(400).send({ 
          success: false, 
          error: 'Version number is required' 
        });
      }

      const version = await promptVersionService.rollbackVersion(templateId, versionNumber);
      
      logger.info('Prompt rolled back', {
        templateId,
        versionNumber,
        userId: request.user!.id
      });
      
      return reply.send({ success: true, data: version });
    } catch (error) {
      logger.error('Failed to rollback prompt version', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to rollback prompt version' 
      });
    }
  });

  // Get version history
  fastify.get('/prompts/:templateId/versions', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { templateId } = request.params as any;
      const versions = await promptVersionService.getVersionHistory(templateId);
      return reply.send({ success: true, data: versions });
    } catch (error) {
      logger.error('Failed to get version history', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to get version history' 
      });
    }
  });

  // Compare two versions
  fastify.get('/prompts/versions/compare', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { version1, version2 } = request.query as any;
      
      if (!version1 || !version2) {
        return reply.code(400).send({ 
          success: false, 
          error: 'Both version1 and version2 parameters are required' 
        });
      }

      const comparison = await promptVersionService.compareVersions(version1, version2);
      return reply.send({ success: true, data: comparison });
    } catch (error) {
      logger.error('Failed to compare versions', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to compare versions' 
      });
    }
  });

  // Get version metrics
  fastify.get('/prompts/:templateId/metrics', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { templateId } = request.params as any;
      const { days = 30 } = request.query as any;
      const metrics = await promptVersionService.getVersionMetrics(templateId, parseInt(days));
      return reply.send({ success: true, data: metrics });
    } catch (error) {
      logger.error('Failed to get version metrics', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to get version metrics' 
      });
    }
  });

  // ============================================================================
  // PIPELINE MANAGEMENT ROUTES
  // ============================================================================

  // Create a new pipeline
  fastify.post('/pipelines', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { name, description, type, config } = request.body as any;
      
      if (!name || !type || !config) {
        return reply.code(400).send({ 
          success: false, 
          error: 'Name, type, and config are required' 
        });
      }

      const pipeline = await pipelineService.createPipeline({
        name,
        description,
        type,
        config,
        createdBy: request.user!.id
      });
      
      logger.info('Pipeline created', {
        pipelineId: pipeline.id,
        name,
        userId: request.user!.id
      });
      
      return reply.send({ success: true, data: pipeline });
    } catch (error) {
      logger.error('Failed to create pipeline', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to create pipeline' 
      });
    }
  });

  // List all pipelines
  fastify.get('/pipelines', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { type, isActive = true } = request.query as any;
      
      const pipelines = await pipelineService.listPipelines({
        type,
        isActive: isActive === 'true'
      });
      
      return reply.send({ success: true, data: pipelines });
    } catch (error) {
      logger.error('Failed to list pipelines', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to list pipelines' 
      });
    }
  });

  // Add node to pipeline
  fastify.post('/pipelines/:pipelineId/nodes', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pipelineId } = request.params as any;
      const { nodeType, positionX, positionY, config } = request.body as any;
      
      if (!nodeType || positionX === undefined || positionY === undefined || !config) {
        return reply.code(400).send({ 
          success: false, 
          error: 'Node type, position, and config are required' 
        });
      }

      const node = await pipelineService.addNode({
        pipelineId,
        nodeType,
        positionX,
        positionY,
        config
      });
      
      return reply.send({ success: true, data: node });
    } catch (error) {
      logger.error('Failed to add node', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to add node' 
      });
    }
  });

  // Connect nodes
  fastify.post('/pipelines/:pipelineId/edges', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pipelineId } = request.params as any;
      const { fromNodeId, toNodeId, condition } = request.body as any;
      
      if (!fromNodeId || !toNodeId) {
        return reply.code(400).send({ 
          success: false, 
          error: 'From and to node IDs are required' 
        });
      }

      const edge = await pipelineService.connectNodes({
        pipelineId,
        fromNodeId,
        toNodeId,
        condition
      });
      
      return reply.send({ success: true, data: edge });
    } catch (error) {
      logger.error('Failed to connect nodes', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to connect nodes' 
      });
    }
  });

  // Execute pipeline
  fastify.post('/pipelines/:pipelineId/execute', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pipelineId } = request.params as any;
      const { inputData } = request.body as any;
      
      const result = await pipelineService.executePipeline(pipelineId, inputData || {});
      
      logger.info('Pipeline executed', {
        pipelineId,
        executionId: result.executionId,
        duration: result.duration,
        userId: request.user!.id
      });
      
      return reply.send({ success: true, data: result });
    } catch (error) {
      logger.error('Failed to execute pipeline', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to execute pipeline' 
      });
    }
  });

  // Get pipeline details
  fastify.get('/pipelines/:pipelineId', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pipelineId } = request.params as any;
      const pipeline = await pipelineService.getPipelineDetails(pipelineId);
      
      if (!pipeline) {
        return reply.code(404).send({ 
          success: false, 
          error: 'Pipeline not found' 
        });
      }
      
      return reply.send({ success: true, data: pipeline });
    } catch (error) {
      logger.error('Failed to get pipeline details', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to get pipeline details' 
      });
    }
  });

  // Get execution history
  fastify.get('/pipelines/:pipelineId/executions', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pipelineId } = request.params as any;
      const { limit = 20 } = request.query as any;
      const executions = await pipelineService.getExecutionHistory(pipelineId, parseInt(limit));
      return reply.send({ success: true, data: executions });
    } catch (error) {
      logger.error('Failed to get execution history', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to get execution history' 
      });
    }
  });

  // Clone pipeline
  fastify.post('/pipelines/:pipelineId/clone', {
    preHandler: authHandlers
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pipelineId } = request.params as any;
      const { newName } = request.body as any;
      
      if (!newName) {
        return reply.code(400).send({ 
          success: false, 
          error: 'New name is required' 
        });
      }

      const pipeline = await pipelineService.clonePipeline(
        pipelineId, 
        newName, 
        request.user!.id
      );
      
      logger.info('Pipeline cloned', {
        originalId: pipelineId,
        newId: pipeline.id,
        newName,
        userId: request.user!.id
      });
      
      return reply.send({ success: true, data: pipeline });
    } catch (error) {
      logger.error('Failed to clone pipeline', { error });
      return reply.code(500).send({ 
        success: false, 
        error: 'Failed to clone pipeline' 
      });
    }
  });
};