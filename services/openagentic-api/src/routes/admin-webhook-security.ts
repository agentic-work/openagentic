/**
 * Admin Webhook Security Routes
 *
 * Provides full control over enterprise webhook security settings.
 *
 * Endpoints:
 *   GET    /api/admin/webhook-security/config        — get current security config
 *   PUT    /api/admin/webhook-security/config        — update security config
 *   POST   /api/admin/webhook-security/kill-switch   — toggle global kill switch
 *   GET    /api/admin/webhook-security/audit-logs    — query audit logs
 *   GET    /api/admin/webhook-security/stats         — aggregated stats
 *   GET    /api/admin/webhook-security/platforms      — known platform configurations
 *   PUT    /api/admin/webhook-security/platforms/:id  — update platform allowlist
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { webhookSecurityService, WebhookSecurityConfig } from '../services/WebhookSecurityService.js';
import { enterpriseOnly } from '../middleware/enterpriseOnly.js';

const logger = loggers.routes;

export const adminWebhookSecurityRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {


  // OSS gate — all routes in this plugin return 402 with upgrade_url.
  fastify.addHook('preHandler', enterpriseOnly);
  /**
   * GET /config — current webhook security configuration
   */
  fastify.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await webhookSecurityService.loadConfig();
      return reply.send({ config });
    } catch (error: any) {
      logger.error({ error }, '[WebhookSecurity] Failed to get config');
      return reply.code(500).send({ error: 'Failed to load webhook security config', message: error.message });
    }
  });

  /**
   * PUT /config — update webhook security configuration
   */
  fastify.put<{ Body: Partial<WebhookSecurityConfig> }>('/config', async (request, reply) => {
    try {
      const updates = request.body;
      if (!updates || typeof updates !== 'object') {
        return reply.code(400).send({ error: 'Request body must be a JSON object' });
      }

      // Validate specific fields
      if (updates.maxPayloadBytes !== undefined && (updates.maxPayloadBytes < 1024 || updates.maxPayloadBytes > 10 * 1024 * 1024)) {
        return reply.code(400).send({ error: 'maxPayloadBytes must be between 1KB and 10MB' });
      }
      if (updates.replayWindowSeconds !== undefined && (updates.replayWindowSeconds < 30 || updates.replayWindowSeconds > 3600)) {
        return reply.code(400).send({ error: 'replayWindowSeconds must be between 30 and 3600' });
      }
      if (updates.promptInjectionThreshold !== undefined && (updates.promptInjectionThreshold < 0 || updates.promptInjectionThreshold > 1)) {
        return reply.code(400).send({ error: 'promptInjectionThreshold must be between 0 and 1' });
      }
      if (updates.globalRateLimitPerMinute !== undefined && updates.globalRateLimitPerMinute < 0) {
        return reply.code(400).send({ error: 'globalRateLimitPerMinute must be >= 0' });
      }

      const saved = await webhookSecurityService.saveConfig(updates);
      logger.info({ updatedFields: Object.keys(updates) }, '[WebhookSecurity] Config updated by admin');
      return reply.send({ config: saved });
    } catch (error: any) {
      logger.error({ error }, '[WebhookSecurity] Failed to update config');
      return reply.code(500).send({ error: 'Failed to update webhook security config', message: error.message });
    }
  });

  /**
   * POST /kill-switch — toggle the global kill switch (convenience endpoint)
   */
  fastify.post<{ Body: { enabled: boolean } }>('/kill-switch', async (request, reply) => {
    try {
      const { enabled } = request.body || {};
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'Body must include { enabled: boolean }' });
      }

      const saved = await webhookSecurityService.saveConfig({ globalEnabled: enabled });
      logger.warn({ enabled }, '[WebhookSecurity] Kill switch toggled by admin');
      return reply.send({
        globalEnabled: saved.globalEnabled,
        message: enabled ? 'Inbound webhooks are now ENABLED' : 'Inbound webhooks are now DISABLED (kill switch active)',
      });
    } catch (error: any) {
      logger.error({ error }, '[WebhookSecurity] Failed to toggle kill switch');
      return reply.code(500).send({ error: 'Failed to toggle kill switch', message: error.message });
    }
  });

  /**
   * GET /audit-logs — query webhook audit logs with filtering + pagination
   */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      status?: string;
      webhookKey?: string;
      platform?: string;
      sourceIp?: string;
      from?: string;
      to?: string;
    };
  }>('/audit-logs', async (request, reply) => {
    try {
      const page = Math.max(1, parseInt(request.query.page || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '50')));
      const offset = (page - 1) * limit;

      // Build WHERE clauses
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (request.query.status) {
        conditions.push(`status = $${paramIdx++}`);
        params.push(request.query.status);
      }
      if (request.query.webhookKey) {
        conditions.push(`webhook_key = $${paramIdx++}`);
        params.push(request.query.webhookKey);
      }
      if (request.query.platform) {
        conditions.push(`platform = $${paramIdx++}`);
        params.push(request.query.platform);
      }
      if (request.query.sourceIp) {
        conditions.push(`source_ip = $${paramIdx++}`);
        params.push(request.query.sourceIp);
      }
      if (request.query.from) {
        conditions.push(`created_at >= $${paramIdx++}`);
        params.push(new Date(request.query.from));
      }
      if (request.query.to) {
        conditions.push(`created_at <= $${paramIdx++}`);
        params.push(new Date(request.query.to));
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [logs, countResult] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM admin.webhook_audit_logs ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
          ...params, limit, offset
        ),
        prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::int as total FROM admin.webhook_audit_logs ${where}`,
          ...params
        ),
      ]);

      const total = countResult[0]?.total || 0;

      return reply.send({
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error: any) {
      logger.error({ error }, '[WebhookSecurity] Failed to query audit logs');
      return reply.code(500).send({ error: 'Failed to query audit logs', message: error.message });
    }
  });

  /**
   * GET /stats — aggregated webhook security statistics
   */
  fastify.get<{
    Querystring: { hours?: string };
  }>('/stats', async (request, reply) => {
    try {
      const hours = Math.min(720, Math.max(1, parseInt(request.query.hours || '24')));
      const since = new Date(Date.now() - hours * 3600 * 1000);

      const [statusCounts, platformCounts, topRejections, injectionStats] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
          `SELECT status, COUNT(*)::int as count FROM admin.webhook_audit_logs WHERE created_at >= $1 GROUP BY status ORDER BY count DESC`,
          since
        ),
        prisma.$queryRawUnsafe<any[]>(
          `SELECT COALESCE(platform, 'unknown') as platform, COUNT(*)::int as count FROM admin.webhook_audit_logs WHERE created_at >= $1 GROUP BY platform ORDER BY count DESC`,
          since
        ),
        prisma.$queryRawUnsafe<any[]>(
          `SELECT rejection_reason, COUNT(*)::int as count FROM admin.webhook_audit_logs WHERE created_at >= $1 AND status != 'accepted' GROUP BY rejection_reason ORDER BY count DESC LIMIT 10`,
          since
        ),
        prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::int as scanned, COUNT(CASE WHEN injection_score > 0 THEN 1 END)::int as detected, AVG(injection_score)::float as avg_score, MAX(injection_score)::float as max_score FROM admin.webhook_audit_logs WHERE created_at >= $1 AND injection_score IS NOT NULL`,
          since
        ),
      ]);

      const totalRequests = statusCounts.reduce((sum: number, r: any) => sum + r.count, 0);
      const accepted = statusCounts.find((r: any) => r.status === 'accepted')?.count || 0;
      const rejected = totalRequests - accepted;

      return reply.send({
        period: { hours, since: since.toISOString() },
        summary: {
          totalRequests,
          accepted,
          rejected,
          rejectionRate: totalRequests > 0 ? ((rejected / totalRequests) * 100).toFixed(1) + '%' : '0%',
        },
        byStatus: statusCounts,
        byPlatform: platformCounts,
        topRejections,
        injectionStats: injectionStats[0] || { scanned: 0, detected: 0, avg_score: 0, max_score: 0 },
      });
    } catch (error: any) {
      logger.error({ error }, '[WebhookSecurity] Failed to get stats');
      return reply.code(500).send({ error: 'Failed to get webhook stats', message: error.message });
    }
  });

  /**
   * GET /platforms — known platform configurations
   */
  fastify.get('/platforms', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await webhookSecurityService.loadConfig();
      return reply.send({ platforms: config.platformAllowlists });
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to get platform configs', message: error.message });
    }
  });

  /**
   * PUT /platforms/:id — update a platform's allowlist configuration
   */
  fastify.put<{
    Params: { id: string };
    Body: { enabled?: boolean; cidrs?: string[]; signatureHeader?: string; description?: string };
  }>('/platforms/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const config = await webhookSecurityService.loadConfig();

      if (!config.platformAllowlists[id]) {
        // Allow creating new platform entries
        config.platformAllowlists[id] = {
          enabled: true,
          cidrs: [],
          signatureHeader: '',
          description: '',
        };
      }

      const platform = config.platformAllowlists[id];
      if (request.body.enabled !== undefined) platform.enabled = request.body.enabled;
      if (request.body.cidrs !== undefined) platform.cidrs = request.body.cidrs;
      if (request.body.signatureHeader !== undefined) platform.signatureHeader = request.body.signatureHeader;
      if (request.body.description !== undefined) platform.description = request.body.description;

      const saved = await webhookSecurityService.saveConfig({ platformAllowlists: config.platformAllowlists });
      logger.info({ platform: id }, '[WebhookSecurity] Platform config updated by admin');
      return reply.send({ platform: saved.platformAllowlists[id] });
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to update platform config', message: error.message });
    }
  });

  logger.info('Admin Webhook Security routes registered');
};

export default adminWebhookSecurityRoutes;
