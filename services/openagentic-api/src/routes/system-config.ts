/**
 * System Configuration Routes
 *
 * Provides endpoints for discovering system configuration.
 * Native OpenAgentic workflow engine is the default.
 */

import { FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';

export const systemConfigRoutes: FastifyPluginAsync = async (fastify, opts) => {

  /**
   * Get system configuration including deployed workflow engine
   * No authentication required - public configuration endpoint
   */
  fastify.get('/config', async (request, reply) => {
    try {
      // Deploy mode — distinguishes Docker Compose from Kubernetes/Helm so the
      // (unauthenticated) login "Need help signing in?" modal can show the right
      // admin-credential instructions. KUBERNETES_SERVICE_HOST is injected into
      // every pod by the kubelet and is absent under Compose. An explicit
      // DEPLOY_MODE env (compose|kubernetes) overrides the auto-detection.
      const deploymentMode: 'compose' | 'kubernetes' =
        (process.env.DEPLOY_MODE === 'compose' || process.env.DEPLOY_MODE === 'kubernetes')
          ? process.env.DEPLOY_MODE
          : (process.env.KUBERNETES_SERVICE_HOST ? 'kubernetes' : 'compose');

      return reply.send({
        workflowEngine: {
          type: 'native' as const,
          name: 'OpenAgentic Workflows',
          available: true,
        },
        deploymentMode,
        features: {
          // Core features - default to enabled
          openagentic: process.env.OPENAGENTIC_ENABLED !== 'false',
          mcp: process.env.ENABLE_MCP !== 'false',
          vectorSearch: process.env.ENABLE_VECTOR_SEARCH !== 'false',
          // Optional services - require explicit enabling
          ollama: process.env.OLLAMA_ENABLED === 'true',
          multiModel: process.env.ENABLE_MULTI_MODEL === 'true',
          // Login "Need help signing in?" modal. Default ON; set
          // LOGIN_HELP_MODAL=false to hide the link entirely.
          loginHelp: process.env.LOGIN_HELP_MODAL !== 'false',
          // slider feature flag removed in 0.6.7 — intelligence slider
          // was fully ripped in task #144 and v0.6.7 simplification.
        },
        version: process.env.APP_VERSION || '1.0.0'
      });
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get system config');
      return reply.status(500).send({ error: 'Failed to get system configuration' });
    }
  });
};

export default systemConfigRoutes;
