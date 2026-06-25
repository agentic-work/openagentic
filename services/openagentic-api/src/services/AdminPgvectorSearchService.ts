/**
 * AdminPgvectorSearchService — pgvector backend for the Admin AI assistant RAG.
 *
 * Mirrors DocsPgvectorSearchService exactly, scoped to the admin-console page
 * corpus. The OSS-default deployment runs pgvector-only (MILVUS_ENABLED=false),
 * so the Milvus-backed AdminRAGService collection (admin_pages) never exists and
 * the admin assistant would get ZERO semantic context. This service stores the
 * admin page-corpus chunks in a self-managed Postgres halfvec table created
 * idempotently at boot, queried with cosine `<=>` distance — the same proven
 * pattern as DocsPgvectorSearchService / ToolPgvectorSearchService.
 *
 * Table: `admin_chunks`
 *   id            text PRIMARY KEY     — stable chunk id (the page slug)
 *   content       text                 — embedded page text (label + group + purpose)
 *   metadata      jsonb                — { slug, label, group, ... }
 *   manifest_hash text                 — fingerprint of the ingest that wrote it
 *   embedding     halfvec(<dim>)       — provider-dynamic dim (default 768)
 *   + HNSW cosine index on embedding
 *
 * Meta (single-row fingerprint) lives in `admin_chunks_meta` so the boot
 * reconcile can compare the corpus content hash against the last ingest —
 * exactly like `doc_chunks_meta` does for the docs path.
 *
 * Embedding generation uses the SAME UniversalEmbeddingService the docs path
 * uses — NO hardcoded model / dimension. See docs/rules/no-hardcoded-models.md.
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { capEmbeddingDimForHnsw } from './halfvecHnswCap.js';
import type { AdminSearchResult } from './AdminRAGService.js';

const TABLE = 'admin_chunks';
const META_TABLE = 'admin_chunks_meta';
const HNSW_INDEX = 'admin_chunks_embedding_hnsw_idx';

export interface AdminChunkInput {
  chunkId: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
}

export class AdminPgvectorSearchService {
  private prisma: PrismaClient;
  private embeddingService: UniversalEmbeddingService;
  private logger: Logger;
  private embeddingDim: number | null = null;
  private schemaReady = false;

  constructor(prisma: PrismaClient, embeddingService: UniversalEmbeddingService, logger: Logger) {
    this.prisma = prisma;
    this.embeddingService = embeddingService;
    this.logger = logger.child({ service: 'admin-pgvector-search' });
  }

  // -----------------------------------------------------------------------
  // Embedding dimension (provider-dynamic, mirrors DocsPgvector.getEmbeddingDim)
  // -----------------------------------------------------------------------

  private async getEmbeddingDim(): Promise<number> {
    if (this.embeddingDim !== null) return this.embeddingDim;
    const info = this.embeddingService.getInfo?.();
    if (info?.dimensions && info.dimensions > 0) {
      this.embeddingDim = capEmbeddingDimForHnsw(info.dimensions);
      return this.embeddingDim;
    }
    // Fall back to a tiny probe to discover dims from the live provider.
    try {
      const probe = await this.embeddingService.generateEmbedding('probe');
      const vec = Array.isArray(probe) ? probe : (probe as any)?.embedding;
      if (Array.isArray(vec) && vec.length > 0) {
        this.embeddingDim = capEmbeddingDimForHnsw(vec.length);
        return this.embeddingDim;
      }
    } catch (err: any) {
      this.logger.warn({ error: err?.message }, '[AdminPgvector] Failed to probe embedding dimensions');
    }
    // nomic-embed-text / most Ollama models = 768. Used only when no provider
    // info AND probe both fail; the column is created lazily either way.
    this.embeddingDim = 768;
    return this.embeddingDim;
  }

  // -----------------------------------------------------------------------
  // Schema (idempotent CREATE EXTENSION / TABLE / INDEX IF NOT EXISTS)
  // -----------------------------------------------------------------------

  async ensureSchema(): Promise<boolean> {
    if (this.schemaReady) return true;
    try {
      const dim = await this.getEmbeddingDim();

      await this.prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${TABLE}" (
          id            text PRIMARY KEY,
          content       text NOT NULL,
          metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
          manifest_hash text,
          embedding     halfvec(${dim})
        )
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
          id             integer PRIMARY KEY DEFAULT 1,
          manifest_hash  text NOT NULL,
          manifest_count integer NOT NULL DEFAULT 0,
          ingested_at    timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT "${META_TABLE}_singleton" CHECK (id = 1)
        )
      `);

      // HNSW cosine index — best-effort. Some CPU/pgvector combos SIGILL on
      // halfvec HNSW builds; DISABLE_VECTOR_INDEXES=true skips it and search
      // falls back to a seq scan (still correct, just slower).
      if (process.env.DISABLE_VECTOR_INDEXES !== 'true') {
        try {
          await this.prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "${HNSW_INDEX}"
            ON "${TABLE}" USING hnsw (embedding halfvec_cosine_ops)
            WITH (m = 16, ef_construction = 256)
          `);
        } catch (idxErr: any) {
          this.logger.warn(
            { error: idxErr?.message },
            '[AdminPgvector] HNSW index creation skipped (seq scan will be used)',
          );
        }
      }

      this.schemaReady = true;
      this.logger.info({ dim }, '[AdminPgvector] admin_chunks schema ready');
      return true;
    } catch (err: any) {
      this.logger.error({ error: err?.message }, '[AdminPgvector] Failed to ensure schema');
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Ingest helpers
  // -----------------------------------------------------------------------

  /** Remove all rows — called before a fresh ingest for idempotency. */
  async clear(): Promise<void> {
    try {
      await this.ensureSchema();
      await this.prisma.$executeRawUnsafe(`DELETE FROM "${TABLE}"`);
    } catch (err: any) {
      this.logger.warn({ error: err?.message }, '[AdminPgvector] Failed to clear admin_chunks');
    }
  }

  /**
   * Upsert a batch of pre-embedded chunks. Skips chunks with empty embeddings.
   * Uses ON CONFLICT so re-ingest of the same chunk id overwrites cleanly.
   */
  async upsertChunks(chunks: AdminChunkInput[], manifestHash: string | null): Promise<number> {
    await this.ensureSchema();
    let written = 0;
    for (const chunk of chunks) {
      if (!chunk.embedding || chunk.embedding.length === 0) continue;
      const vectorSql = `[${chunk.embedding.join(',')}]`;
      try {
        await this.prisma.$executeRaw`
          INSERT INTO "admin_chunks" (id, content, metadata, manifest_hash, embedding)
          VALUES (
            ${chunk.chunkId},
            ${chunk.content},
            ${JSON.stringify(chunk.metadata)}::jsonb,
            ${manifestHash},
            ${vectorSql}::halfvec
          )
          ON CONFLICT (id) DO UPDATE SET
            content = EXCLUDED.content,
            metadata = EXCLUDED.metadata,
            manifest_hash = EXCLUDED.manifest_hash,
            embedding = EXCLUDED.embedding
        `;
        written++;
      } catch (err: any) {
        this.logger.warn(
          { error: err?.message, chunkId: chunk.chunkId },
          '[AdminPgvector] Chunk upsert failed',
        );
      }
    }
    return written;
  }

  // -----------------------------------------------------------------------
  // Search (cosine distance, top-K)
  // -----------------------------------------------------------------------

  async search(query: string, topK: number = 5): Promise<AdminSearchResult[]> {
    try {
      const ready = await this.ensureSchema();
      if (!ready) return [];

      const embeddingResult = await this.embeddingService.generateEmbedding(query);
      const vec = Array.isArray(embeddingResult)
        ? (embeddingResult as number[])
        : (embeddingResult as any)?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) {
        this.logger.warn('[AdminPgvector] Failed to generate query embedding');
        return [];
      }

      const vectorSql = `[${vec.join(',')}]`;
      // Cosine distance `<=>` is 0 (identical) .. 2 (opposite). similarity = 1 - dist/2.
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ content: string; metadata: unknown; distance: number }>
      >(
        `SELECT content, metadata, embedding <=> '${vectorSql}'::halfvec AS distance
         FROM "${TABLE}"
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> '${vectorSql}'::halfvec
         LIMIT ${Math.max(1, Math.floor(topK))}`,
      );

      return rows
        .map((r) => {
          let meta: any = {};
          if (r.metadata && typeof r.metadata === 'object') {
            meta = r.metadata;
          } else if (typeof r.metadata === 'string') {
            try { meta = JSON.parse(r.metadata); } catch { /* ignore */ }
          }
          const distance = typeof r.distance === 'number' ? r.distance : 2;
          return {
            content: r.content || '',
            score: 1 - distance / 2,
            metadata: {
              slug: meta.slug || '',
              label: meta.label || '',
              group: meta.group || '',
              ...meta,
            },
          } as AdminSearchResult;
        })
        .filter((r) => r.content.length > 10);
    } catch (err: any) {
      this.logger.error({ error: err?.message }, '[AdminPgvector] Search failed (non-blocking)');
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Stats + meta fingerprint
  // -----------------------------------------------------------------------

  async countRows(): Promise<number> {
    try {
      await this.ensureSchema();
      const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM "${TABLE}"`,
      );
      return Number(rows[0]?.count || 0);
    } catch (err: any) {
      this.logger.warn({ error: err?.message }, '[AdminPgvector] Failed to count rows');
      return 0;
    }
  }

  async readMetaHash(): Promise<{
    manifestHash: string;
    ingestedAt: string;
    manifestCount: number;
  } | null> {
    try {
      await this.ensureSchema();
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ manifest_hash: string; ingested_at: Date | string; manifest_count: number }>
      >(`SELECT manifest_hash, ingested_at, manifest_count FROM "${META_TABLE}" WHERE id = 1 LIMIT 1`);
      const row = rows[0];
      if (!row) return null;
      return {
        manifestHash: String(row.manifest_hash || ''),
        ingestedAt:
          row.ingested_at instanceof Date
            ? row.ingested_at.toISOString()
            : String(row.ingested_at || ''),
        manifestCount: Number(row.manifest_count || 0),
      };
    } catch (err: any) {
      this.logger.warn({ error: err?.message }, '[AdminPgvector] Failed to read meta hash');
      return null;
    }
  }

  async writeMetaHash(params: { manifestHash: string; manifestCount: number }): Promise<boolean> {
    try {
      await this.ensureSchema();
      await this.prisma.$executeRaw`
        INSERT INTO "admin_chunks_meta" (id, manifest_hash, manifest_count, ingested_at)
        VALUES (1, ${params.manifestHash}, ${params.manifestCount}, now())
        ON CONFLICT (id) DO UPDATE SET
          manifest_hash = EXCLUDED.manifest_hash,
          manifest_count = EXCLUDED.manifest_count,
          ingested_at = now()
      `;
      this.logger.info(
        { manifestHash: params.manifestHash, manifestCount: params.manifestCount },
        '[AdminPgvector] Wrote admin_chunks_meta fingerprint',
      );
      return true;
    } catch (err: any) {
      this.logger.warn({ error: err?.message }, '[AdminPgvector] Failed to write meta hash');
      return false;
    }
  }
}
