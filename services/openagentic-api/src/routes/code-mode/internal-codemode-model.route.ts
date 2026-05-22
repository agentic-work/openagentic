/**
 * Phase I (2026-04-29) — internal endpoint for cm to fetch the live
 * default codemode model id at pod-spawn time.
 *
 * Route: GET /api/internal/codemode-default-model
 *   headers  X-Internal-API-Key: <CODE_MANAGER_INTERNAL_KEY>
 *   200      { "model": "anthropic.claude-sonnet-4-20250514" } or { "model": "" }
 *   401      missing / wrong internal key
 *   500      registry read failure (scrubbed — no Prisma stack leakage)
 *
 * Why this exists:
 *   The codemode-manager (cm) needs the registry-canonical default code
 *   model BEFORE it spawns the user's exec pod, so it can stamp
 *   OPENAGENTIC_BOOT_MODEL on the pod env. The existing admin endpoint
 *   `/api/admin/llm-providers/default-models` is gated by adminMiddleware
 *   (real admin bearer token only) — cm has the internal-key contract,
 *   not an admin user identity. This route is the cm-friendly sibling:
 *   same SoT (ModelConfigurationService.getDefaultCodeModel which reads
 *   admin.system_configuration.default_models.code), but auth via the
 *   X-Internal-API-Key header that every other cm↔api internal call uses
 *   (see internal-user-storage.route.ts for the canonical pattern).
 *
 * Empty model is a valid 200 response: it tells cm "registry has no
 * default configured, fall through to api-side smart routing on every
 * /v1/messages call." cm omits OPENAGENTIC_BOOT_MODEL on the pod env in
 * that case.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface InternalCodemodeModelRouteDeps {
  /**
   * The internal key callers must present in X-Internal-API-Key. Typically
   * `process.env.CODE_MANAGER_INTERNAL_KEY`. Empty server-side key rejects
   * ALL requests (fail closed) — cm MUST have the key set in-cluster.
   */
  internalKey: string;
  /**
   * Resolves the current registry-canonical code-default model id. Returns
   * empty string when registry has no default configured (cm fallback path).
   * Tests inject a stub; production wiring uses
   * `ModelConfigurationService.getDefaultCodeModel`.
   */
  resolveDefaultCodeModel: () => Promise<string>;
}

/**
 * Register the route on the given Fastify instance. Intentionally NOT a
 * plugin — codemode.plugin.ts orchestrator calls this directly in its
 * no-auth section so the route lives under `/api/internal/*` as a
 * sibling to /api/internal/code-mode/ensure-user-bucket.
 */
export function registerInternalCodemodeModelRoute(
  fastify: FastifyInstance,
  deps: InternalCodemodeModelRouteDeps,
): void {
  const { internalKey, resolveDefaultCodeModel } = deps;

  fastify.get(
    '/api/internal/codemode-default-model',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Fail-closed auth: empty server-side key rejects everything.
      if (!internalKey) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const provided =
        (request.headers['x-internal-api-key'] as string | undefined) ?? '';
      if (provided !== internalKey) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        const model = await resolveDefaultCodeModel();
        // Empty model is a valid 200 — it tells cm to omit
        // OPENAGENTIC_BOOT_MODEL and let the daemon smart-route per turn.
        return reply.code(200).send({ model: typeof model === 'string' ? model : '' });
      } catch (err) {
        // Registry read failed (DB down, schema drift, etc.). Log on the
        // api side; cm gets a generic 500 so its own fallback path
        // (empty OPENAGENTIC_BOOT_MODEL) kicks in. Never leak Prisma
        // stack frames, schema names, or env vars.
        request.log.error(
          { err: (err as Error).message },
          'codemode-default-model resolution failed',
        );
        return reply.code(500).send({ error: 'codemode_default_model_failed' });
      }
    },
  );
}
