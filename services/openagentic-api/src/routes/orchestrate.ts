/**
 * Orchestration Routes
 *
 * Provides endpoints for concurrent subagent execution.
 * Enables complex multi-domain requests to be processed in parallel.
 *
 * Use Cases:
 * - M&A Due Diligence: Parallel financial, legal, technical analysis
 * - Multi-Cloud Deployments: Concurrent AWS/Azure/GCP operations
 * - Research Tasks: Parallel web searches and document analysis
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { logger } from '../utils/logger.js';
import { createSubagentOrchestrator, type OrchestrationResult, type LLMClient, type OrchestratorEvent, type EventEmitter } from '../services/SubagentOrchestrator.js';
import { createMCPProxyClient } from '../services/MCPProxyClient.js';
import { GoogleVertexProvider } from '../services/llm-providers/GoogleVertexProvider.js';

const OrchestrateStreamSchema = z.object({
  request: z.string().min(1, 'Request is required'),
  availableTools: z.array(z.string()).optional()
});

// Validation schemas
const OrchestratePlanSchema = z.object({
  request: z.string().min(1, 'Request is required'),
  availableTools: z.array(z.string()).optional()
});

const OrchestrateExecuteSchema = z.object({
  request: z.string().min(1, 'Request is required'),
  availableTools: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  stream: z.boolean().optional().default(false)
});

export default async function orchestrateRoutes(fastify: FastifyInstance) {

  /**
   * POST /api/orchestrate/plan
   *
   * Analyze a request and create an execution plan without executing it.
   * Useful for previewing what subagents would be created.
   */
  fastify.post('/api/orchestrate/plan', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const body = OrchestratePlanSchema.parse(request.body);

      logger.info({
        userId,
        requestLength: body.request.length
      }, '[Orchestrate] Creating execution plan');

      // Create orchestrator (no MCP proxy needed for planning)
      const orchestrator = createSubagentOrchestrator(logger);

      // Get available tools if not provided
      let tools = body.availableTools;
      if (!tools || tools.length === 0) {
        const userToken = (request as any).accessToken;
        const mcpClient = createMCPProxyClient(logger, userToken);
        tools = await mcpClient.getAvailableTools();
      }

      // Create plan
      const plan = await orchestrator.createPlan(body.request, tools);

      return reply.send({
        success: true,
        plan: {
          originalRequest: plan.originalRequest,
          complexity: plan.complexity,
          parallelizable: plan.parallelizable,
          subtaskCount: plan.subtasks.length,
          executionGroupCount: plan.executionGroups.length,
          estimatedDurationMs: plan.estimatedDurationMs,
          estimatedCost: plan.estimatedCost,
          subtasks: plan.subtasks.map(t => ({
            id: t.id,
            name: t.name,
            domain: t.domain,
            mcpServer: t.mcpServer,
            toolCount: t.tools.length,
            dependsOn: t.dependsOn
          })),
          executionGroups: plan.executionGroups.map((group, idx) => ({
            groupIndex: idx,
            parallelTasks: group.map(t => t.name)
          }))
        }
      });

    } catch (error: any) {
      logger.error({
        error: error.message,
        userId
      }, '[Orchestrate] Failed to create plan');

      return reply.code(400).send({
        error: 'Failed to create execution plan',
        message: error.message
      });
    }
  });

  /**
   * POST /api/orchestrate/execute
   *
   * Execute a request with concurrent subagents.
   * This is the main endpoint for parallel task execution.
   */
  fastify.post('/api/orchestrate/execute', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const userToken = (request as any).accessToken;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const body = OrchestrateExecuteSchema.parse(request.body);

      logger.info({
        userId,
        requestLength: body.request.length,
        stream: body.stream
      }, '[Orchestrate] Executing with subagents');

      // Create MCP client with user's token for OBO
      const mcpClient = createMCPProxyClient(logger, userToken);

      // Create LLM client for subagent reasoning
      // Each subagent gets its own LLM brain via this provider
      let llmClient: LLMClient | undefined;
      try {
        const vertexProvider = new GoogleVertexProvider(logger);
        await vertexProvider.initialize({
          projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT_ID,
          location: process.env.VERTEX_AI_LOCATION || 'us-central1'
        });
        llmClient = vertexProvider;
        logger.info('[Orchestrate] LLM client initialized for subagent brains');
      } catch (llmError: any) {
        logger.warn({ error: llmError.message }, '[Orchestrate] LLM client init failed, using tool-only mode');
      }

      // Create orchestrator with MCP client AND LLM client
      const orchestrator = createSubagentOrchestrator(logger, mcpClient, llmClient);

      // Get available tools if not provided
      let tools = body.availableTools;
      if (!tools || tools.length === 0) {
        tools = await mcpClient.getAvailableTools();
      }

      // Execute with orchestration
      const result = await orchestrator.orchestrate(body.request, tools);

      // Format response
      const response = {
        success: true,
        orchestration: {
          totalDurationMs: result.totalDurationMs,
          parallelSpeedup: Math.round(result.parallelSpeedup * 100) / 100,
          complexity: result.plan.complexity,
          subtaskCount: result.plan.subtasks.length
        },
        results: result.results.map(r => ({
          taskId: r.taskId,
          taskName: r.taskName,
          domain: r.domain,
          success: r.success,
          durationMs: r.durationMs,
          toolsUsed: r.toolsUsed,
          error: r.error,
          // Include result preview (truncated for large results)
          resultPreview: r.result
            ? JSON.stringify(r.result).substring(0, 500)
            : null
        })),
        synthesis: result.synthesis
      };

      return reply.send(response);

    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        userId
      }, '[Orchestrate] Execution failed');

      return reply.code(500).send({
        error: 'Orchestration execution failed',
        message: error.message
      });
    }
  });

  /**
   * POST /api/orchestrate/stream
   *
   * Execute with streaming SSE events for real-time UI updates.
   * Events include: subagent_started, subagent_tool_call, subagent_completed, etc.
   */
  fastify.post('/api/orchestrate/stream', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const userToken = (request as any).accessToken;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const body = OrchestrateStreamSchema.parse(request.body);

      logger.info({
        userId,
        requestLength: body.request.length
      }, '[Orchestrate] Starting streaming execution');

      // Set up SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');

      // Create event emitter that writes to SSE stream
      const emitEvent: EventEmitter = (event: OrchestratorEvent) => {
        const data = JSON.stringify(event);
        reply.raw.write(`data: ${data}\n\n`);
      };

      // Create MCP client with user's token
      const mcpClient = createMCPProxyClient(logger, userToken);

      // Create LLM client for subagent reasoning
      let llmClient: LLMClient | undefined;
      try {
        const vertexProvider = new GoogleVertexProvider(logger);
        await vertexProvider.initialize({
          projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT_ID,
          location: process.env.VERTEX_AI_LOCATION || 'us-central1'
        });
        llmClient = vertexProvider;
      } catch (llmError: any) {
        logger.warn({ error: llmError.message }, '[Orchestrate] LLM client init failed for streaming');
      }

      // Create orchestrator WITH event emitter
      const orchestrator = createSubagentOrchestrator(logger, mcpClient, llmClient, emitEvent);

      // Get available tools if not provided
      let tools = body.availableTools;
      if (!tools || tools.length === 0) {
        tools = await mcpClient.getAvailableTools();
      }

      // Execute with orchestration (events will stream as they happen)
      const result = await orchestrator.orchestrate(body.request, tools);

      // Send final result
      const finalEvent: OrchestratorEvent = {
        type: 'orchestration_completed',
        timestamp: new Date().toISOString(),
        data: {
          success: true,
          orchestration: {
            totalDurationMs: result.totalDurationMs,
            parallelSpeedup: Math.round(result.parallelSpeedup * 100) / 100,
            complexity: result.plan.complexity,
            subtaskCount: result.plan.subtasks.length
          },
          synthesis: result.synthesis
        }
      };
      reply.raw.write(`data: ${JSON.stringify(finalEvent)}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();

      return reply;

    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        userId
      }, '[Orchestrate] Streaming execution failed');

      // Send error event
      const errorEvent = {
        type: 'error',
        timestamp: new Date().toISOString(),
        data: { error: error.message }
      };
      reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      reply.raw.end();

      return reply;
    }
  });

  /**
   * POST /api/orchestrate/analyze
   *
   * Quick analysis to determine if a request would benefit from parallel execution.
   * Returns whether the request is parallelizable and detected domains.
   */
  fastify.post('/api/orchestrate/analyze', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const body = z.object({
        request: z.string().min(1)
      }).parse(request.body);

      const orchestrator = createSubagentOrchestrator(logger);
      const plan = await orchestrator.createPlan(body.request);

      return reply.send({
        success: true,
        analysis: {
          parallelizable: plan.parallelizable,
          complexity: plan.complexity,
          domainCount: new Set(plan.subtasks.map(t => t.domain)).size,
          domains: [...new Set(plan.subtasks.map(t => t.domain))],
          subtaskCount: plan.subtasks.length,
          recommendation: plan.parallelizable
            ? 'This request would benefit from parallel execution using /api/orchestrate/execute'
            : 'This request can be handled with standard sequential execution'
        }
      });

    } catch (error: any) {
      logger.error({
        error: error.message,
        userId
      }, '[Orchestrate] Analysis failed');

      return reply.code(400).send({
        error: 'Analysis failed',
        message: error.message
      });
    }
  });

  /**
   * GET /api/orchestrate/domains
   *
   * List available domains and their MCP servers.
   * Useful for understanding what parallel capabilities are available.
   */
  fastify.get('/api/orchestrate/domains', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || user?.userId;
    const userToken = (request as any).accessToken;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      // Get available MCP servers
      const mcpClient = createMCPProxyClient(logger, userToken);
      const servers = await mcpClient.getServers();

      // Define domain mappings
      const domains = [
        {
          domain: 'aws',
          mcpServer: 'oap-aws-mcp',
          keywords: ['aws', 'amazon', 'ec2', 's3', 'lambda'],
          available: servers.some(s => s.name.includes('aws'))
        },
        {
          domain: 'azure',
          mcpServer: 'oap-azure-mcp',
          keywords: ['azure', 'microsoft', 'arm', 'aks'],
          available: servers.some(s => s.name.includes('azure'))
        },
        {
          domain: 'gcp',
          mcpServer: 'oap-gcp-mcp',
          keywords: ['gcp', 'google', 'gce', 'gke'],
          available: servers.some(s => s.name.includes('gcp'))
        },
        {
          domain: 'github',
          mcpServer: 'oap-github-mcp',
          keywords: ['github', 'repository', 'commit', 'pr'],
          available: servers.some(s => s.name.includes('github'))
        },
        {
          domain: 'financial',
          mcpServer: 'oap-financial-mcp',
          keywords: ['financial', 'revenue', 'valuation'],
          available: servers.some(s => s.name.includes('financial'))
        },
        {
          domain: 'technical',
          mcpServer: 'oap-openagentic-mcp',
          keywords: ['code', 'architecture', 'security'],
          available: servers.some(s => s.name.includes('openagentic'))
        }
      ];

      return reply.send({
        success: true,
        domains,
        availableDomains: domains.filter(d => d.available).map(d => d.domain),
        serverCount: servers.length
      });

    } catch (error: any) {
      logger.error({
        error: error.message,
        userId
      }, '[Orchestrate] Failed to get domains');

      return reply.code(500).send({
        error: 'Failed to get domains',
        message: error.message
      });
    }
  });
}
