/**
 * Agent Resolution Route
 * Proxies to the API's /api/agents/resolve endpoint which has DB + PromptComposer access.
 * This route exists because nginx routes /api/agents/* to openagentic-proxy, not the API.
 */

import { FastifyInstance } from 'fastify';

const API_URL = process.env.API_URL || process.env.OPENAGENTIC_API_URL || 'http://openagentic-api:8000';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

export default async function resolveRoutes(app: FastifyInstance) {
  app.get('/api/agents/resolve', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          id: { type: 'string' },
          mode: { type: 'string', default: 'chat' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const query = request.query as { role?: string; id?: string; mode?: string };
      const params = new URLSearchParams();
      if (query.role) params.set('role', query.role);
      if (query.id) params.set('id', query.id);
      if (query.mode) params.set('mode', query.mode);

      // Forward all auth headers from original request (cookie + authorization),
      // and add service-to-service auth via INTERNAL_SERVICE_SECRET so the api's
      // unifiedAuthHook lets us through when the original request lacks a user token
      // (which happens when openagentic-proxy resolves an agent config for a spawning call).
      const headers: Record<string, string> = { 'x-request-from': 'openagentic-proxy' };
      if (request.headers.authorization) headers['Authorization'] = request.headers.authorization;
      if (request.headers.cookie) headers['Cookie'] = request.headers.cookie;
      if (INTERNAL_SECRET) headers['x-internal-secret'] = INTERNAL_SECRET;

      const res = await fetch(`${API_URL}/api/agents/resolve?${params}`, { headers });

      const data = await res.json();
      return reply.code(res.status).send(data);
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });
}
