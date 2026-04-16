/**
 * Synth (Tool Synthesis) User Routes
 *
 * User-facing endpoints for Synth tool synthesis and execution.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SynthService, type SynthRequest } from '../services/SynthService.js';
import { AzureOBOService } from '../services/AzureOBOService.js';

interface SynthRouteContext {
  synthService: SynthService;
}

/**
 * Register Synth user routes
 */
export async function registerSynthRoutes(
  fastify: FastifyInstance,
  context: SynthRouteContext
): Promise<void> {
  const { synthService } = context;
  const oboService = new AzureOBOService(fastify.log);

  /**
   * Inject cloud credentials from user's Azure AD SSO token via OBO exchange.
   * Only runs on mutation endpoints (POST/PUT/DELETE), NOT on approval polling (GET).
   * Populates request.cloudCredentials so synthesized code runs AS the authenticated user.
   */
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    // Skip OBO on GET requests (approval polling) — they don't need cloud credentials
    if (request.method === 'GET') return;

    const user = (request as any).user;
    if (!user?.accessToken || user.accessToken === 'internal-service-token') return;

    try {
      // Exchange user's Azure AD token for ARM + Graph scoped tokens
      const [armResult, graphResult] = await Promise.allSettled([
        oboService.acquireTokenOnBehalfOf({
          userAccessToken: user.accessToken,
          scopes: ['https://management.azure.com/.default'],
        }),
        oboService.acquireTokenOnBehalfOf({
          userAccessToken: user.accessToken,
          scopes: ['https://graph.microsoft.com/.default'],
        }),
      ]);

      const azure: any = {};
      if (armResult.status === 'fulfilled' && armResult.value) {
        azure.accessToken = armResult.value.accessToken;
        azure.tenantId = process.env.AZURE_TENANT_ID || '';
      }

      if (Object.keys(azure).length > 0) {
        (request as any).cloudCredentials = { azure };
        request.log.info({ userId: user.id }, 'Cloud credentials injected via OBO for Synth');
      }
    } catch (err) {
      request.log.warn({ err, userId: user?.id }, 'OBO credential injection failed (non-fatal)');
    }
  });

  /**
   * POST /api/synth/synthesize
   * Synthesize and execute a tool from natural language intent
   */
  fastify.post('/synthesize', {
    schema: {
      tags: ['Synth'],
      summary: 'Synthesize tool from intent',
      description: `
Dynamically synthesize and execute a one-shot tool from natural language intent.

Synth (Tool Synthesis) will:
1. Analyze your intent and select appropriate capabilities
2. Synthesize secure Python code for the task
3. Request human approval (if required by risk level)
4. Execute in a sandboxed environment with your credentials
5. Return results with full metrics

Your cloud credentials (AWS, Azure, GCP) from SSO are automatically used,
so the tool runs AS YOU with your permissions.
      `,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['intent'],
        properties: {
          intent: {
            type: 'string',
            description: 'Natural language description of what you want to accomplish',
            examples: [
              'Fetch the current Bitcoin price from CoinGecko',
              'List all S3 buckets in my AWS account',
              'Get the top 5 trending repos on GitHub',
            ],
          },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific capabilities to use (optional, defaults to all allowed)',
          },
          dryRun: {
            type: 'boolean',
            default: false,
            description: 'If true, only synthesize and show code without executing',
          },
          sessionId: {
            type: 'string',
            description: 'Chat session ID for context tracking',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            toolId: { type: 'string' },
            intent: { type: 'string' },
            tool: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                explanation: { type: 'string' },
                riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                riskReasoning: { type: 'string' },
                capabilitiesUsed: { type: 'array', items: { type: 'string' } },
              },
            },
            result: {},
            error: { type: 'string' },
            metrics: {
              type: 'object',
              properties: {
                synthesisTimeMs: { type: 'number' },
                executionTimeMs: { type: 'number' },
                totalTimeMs: { type: 'number' },
                inputTokens: { type: 'number' },
                outputTokens: { type: 'number' },
                costUsd: { type: 'number' },
                ttftMs: { type: 'number' },
              },
            },
            approval: {
              type: 'object',
              properties: {
                required: { type: 'boolean' },
                approved: { type: 'boolean' },
                reason: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        429: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            resetAt: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      intent: string;
      capabilities?: string[];
      dryRun?: boolean;
      sessionId?: string;
    };

    const user = (request as any).user;

    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    // Build synthesis request
    const synthesisRequest: SynthRequest = {
      intent: body.intent,
      userId: user.id,
      userEmail: user.email,
      capabilities: body.capabilities,
      dryRun: body.dryRun,
      sessionId: body.sessionId,
      // User's linked cloud credentials would come from the user's profile
      // For now, we rely on environment variables or session credentials
      credentials: (request as any).cloudCredentials,
    };

    request.log.info({
      userId: user.id,
      intent: body.intent.substring(0, 100),
      dryRun: body.dryRun,
    }, 'Synth synthesis requested');

    try {
      const result = await synthService.synthesize(synthesisRequest);

      return result;

    } catch (error) {
      request.log.error({ error, userId: user.id }, 'Synth synthesis failed');

      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Synthesis failed',
        code: 'SYNTHESIS_ERROR',
      });
    }
  });

  /**
   * GET /api/synth/history
   * Get user's synthesis history
   */
  fastify.get('/history', {
    schema: {
      tags: ['Synth'],
      summary: 'Get synthesis history',
      description: 'Returns your recent Synth synthesis history',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            history: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  toolId: { type: 'string' },
                  intent: { type: 'string' },
                  success: { type: 'boolean' },
                  riskLevel: { type: 'string' },
                  executionTimeMs: { type: 'number' },
                  costUsd: { type: 'number' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = 20 } = request.query as { limit?: number };
    const user = (request as any).user;

    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const history = await synthService.getHistory(user.id, limit);

    return { history };
  });

  /**
   * GET /api/synth/capabilities
   * Get available capabilities for the user
   */
  fastify.get('/capabilities', {
    schema: {
      tags: ['Synth'],
      summary: 'Get available capabilities',
      description: 'Returns Synth capabilities available to you based on your permissions',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            capabilities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  available: { type: 'boolean' },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const config = synthService.getConfig();

    // All available capabilities
    const allCapabilities = [
      { name: 'http', description: 'Make HTTP requests to external APIs' },
      { name: 'github', description: 'Interact with GitHub repositories' },
      { name: 'slack', description: 'Send and read Slack messages' },
      { name: 'aws', description: 'Interact with AWS services' },
      { name: 'azure', description: 'Interact with Azure services' },
      { name: 'gcp', description: 'Interact with Google Cloud Platform' },
      { name: 'shell', description: 'Execute shell commands' },
      { name: 'filesystem', description: 'Read and write files' },
      { name: 'json', description: 'Parse and manipulate JSON' },
      { name: 'datetime', description: 'Date and time operations' },
    ];

    // Filter based on configuration
    const capabilities = allCapabilities.map(cap => {
      const blocked = config.blockedCapabilities.includes(cap.name);
      const allowed = config.allowedCapabilities.length === 0 ||
                      config.allowedCapabilities.includes(cap.name);

      return {
        ...cap,
        available: !blocked && allowed,
        reason: blocked ? 'Blocked by administrator' :
                (!allowed ? 'Not in allowed list' : undefined),
      };
    });

    return { capabilities };
  });

  /**
   * GET /api/synth/usage
   * Get user's usage statistics
   */
  fastify.get('/usage', {
    schema: {
      tags: ['Synth'],
      summary: 'Get usage statistics',
      description: 'Returns your Synth usage statistics and remaining quota',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            usage: {
              type: 'object',
              properties: {
                todaySyntheses: { type: 'number' },
                dailyLimit: { type: 'number' },
                remaining: { type: 'number' },
                totalSyntheses: { type: 'number' },
                totalCostUsd: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const config = synthService.getConfig();
    const stats = await synthService.getUsageStats(user.id);

    return {
      usage: {
        todaySyntheses: stats.todaySyntheses,
        dailyLimit: config.maxDailySynthesesPerUser,
        remaining: Math.max(0, config.maxDailySynthesesPerUser - stats.todaySyntheses),
        totalSyntheses: stats.totalSyntheses,
        successfulSyntheses: stats.successfulSyntheses,
        failedSyntheses: stats.failedSyntheses,
        totalCostUsd: stats.totalCostUsd,
        avgCostUsd: stats.avgCostUsd,
        avgExecutionMs: stats.avgExecutionMs,
        riskBreakdown: stats.riskBreakdown,
      },
    };
  });

  /**
   * GET /api/synth/approvals
   * Get pending approvals for the current user (optionally filtered by session)
   */
  fastify.get('/approvals', {
    schema: {
      tags: ['Synth'],
      summary: 'Get my pending approvals',
      description: 'Returns pending synth approvals that belong to the current user, optionally filtered by session ID',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Filter by chat session ID' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.code(401).send({ error: 'Authentication required' });

    const { sessionId } = request.query as { sessionId?: string };

    try {
      // Get pending approvals for this user
      const approvals = await (fastify as any).prisma.synthApproval.findMany({
        where: {
          requester_id: user.id,
          status: 'pending',
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      });

      // If sessionId filter, also filter by matching synthesis session_id
      let filtered = approvals;
      if (sessionId) {
        const synthesisIds = approvals.map((a: any) => a.synthesis_id);
        const syntheses = await (fastify as any).prisma.synthSynthesis.findMany({
          where: {
            id: { in: synthesisIds },
            session_id: sessionId,
          },
          select: { id: true },
        });
        const matchingIds = new Set(syntheses.map((s: any) => s.id));
        filtered = approvals.filter((a: any) => matchingIds.has(a.synthesis_id));
      }

      // GAP-4: also surface recently-completed post-approval executions for this
      // session so the UI can render the result inline. The chat UI polls this
      // endpoint, so by piggybacking the result here we don't need a new SSE channel.
      // Returns syntheses completed in the last 5 minutes that the user owns.
      let recentResults: any[] = [];
      if (sessionId) {
        try {
          const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
          const completed = await (fastify as any).prisma.synthSynthesis.findMany({
            where: {
              user_id: user.id,
              session_id: sessionId,
              status: { in: ['completed', 'failed'] },
              completed_at: { gte: fiveMinAgo },
            },
            select: {
              id: true,
              intent: true,
              status: true,
              result: true,
              error: true,
              execution_time_ms: true,
              completed_at: true,
            },
            orderBy: { completed_at: 'desc' },
            take: 10,
          });
          recentResults = completed.map((s: any) => ({
            synthesisId: s.id,
            intent: s.intent,
            status: s.status,
            result: s.result,
            error: s.error,
            executionTimeMs: s.execution_time_ms,
            completedAt: s.completed_at?.toISOString(),
          }));
        } catch (err) {
          fastify.log.debug({ err }, 'Failed to query recent synth results (non-fatal)');
        }
      }

      return {
        approvals: filtered.map((a: any) => ({
          id: a.id,
          synthesisId: a.synthesis_id,
          intent: a.intent,
          riskLevel: a.risk_level,
          code: a.code,
          status: a.status,
          expiresAt: a.expires_at?.toISOString(),
          createdAt: a.created_at.toISOString(),
        })),
        recentResults,
      };
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to query user synth approvals');
      return { approvals: [], recentResults: [] };
    }
  });

  /**
   * POST /api/synth/approvals/:id/approve
   * User approves their own pending synth tool
   */
  fastify.post('/approvals/:id/approve', {
    schema: {
      tags: ['Synth'],
      summary: 'Approve my synth tool',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.code(401).send({ error: 'Authentication required' });

    const { id } = request.params as { id: string };

    try {
      // Verify user owns this approval
      const approval = await (fastify as any).prisma.synthApproval.findUnique({
        where: { id },
      });

      if (!approval) return reply.code(404).send({ error: 'Approval not found' });
      if (approval.requester_id !== user.id) return reply.code(403).send({ error: 'Not your approval' });
      if (approval.status !== 'pending') return reply.code(400).send({ error: `Approval already ${approval.status}` });

      // GAP-4: process the approval AND kick off post-approval execution.
      // The OBO preHandler at the top of this route file already populated
      // (request as any).cloudCredentials with the approving user's Azure ARM
      // token via OBO exchange. Pass it through so the synth code can run
      // AS the user with their cloud credentials injected into the sandbox.
      const cloudCredentials = (request as any).cloudCredentials;
      await synthService.processApproval(id, {
        approved: true,
        approvedBy: user.id,
        reason: 'User self-approved',
        cloudCredentials,
      });

      return { success: true, message: 'Tool approved and executing' };
    } catch (error) {
      fastify.log.error({ error }, 'Failed to approve synth tool');
      return reply.code(500).send({ error: 'Failed to approve' });
    }
  });

  /**
   * POST /api/synth/approvals/:id/reject
   * User rejects their own pending synth tool
   */
  fastify.post('/approvals/:id/reject', {
    schema: {
      tags: ['Synth'],
      summary: 'Reject my synth tool',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.code(401).send({ error: 'Authentication required' });

    const { id } = request.params as { id: string };

    try {
      const approval = await (fastify as any).prisma.synthApproval.findUnique({
        where: { id },
      });

      if (!approval) return reply.code(404).send({ error: 'Approval not found' });
      if (approval.requester_id !== user.id) return reply.code(403).send({ error: 'Not your approval' });
      if (approval.status !== 'pending') return reply.code(400).send({ error: `Approval already ${approval.status}` });

      await synthService.processApproval(id, { approved: false, approvedBy: user.id, reason: 'User rejected' });

      return { success: true, message: 'Tool rejected' };
    } catch (error) {
      fastify.log.error({ error }, 'Failed to reject synth tool');
      return reply.code(500).send({ error: 'Failed to reject' });
    }
  });

  /**
   * DELETE /api/synth/execution/:id
   * Cancel a running Synth execution
   */
  fastify.delete('/execution/:id', {
    schema: {
      tags: ['Synth'],
      summary: 'Cancel execution',
      description: 'Cancel a running Synth execution',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;

    // Verify user owns this execution (id includes user ID)
    if (!id.startsWith(user.id)) {
      return reply.code(403).send({ error: 'Not authorized to cancel this execution' });
    }

    const cancelled = synthService.cancelExecution(id);

    return {
      success: cancelled,
      message: cancelled ? 'Execution cancelled' : 'Execution not found or already completed',
    };
  });
}

export default registerSynthRoutes;
