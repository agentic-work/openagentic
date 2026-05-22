/**
 * Admin Service Prompts — CRUD endpoints for live-editable named service prompts.
 *
 * Mounted by `plugins/admin.plugin.ts` at `/api/admin/service-prompts`
 * behind the `adminMiddleware` preHandler (is_admin gate). Reads/writes
 * go through the singleton `ServicePromptService` set on AppContext by
 * `startup/09-prompt-cache.ts`.
 *
 * Routes:
 *   GET  /                    list all active prompt keys
 *   GET  /:key                get the active body for a key
 *   POST /:key                save a new active version + redis publish
 *   GET  /:key/versions       version history for a key
 *
 * Sprint W — 2026-05-19
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ServicePromptService } from '../services/prompt/ServicePromptService.js';

const MAX_BODY_BYTES = 64 * 1024; // 64 KB cap

function getService(req: FastifyRequest): ServicePromptService | null {
  const svc = (req.server as any)?.app?.servicePromptService as ServicePromptService | undefined;
  return svc ?? null;
}

function getActorUserId(req: FastifyRequest): string | null {
  const user = (req as any).user;
  return user?.id ?? user?.sub ?? null;
}

export const adminServicePromptsRoutes: FastifyPluginAsync = async (fastify) => {
  /** List all active prompt keys with metadata. */
  fastify.get('/', async (request, reply) => {
    const svc = getService(request);
    if (!svc) {
      return reply.code(503).send({ error: 'servicePromptService unavailable' });
    }
    const keys = await svc.listKeys();
    return reply.send({ prompts: keys });
  });

  /** Get the active body for a key. */
  fastify.get<{ Params: { key: string } }>('/:key', async (request, reply) => {
    const { key } = request.params;
    const svc = getService(request);
    if (!svc) {
      return reply.code(503).send({ error: 'servicePromptService unavailable' });
    }
    try {
      const body = await svc.getPrompt(key);
      return reply.send({ prompt_key: key, body });
    } catch (err: any) {
      if (/no active service_prompt/i.test(err?.message ?? '')) {
        return reply.code(404).send({ error: err.message });
      }
      return reply.code(500).send({ error: err?.message ?? 'lookup failed' });
    }
  });

  /** Get version history for a key. */
  fastify.get<{ Params: { key: string } }>('/:key/versions', async (request, reply) => {
    const { key } = request.params;
    const svc = getService(request);
    if (!svc) {
      return reply.code(503).send({ error: 'servicePromptService unavailable' });
    }
    const versions = await svc.listVersions(key);
    return reply.send({
      prompt_key: key,
      versions: versions.map((v: any) => ({
        id: v.id,
        version: v.version,
        is_active: v.is_active,
        created_at: v.created_at,
        updated_at: v.updated_at,
        body_preview: typeof v.body === 'string' ? v.body.slice(0, 200) : '',
        body_chars: typeof v.body === 'string' ? v.body.length : 0,
      })),
    });
  });

  /** Roll back to a prior version. */
  fastify.post<{ Params: { key: string; version: string }; Body: { reason?: string } }>(
    '/:key/rollback/:version',
    async (request, reply) => {
      const { key, version } = request.params;
      const targetVersion = Number.parseInt(version, 10);
      if (!Number.isFinite(targetVersion) || targetVersion < 1) {
        return reply.code(400).send({ error: `Invalid version '${version}'` });
      }
      const svc = getService(request);
      if (!svc) {
        return reply.code(503).send({ error: 'servicePromptService unavailable' });
      }
      try {
        const restored = await svc.rollback(key, targetVersion, {
          actorUserId: getActorUserId(request),
          reason: request.body?.reason,
        });
        return reply.send({
          prompt_key: key,
          version: restored.version,
          id: restored.id,
          is_active: restored.is_active,
        });
      } catch (err: any) {
        const status = /No service_prompt for key/i.test(err?.message ?? '') ? 404 : 500;
        return reply.code(status).send({ error: err?.message ?? 'rollback failed' });
      }
    },
  );

  /** Save a new active version (version+1, cache bust, redis publish). */
  fastify.post<{ Params: { key: string }; Body: { body: string; reason?: string } }>(
    '/:key',
    {
      schema: {
        body: {
          type: 'object',
          required: ['body'],
          properties: {
            body: { type: 'string', minLength: 1 },
            reason: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { body, reason } = request.body;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        return reply.code(413).send({ error: `Prompt body exceeds ${MAX_BODY_BYTES} bytes` });
      }
      const svc = getService(request);
      if (!svc) {
        return reply.code(503).send({ error: 'servicePromptService unavailable' });
      }
      try {
        const created = await svc.setPrompt(key, body, {
          actorUserId: getActorUserId(request),
          reason,
        });
        return reply.code(201).send({
          prompt_key: key,
          version: created.version,
          id: created.id,
          is_active: created.is_active,
          created_at: created.created_at,
        });
      } catch (err: any) {
        return reply.code(500).send({ error: err?.message ?? 'save failed' });
      }
    },
  );
};

export default adminServicePromptsRoutes;
