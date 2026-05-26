/**
 * Internal route that cm (code-manager) calls in-cluster to provision a
 * per-user MinIO bucket + user + k8s Secret for CSI-S3-mounted workspaces.
 *
 * POST /api/internal/code-mode/ensure-user-bucket
 *   headers  X-Internal-API-Key: <CODE_MANAGER_INTERNAL_KEY>
 *   body     { "userId": "<stable user id>" }
 *   200      { "bucketName", "minioUser", "secretName" }
 *   400      bad body
 *   401      missing / wrong internal key
 *   500      provisioning failure (scrubbed — no MinIO/axios/stack leakage)
 *
 * Architectural note (Task 5):
 *   UserStorageService (Task 2, commit 6828c460) already owns all
 *   bucket/user/policy/secret logic. This route is a thin adapter so cm
 *   doesn't need a second implementation. The concrete axios+SigV4
 *   MinIO-admin ops and @kubernetes/client-node-backed Secret writer are
 *   both implemented here (Task 2 shipped stubs only).
 *
 * Auth pattern matches every other cm↔api internal call-site in this
 * repo: `X-Internal-API-Key` header must match
 * `process.env.CODE_MANAGER_INTERNAL_KEY`. See admin-code.ts:19+,
 * openagentic.ts:27+, relay-ws.handler.ts:107+ for the exact shape.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  UserBucketInfo,
  UserStorageService,
} from '../../services/UserStorageService.js';

export interface InternalUserStorageRouteDeps {
  /**
   * The internal key callers must present in X-Internal-API-Key. Typically
   * `process.env.CODE_MANAGER_INTERNAL_KEY`. If empty, the route rejects
   * ALL requests (fail closed) — cm MUST have the key set in-cluster.
   */
  internalKey: string;
  /**
   * Factory called once per HTTP call. Tests inject a mock that skips the
   * real minio-admin + k8s-secret-writer stack; production code uses
   * `defaultUserStorageServiceFactory()` below, which builds a live
   * service from the current process env.
   */
  userStorageServiceFactory: () => Pick<UserStorageService, 'ensureUserBucket'>;
}

interface EnsureUserBucketBody {
  userId?: unknown;
}

/**
 * Register the route on the given Fastify instance. Intentionally NOT
 * a plugin — the codemode.plugin.ts orchestrator calls this directly in
 * its no-auth section so the route lives under `/api/internal/*` as a
 * sibling to `/api/code/access-check` (the other in-cluster-only surface).
 */
export function registerInternalUserStorageRoute(
  fastify: FastifyInstance,
  deps: InternalUserStorageRouteDeps,
): void {
  const { internalKey, userStorageServiceFactory } = deps;

  fastify.post(
    '/api/internal/code-mode/ensure-user-bucket',
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

      const body = (request.body ?? {}) as EnsureUserBucketBody;
      const userId = body.userId;
      if (typeof userId !== 'string' || userId.length === 0) {
        return reply.code(400).send({ error: 'userId must be a non-empty string' });
      }

      try {
        const service = userStorageServiceFactory();
        const info: UserBucketInfo = await service.ensureUserBucket(userId);
        return reply.code(200).send({
          bucketName: info.bucketName,
          minioUser: info.minioUser,
          secretName: info.secretName,
        });
      } catch (err) {
        // Scrub the error — do NOT leak raw MinIO HTTP body, stack frames,
        // or internal file paths to the caller. cm gets a generic code;
        // operators get the detail in api logs.
        request.log.error(
          { err: (err as Error).message, userId },
          'ensure-user-bucket failed',
        );
        return reply.code(500).send({ error: 'ensure_user_bucket_failed' });
      }
    },
  );
}
