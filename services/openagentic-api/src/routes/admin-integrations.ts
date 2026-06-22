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
 *   POST   /integrations/:id/test  - Test integration connection (with rich diagnostics)
 *   POST   /integrations/:id/test/send-message - Send a test message (Slack only)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { SlackIntegrationService } from '../services/SlackIntegrationService.js';
import { TeamsIntegrationService } from '../services/TeamsIntegrationService.js';
import { auditLogService } from '../services/AuditLogService.js';

const logger = loggers.routes.child({ component: 'AdminIntegrations' });

// ---------------------------------------------------------------------------
// Format validation helpers
// ---------------------------------------------------------------------------

const SLACK_BOT_TOKEN_RE = /^xoxb-[\w-]+$/;
const SLACK_SIGNING_SECRET_RE = /^[a-f0-9]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSlackConfig(config: any): { error: string; field: string } | null {
  if (!config.botToken || !SLACK_BOT_TOKEN_RE.test(config.botToken)) {
    return { error: 'invalid_token_format', field: 'botToken' };
  }
  if (config.signingSecret && !SLACK_SIGNING_SECRET_RE.test(config.signingSecret)) {
    return { error: 'invalid_signing_secret_format', field: 'signingSecret' };
  }
  return null;
}

function validateTeamsConfig(config: any): { error: string; field: string } | null {
  if (!config.appId || !UUID_RE.test(config.appId)) {
    return { error: 'invalid_app_id_format', field: 'appId' };
  }
  if (!config.appPassword || config.appPassword.trim() === '') {
    return { error: 'missing_app_password', field: 'appPassword' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// JWT decode helper (no verification — just reads claims for diagnostics)
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const json = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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

    // Audit log — fire-and-forget
    auditLogService.write({
      action: 'integration.create',
      target_type: 'integration',
      target_id: integration.id,
      outcome: 'success',
      actor: { userId: (request as any).userId || undefined },
      metadata: { name: integration.name, platform: integration.platform },
    }).catch(() => {/* audit failures never surface */});

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

    // Audit log
    auditLogService.write({
      action: 'integration.update',
      target_type: 'integration',
      target_id: integration.id,
      outcome: 'success',
      actor: { userId: (request as any).userId || undefined },
      metadata: { name: integration.name },
    }).catch(() => {/* audit failures never surface */});

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

    // Audit log
    auditLogService.write({
      action: 'integration.delete',
      target_type: 'integration',
      target_id: id,
      outcome: 'success',
      actor: { userId: (request as any).userId || undefined },
    }).catch(() => {/* audit failures never surface */});

    reply.send({ success: true });
  });

  /**
   * GET /integrations/:id/logs - Get integration logs
   */
  fastify.get<{ Params: { id: string } }>('/integrations/:id/logs', async (request, reply) => {
    const { id } = request.params;
    const query = request.query as { limit?: string; offset?: string };
    const limit = Number.parseInt(query.limit || '50');
    const offset = Number.parseInt(query.offset || '0');

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
   *
   * A1: Format validation before external calls
   * A2: Rich Slack diagnostics
   * A3: Slack scopes detection
   * A4: Rich Teams diagnostics
   * A5: HTTP status reflects success (400 on failure, 200 on success)
   */
  fastify.post<{ Params: { id: string } }>('/integrations/:id/test', async (request, reply) => {
    const { id } = request.params;
    const integration = await prisma.integration.findUnique({ where: { id } });
    if (!integration) return reply.status(404).send({ error: 'Integration not found' });

    try {
      if (integration.platform === 'slack') {
        const config = integration.config as any;

        // A1: Format validation
        const validationError = validateSlackConfig(config);
        if (validationError) {
          return reply.status(400).send({ success: false, details: validationError });
        }

        // A2: Call auth.test
        const authRes = await fetch('https://slack.com/api/auth.test', {
          headers: { 'Authorization': `Bearer ${config.botToken}` }
        });
        const authData = await authRes.json() as any;

        if (!authData.ok) {
          // A5: HTTP 400 on failure
          return reply.status(400).send({
            success: false,
            details: { error: authData.error }
          });
        }

        // Build rich diagnostic
        const details: Record<string, any> = {
          team: authData.team,
          teamId: authData.team_id,
          user: authData.user,
          userId: authData.user_id,
          botId: authData.bot_id,
          url: authData.url,
        };

        // A3: Attempt scopes list — tolerate failure
        try {
          const scopesRes = await fetch('https://slack.com/api/apps.permissions.scopes.list', {
            headers: { 'Authorization': `Bearer ${config.botToken}` }
          });
          const scopesData = await scopesRes.json() as any;
          if (scopesData.ok && scopesData.scopes?.bot) {
            details.scopes = scopesData.scopes.bot;
          }
        } catch {
          // Tolerate — some app types don't have this permission
        }

        // Audit log
        auditLogService.write({
          action: 'integration.test',
          target_type: 'integration',
          target_id: id,
          outcome: 'success',
          actor: { userId: (request as any).userId || undefined },
          metadata: { platform: 'slack', team: details.team },
        }).catch(() => {/* audit failures never surface */});

        return reply.status(200).send({ success: true, details });

      } else if (integration.platform === 'teams') {
        const config = integration.config as any;

        // A1: Format validation
        const validationError = validateTeamsConfig(config);
        if (validationError) {
          return reply.status(400).send({ success: false, details: validationError });
        }

        // A4: Test Teams by getting a token
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

        if (!data.access_token) {
          // A5: HTTP 400 on failure
          return reply.status(400).send({
            success: false,
            details: { error: data.error, errorDescription: data.error_description }
          });
        }

        // A4: Rich diagnostic
        const details: Record<string, any> = {
          tokenType: data.token_type,
          expiresIn: data.expires_in,
        };

        // Bonus: decode JWT for app_displayname
        const claims = decodeJwtPayload(data.access_token);
        if (claims?.app_displayname) {
          details.appDisplayName = claims.app_displayname;
        }

        // Audit log
        auditLogService.write({
          action: 'integration.test',
          target_type: 'integration',
          target_id: id,
          outcome: 'success',
          actor: { userId: (request as any).userId || undefined },
          metadata: { platform: 'teams' },
        }).catch(() => {/* audit failures never surface */});

        return reply.status(200).send({ success: true, details });

      } else {
        return reply.status(400).send({ success: false, details: { error: `Unsupported platform: ${integration.platform}` } });
      }
    } catch (err: any) {
      logger.error({ err }, 'Integration test error');
      // Audit log — error outcome
      auditLogService.write({
        action: 'integration.test',
        target_type: 'integration',
        target_id: id,
        outcome: 'error',
        actor: { userId: (request as any).userId || undefined },
        metadata: { error: err.message },
      }).catch(() => {/* audit failures never surface */});
      return reply.status(500).send({ success: false, details: { error: err.message } });
    }
  });

  /**
   * POST /integrations/:id/test/send-message - Send a test message (Slack only)
   *
   * A6: Takes { channel, text? } body. Calls chat.postMessage.
   * Returns { success, details: { ts, channel } } on success.
   */
  fastify.post<{ Params: { id: string } }>('/integrations/:id/test/send-message', async (request, reply) => {
    const { id } = request.params;
    const integration = await prisma.integration.findUnique({ where: { id } });
    if (!integration) return reply.status(404).send({ error: 'Integration not found' });

    if (integration.platform !== 'slack') {
      return reply.status(400).send({
        success: false,
        details: { error: 'send-message is only supported for Slack integrations' }
      });
    }

    const config = integration.config as any;

    // Format validation
    const validationError = validateSlackConfig(config);
    if (validationError) {
      return reply.status(400).send({ success: false, details: validationError });
    }

    const body = request.body as any;
    const channel = body?.channel;
    const text = body?.text ?? ':white_check_mark: OpenAgentic test message — your integration is configured correctly.';

    if (!channel) {
      return reply.status(400).send({ success: false, details: { error: 'channel is required', field: 'channel' } });
    }

    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel, text }),
      });
      const data = await res.json() as any;

      if (!data.ok) {
        return reply.status(400).send({ success: false, details: { error: data.error } });
      }

      return reply.status(200).send({
        success: true,
        details: { ts: data.ts, channel: data.channel }
      });
    } catch (err: any) {
      logger.error({ err }, 'send-message error');
      return reply.status(500).send({ success: false, details: { error: err.message } });
    }
  });

  logger.info('Admin integration routes registered');
};

export default adminIntegrationRoutes;
