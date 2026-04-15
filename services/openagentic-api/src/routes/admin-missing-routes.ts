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
 * Admin Missing Routes
 *
 * Implements routes that were returning 404 in validation tests:
 * - /api/admin/mcp/health
 * - /api/admin/mcp-tools/status
 * - /api/capabilities/catalog
 * - /api/capabilities/stats
 * - /api/capabilities/tools/mcp
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';

const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:3100';

export const adminMissingRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /api/admin/mcp/health
   * Check MCP proxy health status
   */
  fastify.get('/mcp/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${MCP_PROXY_URL}/health`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          status: 'healthy',
          proxy: data,
          endpoint: MCP_PROXY_URL
        };
      } else {
        return reply.code(503).send({
          success: false,
          status: 'unhealthy',
          error: `MCP proxy returned ${response.status}`,
          endpoint: MCP_PROXY_URL
        });
      }
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[AdminMCP] Health check failed');
      return reply.code(503).send({
        success: false,
        status: 'unreachable',
        error: error.message,
        endpoint: MCP_PROXY_URL
      });
    }
  });

  /**
   * GET /api/admin/mcp-tools/status
   * Get status of all MCP tools
   */
  fastify.get('/mcp-tools/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${MCP_PROXY_URL}/tools`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const tools = await response.json();

        // Group tools by server
        const serverTools: Record<string, any[]> = {};
        for (const tool of (tools.tools || tools || [])) {
          const serverName = tool.server || 'unknown';
          if (!serverTools[serverName]) {
            serverTools[serverName] = [];
          }
          serverTools[serverName].push({
            name: tool.name,
            description: tool.description?.substring(0, 100),
            status: 'available'
          });
        }

        return {
          success: true,
          totalTools: Object.values(serverTools).flat().length,
          servers: Object.keys(serverTools).length,
          byServer: serverTools
        };
      } else {
        return reply.code(500).send({
          success: false,
          error: `Failed to fetch tools: ${response.status}`
        });
      }
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[AdminMCP] Tools status failed');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });
};

/**
 * Capabilities routes at /api/capabilities/*
 */
export const capabilitiesRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /api/capabilities/catalog
   * Get system capabilities catalog
   */
  fastify.get('/catalog', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get MCP tools from proxy
      let mcpTools: any[] = [];
      try {
        const response = await fetch(`${MCP_PROXY_URL}/tools`);
        if (response.ok) {
          const data = await response.json();
          mcpTools = data.tools || data || [];
        }
      } catch (e) {
        loggers.services.warn('MCP proxy not available for capabilities');
      }

      // Get LLM providers from environment
      const providers = [];
      if (process.env.AZURE_OPENAI_API_KEY) providers.push('azure-openai');
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.VERTEX_AI_PROJECT) providers.push('vertex-ai');
      if (process.env.AWS_ACCESS_KEY_ID) providers.push('aws-bedrock');
      if (process.env.OLLAMA_BASE_URL) providers.push('ollama');
      if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
      if (process.env.OPENAI_API_KEY) providers.push('openai');

      return {
        success: true,
        catalog: {
          llmProviders: providers,
          mcpServers: [...new Set(mcpTools.map((t: any) => t.server))].filter(Boolean),
          mcpTools: mcpTools.length,
          features: {
            chat: true,
            streaming: true,
            toolCalling: mcpTools.length > 0,
            imageGeneration: !!process.env.IMAGE_GEN_MODEL,
            embeddings: !!process.env.EMBEDDING_MODEL,
            rag: !!process.env.MILVUS_ADDRESS,
            codeExecution: !!process.env.OPENAGENTIC_MANAGER_URL
          }
        }
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[Capabilities] Catalog failed');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/capabilities/stats
   * Get capability usage statistics
   */
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get tool count from MCP proxy
      let toolCount = 0;
      let serverCount = 0;
      try {
        const response = await fetch(`${MCP_PROXY_URL}/tools`);
        if (response.ok) {
          const data = await response.json();
          const tools = data.tools || data || [];
          toolCount = tools.length;
          serverCount = [...new Set(tools.map((t: any) => t.server))].filter(Boolean).length;
        }
      } catch (e) {
        // MCP not available
      }

      return {
        success: true,
        stats: {
          mcpTools: toolCount,
          mcpServers: serverCount,
          llmProviders: [
            process.env.AZURE_OPENAI_API_KEY && 'azure-openai',
            (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.VERTEX_AI_PROJECT) && 'vertex-ai',
            process.env.AWS_ACCESS_KEY_ID && 'aws-bedrock',
            process.env.OLLAMA_BASE_URL && 'ollama',
            process.env.ANTHROPIC_API_KEY && 'anthropic',
            process.env.OPENAI_API_KEY && 'openai'
          ].filter(Boolean).length,
          embeddingProvider: process.env.EMBEDDING_PROVIDER || 'none',
          vectorStore: process.env.MILVUS_ADDRESS ? 'milvus' : 'none'
        }
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[Capabilities] Stats failed');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/capabilities/tools/mcp
   * Get all MCP tools
   */
  fastify.get('/tools/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await fetch(`${MCP_PROXY_URL}/tools`);

      if (response.ok) {
        const data = await response.json();
        const tools = data.tools || data || [];

        return {
          success: true,
          count: tools.length,
          tools: tools.map((t: any) => ({
            name: t.name,
            server: t.server,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        };
      } else {
        return reply.code(500).send({
          success: false,
          error: `MCP proxy returned ${response.status}`
        });
      }
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[Capabilities] MCP tools failed');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });
};

export default adminMissingRoutes;
