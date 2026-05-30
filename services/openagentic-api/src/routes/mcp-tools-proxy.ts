/**
 * MCP Tools Proxy Routes
 * 
 * Proxies UI requests for MCP tools to the MCP Orchestrator service.
 * This provides a single API endpoint for the UI while routing MCP operations
 * to the appropriate service.
 */

import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

// MCP Orchestrator configuration
const MCP_ORCHESTRATOR_URL = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';

const mcpToolsProxyRoutes: FastifyPluginAsync = async (fastify) => {
  
  // Proxy /api/mcp-tools/mcp-functions to MCP orchestrator
  fastify.get('/mcp-functions', {
    preHandler: authMiddleware
  }, async (request, reply) => {
    try {
      logger.debug('Proxying MCP functions request to orchestrator');
      
      // Forward request to MCP orchestrator
      const response = await fetch(`${MCP_ORCHESTRATOR_URL}/api/mcp-tools/mcp-functions`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': request.headers.authorization || '',
        }
      });

      if (!response.ok) {
        logger.error(`MCP orchestrator returned ${response.status}: ${response.statusText}`);
        return reply.status(response.status).send({ 
          error: 'MCP orchestrator request failed',
          details: response.statusText 
        });
      }

      const data = await response.json();
      return reply.send(data);
      
    } catch (error) {
      logger.error('Error proxying MCP functions request:', error);
      return reply.status(500).send({ 
        error: 'Failed to proxy MCP functions request',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Proxy other MCP tools endpoints as needed
  fastify.get('/models', {
    preHandler: authMiddleware
  }, async (request, reply) => {
    try {
      logger.debug('Proxying MCP models request to orchestrator');
      
      const response = await fetch(`${MCP_ORCHESTRATOR_URL}/api/mcp-tools/models`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': request.headers.authorization || '',
        }
      });

      if (!response.ok) {
        logger.error(`MCP orchestrator returned ${response.status}: ${response.statusText}`);
        return reply.status(response.status).send({ 
          error: 'MCP orchestrator request failed',
          details: response.statusText 
        });
      }

      const data = await response.json();
      return reply.send(data);
      
    } catch (error) {
      logger.error('Error proxying MCP models request:', error);
      return reply.status(500).send({ 
        error: 'Failed to proxy MCP models request',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
};

export { mcpToolsProxyRoutes };