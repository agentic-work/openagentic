/**
 * Per-user CodeMode collections route.
 *
 * Surfaces the authenticated user's Milvus collection (a singleton per-user,
 * named `codemode_user_<userId>`) plus the indexed files in it. Pairs with
 * the Collections sidebar section in services/openagentic-ui.
 *
 *   GET /api/code-mode/collections
 *     200 { collections: CollectionListItem[] }
 *
 *   GET /api/code-mode/collections/:collectionId/files
 *     200 { files: CollectionFileItem[] }
 *     403 if the requested collection isn't owned by the authenticated user
 *     404 if the user has no collection yet
 *
 * Security model (cross-tenant isolation):
 *   - The route is mounted INSIDE the auth-gated /api/code subtree of
 *     codemode.plugin.ts (onRequest: authMiddleware). Every handler reads
 *     `request.user.id` and computes the canonical collection name from it.
 *     The :collectionId URL parameter is COMPARED against that canonical
 *     name; mismatches return 403. The Milvus service is NEVER queried with
 *     a userId derived from the URL — only the authenticated user's id.
 *
 * Implementation note:
 *   This file deliberately accepts a `service` interface rather than
 *   importing CodeModeMilvusService directly so tests can inject a fake
 *   without standing up Milvus. Production wiring lives in codemode.plugin.ts.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Public types — shared with UI via fetch JSON shape
// ---------------------------------------------------------------------------

export interface CollectionListItem {
  /** Canonical Milvus collection name, e.g. `codemode_user_<userId>`. */
  name: string;
  /** Owning user id (always === request.user.id). */
  userId: string;
  /** Total vector count (one row per indexed chunk). */
  vectorCount: number;
  /** Distinct file count derived from `file_path` field. */
  fileCount: number;
  /** active | inactive | error */
  status: 'active' | 'inactive' | 'error';
}

export interface CollectionFileItem {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  mime: string;
}

// ---------------------------------------------------------------------------
// Service interface — exact subset of CodeModeMilvusService consumed here
// ---------------------------------------------------------------------------

export interface CollectionsCodeModeService {
  /**
   * Returns the user's collection summary, or `null` if none has been created
   * yet. MUST never enumerate other users' collections — the contract is
   * "scoped strictly by `userId`".
   */
  getUserCollection(userId: string): Promise<CollectionListItem | null>;
  /** Lists indexed files for the given user's collection. */
  listUserFiles(userId: string): Promise<CollectionFileItem[]>;
  /** Returns the canonical Milvus collection name for a user. */
  getCollectionName(userId: string): string;
}

export interface CodeModeCollectionsRouteDeps {
  service: CollectionsCodeModeService;
}

// ---------------------------------------------------------------------------
// Register routes
// ---------------------------------------------------------------------------

export function registerCodeModeCollectionsRoute(
  fastify: FastifyInstance,
  deps: CodeModeCollectionsRouteDeps,
): void {
  const { service } = deps;

  fastify.get(
    '/api/code-mode/collections',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user?.id as string | undefined;
      if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      try {
        const collection = await service.getUserCollection(userId);
        const collections = collection ? [collection] : [];
        return reply.code(200).send({ collections });
      } catch (err) {
        request.log.error(
          { err: (err as Error).message, userId },
          'list_user_collections_failed',
        );
        return reply.code(500).send({ error: 'list_collections_failed' });
      }
    },
  );

  fastify.get<{ Params: { collectionId: string } }>(
    '/api/code-mode/collections/:collectionId/files',
    async (request: FastifyRequest<{ Params: { collectionId: string } }>, reply: FastifyReply) => {
      const userId = (request as any).user?.id as string | undefined;
      if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Authoritative name comes from the authenticated user — NEVER from the URL.
      const expected = service.getCollectionName(userId);
      const requested = request.params.collectionId;
      if (requested !== expected) {
        request.log.warn(
          { userId, requested, expected },
          'cross_tenant_collection_access_denied',
        );
        return reply.code(403).send({ error: 'Forbidden' });
      }

      try {
        const collection = await service.getUserCollection(userId);
        if (!collection) {
          return reply.code(404).send({ error: 'collection_not_found' });
        }
        const files = await service.listUserFiles(userId);
        return reply.code(200).send({ files });
      } catch (err) {
        request.log.error(
          { err: (err as Error).message, userId },
          'list_user_files_failed',
        );
        return reply.code(500).send({ error: 'list_files_failed' });
      }
    },
  );
}
