import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

export async function build(opts = { test: true }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.test ? false : true
  });

  // Mock Azure AD auth service
  app.decorate('azureADAuthService', {
    validateToken: vi.fn(),
    getGroupMemberships: vi.fn(),
    isUserAdmin: vi.fn()
  });

  // Add auth routes
  app.register(async (app) => {
    // POST /api/auth/validate
    app.post('/api/auth/validate', async (request, reply) => {
      const { token } = request.body as { token: string };
      
      // SECURITY: AUTH_MODE=test bypass removed in v0.5.0 FedRAMP hardening (Bolt 01)
      // All token validation must go through Azure AD, even in test helpers.
      // Use vi.fn() mocks on azureADAuthService.validateToken for unit tests.
      return reply.status(401).send({ error: 'Invalid token - use Azure AD authentication' });
    });

    // POST /api/auth/spawn-mcp
    app.post('/api/auth/spawn-mcp', async (request, reply) => {
      const authHeader = request.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { userId, mcpType } = request.body as { userId: string; mcpType: string };
      
      // Mock check for user token
      if (!userId) {
        return reply.status(401).send({ error: 'No valid token found for user' });
      }

      // Mock MCP orchestrator response
      return reply.send({
        success: true,
        instanceId: `${userId}-${mcpType}-123`,
        connectionInfo: {
          status: 'running'
        }
      });
    });
  });

  return app;
}