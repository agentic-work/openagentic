/**
 * GitHub OAuth Routes - API v1
 *
 * Handles GitHub OAuth flow and credential management for GitHub MCP.
 * Endpoints:
 * - GET  /api/v1/github/connect    - Initiate OAuth flow
 * - GET  /api/v1/github/callback   - OAuth callback handler
 * - GET  /api/v1/github/status     - Get connection status
 * - POST /api/v1/github/disconnect - Remove GitHub connection
 *
 * @module routes/v1/github
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/unifiedAuth.js';
import { getGitHubCredentialService, GitHubCredentialService, GitHubDeviceFlowSession } from '../../services/GitHubCredentialService.js';
import { loggers } from '../../utils/logger.js';

// In-memory store for active Device Flow sessions (could move to Redis for multi-instance)
const deviceFlowSessions = new Map<string, GitHubDeviceFlowSession>();

interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

interface ConnectQuery {
  redirect?: string;
}

/**
 * GitHub OAuth Routes Plugin
 */
export const githubRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;
  let githubService: GitHubCredentialService;

  // Initialize service lazily to ensure logger is available
  fastify.addHook('onRequest', async (request) => {
    if (!githubService) {
      githubService = getGitHubCredentialService(request.log);
    }
  });

  // ============================================================================
  // PUBLIC: Check if GitHub OAuth is configured
  // ============================================================================

  /**
   * GET /api/v1/github/config
   * Check if GitHub OAuth is available (no auth required)
   */
  fastify.get('/config', {
    schema: {
      tags: ['GitHub'],
      summary: 'Check GitHub OAuth configuration',
      description: 'Returns whether GitHub OAuth is configured for this instance',
      response: {
        200: {
          type: 'object',
          properties: {
            configured: { type: 'boolean' },
            clientId: { type: 'string' },
            redirectUri: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const service = getGitHubCredentialService(request.log);
    return reply.send(service.getConfigStatus());
  });

  // ============================================================================
  // AUTH REQUIRED ROUTES
  // ============================================================================

  /**
   * GET /api/v1/github/connect
   * Initiate GitHub OAuth flow
   */
  fastify.get<{ Querystring: ConnectQuery }>('/connect', {
    onRequest: authMiddleware,
    schema: {
      tags: ['GitHub'],
      summary: 'Initiate GitHub OAuth flow',
      description: 'Redirects user to GitHub for OAuth authorization',
      querystring: {
        type: 'object',
        properties: {
          redirect: {
            type: 'string',
            description: 'URL to redirect after successful auth'
          }
        }
      }
    }
  }, async (request, reply) => {
    const user = (request as any).user;
    const { redirect } = request.query;

    if (!githubService.isConfigured()) {
      return reply.code(503).send({
        error: 'GitHub OAuth not configured',
        message: 'GitHub OAuth Client ID and Secret are not configured on this server'
      });
    }

    // Generate state with encrypted user info
    const state = githubService.generateOAuthState(user.id, redirect);

    // Build authorization URL with scopes needed for GitHub MCP
    const authUrl = githubService.getAuthorizationUrl(state, [
      'repo',              // Full control of private repositories
      'read:org',          // Read org membership
      'read:user',         // Read user profile
      'user:email',        // Read user emails
      'workflow',          // Update GitHub Actions workflows
      'read:packages'      // Read packages
    ]);

    logger.info({ userId: user.id }, 'Initiating GitHub OAuth flow');

    // Redirect to GitHub
    return reply.redirect(authUrl);
  });

  /**
   * GET /api/v1/github/callback
   * Handle OAuth callback from GitHub
   */
  fastify.get<{ Querystring: OAuthCallbackQuery }>('/callback', {
    schema: {
      tags: ['GitHub'],
      summary: 'GitHub OAuth callback',
      description: 'Handles the OAuth callback from GitHub after user authorization',
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' },
          error_description: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { code, state, error, error_description } = request.query;
    const service = getGitHubCredentialService(request.log);

    // Default landing page — the legacy /settings page is being ripped
    // (per user 2026-05-07). Bounce back to /admin#integrations so the
    // admin can see the result, OR honor the per-flow redirectUrl when a
    // caller passes one with its "Connect GitHub" request.
    const DEFAULT_LANDING = '/admin#integrations/github';

    // Handle OAuth errors
    if (error) {
      logger.error({ error, error_description }, 'GitHub OAuth error');
      return reply.redirect(
        `${DEFAULT_LANDING}?github_error=${encodeURIComponent(error_description || error)}`,
      );
    }

    if (!code || !state) {
      return reply.redirect(`${DEFAULT_LANDING}?github_error=missing_parameters`);
    }

    // Decode and validate state
    const stateData = service.decodeOAuthState(state);
    if (!stateData) {
      return reply.redirect(`${DEFAULT_LANDING}?github_error=invalid_state`);
    }

    try {
      // Exchange code for token
      const tokenInfo = await service.exchangeCodeForToken(code);

      // Fetch user info
      const userInfo = await service.fetchUserInfo(tokenInfo.access_token);

      // Store credentials
      await service.storeCredentials(stateData.userId, tokenInfo, userInfo);

      logger.info({
        userId: stateData.userId,
        githubUsername: userInfo.login
      }, 'GitHub OAuth completed successfully');

      // Honor the per-flow redirect if the connect call passed one.
      // Otherwise bounce back to the admin integrations page so the
      // operator can see "GitHub: connected".
      const redirectUrl = stateData.redirectUrl || `${DEFAULT_LANDING}?github_success=true`;
      return reply.redirect(redirectUrl);

    } catch (err) {
      logger.error({ error: (err as Error).message }, 'GitHub OAuth callback failed');
      return reply.redirect(
        `${DEFAULT_LANDING}?github_error=${encodeURIComponent((err as Error).message)}`,
      );
    }
  });

  /**
   * GET /api/v1/github/status
   * Get current GitHub connection status
   */
  fastify.get('/status', {
    onRequest: authMiddleware,
    schema: {
      tags: ['GitHub'],
      summary: 'Get GitHub connection status',
      description: 'Returns the current GitHub connection status for the authenticated user',
      response: {
        200: {
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            githubUsername: { type: 'string' },
            githubEmail: { type: 'string' },
            avatarUrl: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            lastUsed: { type: 'string', format: 'date-time' },
            isValid: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const status = await githubService.getConnectionStatus(user.id);
    return reply.send(status);
  });

  /**
   * POST /api/v1/github/disconnect
   * Disconnect GitHub account
   */
  fastify.post('/disconnect', {
    onRequest: authMiddleware,
    schema: {
      tags: ['GitHub'],
      summary: 'Disconnect GitHub account',
      description: 'Removes the GitHub OAuth connection for the authenticated user',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    const success = await githubService.disconnect(user.id);

    if (success) {
      logger.info({ userId: user.id }, 'GitHub disconnected');
      return reply.send({ success: true, message: 'GitHub disconnected successfully' });
    } else {
      return reply.code(500).send({ success: false, message: 'Failed to disconnect GitHub' });
    }
  });

  /**
   * POST /api/v1/github/validate
   * Validate current GitHub token
   */
  fastify.post('/validate', {
    onRequest: authMiddleware,
    schema: {
      tags: ['GitHub'],
      summary: 'Validate GitHub token',
      description: 'Tests if the stored GitHub token is still valid',
      response: {
        200: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    const tokenInfo = await githubService.getUserToken(user.id);
    if (!tokenInfo) {
      return reply.send({ valid: false, message: 'No GitHub token found' });
    }

    const isValid = await githubService.validateToken(tokenInfo.access_token);

    return reply.send({
      valid: isValid,
      message: isValid ? 'Token is valid' : 'Token is invalid or expired'
    });
  });

  // ============================================================================
  // DEVICE FLOW ROUTES (for terminal/CLI/VSCode use)
  // ============================================================================

  /**
   * POST /api/v1/github/device/start
   * Initiate GitHub Device Flow - returns code for user to enter at github.com/login/device
   */
  fastify.post('/device/start', {
    onRequest: authMiddleware,
    schema: {
      tags: ['GitHub'],
      summary: 'Start GitHub Device Flow',
      description: 'Initiates Device Flow authentication - returns a user code to enter at github.com/login/device',
      response: {
        200: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            userCode: { type: 'string' },
            verificationUri: { type: 'string' },
            expiresIn: { type: 'number' },
            interval: { type: 'number' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    if (!githubService.isConfigured()) {
      return reply.code(503).send({
        error: 'GitHub OAuth not configured',
        message: 'GitHub OAuth Client ID is not configured on this server'
      });
    }

    try {
      const session = await githubService.initiateDeviceFlow(user.id);

      // Generate a session ID and store the session
      const sessionId = `df_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      deviceFlowSessions.set(sessionId, session);

      // Clean up expired sessions periodically
      setTimeout(() => deviceFlowSessions.delete(sessionId), session.expiresAt - Date.now() + 60000);

      logger.info({
        userId: user.id,
        sessionId,
        userCode: session.userCode
      }, 'Device Flow initiated');

      return reply.send({
        sessionId,
        userCode: session.userCode,
        verificationUri: session.verificationUri,
        expiresIn: Math.floor((session.expiresAt - Date.now()) / 1000),
        interval: session.interval,
        message: `Go to ${session.verificationUri} and enter code: ${session.userCode}`
      });
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Device Flow initiation failed');
      return reply.code(500).send({
        error: 'Device Flow failed',
        message: (err as Error).message
      });
    }
  });

  /**
   * POST /api/v1/github/device/poll
   * Poll for Device Flow completion
   */
  fastify.post<{ Body: { sessionId: string } }>('/device/poll', {
    onRequest: authMiddleware,
    schema: {
      tags: ['GitHub'],
      summary: 'Poll Device Flow status',
      description: 'Checks if user has completed Device Flow authentication',
      body: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'success', 'expired', 'error'] },
            message: { type: 'string' },
            githubUsername: { type: 'string' },
            avatarUrl: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const user = (request as any).user;
    const { sessionId } = request.body;

    const session = deviceFlowSessions.get(sessionId);

    if (!session) {
      return reply.send({
        status: 'expired',
        message: 'Session not found or expired - please start again'
      });
    }

    if (session.userId !== user.id) {
      return reply.code(403).send({
        status: 'error',
        message: 'Session does not belong to this user'
      });
    }

    if (Date.now() > session.expiresAt) {
      deviceFlowSessions.delete(sessionId);
      return reply.send({
        status: 'expired',
        message: 'Session expired - please start again'
      });
    }

    try {
      const tokenInfo = await githubService.pollDeviceFlow(session);

      if (!tokenInfo) {
        // Still waiting for user — include interval for frontend to respect
        return reply.send({
          status: 'pending',
          message: 'Waiting for user to complete authorization...',
          interval: session.interval || 5,
        });
      }

      // Success! Fetch user info and store credentials
      const userInfo = await githubService.fetchUserInfo(tokenInfo.access_token);
      await githubService.storeCredentials(user.id, tokenInfo, userInfo);

      // Clean up session
      deviceFlowSessions.delete(sessionId);

      logger.info({
        userId: user.id,
        githubUsername: userInfo.login
      }, 'Device Flow completed successfully');

      return reply.send({
        status: 'success',
        message: 'GitHub connected successfully!',
        githubUsername: userInfo.login,
        avatarUrl: userInfo.avatar_url
      });

    } catch (err) {
      const errorMessage = (err as Error).message;

      if (errorMessage.includes('expired')) {
        deviceFlowSessions.delete(sessionId);
        return reply.send({
          status: 'expired',
          message: 'Session expired - please start again'
        });
      }

      if (errorMessage.includes('denied')) {
        deviceFlowSessions.delete(sessionId);
        return reply.send({
          status: 'error',
          message: 'Authorization was denied'
        });
      }

      logger.error({ error: errorMessage }, 'Device Flow poll error');
      return reply.send({
        status: 'error',
        message: errorMessage
      });
    }
  });

  /**
   * DELETE /api/v1/github/device/:sessionId
   * Cancel a Device Flow session
   */
  fastify.delete<{ Params: { sessionId: string } }>('/device/:sessionId', {
    onRequest: authMiddleware,
    schema: {
      tags: ['GitHub'],
      summary: 'Cancel Device Flow',
      description: 'Cancels an active Device Flow session',
      params: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const user = (request as any).user;
    const { sessionId } = request.params;

    const session = deviceFlowSessions.get(sessionId);

    if (session && session.userId === user.id) {
      deviceFlowSessions.delete(sessionId);
    }

    return reply.send({ success: true, message: 'Device Flow cancelled' });
  });

  logger.info('GitHub OAuth routes registered');
};

export default githubRoutes;
