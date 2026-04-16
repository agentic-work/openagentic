/**
 * Ollama Admin Routes — Multi-Host Support
 *
 * Admin endpoints for managing Ollama models across multiple hosts.
 * Each Ollama LLMProvider record has its own baseUrl — routes accept
 * a `providerId` query param to target a specific host.
 * Without providerId, targets the first enabled Ollama provider.
 *
 * @copyright 2026 Openagentic LLC
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Ollama } from 'ollama';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { getOllamaModelSyncService } from '../services/OllamaModelSyncService.js';

const logger = loggers.services;

/** Get Ollama client for a specific provider or the default one */
async function getOllamaClient(prisma: PrismaClient, providerId?: string): Promise<{ client: Ollama; provider: any; baseUrl: string }> {
  let provider: any;

  if (providerId) {
    provider = await prisma.lLMProvider.findUnique({ where: { id: providerId } });
  } else {
    // Get first enabled Ollama provider
    provider = await prisma.lLMProvider.findFirst({
      where: { provider_type: 'ollama', enabled: true, deleted_at: null },
      orderBy: { priority: 'asc' },
    });
  }

  if (!provider) {
    throw new Error('No Ollama provider configured');
  }

  const pc = provider.provider_config as any || {};
  const baseUrl = pc.baseUrl || pc.host || pc.endpoint || process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
  const client = new Ollama({ host: baseUrl });

  return { client, provider, baseUrl };
}

export async function adminOllamaRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/ollama/hosts
   * List all configured Ollama hosts (providers) with status
   */
  fastify.get('/ollama/hosts', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const providers = await prisma.lLMProvider.findMany({
        where: { provider_type: 'ollama', deleted_at: null },
        orderBy: { priority: 'asc' },
      });

      const hosts = await Promise.all(providers.map(async (p: any) => {
        const pc = p.provider_config as any || {};
        const mc = p.model_config as any || {};
        const baseUrl = pc.baseUrl || pc.host || pc.endpoint || 'http://ollama:11434';

        let status = 'unknown';
        let modelCount = 0;
        let runningCount = 0;
        let liveModels: any[] = [];
        let runningModels: any[] = [];
        let error: string | undefined;

        try {
          const client = new Ollama({ host: baseUrl });
          const models = await client.list();
          const running = await client.ps();
          status = 'connected';
          liveModels = models.models || [];
          runningModels = running.models || [];
          modelCount = liveModels.length;
          runningCount = runningModels.length;
        } catch (e: any) {
          status = 'disconnected';
          error = e.message;
        }

        return {
          id: p.id,
          name: p.name,
          displayName: p.display_name,
          host: baseUrl,
          enabled: p.enabled,
          priority: p.priority,
          status,
          modelCount,
          runningCount,
          chatModel: mc.chatModel,
          lastSync: pc.lastSync || null,
          // LIVE data from Ollama — not stale DB cache
          hostModels: liveModels.map((m: any) => m.name || m.model),
          runningModels: runningModels.map((m: any) => ({ name: m.name, sizeVram: m.size_vram })),
          error,
        };
      }));

      return { success: true, hosts };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to list hosts');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/admin/ollama/sync
   * Trigger immediate sync for all or a specific provider
   */
  fastify.post('/ollama/sync', async (request: FastifyRequest<{ Querystring: { providerId?: string } }>, reply: FastifyReply) => {
    try {
      const syncService = getOllamaModelSyncService();
      const { providerId } = request.query as any;

      let results;
      if (providerId) {
        const result = await syncService.syncProvider(providerId);
        results = [result];
      } else {
        results = await syncService.syncAll();
      }

      return { success: true, results };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Sync failed');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/admin/ollama/sync/status
   * Get last sync results
   */
  fastify.get('/ollama/sync/status', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const syncService = getOllamaModelSyncService();
    return { success: true, results: syncService.getLastSyncResults() };
  });

  /**
   * GET /api/admin/ollama/status
   * Get Ollama server status (supports ?providerId=xxx)
   */
  fastify.get('/ollama/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { providerId } = request.query as any;
      const { client, provider, baseUrl } = await getOllamaClient(prisma, providerId);
      const models = await client.list();
      const running = await client.ps();

      return {
        success: true,
        status: 'connected',
        providerId: provider.id,
        providerName: provider.name,
        endpoint: baseUrl,
        models: models.models?.length || 0,
        runningModels: running.models?.length || 0,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to get status');
      return reply.code(503).send({
        success: false,
        status: 'disconnected',
        error: error.message,
      });
    }
  });

  /**
   * GET /api/admin/ollama/models
   * List all available models on a host
   */
  fastify.get('/ollama/models', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { providerId } = request.query as any;
      const { client, provider } = await getOllamaClient(prisma, providerId);
      const response = await client.list();

      return {
        success: true,
        providerId: provider.id,
        models: response.models.map((m: any) => ({
          name: m.name,
          size: m.size,
          digest: m.digest,
          modifiedAt: m.modified_at,
          details: m.details,
        })),
      };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to list models');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/admin/ollama/running
   * Get currently running models on a host
   */
  fastify.get('/ollama/running', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { providerId } = request.query as any;
      const { client, provider } = await getOllamaClient(prisma, providerId);
      const response = await client.ps();

      return {
        success: true,
        providerId: provider.id,
        models: response.models?.map((m: any) => ({
          name: m.name,
          size: m.size,
          digest: m.digest,
          expiresAt: m.expires_at,
          sizeVram: m.size_vram,
        })) || [],
      };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to get running models');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/admin/ollama/pull
   * Pull a model from Ollama registry to a specific host
   */
  fastify.post('/ollama/pull', async (request: FastifyRequest<{ Body: { model: string; providerId?: string } }>, reply: FastifyReply) => {
    try {
      const { model, providerId } = request.body;
      if (!model) return reply.code(400).send({ success: false, error: 'Model name is required' });

      const { client, provider } = await getOllamaClient(prisma, providerId);
      logger.info({ model, provider: provider.name }, '[OllamaAdmin] Pulling model');

      const stream = await client.pull({ model, stream: true });
      for await (const chunk of stream) {
        if (chunk.status === 'success') break;
      }

      // Trigger sync to update DB + invalidate ALL caches for instant availability
      const syncService = getOllamaModelSyncService();
      await syncService.syncProvider(provider.id);
      const { invalidateAllModelCaches } = await import('../services/llm-providers/ProviderManager.js');
      await invalidateAllModelCaches(logger);

      logger.info({ model, provider: provider.name }, '[OllamaAdmin] Model pulled + synced + caches invalidated');
      return { success: true, model, message: `Model ${model} pulled successfully` };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to pull model');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /api/admin/ollama/models/:model
   * Delete a model from a host
   */
  fastify.delete('/ollama/models/:model', async (request: FastifyRequest<{ Params: { model: string }; Querystring: { providerId?: string } }>, reply: FastifyReply) => {
    try {
      const { model } = request.params;
      const { providerId } = request.query as any;
      const { client, provider } = await getOllamaClient(prisma, providerId);

      await client.delete({ model });

      // Trigger sync to update DB + invalidate ALL caches
      const syncService = getOllamaModelSyncService();
      await syncService.syncProvider(provider.id);
      const { invalidateAllModelCaches } = await import('../services/llm-providers/ProviderManager.js');
      await invalidateAllModelCaches(logger);

      logger.info({ model, provider: provider.name }, '[OllamaAdmin] Model deleted + synced + caches invalidated');
      return { success: true, message: `Model ${model} deleted successfully` };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to delete model');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/admin/ollama/models/:model/info
   * Get detailed model information
   */
  fastify.get('/ollama/models/:model/info', async (request: FastifyRequest<{ Params: { model: string }; Querystring: { providerId?: string } }>, reply: FastifyReply) => {
    try {
      const { model } = request.params;
      const { providerId } = request.query as any;
      const { client } = await getOllamaClient(prisma, providerId);

      const info = await client.show({ model });
      return {
        success: true,
        model,
        info: {
          license: info.license,
          modelfile: info.modelfile,
          parameters: info.parameters,
          template: info.template,
          details: info.details,
          modelInfo: info.model_info,
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to get model info');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/admin/ollama/generate
   * Test generate with a model on a host
   */
  fastify.post('/ollama/generate', async (request: FastifyRequest<{ Body: { model: string; prompt: string; providerId?: string } }>, reply: FastifyReply) => {
    try {
      const { model, prompt, providerId } = request.body;
      if (!model || !prompt) return reply.code(400).send({ success: false, error: 'Model and prompt are required' });

      const { client } = await getOllamaClient(prisma, providerId);
      const response = await client.generate({ model, prompt, stream: false });

      return {
        success: true,
        model,
        response: response.response,
        totalDuration: response.total_duration,
        loadDuration: response.load_duration,
        promptEvalCount: response.prompt_eval_count,
        evalCount: response.eval_count,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to generate');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/admin/ollama/embed
   * Test embeddings with a model on a host
   */
  fastify.post('/ollama/embed', async (request: FastifyRequest<{ Body: { model: string; input: string; providerId?: string } }>, reply: FastifyReply) => {
    try {
      const { model, input, providerId } = request.body;
      if (!model || !input) return reply.code(400).send({ success: false, error: 'Model and input are required' });

      const { client } = await getOllamaClient(prisma, providerId);
      const response = await client.embed({ model, input });

      return {
        success: true,
        model,
        dimensions: response.embeddings[0]?.length || 0,
        embeddings: response.embeddings,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, '[OllamaAdmin] Failed to embed');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });
}
