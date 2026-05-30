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
import { Agent } from 'undici';
import { loggers } from '../utils/logger.js';

const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

// Shared dispatcher for mcp-proxy fetches — avoids the global pool getting
// starved by concurrent ollama/embedding calls (which caused /mcp/health
// to time out at 5s even though mcp-proxy answers in ~30ms).
const mcpProxyAgent = new Agent({
  connections: 32,
  connect: { timeout: 5_000 },
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
});

export const adminMissingRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /api/admin/mcp/health
   * Check MCP proxy health status
   */
  fastify.get('/mcp/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${MCP_PROXY_URL}/health`, {
        signal: controller.signal,
        dispatcher: mcpProxyAgent as any,
      } as any);
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

  // ──────────────────────────────────────────────────────────────────────
  // OSS enterprise stubs — these routes exist in the hosted edition but
  // are not part of OSS. Returning 402 (not 404) lets the UI render the
  // enterprise lock screen instead of a generic "endpoint missing" error.
  // ──────────────────────────────────────────────────────────────────────
  const enterpriseStub = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(402).send({
      error: 'PaymentRequired',
      edition: 'oss',
      message: 'This feature requires the hosted edition.',
      upgrade_url: 'https://agenticwork.io/purchase',
    });
  };
  // Prometheus query proxy — Dashboard charts (enterprise observability).
  fastify.post('/prom/query', enterpriseStub);
  fastify.post('/prom/query_range', enterpriseStub);
  fastify.get('/prom/health', enterpriseStub);
  // Cluster fleet — multi-node coordination (enterprise infra).
  // NOTE: /cluster/health is owned by admin/v3-extras-misc.ts already.
  fastify.get('/cluster/services', enterpriseStub);
  // Code Mode API keys — codemode stripped from OSS entirely.
  fastify.get('/agenticode/api-keys', enterpriseStub);
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
