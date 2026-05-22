/**
 * A.11 — internal endpoint for cm to seed the correct CSI-S3 bucket after
 * PVC binds. The CSI-S3 provisioner creates a bucket named `pvc-<uuid>`
 * (the PV's volumeHandle), distinct from the api's `ws-<hash>` bucket.
 * This route accepts the real mounted bucket name and seeds it with the
 * per-user `.keep` marker.
 *
 * POST /api/internal/code-mode/seed-bucket-subdir
 *   headers  X-Internal-API-Key: <CODE_MANAGER_INTERNAL_KEY>
 *   body     { "bucket": "pvc-<uuid>", "userId": "<stable user id>" }
 *   200      { "ok": true }
 *   400      bad body (missing/invalid bucket or userId)
 *   401      missing / wrong internal key
 *   500      { "ok": false, "error": "<scrubbed>" }
 *
 * Auth pattern matches every other cm↔api internal route in this repo.
 * Best-effort at the service layer (UserStorageService.seedBucketSubdir
 * never throws), so 500 only fires when the factory itself throws.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserStorageService } from '../../services/UserStorageService.js';

export interface InternalBucketSeedRouteDeps {
  /**
   * The internal key callers must present in X-Internal-API-Key. Typically
   * `process.env.CODE_MANAGER_INTERNAL_KEY`. Empty server-side key rejects
   * ALL requests (fail closed).
   */
  internalKey: string;
  /**
   * Factory called once per HTTP call. Tests inject a mock; production uses
   * a factory that builds a live service from the current process env.
   */
  userStorageServiceFactory: () => Pick<UserStorageService, 'seedBucketSubdir'>;
}

interface SeedBucketBody {
  bucket?: unknown;
  userId?: unknown;
}

/**
 * Register the route on the given Fastify instance. Intentionally NOT a
 * plugin — codemode.plugin.ts calls this directly alongside its sibling
 * internal routes.
 */
export function registerInternalBucketSeedRoute(
  fastify: FastifyInstance,
  deps: InternalBucketSeedRouteDeps,
): void {
  const { internalKey, userStorageServiceFactory } = deps;

  fastify.post(
    '/api/internal/code-mode/seed-bucket-subdir',
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

      const body = (request.body ?? {}) as SeedBucketBody;
      const bucket = body.bucket;
      const userId = body.userId;

      if (typeof bucket !== 'string' || bucket.length === 0) {
        return reply.code(400).send({ error: 'bucket must be a non-empty string' });
      }
      if (typeof userId !== 'string' || userId.length === 0) {
        return reply.code(400).send({ error: 'userId must be a non-empty string' });
      }

      try {
        const service = userStorageServiceFactory();
        await service.seedBucketSubdir(bucket, userId);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        request.log.error(
          { err: (err as Error).message, bucket, userId },
          'seed-bucket-subdir failed',
        );
        return reply.code(500).send({ ok: false, error: 'seed_bucket_subdir_failed' });
      }
    },
  );
}
