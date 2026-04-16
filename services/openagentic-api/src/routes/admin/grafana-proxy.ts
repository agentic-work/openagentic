/**
 * Grafana Reverse Proxy for Admin Console
 *
 * Proxies requests from /api/admin/grafana/* to the internal Grafana service.
 * Only accessible to admin users. Supports both Bearer token and cookie auth
 * so it works when opened in a new browser tab from the Admin Console.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateAnyToken, extractBearerToken } from '../../auth/tokenValidator.js';
import http from 'http';

const GRAFANA_HOST = process.env.GRAFANA_HOST || 'grafana.monitoring-stack.svc.cluster.local';
const GRAFANA_PORT = parseInt(process.env.GRAFANA_PORT || '3000');

/** Admin guard that checks both Authorization header AND cookies */
async function grafanaAdminGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Try Bearer token first
  let token = extractBearerToken(request.headers.authorization);

  // Fall back to cookies (for new-tab access from Admin Console)
  if (!token) {
    const cookies = (request as any).cookies as Record<string, string> | undefined;
    token = cookies?.openagentic_token || cookies?.accessToken || null;
  }

  if (!token) {
    reply.code(401).send({ error: 'Unauthorized', message: 'No authentication token provided' });
    return;
  }

  const result = await validateAnyToken(token, { requireAdmin: true, logger: request.log });
  if (!result.isValid) {
    reply.code(result.error?.includes('Administrator') ? 403 : 401).send({
      error: 'Unauthorized',
      message: result.error || 'Admin access required'
    });
    return;
  }

  (request as any).user = result.user;
}

export const grafanaProxyRoutes: FastifyPluginAsync = async (fastify) => {
  // Proxy all requests under /grafana/* to internal Grafana
  fastify.all('/grafana/*', {
    preHandler: [grafanaAdminGuard],
  }, async (request, reply) => {
    const targetPath = (request.params as { '*': string })['*'];
    const queryString = request.url.includes('?') ? '?' + request.url.split('?')[1] : '';
    const grafanaPath = `/grafana/${targetPath}${queryString}`;

    return new Promise<void>((resolve) => {
      const proxyReq = http.request({
        hostname: GRAFANA_HOST,
        port: GRAFANA_PORT,
        path: grafanaPath,
        method: request.method,
        headers: {
          ...request.headers,
          host: `${GRAFANA_HOST}:${GRAFANA_PORT}`,
        },
      }, (proxyRes) => {
        reply.status(proxyRes.statusCode || 502);
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value && key !== 'transfer-encoding') {
            reply.header(key, value);
          }
        }
        reply.send(proxyRes);
        resolve();
      });

      proxyReq.on('error', (err) => {
        fastify.log.error({ err, path: grafanaPath }, 'Grafana proxy error');
        reply.status(502).send({ error: 'Grafana unreachable' });
        resolve();
      });

      if (request.body) {
        proxyReq.write(typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
      }
      proxyReq.end();
    });
  });

  // Redirect /grafana to /grafana/
  fastify.get('/grafana', {
    preHandler: [grafanaAdminGuard],
  }, async (_request, reply) => {
    reply.redirect('/api/admin/grafana/');
  });
};
