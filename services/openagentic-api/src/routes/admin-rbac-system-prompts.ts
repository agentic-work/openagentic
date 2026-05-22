/**
 * Admin RBAC System Prompts — CRUD endpoints for live-editable Layer-1
 * chatmode prompts.
 *
 * Mounted by `plugins/admin.plugin.ts` at `/api/admin/rbac-system-prompts`
 * behind the `adminMiddleware` preHandler (is_admin gate). Reads/writes
 * go through the singleton `RbacSystemPromptService` set on AppContext by
 * `startup/09-prompt-cache.ts`. Writes:
 *   1. INSERT version+1 + audit row in a transaction
 *   2. Bust local cache
 *   3. Publish redis `prompt:invalidate` so every replica re-reads
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-prompts-db-editable.md
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { RbacSystemPromptService, UserRole } from '../services/prompt/RbacSystemPromptService.js';

const ROLE_KEYS: ReadonlyArray<UserRole> = ['admin', 'member'];
const MAX_BODY_BYTES = 64 * 1024; // 64 KB cap — prompts longer than this are smelly

function isValidRole(role: string): role is UserRole {
  return (ROLE_KEYS as readonly string[]).includes(role);
}

function getService(req: FastifyRequest): RbacSystemPromptService | null {
  const svc = (req.server as any)?.app?.rbacSystemPromptService as
    | RbacSystemPromptService
    | undefined;
  return svc ?? null;
}

function getActorUserId(req: FastifyRequest): string | null {
  const user = (req as any).user;
  return user?.id ?? user?.sub ?? null;
}

export const adminRbacSystemPromptsRoutes: FastifyPluginAsync = async (fastify) => {
  /** List active rows for both roles + audit count summary. */
  fastify.get('/', async (request, reply) => {
    const svc = getService(request);
    if (!svc) {
      return reply.code(503).send({ error: 'rbacSystemPromptService unavailable' });
    }
    const rows = await Promise.all(
      ROLE_KEYS.map(async (role) => {
        try {
          const versions = await svc.listVersions(role);
          const active = versions.find((v) => v.is_active);
          return {
            role_key: role,
            active_version: active?.version ?? null,
            active_id: active?.id ?? null,
            active_updated_at: active?.updated_at ?? null,
            total_versions: versions.length,
            preview: active ? active.body.slice(0, 200) : null,
          };
        } catch {
          return {
            role_key: role,
            active_version: null,
            active_id: null,
            active_updated_at: null,
            total_versions: 0,
            preview: null,
            unseeded: true,
          };
        }
      }),
    );
    return reply.send({ roles: rows });
  });

  /** Get the active body for a role. */
  fastify.get<{ Params: { role: string } }>('/:role', async (request, reply) => {
    const { role } = request.params;
    if (!isValidRole(role)) {
      return reply.code(400).send({ error: `Invalid role '${role}'. Valid: admin, member.` });
    }
    const svc = getService(request);
    if (!svc) {
      return reply.code(503).send({ error: 'rbacSystemPromptService unavailable' });
    }
    try {
      const body = await svc.getActiveTemplate(role);
      return reply.send({ role_key: role, body });
    } catch (err: any) {
      if (/no active rbac_system_prompt/i.test(err?.message ?? '')) {
        return reply.code(404).send({ error: err.message });
      }
      return reply.code(500).send({ error: err?.message ?? 'lookup failed' });
    }
  });

  /** List all versions (history) for a role. */
  fastify.get<{ Params: { role: string } }>('/:role/versions', async (request, reply) => {
    const { role } = request.params;
    if (!isValidRole(role)) {
      return reply.code(400).send({ error: `Invalid role '${role}'.` });
    }
    const svc = getService(request);
    if (!svc) {
      return reply.code(503).send({ error: 'rbacSystemPromptService unavailable' });
    }
    const versions = await svc.listVersions(role);
    return reply.send({
      role_key: role,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        is_active: v.is_active,
        created_at: v.created_at,
        updated_at: v.updated_at,
        body_preview: v.body.slice(0, 200),
        body_chars: v.body.length,
      })),
    });
  });

  /** Save a new active version for a role (version+1, audit, redis publish). */
  fastify.post<{ Params: { role: string }; Body: { body: string; reason?: string } }>(
    '/:role',
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
      const { role } = request.params;
      if (!isValidRole(role)) {
        return reply.code(400).send({ error: `Invalid role '${role}'.` });
      }
      const { body, reason } = request.body;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        return reply.code(413).send({
          error: `Prompt body exceeds ${MAX_BODY_BYTES} bytes`,
        });
      }
      const svc = getService(request);
      if (!svc) {
        return reply.code(503).send({ error: 'rbacSystemPromptService unavailable' });
      }
      try {
        const created = await svc.setActiveTemplate(role, body, {
          actorUserId: getActorUserId(request),
          reason,
        });
        return reply.code(201).send({
          role_key: created.role_key,
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

  /** Roll back to a prior version. */
  fastify.post<{ Params: { role: string; version: string }; Body: { reason?: string } }>(
    '/:role/rollback/:version',
    async (request, reply) => {
      const { role, version } = request.params;
      if (!isValidRole(role)) {
        return reply.code(400).send({ error: `Invalid role '${role}'.` });
      }
      const targetVersion = Number.parseInt(version, 10);
      if (!Number.isFinite(targetVersion) || targetVersion < 1) {
        return reply.code(400).send({ error: `Invalid version '${version}'.` });
      }
      const svc = getService(request);
      if (!svc) {
        return reply.code(503).send({ error: 'rbacSystemPromptService unavailable' });
      }
      try {
        const restored = await svc.rollback(role, targetVersion, {
          actorUserId: getActorUserId(request),
          reason: request.body?.reason,
        });
        return reply.send({
          role_key: restored.role_key,
          version: restored.version,
          id: restored.id,
          is_active: restored.is_active,
        });
      } catch (err: any) {
        const status = /no rbac_system_prompt for/i.test(err?.message ?? '') ? 404 : 500;
        return reply.code(status).send({ error: err?.message ?? 'rollback failed' });
      }
    },
  );
};

export default adminRbacSystemPromptsRoutes;
