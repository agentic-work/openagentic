/**
 * Admin Routes — EnrichedTool registry (Phase 5).
 *
 * the design notes
 * the design notes (Phase 5)
 *
 *   GET    /api/admin/enriched-tools           List (filters: ?category, ?mcp_server, ?enabled)
 *   GET    /api/admin/enriched-tools/:slug     Single
 *   POST   /api/admin/enriched-tools           Upsert (admin auth required)
 *   PATCH  /api/admin/enriched-tools/:slug/toggle   Enable/disable
 *   DELETE /api/admin/enriched-tools/:slug     Delete
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../utils/prisma.js';
import { EnrichedToolService } from '../../services/EnrichedToolService.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ListQuerySchema = z
  .object({
    category: z.string().optional(),
    mcp_server: z.string().optional(),
    enabled: z.enum(['true', 'false']).optional(),
  })
  .strict();

const UpsertBodySchema = z
  .object({
    slug: z.string().min(1).max(100),
    display_name: z.string().min(1).max(200),
    description: z.string().min(1),
    output_template: z.string().max(64).nullable().optional(),
    truncate_summary: z.string().nullable().optional(),
    input_schema: z.record(z.any()),
    output_schema: z.record(z.any()).nullable().optional(),
    mcp_server: z.string().max(100).nullable().optional(),
    category: z.string().min(1).max(40),
    tier: z.number().int().min(1).max(3).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const ToggleBodySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Auth guard helper
// ---------------------------------------------------------------------------

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = (req as any).user;
  if (!user?.isAdmin && user?.role !== 'admin') {
    reply.code(403).send({ success: false, error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const enrichedToolsRoutes: FastifyPluginAsync = async (fastify, _opts) => {
  const logger = fastify.log;
  const service = new EnrichedToolService(prisma as any);

  // GET /api/admin/enriched-tools
  fastify.get('/enriched-tools', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid query params',
        message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
      });
    }
    try {
      const { category, mcp_server, enabled } = parsed.data;
      // When `enabled` filter is omitted, return ALL rows so admin sees disabled too.
      let rows;
      if (enabled === 'true' || enabled === undefined) {
        if (enabled === undefined) {
          rows = await service.listAll();
          if (category) rows = rows.filter(r => r.category === category);
          if (mcp_server) rows = rows.filter(r => r.mcp_server === mcp_server);
        } else {
          rows = await service.listEnabled({ category, mcpServer: mcp_server });
        }
      } else {
        // enabled=false: return only disabled, optionally filtered.
        const all = await service.listAll();
        rows = all.filter(r => !r.enabled);
        if (category) rows = rows.filter(r => r.category === category);
        if (mcp_server) rows = rows.filter(r => r.mcp_server === mcp_server);
      }
      return reply.send({ success: true, tools: rows, count: rows.length });
    } catch (err: any) {
      logger.error({ err: err?.message }, 'enriched-tools GET failed');
      return reply.code(500).send({ success: false, error: 'List failed', message: err?.message });
    }
  });

  // GET /api/admin/enriched-tools/:slug
  fastify.get<{ Params: { slug: string } }>(
    '/enriched-tools/:slug',
    async (req, reply) => {
      try {
        const row = await service.getBySlug(req.params.slug);
        if (!row) {
          return reply.code(404).send({ success: false, error: 'Not found' });
        }
        return reply.send({ success: true, tool: row });
      } catch (err: any) {
        logger.error({ err: err?.message }, 'enriched-tools GET-by-slug failed');
        return reply.code(500).send({ success: false, error: 'Fetch failed', message: err?.message });
      }
    },
  );

  // POST /api/admin/enriched-tools (upsert)
  fastify.post('/enriched-tools', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return reply;
    const parsed = UpsertBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid body',
        message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
      });
    }
    try {
      const user = (req as any).user;
      const updatedBy = user?.email ?? user?.id ?? 'admin';
      const row = await service.upsert({
        slug: parsed.data.slug,
        display_name: parsed.data.display_name,
        description: parsed.data.description,
        output_template: parsed.data.output_template ?? null,
        truncate_summary: parsed.data.truncate_summary ?? null,
        input_schema: parsed.data.input_schema,
        output_schema: parsed.data.output_schema ?? null,
        mcp_server: parsed.data.mcp_server ?? null,
        category: parsed.data.category,
        tier: parsed.data.tier ?? 1,
        enabled: parsed.data.enabled ?? true,
        updated_by: updatedBy,
      });
      logger.info({ slug: row.slug, updatedBy }, '[admin] EnrichedTool upserted');
      return reply.send({ success: true, tool: row });
    } catch (err: any) {
      logger.error({ err: err?.message }, 'enriched-tools POST failed');
      return reply.code(500).send({ success: false, error: 'Upsert failed', message: err?.message });
    }
  });

  // PATCH /api/admin/enriched-tools/:slug/toggle
  fastify.patch<{ Params: { slug: string }; Body: { enabled: boolean } }>(
    '/enriched-tools/:slug/toggle',
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return reply;
      const parsed = ToggleBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid body',
          message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
      }
      try {
        const user = (req as any).user;
        const updatedBy = user?.email ?? user?.id ?? 'admin';
        const row = await service.toggle(req.params.slug, parsed.data.enabled, updatedBy);
        logger.info({ slug: row.slug, enabled: row.enabled, updatedBy }, '[admin] EnrichedTool toggled');
        return reply.send({ success: true, tool: row });
      } catch (err: any) {
        logger.error({ err: err?.message }, 'enriched-tools PATCH toggle failed');
        return reply.code(500).send({ success: false, error: 'Toggle failed', message: err?.message });
      }
    },
  );

  // DELETE /api/admin/enriched-tools/:slug
  fastify.delete<{ Params: { slug: string } }>(
    '/enriched-tools/:slug',
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return reply;
      try {
        const user = (req as any).user;
        const updatedBy = user?.email ?? user?.id ?? 'admin';
        const existing = await service.getBySlug(req.params.slug);
        if (!existing) {
          return reply.code(404).send({ success: false, error: 'Not found' });
        }
        await service.delete(req.params.slug);
        logger.info({ slug: req.params.slug, updatedBy }, '[admin] EnrichedTool deleted');
        return reply.send({ success: true, deleted: req.params.slug });
      } catch (err: any) {
        logger.error({ err: err?.message }, 'enriched-tools DELETE failed');
        return reply.code(500).send({ success: false, error: 'Delete failed', message: err?.message });
      }
    },
  );
};

export default enrichedToolsRoutes;
