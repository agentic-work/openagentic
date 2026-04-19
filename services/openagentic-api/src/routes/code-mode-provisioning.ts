import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { ndjsonHeaders, writeNDJSON } from '../infra/ndjson.js';
import {
  getCodeModeProvisioningService,
  ProvisioningProgress
} from '../services/CodeModeProvisioningService.js';
import type { Logger } from 'pino';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
  };
}

const codeModeProvisioningRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log.child({ plugin: 'code-mode-provisioning' }) as Logger;
  const provisioningService = getCodeModeProvisioningService(prisma, logger);

  // Authentication hook
  fastify.addHook('preHandler', async (request: any, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }
  });

  /**
   * GET /api/code-mode/provisioning/status
   * Check if user's Code Mode environment is provisioned
   */
  fastify.get('/status', async (request: any, reply) => {
    const userId = request.user.id;

    try {
      // Check if user has Code Mode access
      const hasAccess = await provisioningService.hasCodeModeAccess(userId);
      if (!hasAccess) {
        return reply.send({
          success: true,
          hasAccess: false,
          status: null,
          message: 'Code Mode not enabled for this user'
        });
      }

      // Get provisioning status
      const provisioning = await provisioningService.checkProvisioningStatus(userId);

      if (!provisioning) {
        return reply.send({
          success: true,
          hasAccess: true,
          status: 'not_provisioned',
          message: 'Code Mode environment needs to be set up'
        });
      }

      // Update last accessed if ready
      if (provisioning.status === 'ready') {
        await provisioningService.recordAccess(userId);
      }

      return reply.send({
        success: true,
        hasAccess: true,
        status: provisioning.status,
        statusMessage: provisioning.status_message,
        provisionedAt: provisioning.provisioned_at,
        lastAccessedAt: provisioning.last_accessed_at,
        workspace: {
          provisioned: provisioning.storage_provisioned,
          path: provisioning.storage_bucket, // Reused field for workspace path
        },
        pod: {
          provisioned: provisioning.sandbox_provisioned,
          username: provisioning.sandbox_username,
        },
        vscode: {
          provisioned: provisioning.vscode_provisioned,
        },
        openagentic: {
          provisioned: provisioning.openagentic_provisioned,
          model: provisioning.openagentic_model,
        }
      });
    } catch (error: any) {
      logger.error({ error, userId }, 'Failed to get provisioning status');
      return reply.code(500).send({
        success: false,
        error: 'Failed to check provisioning status'
      });
    }
  });

  /**
   * POST /api/code-mode/provisioning/start
   * Start provisioning the user's Code Mode environment
   * Returns an SSE stream with progress updates
   */
  fastify.post('/start', async (request: any, reply): Promise<void> => {
    const userId = request.user.id;

    try {
      // Check if user has Code Mode access
      const hasAccess = await provisioningService.hasCodeModeAccess(userId);
      if (!hasAccess) {
        reply.code(403).send({
          success: false,
          error: 'Code Mode not enabled for this user'
        });
        return;
      }

      // Check if already provisioned
      const existing = await provisioningService.checkProvisioningStatus(userId);
      if (existing?.status === 'ready') {
        reply.send({
          success: true,
          alreadyProvisioned: true,
          message: 'Environment already provisioned'
        });
        return;
      }

      // NDJSON stream (v0.6.7 — Phase D.6).
      reply.raw.writeHead(200, ndjsonHeaders());

      const onProgress = (progress: ProvisioningProgress) => {
        writeNDJSON(reply, 'progress', progress as unknown as Record<string, unknown>);
      };

      writeNDJSON(reply, 'start', { userId, message: 'Starting provisioning...' });

      const result = await provisioningService.startProvisioning(userId, onProgress);

      if (result.success) {
        writeNDJSON(reply, 'complete', {
          success: true,
          message: 'Your development environment is ready!',
          provisioning: {
            status: result.provisioning?.status,
            provisionedAt: result.provisioning?.provisioned_at,
          }
        });
      } else {
        writeNDJSON(reply, 'error', {
          success: false,
          error: result.error
        });
      }

      reply.raw.end();
      return;

    } catch (error: any) {
      logger.error({ error, userId }, 'Failed to start provisioning');

      if (reply.raw.headersSent) {
        writeNDJSON(reply, 'error', { error: error.message });
        reply.raw.end();
      } else {
        reply.code(500).send({
          success: false,
          error: 'Failed to start provisioning'
        });
      }
    }
  });

  /**
   * GET /api/code-mode/provisioning/progress
   * SSE stream for checking provisioning progress (reconnect-friendly)
   */
  fastify.get('/progress', async (request: any, reply) => {
    const userId = request.user.id;

    // NDJSON stream (v0.6.7 — Phase D.6).
    reply.raw.writeHead(200, ndjsonHeaders());

    const sendEvent = (type: string, data: any) => {
      writeNDJSON(reply, type, data);
    };

    // Check current progress
    const progress = provisioningService.getProvisioningProgress(userId);

    if (progress) {
      sendEvent('progress', progress);

      // Poll for updates every 500ms
      const interval = setInterval(async () => {
        const currentProgress = provisioningService.getProvisioningProgress(userId);
        if (currentProgress) {
          sendEvent('progress', currentProgress);

          if (currentProgress.status === 'ready' || currentProgress.status === 'failed') {
            clearInterval(interval);
            sendEvent('complete', {
              success: currentProgress.status === 'ready',
              message: currentProgress.statusMessage
            });
            reply.raw.end();
          }
        } else {
          // No longer provisioning
          clearInterval(interval);

          const provisioning = await provisioningService.checkProvisioningStatus(userId);
          sendEvent('complete', {
            success: provisioning?.status === 'ready',
            status: provisioning?.status || 'not_found'
          });
          reply.raw.end();
        }
      }, 500);

      // Clean up on client disconnect
      request.raw.on('close', () => {
        clearInterval(interval);
      });

    } else {
      // Not currently provisioning - check DB status
      const provisioning = await provisioningService.checkProvisioningStatus(userId);
      sendEvent('status', {
        provisioning: !!provisioning,
        status: provisioning?.status || 'not_provisioned'
      });
      reply.raw.end();
    }
  });

  /**
   * POST /api/code-mode/provisioning/deprovision (Admin only)
   * Remove a user's provisioned environment
   */
  fastify.post<{
    Body: { userId: string };
  }>('/deprovision', async (request: any, reply) => {
    if (!request.user.isAdmin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const { userId } = request.body;
    if (!userId) {
      return reply.code(400).send({ error: 'userId is required' });
    }

    try {
      await provisioningService.deprovision(userId);
      return reply.send({
        success: true,
        message: 'Environment deprovisioned'
      });
    } catch (error: any) {
      logger.error({ error, userId }, 'Failed to deprovision');
      return reply.code(500).send({
        success: false,
        error: 'Failed to deprovision environment'
      });
    }
  });

  /**
   * GET /api/code-mode/provisioning/list (Admin only)
   * List all provisioned environments
   */
  fastify.get('/list', async (request: any, reply) => {
    if (!request.user.isAdmin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    try {
      const provisionings = await provisioningService.listProvisionedUsers();
      return reply.send({
        success: true,
        provisionings: provisionings.map(p => ({
          id: p.id,
          userId: p.user_id,
          status: p.status,
          statusMessage: p.status_message,
          workspacePath: p.storage_bucket,
          provisionedAt: p.provisioned_at,
          lastAccessedAt: p.last_accessed_at,
        }))
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to list provisionings');
      return reply.code(500).send({
        success: false,
        error: 'Failed to list provisioned environments'
      });
    }
  });

  logger.info('Code Mode provisioning routes registered');
};

export default codeModeProvisioningRoutes;
