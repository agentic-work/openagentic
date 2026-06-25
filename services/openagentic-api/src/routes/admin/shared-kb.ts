/**
 * Admin Shared Knowledge Base API
 *
 * CRUD + ingest endpoints for the cluster-wide shared knowledge base.
 * Routes mount under /api/admin/shared-kb (registered in server.ts).
 *
 * Security: all routes require admin auth (enforced by the parent plugin
 * in server.ts where the admin prefix + middleware are applied).
 */

import { FastifyInstance } from 'fastify';
import { getSharedKBService, SharedKBSourceType } from '../../services/SharedKBService.js';

export default async function sharedKBRoutes(fastify: FastifyInstance) {
  const logger = fastify.log.child({ component: 'admin-shared-kb' }) as any;
  const service = getSharedKBService(logger);

  // ── GET /admin/shared-kb/sources ───────────────────────────────────────
  fastify.get('/sources', async (_request, reply) => {
    try {
      const sources = await service.listSources();
      return reply.send({ sources, count: sources.length });
    } catch (err: any) {
      logger.error({ error: err.message }, '[SharedKB] list sources failed');
      return reply.code(500).send({ error: 'Failed to list shared KB sources' });
    }
  });

  // ── GET /admin/shared-kb/sources/:id ───────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/sources/:id', async (request, reply) => {
    try {
      const source = await service.getSource(request.params.id);
      if (!source) return reply.code(404).send({ error: 'Source not found' });
      return reply.send(source);
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, '[SharedKB] get source failed');
      return reply.code(500).send({ error: 'Failed to get shared KB source' });
    }
  });

  // ── POST /admin/shared-kb/sources ──────────────────────────────────────
  fastify.post('/sources', async (request, reply) => {
    try {
      const body = (request.body || {}) as any;
      const { name, description, type, config, enabled, schedule } = body;
      if (!name || !type || !config) {
        return reply.code(400).send({ error: 'name, type, and config are required' });
      }
      const user = (request as any).user;
      const created = await service.createSource({
        name,
        description,
        type: type as SharedKBSourceType,
        config,
        enabled,
        schedule,
        createdBy: user?.email || user?.id,
      });
      return reply.code(201).send(created);
    } catch (err: any) {
      logger.error({ error: err.message }, '[SharedKB] create source failed');
      return reply.code(400).send({ error: err.message || 'Failed to create shared KB source' });
    }
  });

  // ── PATCH /admin/shared-kb/sources/:id ─────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/sources/:id', async (request, reply) => {
    try {
      const body = (request.body || {}) as any;
      const updated = await service.updateSource(request.params.id, body);
      return reply.send(updated);
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, '[SharedKB] update source failed');
      return reply.code(400).send({ error: err.message || 'Failed to update shared KB source' });
    }
  });

  // ── DELETE /admin/shared-kb/sources/:id ────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/sources/:id', async (request, reply) => {
    try {
      await service.deleteSource(request.params.id);
      return reply.send({ success: true });
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, '[SharedKB] delete source failed');
      return reply.code(500).send({ error: 'Failed to delete shared KB source' });
    }
  });

  // ── POST /admin/shared-kb/sources/:id/ingest ───────────────────────────
  fastify.post<{ Params: { id: string } }>('/sources/:id/ingest', async (request, reply) => {
    try {
      const result = await service.ingestSource(request.params.id);
      return reply.send(result);
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, '[SharedKB] ingest source failed');
      return reply.code(500).send({ error: err.message || 'Failed to ingest shared KB source' });
    }
  });

  // ── GET /admin/shared-kb/sources/:id/documents ─────────────────────────
  fastify.get<{ Params: { id: string } }>('/sources/:id/documents', async (request, reply) => {
    try {
      const docs = await service.listDocuments(request.params.id);
      return reply.send({ documents: docs, count: docs.length });
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, '[SharedKB] list documents failed');
      return reply.code(500).send({ error: 'Failed to list documents' });
    }
  });

  // ── DELETE /admin/shared-kb/sources/:sid/documents/:did ────────────────
  fastify.delete<{ Params: { sid: string; did: string } }>(
    '/sources/:sid/documents/:did',
    async (request, reply) => {
      try {
        await service.deleteDocument(request.params.sid, request.params.did);
        return reply.send({ success: true });
      } catch (err: any) {
        logger.error({ error: err.message }, '[SharedKB] delete document failed');
        return reply.code(500).send({ error: 'Failed to delete document' });
      }
    },
  );

  // ── POST /admin/shared-kb/search — debug/preview endpoint ─────────────
  fastify.post('/search', async (request, reply) => {
    try {
      const body = (request.body || {}) as any;
      const query = body.query as string;
      const limit = Number.parseInt(body.limit, 10) || 5;
      if (!query) return reply.code(400).send({ error: 'query is required' });
      const results = await service.search(query, limit);
      return reply.send({ query, results, count: results.length });
    } catch (err: any) {
      logger.error({ error: err.message }, '[SharedKB] search failed');
      return reply.code(500).send({ error: err.message || 'Shared KB search failed' });
    }
  });
}
