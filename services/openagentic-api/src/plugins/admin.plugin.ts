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
 * Admin Routes Plugin
 *
 * Modularized from server.ts (HIGH-001 refactoring)
 * Groups all admin-related route registrations into a single Fastify plugin.
 *
 * All routes require admin authentication via adminMiddleware.
 *
 * Includes:
 * - Admin core routes
 * - Admin portal enhanced routes
 * - Admin system monitoring routes
 * - Admin slider routes
 * - Admin rate limits routes
 * - Admin chargeback routes
 * - Admin tiered function calling routes
 * - Admin MCP routes
 * - Admin Ollama routes (conditional)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';

interface AdminPluginOptions {
  ollamaEnabled?: boolean;
}

const adminPlugin: FastifyPluginAsync<AdminPluginOptions> = async (
  fastify: FastifyInstance,
  options: AdminPluginOptions
) => {
  const ollamaEnabled = options.ollamaEnabled ?? process.env.OLLAMA_ENABLED === 'true';

  // Track registration success/failure for summary
  let successCount = 0;
  let failCount = 0;

  loggers.routes.info('Registering admin routes plugin...');

  // Cache-Control for admin API responses
  // Analytics/metrics: 30s (not real-time critical)
  // Config endpoints: 10s (changes infrequently)
  // Audit/logs: no-cache (always fresh)
  fastify.addHook('onSend', async (request, reply) => {
    if (reply.statusCode >= 200 && reply.statusCode < 300 && request.method === 'GET') {
      const url = request.url;
      if (!reply.hasHeader('cache-control')) {
        if (url.includes('metrics') || url.includes('analytics') || url.includes('stats') || url.includes('dashboard')) {
          reply.header('cache-control', 'private, max-age=30');
        } else if (url.includes('audit') || url.includes('logs') || url.includes('executions')) {
          reply.header('cache-control', 'no-cache');
        } else {
          reply.header('cache-control', 'private, max-age=10');
        }
      }
    }
  });

  // Register Admin routes
  try {
    const { adminRoutes } = await import('../routes/admin.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin routes registered at /api/admin with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin routes');
    failCount++;
  }

  // Register Admin Portal Enhanced routes
  try {
    const { adminPortalEnhancedRoutes } = await import('../routes/admin-portal-enhanced.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminPortalEnhancedRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Enhanced admin portal routes registered at /api/admin with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register enhanced admin portal routes');
    failCount++;
  }

  // Register Admin Ollama routes for Ollama model management (only if enabled)
  if (ollamaEnabled) {
    try {
      const { adminOllamaRoutes } = await import('../routes/admin-ollama.js');
      await fastify.register(async (instance) => {
        instance.addHook('preHandler', adminMiddleware);
        await instance.register(adminOllamaRoutes);
      }, { prefix: '/api/admin' });
      loggers.routes.info('Admin Ollama routes registered at /api/admin/ollama/* with admin middleware');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register admin Ollama routes');
    }
  } else {
    loggers.routes.info('Ollama routes skipped - OLLAMA_ENABLED is false');
  }

  // Register Admin Missing Routes (MCP health, tools status)
  try {
    const { adminMissingRoutes, capabilitiesRoutes } = await import('../routes/admin-missing-routes.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMissingRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin missing routes registered at /api/admin/mcp/health, /api/admin/mcp-tools/status');

    // Register capabilities routes at /api/capabilities/*
    await fastify.register(capabilitiesRoutes, { prefix: '/api/capabilities' });
    loggers.routes.info('Capabilities routes registered at /api/capabilities/*');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin missing routes');
    failCount++;
  }

  // Register Admin System routes for real-time system monitoring
  try {
    const { adminSystemRoutes } = await import('../routes/admin-system.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminSystemRoutes);
    }, { prefix: '/api/admin/system' });
    loggers.routes.info('Admin System monitoring routes registered at /api/admin/system/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin system routes');
    failCount++;
  }

  // Register Admin Test Harness routes for system-wide testing
  try {
    const { default: testHarnessRoutes } = await import('../routes/admin-test-harness.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(testHarnessRoutes);
    }, { prefix: '/api/admin/test-harness' });
    loggers.routes.info('Admin Test Harness routes registered at /api/admin/test-harness/*');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin test harness routes');
    failCount++;
  }

  // Register Admin DLP routes for Data Loss Prevention rule management
  try {
    const { default: dlpRoutes } = await import('../routes/admin/dlp.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(dlpRoutes);
    }, { prefix: '/api/admin/dlp' });
    loggers.routes.info('Admin DLP routes registered at /api/admin/dlp/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin DLP routes');
    failCount++;
  }

  // Register Agent Metrics routes
  try {
    const { default: agentMetricsRoutes } = await import('../routes/admin/agent-metrics.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(agentMetricsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Agent metrics time-series routes registered at /api/admin/agents/metrics/*');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register agent metrics routes');
    failCount++;
  }

  // Register Admin Slider routes for intelligence slider management
  try {
    const { adminSliderRoutes } = await import('../routes/admin-slider.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminSliderRoutes);
    }, { prefix: '/api/admin/slider' });
    loggers.routes.info('Admin Slider routes registered at /api/admin/slider/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin slider routes');
    failCount++;
  }

  // Register Admin Rate Limits routes for rate limit configuration
  try {
    const { adminRateLimitsRoutes } = await import('../routes/admin-rate-limits.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminRateLimitsRoutes);
    }, { prefix: '/api/admin/rate-limits' });
    loggers.routes.info('Admin Rate Limits routes registered at /api/admin/rate-limits/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin rate limits routes');
    failCount++;
  }

  // Register Admin Chargeback routes for enterprise cost allocation
  try {
    const { adminChargebackRoutes } = await import('../routes/admin-chargeback.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminChargebackRoutes);
    }, { prefix: '/api/admin/chargeback' });
    loggers.routes.info('Admin Chargeback routes registered at /api/admin/chargeback/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin chargeback routes');
    failCount++;
  }

  // Register Tiered Function Calling routes for configurable model selection
  try {
    const { adminTieredFunctionCallingRoutes } = await import('../routes/admin-tiered-fc.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminTieredFunctionCallingRoutes);
    }, { prefix: '/api/admin/tiered-fc' });
    loggers.routes.info('Tiered Function Calling routes registered at /api/admin/tiered-fc/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register tiered function calling routes');
    failCount++;
  }

  // Register Admin Prompts & Templates management routes
  try {
    const { adminPromptsRoutes } = await import('../routes/admin-prompts.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminPromptsRoutes);
    }, { prefix: '/api/admin/prompts' });
    loggers.routes.info('Admin Prompts & Templates routes registered at /api/admin/prompts/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin prompts routes');
    failCount++;
  }

  // Register Admin Audit Chat routes for AI-powered log querying
  try {
    const { default: adminAuditChatRoutes } = await import('../routes/admin-audit-chat.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminAuditChatRoutes);
    });
    loggers.routes.info('Admin Audit Chat routes registered at /api/admin/audit/chat with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit chat routes');
    failCount++;
  }

  // Register Admin LLM Metrics routes for real-time token usage and cost analytics
  try {
    const { default: adminLLMMetricsRoutes } = await import('../routes/admin-llm-metrics.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminLLMMetricsRoutes);
    });
    loggers.routes.info('Admin LLM Metrics routes registered at /api/admin/metrics/llm/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin LLM metrics routes');
    failCount++;
  }

  // Register Admin MCP Logs routes for tracking tool executions
  try {
    const { default: adminMCPLogsRoutes } = await import('../routes/admin-mcp-logs.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMCPLogsRoutes);
    });
    loggers.routes.info('Admin MCP Logs routes registered at /api/admin/mcp-logs with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP logs routes');
    failCount++;
  }

  // Register Admin Context Window Metrics routes
  try {
    const { default: adminContextMetricsRoutes } = await import('../routes/admin-context-metrics.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminContextMetricsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Context Window Metrics routes registered at /api/admin/context-metrics with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin context window metrics routes');
    failCount++;
  }

  // Register Admin MCP Tools routes for tool cache management
  try {
    const { default: adminMCPToolsRoutes } = await import('../routes/admin-mcp-tools.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMCPToolsRoutes);
    }, { prefix: '/api/admin/mcp/tools' });
    loggers.routes.info('Admin MCP Tools routes registered at /api/admin/mcp/tools/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP tools routes');
    failCount++;
  }

  // Register Admin Usage Analytics routes for usage metrics
  try {
    const { default: adminUsageAnalyticsRoutes } = await import('../routes/admin-usage-analytics.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminUsageAnalyticsRoutes);
    });
    loggers.routes.info('Admin Usage Analytics routes registered at /api/admin/analytics/usage with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin usage analytics routes');
    failCount++;
  }

  // Register Admin Feedback Analytics routes
  try {
    const { adminFeedbackRoutes } = await import('../routes/admin-feedback.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminFeedbackRoutes);
    }, { prefix: '/api/admin/feedback' });
    loggers.routes.info('Admin Feedback Analytics routes registered at /api/admin/feedback/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin feedback routes');
    failCount++;
  }

  // Register Admin MCP Tool Access routes for per-tool granular access control
  try {
    const { adminMCPToolAccessRoutes } = await import('../routes/admin-mcp-tool-access.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMCPToolAccessRoutes);
    }, { prefix: '/api/admin/mcp-access' });
    loggers.routes.info('Admin MCP Tool Access routes registered at /api/admin/mcp-access/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP tool access routes');
    failCount++;
  }

  // Register Admin Network Security routes for K8s NetworkPolicy management
  try {
    const { adminNetworkRoutes } = await import('../routes/admin-network.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminNetworkRoutes);
    }, { prefix: '/api/admin/network' });
    loggers.routes.info('Admin Network Security routes registered at /api/admin/network/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin network security routes');
    failCount++;
  }

  // Register Admin Webhook Security routes for enterprise webhook security management
  try {
    const { adminWebhookSecurityRoutes } = await import('../routes/admin-webhook-security.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminWebhookSecurityRoutes);
    }, { prefix: '/api/admin/webhook-security' });
    loggers.routes.info('Admin Webhook Security routes registered at /api/admin/webhook-security/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin webhook security routes');
    failCount++;
  }

  // Register Admin Workflow Secrets routes for encrypted secret management
  try {
    const { adminWorkflowSecretsRoutes } = await import('../routes/admin-workflow-secrets.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminWorkflowSecretsRoutes);
    }, { prefix: '/api/admin/workflow-secrets' });
    loggers.routes.info('Admin Workflow Secrets routes registered at /api/admin/workflow-secrets/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin workflow secrets routes');
    failCount++;
  }

  // Register Admin User Activity routes for real-time presence and usage monitoring
  try {
    const { adminUserActivityRoutes } = await import('../routes/admin-user-activity.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminUserActivityRoutes);
    }, { prefix: '/api/admin/user-activity' });
    loggers.routes.info('Admin User Activity routes registered at /api/admin/user-activity/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin user activity routes');
    failCount++;
  }

  // NOTE: admin-audit-logs and admin-code are registered in server.ts (lines 1411, 1925)
  // Do NOT duplicate here — it causes FST_ERR_DUPLICATED_ROUTE

  // Register Admin User Context (Memory) routes for adaptive memory admin view
  try {
    const { default: adminUserContextRoutes } = await import('../routes/admin-user-context.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminUserContextRoutes);
    }, { prefix: '/api/admin/user-context' });
    loggers.routes.info('Admin User Context routes registered at /api/admin/user-context/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin user context routes');
    failCount++;
  }

  loggers.routes.info({
    successCount,
    failCount,
    ollamaEnabled
  }, `Admin routes plugin registered: ${successCount} succeeded, ${failCount} failed`);
};

export default fp(adminPlugin, {
  name: 'admin-routes',
  dependencies: []
});
