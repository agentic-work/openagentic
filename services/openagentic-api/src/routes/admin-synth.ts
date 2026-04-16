/**
 * Admin Synth (Tool Synthesis) Routes
 *
 * Configuration and management endpoints for Synth in the admin portal.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SynthService, type SynthConfig } from '../services/SynthService.js';
import { ProviderManager } from '../services/llm-providers/ProviderManager.js';

interface AdminSynthContext {
  synthService: SynthService;
}

/**
 * Active SSE connections for synth approval notifications
 * Map: userId -> Set of FastifyReply objects
 */
const approvalSSEClients = new Map<string, Set<FastifyReply>>();

/**
 * Broadcast a synth approval event to all connected admin SSE clients
 */
export function broadcastSynthApprovalEvent(event: {
  type: string;
  data: Record<string, any>;
}): void {
  for (const [_userId, clients] of approvalSSEClients) {
    for (const reply of clients) {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      } catch {
        clients.delete(reply);
      }
    }
  }
}

// Get ProviderManager from global scope
function getProviderManager(): ProviderManager | null {
  return (global as any).providerManager || null;
}

/**
 * Register admin Synth routes
 */
export async function registerAdminSynthRoutes(
  fastify: FastifyInstance,
  context: AdminSynthContext
): Promise<void> {
  const { synthService } = context;

  /**
   * GET /api/admin/synth/config
   * Get current Synth configuration (full admin view)
   */
  fastify.get('/config', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Get Synth configuration',
      description: 'Returns the full Synth configuration including all admin settings',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            config: {
              type: 'object',
              properties: {
                // Visibility & Enablement
                enabled: { type: 'boolean', description: 'Whether Synth is enabled globally' },
                visibleToLLM: { type: 'boolean', description: 'Whether LLM can see Synth as available tool' },
                // Model Configuration
                provider: { type: 'string', description: 'LLM provider' },
                model: { type: 'string', description: 'Specific model ID for synthesis' },
                baseUrl: { type: 'string', description: 'Base URL for LLM API' },
                synthesisTemperature: { type: 'number', description: 'LLM temperature (0-1)' },
                maxSynthesisTokens: { type: 'number', description: 'Max tokens for synthesis' },
                useSliderModelSelection: { type: 'boolean', description: 'Use slider for model selection' },
                // Execution Settings
                timeoutSeconds: { type: 'number', description: 'Max execution timeout' },
                executorUrl: { type: 'string', description: 'Synth Executor service URL' },
                maxMemoryMb: { type: 'number', description: 'Max memory for execution' },
                maxConcurrentExecutions: { type: 'number', description: 'Max concurrent executions' },
                // Rate Limits & Budgets
                maxDailySynthesesPerUser: { type: 'number' },
                defaultUserDailyBudgetUsd: { type: 'number' },
                defaultGroupDailyBudgetUsd: { type: 'number' },
                // Approval Workflow
                autoApproveLowRisk: { type: 'boolean' },
                autoApproveMediumRisk: { type: 'boolean' },
                approvalTimeoutSeconds: { type: 'number' },
                approvalTimeoutAction: { type: 'string', enum: ['reject', 'approve'] },
                // Capabilities
                allowedCapabilities: { type: 'array', items: { type: 'string' } },
                blockedCapabilities: { type: 'array', items: { type: 'string' } },
                adminOnlyCapabilities: { type: 'array', items: { type: 'string' } },
                // Semantic Search
                useSemanticToolSearch: { type: 'boolean' },
                semanticSearchTopK: { type: 'number' },
                // Auth Settings
                credentialSource: { type: 'string', enum: ['sso_only', 'linked_accounts', 'none'] },
                sessionBasedOAuth: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const config = synthService.getConfig();
    return { config };
  });

  /**
   * PUT /api/admin/synth/config
   * Update Synth configuration (full admin control)
   */
  fastify.put('/config', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Update Synth configuration',
      description: 'Update any Synth configuration setting. All fields are optional.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          // Visibility & Enablement
          enabled: { type: 'boolean', description: 'Enable/disable Synth globally' },
          visibleToLLM: { type: 'boolean', description: 'Show/hide Synth from LLM during chat' },
          // Model Configuration
          provider: { type: 'string', enum: ['anthropic', 'bedrock', 'ollama', 'openai', 'google', 'azure', 'auto'] },
          model: { type: 'string', description: 'Model ID (e.g., claude-sonnet-4-20250514)' },
          baseUrl: { type: 'string', description: 'Base URL for custom LLM endpoint' },
          synthesisTemperature: { type: 'number', minimum: 0, maximum: 1 },
          maxSynthesisTokens: { type: 'number', minimum: 256, maximum: 32768 },
          useSliderModelSelection: { type: 'boolean', description: 'Use slider for dynamic model selection' },
          // Execution Settings
          timeoutSeconds: { type: 'number', minimum: 10, maximum: 600 },
          executorUrl: { type: 'string' },
          maxMemoryMb: { type: 'number', minimum: 64, maximum: 4096 },
          maxConcurrentExecutions: { type: 'number', minimum: 1, maximum: 100 },
          // Rate Limits & Budgets
          maxDailySynthesesPerUser: { type: 'number', minimum: 1, maximum: 10000 },
          defaultUserDailyBudgetUsd: { type: 'number', minimum: 0, maximum: 1000 },
          defaultGroupDailyBudgetUsd: { type: 'number', minimum: 0, maximum: 10000 },
          // Approval Workflow
          autoApproveLowRisk: { type: 'boolean' },
          autoApproveMediumRisk: { type: 'boolean' },
          approvalTimeoutSeconds: { type: 'number', minimum: 60, maximum: 86400 },
          approvalTimeoutAction: { type: 'string', enum: ['reject', 'approve'] },
          // Capabilities
          allowedCapabilities: { type: 'array', items: { type: 'string' } },
          blockedCapabilities: { type: 'array', items: { type: 'string' } },
          adminOnlyCapabilities: { type: 'array', items: { type: 'string' } },
          // Semantic Search
          useSemanticToolSearch: { type: 'boolean' },
          semanticSearchTopK: { type: 'number', minimum: 1, maximum: 50 },
          // Auth Settings
          credentialSource: { type: 'string', enum: ['sso_only', 'linked_accounts', 'none'] },
          sessionBasedOAuth: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            config: { type: 'object' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const updates = request.body as Partial<SynthConfig>;

    await synthService.updateConfig(updates);
    const config = synthService.getConfig();

    request.log.info({
      updates,
      enabled: config.enabled,
      visibleToLLM: config.visibleToLLM,
      model: config.model,
    }, 'Synth configuration updated by admin');

    return {
      success: true,
      config,
      message: 'Synth configuration updated successfully',
    };
  });

  /**
   * GET /api/admin/synth/models
   * List available models for Synth synthesis
   */
  fastify.get('/models', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'List available models',
      description: 'Returns all available LLM models that can be used for Synth synthesis',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            models: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Model ID' },
                  name: { type: 'string', description: 'Display name' },
                  provider: { type: 'string', description: 'Provider name' },
                  contextWindow: { type: 'number', description: 'Max context tokens' },
                  maxOutputTokens: { type: 'number', description: 'Max output tokens' },
                  inputCostPer1k: { type: 'number', description: 'Input cost per 1k tokens' },
                  outputCostPer1k: { type: 'number', description: 'Output cost per 1k tokens' },
                  recommended: { type: 'boolean', description: 'Recommended for Synth' },
                },
              },
            },
            currentModel: { type: 'string', description: 'Currently configured model' },
            currentProvider: { type: 'string', description: 'Currently configured provider' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const providerManager = getProviderManager();
    const config = synthService.getConfig();

    if (!providerManager) {
      return {
        models: [],
        currentModel: config.model,
        currentProvider: config.provider,
        error: 'ProviderManager not available',
      };
    }

    try {
      const allModels = await providerManager.listModels();

      // Filter and annotate models suitable for Synth
      const synthModels = allModels.map((model: any) => ({
        id: model.id || model.modelId,
        name: model.name || model.id,
        provider: model.provider,
        contextWindow: model.contextWindow || model.maxTokens,
        maxOutputTokens: model.maxOutputTokens || 4096,
        inputCostPer1k: model.inputCostPer1k || model.cost?.inputPer1kTokens || 0,
        outputCostPer1k: model.outputCostPer1k || model.cost?.outputPer1kTokens || 0,
        // Recommend models good for code generation
        recommended: (model.id || '').includes('claude') ||
                     (model.id || '').includes('gpt-4') ||
                     (model.id || '').includes('sonnet') ||
                     (model.id || '').includes('opus'),
      }));

      return {
        models: synthModels,
        currentModel: config.model,
        currentProvider: config.provider,
      };
    } catch (error) {
      request.log.error({ error }, 'Failed to list models for Synth');
      return {
        models: [],
        currentModel: config.model,
        currentProvider: config.provider,
        error: 'Failed to fetch models',
      };
    }
  });

  /**
   * GET /api/admin/synth/capabilities
   * List available Synth capabilities
   */
  fastify.get('/capabilities', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'List Synth capabilities',
      description: 'Returns all available Synth capabilities that can be used for tool synthesis',
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
                  authType: { type: 'string' },
                  scopes: { type: 'array', items: { type: 'string' } },
                  tokenEnvVar: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // These are the built-in Synth capabilities
    const capabilities = [
      {
        name: 'http',
        description: 'Make HTTP requests to external APIs',
        authType: 'none',
        scopes: ['http:get', 'http:post', 'http:put', 'http:delete'],
        tokenEnvVar: null,
      },
      {
        name: 'github',
        description: 'Interact with GitHub repositories, issues, and pull requests',
        authType: 'oauth',
        scopes: ['github:read', 'github:write', 'github:repo:read', 'github:issues:write'],
        tokenEnvVar: 'GITHUB_TOKEN',
      },
      {
        name: 'slack',
        description: 'Send and read Slack messages',
        authType: 'oauth',
        scopes: ['slack:read', 'slack:write', 'slack:chat:write'],
        tokenEnvVar: 'SLACK_TOKEN',
      },
      {
        name: 'aws',
        description: 'Interact with AWS services (S3, EC2, Lambda, etc.)',
        authType: 'aws_credentials',
        scopes: ['aws:s3:read', 'aws:s3:write', 'aws:ec2:read', 'aws:lambda:invoke'],
        tokenEnvVar: 'AWS_ACCESS_KEY_ID',
      },
      {
        name: 'azure',
        description: 'Interact with Azure services',
        authType: 'oauth',
        scopes: ['azure:resources:read', 'azure:resources:write'],
        tokenEnvVar: 'AZURE_ACCESS_TOKEN',
      },
      {
        name: 'gcp',
        description: 'Interact with Google Cloud Platform services',
        authType: 'oauth',
        scopes: ['gcp:storage:read', 'gcp:compute:read'],
        tokenEnvVar: 'GOOGLE_OAUTH_ACCESS_TOKEN',
      },
      {
        name: 'shell',
        description: 'Execute shell commands locally',
        authType: 'none',
        scopes: ['shell:execute'],
        tokenEnvVar: null,
      },
      {
        name: 'filesystem',
        description: 'Read and write local files',
        authType: 'none',
        scopes: ['filesystem:read', 'filesystem:write'],
        tokenEnvVar: null,
      },
      {
        name: 'json',
        description: 'Parse and manipulate JSON data',
        authType: 'none',
        scopes: ['json'],
        tokenEnvVar: null,
      },
      {
        name: 'datetime',
        description: 'Date and time operations',
        authType: 'none',
        scopes: ['datetime'],
        tokenEnvVar: null,
      },
    ];

    return { capabilities };
  });

  /**
   * GET /api/admin/synth/stats
   * Get Synth usage statistics
   */
  fastify.get('/stats', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Get Synth usage statistics',
      description: 'Returns usage statistics for Synth across all users',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'number', default: 7, description: 'Number of days to include' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            stats: {
              type: 'object',
              properties: {
                totalSyntheses: { type: 'number' },
                successfulSyntheses: { type: 'number' },
                failedSyntheses: { type: 'number' },
                totalCostUsd: { type: 'number' },
                avgExecutionMs: { type: 'number' },
                riskBreakdown: { type: 'object' },
                topCapabilities: { type: 'array', items: { type: 'object' } },
                dailyUsage: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { days = 7 } = request.query as { days?: number };

    // Get real stats from service (now includes topCapabilities and dailyUsage)
    const stats = await synthService.getUsageStats();

    return { stats };
  });

  /**
   * GET /api/admin/synth/history
   * Get Synth synthesis history
   */
  fastify.get('/history', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Get Synth synthesis history',
      description: 'Returns recent Synth synthesis history for all users',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50 },
          userId: { type: 'string', description: 'Filter by user ID' },
          riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          success: { type: 'boolean' },
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
                  userId: { type: 'string' },
                  userEmail: { type: 'string' },
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
    const { limit = 50, userId, riskLevel, success } = request.query as {
      limit?: number;
      userId?: string;
      riskLevel?: string;
      success?: boolean;
    };

    // If filtering by userId, use the service method
    if (userId && !riskLevel && success === undefined) {
      const history = await synthService.getHistory(userId, limit);
      return { history };
    }

    // Global history (all users) for admin view using Prisma model
    try {
      const whereClause: Record<string, any> = {};
      if (userId) whereClause.user_id = userId;
      if (riskLevel) whereClause.risk_level = riskLevel;
      if (success !== undefined) {
        whereClause.status = success ? 'completed' : 'failed';
      }

      const records = await fastify.prisma.synthSynthesis.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        take: limit,
        include: {
          user: { select: { email: true, name: true } },
        },
      });

      const history = records.map(r => ({
        toolId: r.id,
        userId: r.user_id,
        userEmail: r.user?.email || '',
        userName: r.user?.name || '',
        intent: r.intent,
        success: r.status === 'completed',
        status: r.status,
        riskLevel: r.risk_level,
        capabilitiesUsed: r.capabilities_used,
        executionTimeMs: r.execution_time_ms || 0,
        costUsd: r.cost_usd ? Number(r.cost_usd) : 0,
        error: r.error,
        dryRun: r.dry_run,
        approvalRequired: r.approval_required,
        createdAt: r.created_at.toISOString(),
        completedAt: r.completed_at?.toISOString(),
      }));

      return { history };
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to query global synth history, table may not exist yet');
      return { history: [] };
    }
  });

  /**
   * GET /api/admin/synth/history/:id
   * Get full detail for a single synthesis record
   */
  fastify.get('/history/:id', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Get synthesis detail',
      description: 'Returns full detail for a single synthesis including code, result, and approval info',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const record = await fastify.prisma.synthSynthesis.findUnique({
        where: { id },
        include: {
          user: { select: { email: true, name: true, id: true } },
          approval: {
            include: {
              approver: { select: { email: true, name: true } },
            },
          },
        },
      });

      if (!record) {
        return reply.code(404).send({ error: 'Synthesis record not found' });
      }

      return {
        synthesis: {
          id: record.id,
          userId: record.user_id,
          userEmail: record.user?.email || '',
          userName: record.user?.name || '',
          intent: record.intent,
          sessionId: record.session_id,
          capabilities: record.capabilities,
          capabilitiesUsed: record.capabilities_used,
          code: record.code,
          explanation: record.explanation,
          riskLevel: record.risk_level,
          riskReasoning: record.risk_reasoning,
          status: record.status,
          result: record.result,
          error: record.error,
          dryRun: record.dry_run,
          approvalRequired: record.approval_required,
          ssoProvider: record.sso_provider,
          synthesisTimeMs: record.synthesis_time_ms,
          executionTimeMs: record.execution_time_ms,
          inputTokens: record.input_tokens,
          outputTokens: record.output_tokens,
          costUsd: record.cost_usd ? Number(record.cost_usd) : 0,
          ttftMs: record.ttft_ms,
          createdAt: record.created_at.toISOString(),
          completedAt: record.completed_at?.toISOString(),
          approval: record.approval ? {
            id: record.approval.id,
            status: record.approval.status,
            approverEmail: record.approval.approver?.email,
            approverName: record.approval.approver?.name,
            reason: record.approval.reason,
            createdAt: record.approval.created_at.toISOString(),
            resolvedAt: record.approval.resolved_at?.toISOString(),
          } : null,
        },
      };
    } catch (error) {
      fastify.log.error({ error, id }, 'Failed to fetch synthesis detail');
      return reply.code(500).send({ error: 'Failed to fetch synthesis detail' });
    }
  });

  /**
   * POST /api/admin/synth/test
   * Test Synth synthesis (admin dry-run)
   */
  fastify.post('/test', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Test Synth synthesis',
      description: 'Perform a dry-run Synth synthesis for testing purposes',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['intent'],
        properties: {
          intent: { type: 'string', description: 'Natural language intent to synthesize' },
          capabilities: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            tool: { type: 'object' },
            metrics: { type: 'object' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { intent, capabilities } = request.body as { intent: string; capabilities?: string[] };
    const user = (request as any).user;

    const result = await synthService.synthesize({
      intent,
      userId: user?.id || 'admin-test',
      userEmail: user?.email || 'admin@openagentic.io',
      capabilities,
      dryRun: true,
    });

    return {
      success: result.success,
      tool: result.tool,
      metrics: result.metrics,
      error: result.error,
    };
  });

  /**
   * GET /api/admin/synth/approvals
   * Get pending Synth approvals
   */
  fastify.get('/approvals', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Get pending Synth approvals',
      description: 'Returns tools pending human approval',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            approvals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  toolId: { type: 'string' },
                  userId: { type: 'string' },
                  intent: { type: 'string' },
                  riskLevel: { type: 'string' },
                  code: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Query pending approvals from synth_approvals table using Prisma model
    try {
      const approvals = await fastify.prisma.synthApproval.findMany({
        where: { status: 'pending' },
        orderBy: { created_at: 'desc' },
        take: 100,
        include: {
          requester: { select: { email: true, name: true } },
        },
      });

      return {
        approvals: approvals.map(a => ({
          id: a.id,
          toolId: a.synthesis_id,
          userId: a.requester_id,
          userEmail: a.requester?.email || '',
          userName: a.requester?.name || '',
          intent: a.intent,
          riskLevel: a.risk_level,
          code: a.code,
          status: a.status,
          expiresAt: a.expires_at?.toISOString(),
          createdAt: a.created_at.toISOString(),
        })),
      };
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to query synth approvals, table may not exist yet');
      return { approvals: [] };
    }
  });

  /**
   * POST /api/admin/synth/approvals/:id/approve
   * Approve a pending Synth tool
   */
  fastify.post('/approvals/:id/approve', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Approve Synth tool',
      description: 'Approve a tool pending human approval',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };
    const user = (request as any).user;

    await synthService.processApproval(id, {
      approved: true,
      reason,
      approvedBy: user?.email || 'admin',
    });

    // Broadcast approval event to connected SSE clients
    broadcastSynthApprovalEvent({
      type: 'approval_resolved',
      data: {
        approvalId: id,
        status: 'approved',
        resolvedBy: user?.email || 'admin',
        reason,
        resolvedAt: new Date().toISOString(),
      },
    });

    return { success: true };
  });

  /**
   * POST /api/admin/synth/approvals/:id/reject
   * Reject a pending Synth tool
   */
  fastify.post('/approvals/:id/reject', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Reject Synth tool',
      description: 'Reject a tool pending human approval',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason: string };
    const user = (request as any).user;

    await synthService.processApproval(id, {
      approved: false,
      reason,
      approvedBy: user?.email || 'admin',
    });

    // Broadcast rejection event to connected SSE clients
    broadcastSynthApprovalEvent({
      type: 'approval_resolved',
      data: {
        approvalId: id,
        status: 'rejected',
        resolvedBy: user?.email || 'admin',
        reason,
        resolvedAt: new Date().toISOString(),
      },
    });

    return { success: true };
  });

  // Also update the approve endpoint to broadcast
  // (We need to hook into the existing approve handler's response)
  // The approve handler is already registered above at '/approvals/:id/approve'
  // We add broadcast there too by modifying the approve handler result broadcast.
  // Since Fastify doesn't allow overriding, we rely on the SynthService event emitter below.

  /**
   * GET /api/admin/synth/approvals/stream
   * SSE stream for real-time approval notifications
   *
   * Admins connect to this endpoint to receive live notifications when
   * new synth tools require approval or when approvals are resolved.
   */
  fastify.get('/approvals/stream', {
    schema: {
      tags: ['Admin - Synth'],
      summary: 'Stream approval notifications',
      description: 'SSE endpoint for real-time synth approval notifications',
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const userId = user?.id || 'anonymous';

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });

    // Send initial connection confirmation
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ userId, connectedAt: new Date().toISOString() })}\n\n`);

    // Register this connection
    if (!approvalSSEClients.has(userId)) {
      approvalSSEClients.set(userId, new Set());
    }
    approvalSSEClients.get(userId)!.add(reply);

    fastify.log.info({ userId }, 'Admin connected to synth approval SSE stream');

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`:heartbeat\n\n`);
        }
      } catch {
        clearInterval(heartbeat);
      }
    }, 30000);

    // Clean up on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      approvalSSEClients.get(userId)?.delete(reply);
      if (approvalSSEClients.get(userId)?.size === 0) {
        approvalSSEClients.delete(userId);
      }
      fastify.log.info({ userId }, 'Admin disconnected from synth approval SSE stream');
    });
  });

  // Wire up SynthService events to SSE broadcasts
  synthService.on('approval_requested', (data: any) => {
    broadcastSynthApprovalEvent({
      type: 'approval_requested',
      data: {
        approvalId: data.approvalId,
        synthesisId: data.synthesisId,
        userId: data.userId,
        userEmail: data.userEmail,
        intent: data.intent,
        riskLevel: data.riskLevel,
        expiresAt: data.expiresAt,
        requestedAt: new Date().toISOString(),
      },
    });
  });

  synthService.on('approval_processed', (data: any) => {
    broadcastSynthApprovalEvent({
      type: 'approval_resolved',
      data: {
        approvalId: data.approvalId,
        status: data.approved ? 'approved' : 'rejected',
        resolvedBy: data.approvedBy,
        reason: data.reason,
        resolvedAt: new Date().toISOString(),
      },
    });
  });
}

export default registerAdminSynthRoutes;
