/**
 * Admin Integration Management Routes
 *
 * CRUD for Slack/Teams integrations + webhook receivers.
 *
 * Endpoints:
 *   GET    /integrations           - List all integrations
 *   GET    /integrations/:id       - Get single integration
 *   POST   /integrations           - Create integration
 *   PUT    /integrations/:id       - Update integration
 *   DELETE /integrations/:id       - Soft-delete integration
 *   GET    /integrations/:id/logs  - Get integration logs
 *   POST   /integrations/:id/test  - Test integration connection
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { SlackIntegrationService } from '../services/SlackIntegrationService.js';
import { TeamsIntegrationService } from '../services/TeamsIntegrationService.js';

const logger = loggers.routes.child({ component: 'AdminIntegrations' });

const adminIntegrationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const slackService = new SlackIntegrationService();
  const teamsService = new TeamsIntegrationService(prisma);

  // === Admin CRUD Routes (require admin auth) ===

  /**
   * GET /integrations - List all integrations
   */
  fastify.get('/integrations', async (request, reply) => {
    const integrations = await prisma.integration.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, name: true, platform: true, status: true,
        webhook_id: true, allowed_channels: true, allowed_workflows: true,
        created_at: true, updated_at: true
        // Exclude config (contains secrets)
      }
    });
    reply.send({ integrations });
  });

  /**
   * GET /integrations/:id - Get single integration
   */
  fastify.get<{ Params: { id: string } }>('/integrations/:id', async (request, reply) => {
    const { id } = request.params;
    const integration = await prisma.integration.findUnique({
      where: { id },
      select: {
        id: true, name: true, platform: true, status: true,
        webhook_id: true, allowed_channels: true, allowed_workflows: true,
        created_at: true, updated_at: true
      }
    });
    if (!integration) return reply.status(404).send({ error: 'Integration not found' });
    return reply.send(integration);
  });

  /**
   * POST /integrations - Create integration
   */
  fastify.post('/integrations', async (request, reply) => {
    const body = request.body as any;
    const { name, platform, config, allowed_channels, allowed_workflows } = body;

    if (!name || !platform || !config) {
      return reply.status(400).send({ error: 'name, platform, and config are required' });
    }

    if (!['slack', 'teams'].includes(platform)) {
      return reply.status(400).send({ error: 'platform must be "slack" or "teams"' });
    }

    // Generate webhook ID for inbound events
    const crypto = await import('crypto');
    const webhook_id = crypto.randomBytes(24).toString('hex');

    const integration = await prisma.integration.create({
      data: {
        name,
        platform,
        status: 'active',
        config, // Should be encrypted in production
        webhook_id,
        allowed_channels: allowed_channels || [],
        allowed_workflows: allowed_workflows || [],
        created_by: (request as any).userId || null
      }
    });

    return reply.status(201).send({
      integration: {
        id: integration.id,
        name: integration.name,
        platform: integration.platform,
        status: integration.status,
        webhook_id: integration.webhook_id,
        webhook_url: `/api/v1/hooks/integration/${integration.webhook_id}`
      }
    });
  });

  /**
   * PUT /integrations/:id - Update integration
   */
  fastify.put<{ Params: { id: string } }>('/integrations/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body as any;

    const integration = await prisma.integration.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.status && { status: body.status }),
        ...(body.config && { config: body.config }),
        ...(body.allowed_channels && { allowed_channels: body.allowed_channels }),
        ...(body.allowed_workflows && { allowed_workflows: body.allowed_workflows }),
        updated_by: (request as any).userId || null
      }
    });

    reply.send({ integration: { id: integration.id, name: integration.name, status: integration.status } });
  });

  /**
   * DELETE /integrations/:id - Soft delete integration
   */
  fastify.delete<{ Params: { id: string } }>('/integrations/:id', async (request, reply) => {
    const { id } = request.params;
    await prisma.integration.update({
      where: { id },
      data: { deleted_at: new Date(), status: 'inactive' }
    });
    reply.send({ success: true });
  });

  /**
   * GET /integrations/:id/logs - Get integration logs
   */
  fastify.get<{ Params: { id: string } }>('/integrations/:id/logs', async (request, reply) => {
    const { id } = request.params;
    const query = request.query as { limit?: string; offset?: string };
    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');

    const [logs, total] = await Promise.all([
      prisma.integrationLog.findMany({
        where: { integration_id: id },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset
      }),
      prisma.integrationLog.count({ where: { integration_id: id } })
    ]);

    reply.send({ logs, total, limit, offset });
  });

  /**
   * POST /integrations/:id/test - Test integration connection
   */
  fastify.post<{ Params: { id: string } }>('/integrations/:id/test', async (request, reply) => {
    const { id } = request.params;
    const integration = await prisma.integration.findUnique({ where: { id } });
    if (!integration) return reply.status(404).send({ error: 'Integration not found' });

    try {
      if (integration.platform === 'slack') {
        const config = integration.config as any;
        // Test Slack bot token by calling auth.test
        const res = await fetch('https://slack.com/api/auth.test', {
          headers: { 'Authorization': `Bearer ${config.botToken}` }
        });
        const data = await res.json() as any;
        return reply.send({ success: data.ok, details: data.ok ? { team: data.team, user: data.user } : { error: data.error } });
      } else if (integration.platform === 'teams') {
        const config = integration.config as any;
        // Test Teams by getting a token
        const res = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: config.appId,
            client_secret: config.appPassword,
            scope: 'https://api.botframework.com/.default'
          })
        });
        const data = await res.json() as any;
        return reply.send({ success: !!data.access_token, details: data.access_token ? { tokenType: data.token_type } : { error: data.error_description } });
      } else {
        return reply.send({ success: false, details: { error: `Unsupported platform: ${integration.platform}` } });
      }
    } catch (err: any) {
      return reply.send({ success: false, details: { error: err.message } });
    }
  });

  logger.info('Admin integration routes registered');
};

export default adminIntegrationRoutes;
