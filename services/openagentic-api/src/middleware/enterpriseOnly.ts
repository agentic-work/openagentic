import type { FastifyReply, FastifyRequest } from 'fastify';
import { EDITION, UPGRADE_URL } from '../features.js';

/**
 * Fastify preHandler that gates enterprise-only admin routes.
 *
 * When EDITION === 'oss', the handler 402s with an upgrade_url payload.
 * The UI detects 402 and renders the upsell card instead of the normal view.
 *
 * Apply per-route:
 *   fastify.get('/admin/chargeback', { preHandler: enterpriseOnly }, handler)
 *
 * Or bulk-apply to a plugin scope via fastify.addHook('preHandler', enterpriseOnly).
 */
export async function enterpriseOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if ((EDITION as string) === 'enterprise') return;
  reply.code(402).send({
    error: 'enterprise_only',
    feature: req.routeOptions?.url ?? req.url,
    message: 'This feature is part of the Enterprise edition.',
    upgrade_url: UPGRADE_URL,
  });
}
