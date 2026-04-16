/**
 * Admin Prompt Modules API
 *
 * CRUD + history + preview endpoints for the Composable Prompt System.
 * All routes mount under /api/admin/prompts (registered in server.ts).
 */

import { FastifyInstance } from 'fastify';
import { PromptModuleRegistry } from '../../services/prompt/PromptModuleRegistry.js';
import { ModelAdapterFactory } from '../../services/prompt/adapters/ModelAdapterFactory.js';
import { prisma } from '../../utils/prisma.js';
import type { AdapterFamily } from '../../services/prompt/types.js';

export default async function promptModuleRoutes(fastify: FastifyInstance) {
  const logger = fastify.log.child({ component: 'admin-prompt-modules' }) as any;
  const registry = PromptModuleRegistry.getInstance();

  // ── GET /admin/prompts/modules ─────────────────────────────────────────────
  fastify.get('/modules', async (request, reply) => {
    try {
      const modules = await registry.getAll();
      return reply.send({ modules, count: modules.length });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to list prompt modules');
      return reply.code(500).send({ error: 'Failed to list prompt modules' });
    }
  });

  // ── GET /admin/prompts/modules/:id ────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/modules/:id', async (request, reply) => {
    try {
      const mod = await registry.getById(request.params.id);
      if (!mod) {
        return reply.code(404).send({ error: 'Module not found' });
      }
      return reply.send(mod);
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, 'Failed to get prompt module');
      return reply.code(500).send({ error: 'Failed to get prompt module' });
    }
  });

  // ── POST /admin/prompts/modules ───────────────────────────────────────────
  fastify.post('/modules', async (request, reply) => {
    try {
      const body = (request.body || {}) as any;
      const { name, category, content, description, priority, enabled, injection, variants } = body;

      if (!name || !category || !content || !description) {
        return reply.code(400).send({ error: 'name, category, content, and description are required' });
      }

      const created = await registry.create({
        name,
        category,
        content,
        description,
        priority: priority ?? 50,
        tokenCost: Math.ceil(content.length / 3.5),
        enabled: enabled !== false,
        injection: injection ?? {},
        variants,
      });

      return reply.code(201).send(created);
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to create prompt module');
      return reply.code(500).send({ error: 'Failed to create prompt module' });
    }
  });

  // ── PUT /admin/prompts/modules/:id ────────────────────────────────────────
  fastify.put<{ Params: { id: string }; Body: any }>('/modules/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const editedBy = (request as any).user?.email || (request as any).user?.id || 'admin';

      const existing = await registry.getById(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Module not found' });
      }

      const updated = await registry.update(id, request.body || {}, editedBy);
      return reply.send(updated);
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, 'Failed to update prompt module');
      return reply.code(500).send({ error: 'Failed to update prompt module' });
    }
  });

  // ── DELETE /admin/prompts/modules/:id — soft delete (set enabled=false) ──
  fastify.delete<{ Params: { id: string } }>('/modules/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const editedBy = (request as any).user?.email || (request as any).user?.id || 'admin';

      const existing = await registry.getById(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Module not found' });
      }

      await registry.update(id, { enabled: false }, editedBy);
      return reply.send({ success: true, id, message: 'Module disabled (soft delete)' });
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, 'Failed to delete prompt module');
      return reply.code(500).send({ error: 'Failed to delete prompt module' });
    }
  });

  // ── GET /admin/prompts/modules/:id/history ────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/modules/:id/history', async (request, reply) => {
    try {
      const { id } = request.params;

      const history = await prisma.promptModuleHistory.findMany({
        where: { module_id: id },
        orderBy: { created_at: 'desc' },
        take: 50,
      });

      return reply.send({ history, count: history.length });
    } catch (err: any) {
      logger.error({ error: err.message, id: request.params.id }, 'Failed to get module history');
      return reply.code(500).send({ error: 'Failed to get module history' });
    }
  });

  // ── POST /admin/prompts/modules/:id/preview ───────────────────────────────
  // body: { family: 'claude' | 'gemini' | 'openai' | 'local' }
  fastify.post<{ Params: { id: string }; Body: { family?: AdapterFamily } }>(
    '/modules/:id/preview',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const family: AdapterFamily = request.body?.family || 'claude';

        const mod = await registry.getById(id);
        if (!mod) {
          return reply.code(404).send({ error: 'Module not found' });
        }

        const adapter = ModelAdapterFactory.getAdapter(family, family);
        const capabilities = {
          thinking: true,
          tools: true,
          vision: true,
          longContext: true,
          audio: false,
          video: false,
          documents: true,
          streaming: true,
          imageGen: false,
          audioGen: false,
          videoGen: false,
          embedding: false,
          codeExecution: false,
          grounding: false,
        };

        const preview = adapter.transform([mod], capabilities);
        return reply.send({ id, family, preview });
      } catch (err: any) {
        logger.error({ error: err.message, id: request.params.id }, 'Failed to preview prompt module');
        return reply.code(500).send({ error: 'Failed to preview prompt module' });
      }
    },
  );

  // ── GET /admin/prompts/effectiveness ─────────────────────────────────────
  fastify.get('/effectiveness', async (request, reply) => {
    try {
      // Get module stats
      const allModules = await prisma.promptModule.findMany();
      const enabledModules = allModules.filter(m => m.enabled);
      const avgTokenCost = allModules.length > 0
        ? allModules.reduce((sum, m) => sum + m.token_cost, 0) / allModules.length
        : 0;

      // Get effectiveness data
      const rows = await prisma.promptEffectiveness.findMany({
        orderBy: { created_at: 'desc' },
        take: 500,
      });

      // Aggregate per-module stats
      const moduleStats: Record<string, { total: number; positive: number; negative: number }> = {};
      let positiveOutcomes = 0;
      let negativeOutcomes = 0;
      let pendingOutcomes = 0;

      for (const row of rows) {
        if (row.outcome === 'positive') positiveOutcomes++;
        else if (row.outcome === 'negative') negativeOutcomes++;
        else pendingOutcomes++;

        for (const moduleName of row.modules) {
          if (!moduleStats[moduleName]) {
            moduleStats[moduleName] = { total: 0, positive: 0, negative: 0 };
          }
          moduleStats[moduleName].total++;
          if (row.outcome === 'positive') moduleStats[moduleName].positive++;
          else if (row.outcome === 'negative') moduleStats[moduleName].negative++;
        }
      }

      // Build module usage rows for the UI table
      const moduleUsage = Object.entries(moduleStats)
        .map(([moduleName, stats]) => ({
          moduleName,
          usageCount: stats.total,
          positiveCount: stats.positive,
          negativeCount: stats.negative,
        }))
        .sort((a, b) => b.usageCount - a.usageCount);

      return reply.send({
        totalModules: allModules.length,
        enabledModules: enabledModules.length,
        averageTokenCost: avgTokenCost,
        totalTokenBudgetUsed: enabledModules.reduce((sum, m) => sum + m.token_cost, 0),
        moduleUsage,
        recentCompositions: rows.length,
        positiveOutcomes,
        negativeOutcomes,
        pendingOutcomes,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to get effectiveness data');
      return reply.code(500).send({ error: 'Failed to get effectiveness data' });
    }
  });
}
