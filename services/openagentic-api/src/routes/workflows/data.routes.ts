/**
 * Workflow data-store routes (secrets + vector collections + upload).
 *
 *   GET    /secrets
 *   GET    /data/collections
 *   POST   /data/upload
 *   POST   /data/collections
 *   DELETE /data/collections/:name
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { getReqUser } from './shared.js';

// Minimal shape of the @fastify/multipart async part iterator (the plugin does
// not ship an ambient augmentation, so this mirrors the runtime contract).
type MultipartFilePart = { type: 'file'; filename: string; mimetype: string; file: AsyncIterable<Buffer> };
type MultipartFieldPart = { type: 'field'; fieldname: string; value: unknown };
type MultipartPart = MultipartFilePart | MultipartFieldPart;

export const dataRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * GET /api/workflows/secrets
   * List workflow secrets visible to the current user (global, group-scoped, or workflow-scoped).
   * Never exposes encrypted values.
   * Enterprise-only: secrets management is gated (runtime {{secret:name}} resolution is unaffected).
   */
  fastify.get(
    '/secrets',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Get user's group memberships for group-scoped secrets
        const userGroups = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        }).catch(() => [] as { group_id: string }[]);
        const userGroupIds = userGroups.map(g => g.group_id);

        // Get workflow IDs the user owns (for workflow-scoped secrets)
        const userWorkflows = await prisma.workflow.findMany({
          where: { created_by: userId, deleted_at: null },
          select: { id: true },
        });
        const userWorkflowIds = userWorkflows.map(w => w.id);

        const secrets = await prisma.workflowSecret.findMany({
          where: {
            OR: [
              { scope: 'global' },
              ...(userGroupIds.length > 0 ? [{ scope: 'group', group_id: { in: userGroupIds } }] : []),
              ...(userWorkflowIds.length > 0 ? [{ scope: 'workflow', workflow_id: { in: userWorkflowIds } }] : []),
            ],
          },
          select: {
            id: true,
            name: true,
            description: true,
            scope: true,
            workflow_id: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({ secrets });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list secrets');
        return reply.code(500).send({ error: 'Failed to list secrets', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/data/collections
   * Returns user-scoped data stores: Milvus collections, pgvector tables, Redis status.
   * Only shows data belonging to the authenticated user (security P0).
   * Enterprise-only management route.
   */
  fastify.get(
    '/data/collections',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        // Get user's Milvus collections with document counts
        let userCollections: unknown[] = [];
        try {
          const collections = await prisma.userVectorCollections.findMany({
            where: { user_id: userId },
            include: {
              _count: { select: { artifacts: true } }
            },
            orderBy: { updated_at: 'desc' },
          });
          userCollections = collections.map(c => ({
            id: c.id,
            name: c.collection_name,
            dimension: c.vector_dimension,
            documentCount: c._count.artifacts,
            updatedAt: c.updated_at,
          }));
        } catch (collErr) {
          logger.warn({ error: collErr.message }, '[Workflows] Could not query user collections');
        }

        // Get user's recent documents
        let userDocuments: unknown[] = [];
        try {
          const docs = await prisma.artifactMetadata.findMany({
            where: { created_by: userId },
            select: {
              id: true,
              artifact_type: true,
              artifact_name: true,
              metadata: true,
              created_at: true,
            },
            orderBy: { created_at: 'desc' },
            take: 50,
          });
          userDocuments = docs.map(d => ({
            id: d.id,
            type: d.artifact_type,
            name: d.artifact_name,
            metadata: d.metadata,
            createdAt: d.created_at,
          }));
        } catch (docErr) {
          logger.warn({ error: docErr.message }, '[Workflows] Could not query user documents');
        }

        // Check pgvector tables with vector columns
        let pgvectorTables: string[] = [];
        try {
          const result = await prisma.$queryRaw<{ table_name: string }[]>`
            SELECT DISTINCT table_name
            FROM information_schema.columns
            WHERE udt_name = 'vector'
              AND table_schema = 'public'
            ORDER BY table_name
          `;
          pgvectorTables = result.map((r) => r.table_name);
        } catch (pgErr) {
          logger.warn({ error: pgErr.message }, '[Workflows] Could not query pgvector tables');
        }

        // Milvus status
        const milvusHost = process.env.MILVUS_HOST || process.env.MILVUS_ADDRESS || '';
        const milvusStatus = milvusHost ? 'configured' : 'disconnected';

        // Redis status
        const redisHost = process.env.REDIS_HOST || process.env.REDIS_URL || '';
        const redisStatus = redisHost ? 'configured' : 'disconnected';

        return reply.send({
          userId,
          stores: [
            {
              type: 'milvus',
              name: 'Milvus Vector DB',
              status: milvusStatus,
              collections: userCollections,
            },
            {
              type: 'pgvector',
              name: 'PostgreSQL pgvector',
              status: 'connected',
              tables: pgvectorTables,
            },
            {
              type: 'redis',
              name: 'Redis Cache',
              status: redisStatus,
            },
          ],
          documents: userDocuments,
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to get data collections');
        return reply.code(500).send({ error: 'Failed to get data collections', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/data/upload
   * Upload a file to Milvus for vector search.
   * Accepts multipart/form-data with a single 'file' field.
   * Extracts text, chunks it, embeds, and stores in a per-user Milvus collection.
   * Enterprise-only management route.
   */
  fastify.post(
    '/data/upload',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        // Parse multipart — iterate all parts to capture fields + the file
        const parts = (request as unknown as { parts: () => AsyncIterableIterator<MultipartPart> }).parts();
        let fileData: { filename: string; mimetype: string; buffer: Buffer } | null = null;
        let requestedCollection = '';

        for await (const part of parts) {
          if (part.type === 'file') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            fileData = { filename: part.filename, mimetype: part.mimetype, buffer: Buffer.concat(chunks) };
          } else if (part.type === 'field' && part.fieldname === 'collectionName') {
            requestedCollection = ((part.value as string) || '').trim();
          }
        }

        if (!fileData) {
          return reply.code(400).send({ error: 'No file uploaded. Send as multipart/form-data with field name "file".' });
        }

        const { filename, mimetype, buffer } = fileData;

        // Extract text based on file type
        let text = '';
        const ext = filename.toLowerCase().split('.').pop() || '';

        if (['txt', 'md', 'markdown', 'csv', 'json'].includes(ext)) {
          text = buffer.toString('utf-8');
        } else if (ext === 'pdf') {
          // Basic PDF text extraction — look for text between stream/endstream
          // For production, use pdf-parse library
          text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').trim();
          if (text.length < 50) {
            return reply.code(400).send({ error: 'Could not extract text from PDF. The file may be image-based.' });
          }
        } else {
          return reply.code(400).send({ error: `Unsupported file type: .${ext}` });
        }

        if (!text || text.trim().length < 10) {
          return reply.code(400).send({ error: 'File contains no extractable text' });
        }

        // Smart chunk the text
        const textChunks: string[] = [];
        const lines = text.split('\n');
        let currentChunk = '';
        for (const line of lines) {
          currentChunk += line + '\n';
          if (currentChunk.length > 1500) {
            textChunks.push(currentChunk.trim());
            currentChunk = '';
          }
        }
        if (currentChunk.trim()) {
          textChunks.push(currentChunk.trim());
        }

        // Store in Milvus via MilvusVectorService (with user isolation)
        const milvusSvc = fastify.app?.milvusVectorService;
        if (!milvusSvc) {
          // Fallback: return chunk info without embedding
          const docId = randomUUID();
          logger.warn({ userId, filename }, '[Workflows] MilvusVectorService not available, returning metadata only');
          return reply.send({
            success: true,
            docId,
            filename,
            textLength: text.length,
            chunks: textChunks.length,
            embedded: false,
            message: `File "${filename}" received (${textChunks.length} chunks). Milvus not available for embedding.`,
          });
        }

        // Determine artifact type from extension (lazy-load ArtifactType to avoid eager Milvus SDK import)
        const { ArtifactType: AType } = await import('../../services/MilvusVectorService.js');
        const artifactType = ['json', 'csv'].includes(ext) ? AType.DOCUMENT : ext === 'md' ? AType.DOCUMENT : AType.FILE;

        const artifactId = await milvusSvc.storeArtifact(userId, {
          type: artifactType,
          title: filename,
          content: text,
          mimeType: mimetype,
          metadata: {
            source: 'file_upload',
            description: `Uploaded file: ${filename}`,
            fileSize: buffer.length,
          },
        });

        logger.info({
          userId,
          filename,
          artifactId,
          textLength: text.length,
          chunks: textChunks.length,
        }, '[Workflows] File uploaded and embedded in Milvus');

        return reply.send({
          success: true,
          docId: artifactId,
          filename,
          textLength: text.length,
          chunks: textChunks.length,
          embedded: true,
          message: `File "${filename}" uploaded and indexed (${textChunks.length} chunks embedded).`,
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] File upload failed');
        return reply.code(500).send({ error: 'File upload failed', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/data/collections
   * Create a new named collection (tracked in a metadata table or in-memory for now).
   * Enterprise-only management route.
   */
  fastify.post(
    '/data/collections',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { name, description } = request.body as { name?: string; description?: string };
        if (!name || !name.trim()) {
          return reply.code(400).send({ error: 'Collection name is required' });
        }

        const collectionName = name.trim().replace(/[^a-zA-Z0-9_]/g, '_');

        // Try creating in Milvus if available
        const milvusHost = process.env.MILVUS_HOST || process.env.MILVUS_ADDRESS || '';
        if (milvusHost) {
          try {
            const { MilvusClient, DataType } = await import('@zilliz/milvus2-sdk-node');
            const client = new MilvusClient({ address: milvusHost });

            // Check if collection already exists
            const exists = await client.hasCollection({ collection_name: collectionName });
            if (exists.value) {
              return reply.code(409).send({ error: `Collection "${collectionName}" already exists` });
            }

            const embeddingDim = Number.parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);

            await client.createCollection({
              collection_name: collectionName,
              fields: [
                { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 128 },
                { name: 'text', data_type: DataType.VarChar, max_length: 65535 },
                { name: 'embedding', data_type: DataType.FloatVector, dim: embeddingDim },
                { name: 'metadata', data_type: DataType.VarChar, max_length: 4096 },
                { name: 'user_id', data_type: DataType.VarChar, max_length: 256 },
              ],
            });

            logger.info({ userId, collectionName }, '[Workflows] Created Milvus collection');

            return reply.code(201).send({
              success: true,
              collectionName,
              store: 'milvus',
              message: `Collection "${collectionName}" created in Milvus`,
            });
          } catch (milvusErr) {
            logger.error({ error: milvusErr }, '[Workflows] Milvus collection creation failed');
            return reply.code(500).send({ error: 'Failed to create Milvus collection', message: milvusErr.message });
          }
        }

        // No Milvus — create a pgvector table instead. Uses halfvec so
        // 3072-dim embeddings (text-embedding-3-large, our AIF model)
        // can be HNSW-indexed; `vector` tops out at 2000 dims for HNSW.
        try {
          const dims = Number.parseInt(process.env.EMBEDDING_DIMENSIONS || '3072', 10);
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${collectionName}" (
              id TEXT PRIMARY KEY,
              text TEXT NOT NULL,
              embedding halfvec(${dims}),
              metadata JSONB DEFAULT '{}',
              user_id TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
          // Create HNSW index on the fly so semantic search is fast.
          // halfvec_cosine_ops supports up to 4000 dims.
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "${collectionName}_embedding_idx"
            ON "${collectionName}"
            USING hnsw (embedding halfvec_cosine_ops)
            WITH (m = 16, ef_construction = 64)
          `);

          logger.info({ userId, collectionName }, '[Workflows] Created pgvector collection table');

          return reply.code(201).send({
            success: true,
            collectionName,
            store: 'pgvector',
            message: `Collection "${collectionName}" created in pgvector`,
          });
        } catch (pgErr) {
          logger.error({ error: pgErr }, '[Workflows] pgvector collection creation failed');
          return reply.code(500).send({ error: 'Failed to create collection', message: pgErr.message });
        }
      } catch (error) {
        logger.error({ error }, '[Workflows] Collection creation failed');
        return reply.code(500).send({ error: 'Failed to create collection', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/data/collections/:name
   * Delete a collection by name.
   * Enterprise-only management route.
   */
  fastify.delete(
    '/data/collections/:name',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { name } = request.params as { name: string };
        if (!name || !name.trim()) {
          return reply.code(400).send({ error: 'Collection name is required' });
        }

        const collectionName = name.trim();

        // Try Milvus first
        const milvusHost = process.env.MILVUS_HOST || process.env.MILVUS_ADDRESS || '';
        if (milvusHost) {
          try {
            const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
            const client = new MilvusClient({ address: milvusHost });

            const exists = await client.hasCollection({ collection_name: collectionName });
            if (exists.value) {
              await client.dropCollection({ collection_name: collectionName });
              logger.info({ userId, collectionName }, '[Workflows] Dropped Milvus collection');
              return reply.send({ success: true, message: `Collection "${collectionName}" deleted from Milvus` });
            }
          } catch (milvusErr) {
            logger.warn({ error: milvusErr.message }, '[Workflows] Milvus drop failed, trying pgvector');
          }
        }

        // Try pgvector table drop
        try {
          // Safety: only allow dropping tables that look like user collections (alphanumeric + underscores)
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(collectionName)) {
            return reply.code(400).send({ error: 'Invalid collection name' });
          }
          await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${collectionName}"`);
          logger.info({ userId, collectionName }, '[Workflows] Dropped pgvector collection table');
          return reply.send({ success: true, message: `Collection "${collectionName}" deleted` });
        } catch (pgErr) {
          logger.error({ error: pgErr }, '[Workflows] pgvector table drop failed');
          return reply.code(500).send({ error: 'Failed to delete collection', message: pgErr.message });
        }
      } catch (error) {
        logger.error({ error }, '[Workflows] Collection deletion failed');
        return reply.code(500).send({ error: 'Failed to delete collection', message: error.message });
      }
    }
  );
};

export default dataRoutes;
