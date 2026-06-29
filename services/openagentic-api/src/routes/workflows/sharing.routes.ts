/**
 * Workflow sharing / webhooks / self-service key + group routes.
 *
 *   POST   /:id/webhooks
 *   GET    /:id/webhooks
 *   DELETE /:id/webhooks/:webhookId
 *   GET    /:id/shares
 *   POST   /:id/shares
 *   PUT    /:id/shares/:shareId
 *   DELETE /:id/shares/:shareId
 *   GET    /user/api-keys
 *   POST   /user/api-keys
 *   DELETE /user/api-keys/:keyId
 *   GET    /user/groups
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { getReqUser } from './shared.js';
import type { WorkflowIdParams } from './types.js';

export const sharingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // =========================================================================
  // Webhook Management
  // =========================================================================

  /**
   * POST /api/workflows/:id/webhooks
   * Create a webhook endpoint for a workflow.
   * Returns a unique webhook URL that can be called externally without auth.
   */
  fastify.post<{
    Params: WorkflowIdParams;
    Body: {
      name?: string;
      response_mode?: 'async' | 'sync';
      secret?: string;
      rate_limit_per_minute?: number;
    };
  }>(
    '/:id/webhooks',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { name, response_mode = 'sync', secret, rate_limit_per_minute = 60 } = request.body || {};

        // Verify ownership
        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found or you are not the owner' });
        }

        const webhookKey = `wh_${randomUUID().replaceAll('-', '')}`;
        const webhook = await prisma.workflowWebhook.create({
          data: {
            workflow_id: id,
            webhook_key: webhookKey,
            name: name || `Webhook for ${workflow.name}`,
            response_mode,
            secret: secret || null,
            rate_limit_per_minute,
          },
        });

        return reply.code(201).send({
          success: true,
          webhook: {
            id: webhook.id,
            key: webhook.webhook_key,
            name: webhook.name,
            url: `/api/v1/hooks/${webhook.webhook_key}`,
            response_mode: webhook.response_mode,
            rate_limit_per_minute: webhook.rate_limit_per_minute,
            is_active: webhook.is_active,
            created_at: webhook.created_at,
          },
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to create webhook');
        return reply.code(500).send({ error: 'Failed to create webhook', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/:id/webhooks
   * List webhooks for a workflow
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/webhooks',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, OR: [{ created_by: userId }, { is_public: true }] },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found' });
        }

        const webhooks = await prisma.workflowWebhook.findMany({
          where: { workflow_id: id },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({
          webhooks: webhooks.map(wh => ({
            id: wh.id,
            key: wh.webhook_key,
            name: wh.name,
            url: `/api/v1/hooks/${wh.webhook_key}`,
            response_mode: wh.response_mode,
            is_active: wh.is_active,
            total_calls: wh.total_calls,
            last_called_at: wh.last_called_at,
            rate_limit_per_minute: wh.rate_limit_per_minute,
            created_at: wh.created_at,
          })),
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list webhooks');
        return reply.code(500).send({ error: 'Failed to list webhooks', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/:id/webhooks/:webhookId
   * Delete a webhook
   */
  fastify.delete<{ Params: WorkflowIdParams & { webhookId: string } }>(
    '/:id/webhooks/:webhookId',
    async (request, reply) => {
      try {
        const { id, webhookId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found or you are not the owner' });
        }

        await prisma.workflowWebhook.delete({
          where: { id: webhookId, workflow_id: id },
        });

        return reply.send({ success: true, message: 'Webhook deleted' });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to delete webhook');
        return reply.code(500).send({ error: 'Failed to delete webhook', message: error.message });
      }
    }
  );

  // =========================================================================
  // Workflow Sharing
  // =========================================================================

  /**
   * GET /api/workflows/:id/shares
   * List all shares for a workflow (users and groups with roles).
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/shares',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Verify the user can view this workflow
        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, OR: [{ created_by: userId }, { is_public: true }] },
          select: { id: true, created_by: true },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found' });
        }

        const shares = await prisma.workflowShare.findMany({
          where: { workflow_id: id },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({ shares, owner: workflow.created_by });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list shares');
        return reply.code(500).send({ error: 'Failed to list shares', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/:id/shares
   * Add a share to a workflow.
   */
  fastify.post<{
    Params: WorkflowIdParams;
    Body: { share_type: 'user' | 'group'; target_id: string; role: string };
  }>(
    '/:id/shares',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { share_type, target_id, role } = request.body || {};

        if (!share_type || !target_id || !role) {
          return reply.code(400).send({ error: 'share_type, target_id, and role are required' });
        }

        const validRoles = ['viewer', 'editor', 'executor', 'admin'];
        if (!validRoles.includes(role)) {
          return reply.code(400).send({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        // Verify ownership (only owner or admin sharer can add shares)
        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });
        if (!workflow) {
          return reply.code(403).send({ error: 'Only the workflow owner can manage shares' });
        }

        const share = await prisma.workflowShare.upsert({
          where: {
            workflow_id_share_type_target_id: { workflow_id: id, share_type, target_id },
          },
          create: { workflow_id: id, share_type, target_id, role, shared_by: userId },
          update: { role, shared_by: userId },
        });

        logger.info({ workflowId: id, share_type, target_id, role }, '[Workflows] Share added/updated');
        return reply.code(201).send({ share });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to add share');
        return reply.code(500).send({ error: 'Failed to add share', message: error.message });
      }
    }
  );

  /**
   * PUT /api/workflows/:id/shares/:shareId
   * Update a share role.
   */
  fastify.put<{
    Params: { id: string; shareId: string };
    Body: { role: string };
  }>(
    '/:id/shares/:shareId',
    async (request, reply) => {
      try {
        const { id, shareId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { role } = request.body || {};

        const validRoles = ['viewer', 'editor', 'executor', 'admin'];
        if (!role || !validRoles.includes(role)) {
          return reply.code(400).send({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });
        if (!workflow) {
          return reply.code(403).send({ error: 'Only the workflow owner can manage shares' });
        }

        const share = await prisma.workflowShare.update({
          where: { id: shareId, workflow_id: id },
          data: { role },
        });

        return reply.send({ share });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to update share');
        return reply.code(500).send({ error: 'Failed to update share', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/:id/shares/:shareId
   * Remove a share.
   */
  fastify.delete<{ Params: { id: string; shareId: string } }>(
    '/:id/shares/:shareId',
    async (request, reply) => {
      try {
        const { id, shareId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });
        if (!workflow) {
          return reply.code(403).send({ error: 'Only the workflow owner can manage shares' });
        }

        await prisma.workflowShare.delete({
          where: { id: shareId, workflow_id: id },
        });

        return reply.send({ success: true, message: 'Share removed' });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to remove share');
        return reply.code(500).send({ error: 'Failed to remove share', message: error.message });
      }
    }
  );

  // =========================================================================
  // User API Keys (self-service)
  // =========================================================================

  /**
   * GET /api/workflows/user/api-keys
   * List current user's API keys (masked).
   */
  fastify.get(
    '/user/api-keys',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const keys = await prisma.apiKey.findMany({
          where: { user_id: userId, is_active: true },
          select: {
            id: true,
            name: true,
            last_used_at: true,
            expires_at: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({ keys });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list API keys');
        return reply.code(500).send({ error: 'Failed to list API keys', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/user/api-keys
   * Create a new API key. Returns the plaintext key ONCE.
   */
  fastify.post<{ Body: { name: string } }>(
    '/user/api-keys',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { name } = request.body || {};

        if (!name) {
          return reply.code(400).send({ error: 'name is required' });
        }

        // Generate a secure API key: "oa_" + base64url(32 random bytes) (URL-safe, no padding).
        const prefix = 'oa_';
        const rawKey = prefix + randomBytes(32).toString('base64url');
        const keyHash = await bcrypt.hash(rawKey, 10);

        const apiKey = await prisma.apiKey.create({
          data: {
            user_id: userId,
            name,
            key_hash: keyHash,
          },
        });

        logger.info({ userId, keyId: apiKey.id, name }, '[Workflows] API key created');

        return reply.code(201).send({
          key: {
            id: apiKey.id,
            name: apiKey.name,
            plaintext_key: rawKey,
            created_at: apiKey.created_at,
          },
          warning: 'Save this key now. It will not be shown again.',
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to create API key');
        return reply.code(500).send({ error: 'Failed to create API key', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/user/api-keys/:keyId
   * Revoke an API key.
   */
  fastify.delete<{ Params: { keyId: string } }>(
    '/user/api-keys/:keyId',
    async (request, reply) => {
      try {
        const { keyId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        await prisma.apiKey.updateMany({
          where: { id: keyId, user_id: userId },
          data: { is_active: false },
        });

        return reply.send({ success: true, message: 'API key revoked' });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to revoke API key');
        return reply.code(500).send({ error: 'Failed to revoke API key', message: error.message });
      }
    }
  );

  // =========================================================================
  // User Groups (self-service)
  // =========================================================================

  /**
   * GET /api/workflows/user/groups
   * List groups the current user belongs to.
   */
  fastify.get(
    '/user/groups',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const memberships = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          include: {
            group: {
              select: { id: true, name: true, display_name: true, description: true },
            },
          },
        });

        const groups = memberships.map(m => ({
          ...m.group,
          role: m.role,
        }));

        return reply.send({ groups });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list user groups');
        return reply.code(500).send({ error: 'Failed to list user groups', message: error.message });
      }
    }
  );
};

export default sharingRoutes;
