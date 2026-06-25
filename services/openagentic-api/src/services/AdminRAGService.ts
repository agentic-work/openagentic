/**
 * Admin RAG Service
 *
 * Gives the Admin Console AI assistant (POST /api/admin/ai/ask) a REAL semantic
 * retrieval backend over the admin page-corpus, mirroring DocsRAGService.
 *
 * DUAL-BACKEND (identical routing to DocsRAGService):
 *   - Milvus collection `admin_pages` when Milvus is the configured backend
 *     (isAdminMilvusEnabled() — same gating as isDocsMilvusEnabled())
 *   - Postgres halfvec `admin_chunks` table on the OSS pgvector-only default
 *     (AdminPgvectorSearchService)
 *
 * Unlike docs (which fetch manifests over HTTP from the UI image), the admin
 * corpus is a LOCAL static array (routes/admin/ai/admin-page-corpus.ts). So the
 * "manifest hash" is a stable content hash of that array, and ingest builds
 * chunks directly from it — one chunk per admin page.
 *
 * Provides:
 *   - ingest()              — embed every page-corpus entry, upsert into backend
 *   - search()              — embed a query, return top-K relevant pages
 *   - getStats()            — admin monitoring helper (row count)
 *   - computeCorpusHash()   — stable fingerprint of the static corpus
 *   - readMetaHash()/writeMetaHash() — single-row ingest fingerprint
 *
 * Uses UniversalEmbeddingService for provider-agnostic embedding generation —
 * NO hardcoded model names or dimensions. See docs/rules/no-hardcoded-models.md.
 */

import { createHash } from 'crypto';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { Logger } from 'pino';
import { MilvusConnectionManager, getMilvusClient } from '../utils/MilvusConnectionManager.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { AdminPgvectorSearchService } from './AdminPgvectorSearchService.js';
import { prisma } from '../utils/prisma.js';
import { ADMIN_PAGE_CORPUS, type AdminPageEntry } from '../routes/admin/ai/admin-page-corpus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminSearchResult {
  content: string;
  score: number;
  metadata: {
    slug: string;
    label: string;
    group: string;
    [key: string]: unknown;
  };
}

interface AdminChunkRecord {
  chunk_id: string;
  slug: string;
  label: string;
  group: string;
  content: string;
  metadata: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTION_NAME = 'admin_pages';
const META_COLLECTION_NAME = 'admin_pages_meta';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: AdminRAGService | null = null;

export function getAdminRAGService(logger: Logger): AdminRAGService {
  if (!_instance) {
    _instance = new AdminRAGService(logger);
  }
  return _instance;
}

// ---------------------------------------------------------------------------
// Backend gating — mirror of isDocsMilvusEnabled() / server.ts isMilvusEnabled().
// True only when Milvus is the configured backend. When false (OSS pgvector
// default) the admin RAG path uses the Postgres halfvec `admin_chunks` table.
//   - MILVUS_ENABLED=false          → pgvector
//   - SKIP_TOOL_SEMANTIC_CACHE=true → pgvector
//   - MILVUS_HOST unset/empty       → pgvector
// ---------------------------------------------------------------------------

export function isAdminMilvusEnabled(): boolean {
  if (process.env.MILVUS_ENABLED === 'false') return false;
  if (process.env.SKIP_TOOL_SEMANTIC_CACHE === 'true') return false;
  if (!process.env.MILVUS_HOST || process.env.MILVUS_HOST.trim() === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AdminRAGService {
  private logger: Logger;
  private milvusManager: MilvusConnectionManager;
  private milvusClient: MilvusClient | null = null;
  private embeddingService: UniversalEmbeddingService;
  private embeddingDim: number | null = null;
  private collectionReady = false;
  private pgvector: AdminPgvectorSearchService | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
    this.milvusManager = new MilvusConnectionManager(logger);
    this.embeddingService = new UniversalEmbeddingService(logger);
  }

  /** True when Milvus is the active admin RAG backend; false → pgvector. */
  private useMilvus(): boolean {
    return isAdminMilvusEnabled();
  }

  /** True when an embedding provider is configured; false → fall back to static corpus. */
  embeddingsConfigured(): boolean {
    try {
      return this.embeddingService.isConfigured();
    } catch {
      return false;
    }
  }

  /** Lazily construct the pgvector backend (OSS default). */
  private getPgvector(): AdminPgvectorSearchService {
    if (!this.pgvector) {
      this.pgvector = new AdminPgvectorSearchService(prisma, this.embeddingService, this.logger);
    }
    return this.pgvector;
  }

  /** Lazily resolve embedding dimension from the configured provider. */
  private async getEmbeddingDim(): Promise<number> {
    if (this.embeddingDim !== null) return this.embeddingDim;
    const info = this.embeddingService.getInfo?.();
    if (info?.dimensions && info.dimensions > 0) {
      this.embeddingDim = info.dimensions;
      return this.embeddingDim;
    }
    try {
      const probe = await this.embeddingService.generateEmbedding('probe');
      const vec = Array.isArray(probe) ? probe : (probe as any).embedding;
      if (Array.isArray(vec) && vec.length > 0) {
        this.embeddingDim = vec.length;
        return this.embeddingDim;
      }
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AdminRAG] Failed to probe embedding dimensions');
    }
    throw new Error('[AdminRAG] Could not resolve embedding dimensions — UniversalEmbeddingService returned empty/invalid response');
  }

  // -----------------------------------------------------------------------
  // Corpus → chunks (one chunk per admin page)
  // -----------------------------------------------------------------------

  private buildChunks(corpus: AdminPageEntry[] = ADMIN_PAGE_CORPUS): AdminChunkRecord[] {
    return corpus.map((e) => {
      // The embedded text is the natural-language page description. Including
      // label + group + purpose makes a query like "where do I add a model"
      // land near "Models — The Model Registry … add via Model Garden".
      const content = `${e.label} (${e.group}) — ${e.purpose}`.substring(0, 3990);
      return {
        chunk_id: e.slug,
        slug: e.slug,
        label: e.label,
        group: e.group,
        content,
        metadata: JSON.stringify({
          slug: e.slug,
          label: e.label,
          group: e.group,
          purpose: e.purpose,
          ingestedAt: new Date().toISOString(),
        }).substring(0, 1990),
      };
    });
  }

  /**
   * Stable content hash of the static corpus. Drives idempotent reconcile —
   * re-ingest only fires when the corpus content actually changed (or the
   * backend is empty). Mirrors the docs manifestHash flow.
   */
  computeCorpusHash(corpus: AdminPageEntry[] = ADMIN_PAGE_CORPUS): string {
    const canonical = corpus
      .map((e) => `${e.slug}${e.label}${e.group}${e.purpose}`)
      .sort()
      .join('');
    return createHash('sha256').update(canonical).digest('hex');
  }

  corpusCount(corpus: AdminPageEntry[] = ADMIN_PAGE_CORPUS): number {
    return corpus.length;
  }

  // -----------------------------------------------------------------------
  // Connection helpers
  // -----------------------------------------------------------------------

  private async getClient(): Promise<MilvusClient | null> {
    if (this.milvusClient && this.milvusManager.isConnected()) {
      return this.milvusClient;
    }
    const globalClient: MilvusClient | undefined = getMilvusClient() ?? undefined;
    if (globalClient) {
      this.milvusClient = globalClient;
      return this.milvusClient;
    }
    try {
      this.milvusClient = await this.milvusManager.connect(3, 2000);
      return this.milvusClient;
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AdminRAG] Milvus not available');
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Collection management (Milvus path)
  // -----------------------------------------------------------------------

  private async ensureCollection(): Promise<boolean> {
    if (this.collectionReady) return true;

    const client = await this.getClient();
    if (!client) return false;

    try {
      const has = await client.hasCollection({ collection_name: COLLECTION_NAME });
      if (has.value) {
        this.collectionReady = true;
        return true;
      }

      const dim = await this.getEmbeddingDim();
      this.logger.info({ dim, collection: COLLECTION_NAME }, '[AdminRAG] Creating collection with dynamic dimension');

      await client.createCollection({
        collection_name: COLLECTION_NAME,
        fields: [
          { name: 'id', data_type: 'Int64', is_primary_key: true, autoID: true },
          { name: 'chunk_id', data_type: 'VarChar', max_length: 200 },
          { name: 'slug', data_type: 'VarChar', max_length: 200 },
          { name: 'label', data_type: 'VarChar', max_length: 200 },
          { name: 'group', data_type: 'VarChar', max_length: 100 },
          { name: 'content', data_type: 'VarChar', max_length: 4000 },
          { name: 'embedding', data_type: 'FloatVector', dim },
          { name: 'metadata', data_type: 'VarChar', max_length: 2000 },
        ],
      });

      await client.createIndex({
        collection_name: COLLECTION_NAME,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 128 },
      });

      await client.loadCollection({ collection_name: COLLECTION_NAME });
      this.collectionReady = true;
      this.logger.info('[AdminRAG] Created and loaded admin_pages collection');
      return true;
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[AdminRAG] Failed to ensure collection');
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Ingestion
  // -----------------------------------------------------------------------

  /**
   * Embed every admin page-corpus entry and upsert into the active backend.
   * Routes to Milvus (admin_pages) when Milvus is enabled, else to the Postgres
   * halfvec `admin_chunks` table (OSS default). Idempotent: clears old data
   * before inserting fresh.
   */
  async ingest(): Promise<{ chunksIngested: number }> {
    if (!this.useMilvus()) {
      return this.ingestPgvector();
    }
    return this.ingestMilvus();
  }

  private async ingestPgvector(): Promise<{ chunksIngested: number }> {
    const pg = this.getPgvector();
    const ready = await pg.ensureSchema();
    if (!ready) {
      this.logger.warn('[AdminRAG] pgvector schema unavailable — skipping ingestion');
      return { chunksIngested: 0 };
    }

    const allChunks = this.buildChunks();
    if (allChunks.length === 0) return { chunksIngested: 0 };

    const manifestHash = this.computeCorpusHash();

    await pg.clear();

    this.logger.info({ totalChunks: allChunks.length }, '[AdminRAG] Embedding & inserting admin corpus into pgvector');

    let ingested = 0;
    const BATCH_SIZE = 10;
    for (let batchStart = 0; batchStart < allChunks.length; batchStart += BATCH_SIZE) {
      const batch = allChunks.slice(batchStart, batchStart + BATCH_SIZE);
      const embeddings = await Promise.all(
        batch.map((chunk) => this.generateEmbedding(chunk.content)),
      );
      const inputs = batch.map((chunk, i) => {
        let metaObj: Record<string, unknown> = {};
        try { metaObj = JSON.parse(chunk.metadata); } catch { /* ignore */ }
        return {
          chunkId: chunk.chunk_id,
          content: chunk.content,
          metadata: metaObj,
          embedding: embeddings[i] || [],
        };
      }).filter((c) => c.embedding.length > 0);
      ingested += await pg.upsertChunks(inputs, manifestHash);
    }

    this.logger.info({ ingested, total: allChunks.length }, '[AdminRAG] pgvector ingestion complete');
    return { chunksIngested: ingested };
  }

  private async ingestMilvus(): Promise<{ chunksIngested: number }> {
    const client = await this.getClient();
    if (!client) {
      this.logger.warn('[AdminRAG] Milvus not available — skipping ingestion');
      return { chunksIngested: 0 };
    }

    const ready = await this.ensureCollection();
    if (!ready) return { chunksIngested: 0 };

    // Drop old data by dropping & recreating the collection.
    try {
      await client.dropCollection({ collection_name: COLLECTION_NAME });
      this.collectionReady = false;
      await this.ensureCollection();
      this.logger.info('[AdminRAG] Dropped and recreated collection for fresh ingestion');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AdminRAG] Error dropping collection — continuing');
    }

    const allChunks = this.buildChunks();
    if (allChunks.length === 0) return { chunksIngested: 0 };

    let ingested = 0;
    const BATCH_SIZE = 10;
    for (let batchStart = 0; batchStart < allChunks.length; batchStart += BATCH_SIZE) {
      const batch = allChunks.slice(batchStart, batchStart + BATCH_SIZE);
      const embeddings = await Promise.all(
        batch.map((chunk) => this.generateEmbedding(chunk.content)),
      );
      const insertData: any[] = [];
      for (let i = 0; i < batch.length; i++) {
        const emb = embeddings[i];
        if (!emb || emb.length === 0) {
          this.logger.warn({ chunkId: batch[i].chunk_id }, '[AdminRAG] Embedding failed — skipping chunk');
          continue;
        }
        insertData.push({
          chunk_id: batch[i].chunk_id,
          slug: batch[i].slug,
          label: batch[i].label,
          group: batch[i].group,
          content: batch[i].content,
          embedding: emb,
          metadata: batch[i].metadata,
        });
      }
      if (insertData.length > 0) {
        try {
          await client.insert({ collection_name: COLLECTION_NAME, data: insertData });
          ingested += insertData.length;
        } catch (err: any) {
          this.logger.warn({ error: err.message, batchStart }, '[AdminRAG] Batch insert failed');
        }
      }
    }

    try {
      await client.flush({ collection_names: [COLLECTION_NAME] });
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AdminRAG] Flush failed');
    }

    this.logger.info({ ingested, total: allChunks.length }, '[AdminRAG] Ingestion complete');
    return { chunksIngested: ingested };
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  /**
   * Embed the query and search the active admin RAG backend.
   * Returns empty results if the active backend is unavailable (caller then
   * falls back to the static corpus prompt block).
   */
  async search(query: string, topK: number = 5): Promise<AdminSearchResult[]> {
    if (!this.useMilvus()) {
      return this.getPgvector().search(query, topK);
    }

    const client = await this.getClient();
    if (!client) {
      this.logger.debug('[AdminRAG] Milvus not available — returning empty results');
      return [];
    }

    try {
      const hasCollection = await client.hasCollection({ collection_name: COLLECTION_NAME });
      if (!hasCollection.value) {
        this.logger.debug('[AdminRAG] admin_pages collection does not exist');
        return [];
      }

      try {
        await client.loadCollection({ collection_name: COLLECTION_NAME });
      } catch { /* already loaded */ }

      const queryEmbedding = await this.generateEmbedding(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        this.logger.warn('[AdminRAG] Failed to generate query embedding');
        return [];
      }

      const results = await client.search({
        collection_name: COLLECTION_NAME,
        data: [queryEmbedding],
        output_fields: ['content', 'metadata', 'slug', 'label', 'group'],
        limit: topK,
      });

      return (results.results || [])
        .map((r: any) => {
          let meta: any = {};
          try {
            meta = r.metadata ? JSON.parse(r.metadata) : {};
          } catch { /* ignore parse errors */ }

          return {
            content: r.content || '',
            score: r.score || 0,
            metadata: {
              slug: r.slug || meta.slug || '',
              label: r.label || meta.label || '',
              group: r.group || meta.group || '',
              ...meta,
            },
          };
        })
        .filter((r: AdminSearchResult) => r.content.length > 10);
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[AdminRAG] Search failed (non-blocking)');
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  async getStats(): Promise<{ exists: boolean; rowCount: number; loaded: boolean }> {
    if (!this.useMilvus()) {
      const rowCount = await this.getPgvector().countRows();
      return { exists: rowCount >= 0, rowCount, loaded: true };
    }

    const client = await this.getClient();
    if (!client) return { exists: false, rowCount: 0, loaded: false };

    try {
      const has = await client.hasCollection({ collection_name: COLLECTION_NAME });
      if (!has.value) return { exists: false, rowCount: 0, loaded: false };

      const stats = await client.getCollectionStatistics({ collection_name: COLLECTION_NAME });
      const rowCount = Number.parseInt(stats.data?.row_count || '0', 10);
      return { exists: true, rowCount, loaded: true };
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AdminRAG] Failed to get collection stats');
      return { exists: false, rowCount: 0, loaded: false };
    }
  }

  // -----------------------------------------------------------------------
  // Meta fingerprint (mirrors DocsRAGService.read/writeMilvusMetaHash)
  // -----------------------------------------------------------------------

  async readMetaHash(): Promise<{
    manifestHash: string;
    ingestedAt: string;
    manifestCount: number;
  } | null> {
    if (!this.useMilvus()) {
      return this.getPgvector().readMetaHash();
    }

    const client = await this.getClient();
    if (!client) return null;

    try {
      const has = await client.hasCollection({ collection_name: META_COLLECTION_NAME });
      if (!has.value) return null;

      try {
        await client.loadCollection({ collection_name: META_COLLECTION_NAME });
      } catch { /* already loaded */ }

      const queryResult = await client.query({
        collection_name: META_COLLECTION_NAME,
        filter: 'id >= 0',
        output_fields: ['manifest_hash', 'ingested_at', 'manifest_count'],
        limit: 1,
      });

      const row = (queryResult?.data || [])[0];
      if (!row) return null;

      return {
        manifestHash: String(row.manifest_hash || ''),
        ingestedAt: String(row.ingested_at || ''),
        manifestCount: Number(row.manifest_count || 0),
      };
    } catch (err: any) {
      this.logger.warn({ error: err?.message }, '[AdminRAG] Failed to read admin_pages_meta — treating as missing');
      return null;
    }
  }

  async writeMetaHash(params: { manifestHash: string; manifestCount: number }): Promise<boolean> {
    if (!this.useMilvus()) {
      return this.getPgvector().writeMetaHash(params);
    }

    const client = await this.getClient();
    if (!client) return false;

    try {
      const has = await client.hasCollection({ collection_name: META_COLLECTION_NAME });
      if (!has.value) {
        // Milvus requires at least one vector field per collection — a 2-D
        // dummy vector satisfies the schema for this effectively-scalar KV row.
        await client.createCollection({
          collection_name: META_COLLECTION_NAME,
          fields: [
            { name: 'id', data_type: 'Int64', is_primary_key: true, autoID: true },
            { name: 'manifest_hash', data_type: 'VarChar', max_length: 200 },
            { name: 'ingested_at', data_type: 'VarChar', max_length: 40 },
            { name: 'manifest_count', data_type: 'Int64' },
            { name: 'dummy_vec', data_type: 'FloatVector', dim: 2 },
          ],
        });
        await client.createIndex({
          collection_name: META_COLLECTION_NAME,
          field_name: 'dummy_vec',
          index_type: 'FLAT',
          metric_type: 'L2',
          params: {},
        });
        await client.loadCollection({ collection_name: META_COLLECTION_NAME });
        this.logger.info('[AdminRAG] Created admin_pages_meta collection');
      } else {
        try {
          await client.loadCollection({ collection_name: META_COLLECTION_NAME });
        } catch { /* already loaded */ }
        try {
          await client.deleteEntities({
            collection_name: META_COLLECTION_NAME,
            filter: 'id >= 0',
          });
        } catch (err: any) {
          this.logger.debug({ error: err?.message }, '[AdminRAG] deleteEntities on admin_pages_meta (non-fatal)');
        }
      }

      await client.insert({
        collection_name: META_COLLECTION_NAME,
        data: [
          {
            manifest_hash: params.manifestHash.substring(0, 200),
            ingested_at: new Date().toISOString(),
            manifest_count: params.manifestCount,
            dummy_vec: [0, 0],
          },
        ],
      });

      try {
        await client.flush({ collection_names: [META_COLLECTION_NAME] });
      } catch { /* best-effort */ }

      this.logger.info(
        { manifestHash: params.manifestHash, manifestCount: params.manifestCount },
        '[AdminRAG] Wrote admin_pages_meta fingerprint',
      );
      return true;
    } catch (err: any) {
      this.logger.warn({ error: err?.message }, '[AdminRAG] Failed to write admin_pages_meta');
      return false;
    }
  }

  /**
   * Idempotent boot reconcile: ingest the admin corpus only when the backend is
   * empty OR the corpus content hash changed since the last ingest. Mirrors
   * RAGInitService.reconcileDocsIngest but for the LOCAL static corpus (no HTTP
   * manifest fetch — the fingerprint is computed from ADMIN_PAGE_CORPUS).
   *
   * Fire-and-forget safe: any failure is swallowed and the route falls back to
   * the static corpus prompt block, so this is a no-op-on-failure on a bare box.
   */
  async reconcile(options: { force?: boolean } = {}): Promise<{
    action: 'reingested' | 'skipped' | 'first-ingest' | 'no-embeddings';
    manifestHash: string;
    rowsBefore: number;
    rowsAfter: number;
    reason: string;
  }> {
    const incomingHash = this.computeCorpusHash();
    const manifestCount = this.corpusCount();

    // No embedding provider → nothing to ingest; route falls back to static.
    if (!this.embeddingsConfigured()) {
      this.logger.info('[AdminRAG] No embedding provider configured — skipping ingest (route uses static corpus)');
      return { action: 'no-embeddings', manifestHash: incomingHash, rowsBefore: 0, rowsAfter: 0, reason: 'embeddings unavailable' };
    }

    const statsBefore = await this.getStats();
    const rowsBefore = typeof statsBefore?.rowCount === 'number' ? statsBefore.rowCount : 0;
    const force = options.force === true;

    if (rowsBefore === 0) {
      const result = await this.ingest();
      await this.writeMetaHash({ manifestHash: incomingHash, manifestCount });
      const statsAfter = await this.getStats();
      return {
        action: 'first-ingest',
        manifestHash: incomingHash,
        rowsBefore,
        rowsAfter: statsAfter?.rowCount || result.chunksIngested,
        reason: 'backend was empty',
      };
    }

    if (!force) {
      const stored = await this.readMetaHash();
      if (stored?.manifestHash === incomingHash) {
        this.logger.info({ manifestHash: incomingHash.substring(0, 16) }, '[AdminRAG] Corpus in-sync — skipping reingest');
        return { action: 'skipped', manifestHash: incomingHash, rowsBefore, rowsAfter: rowsBefore, reason: 'corpus hash unchanged' };
      }
    }

    const result = await this.ingest();
    await this.writeMetaHash({ manifestHash: incomingHash, manifestCount });
    const statsAfter = await this.getStats();
    return {
      action: 'reingested',
      manifestHash: incomingHash,
      rowsBefore,
      rowsAfter: statsAfter?.rowCount || result.chunksIngested,
      reason: force ? 'force=true' : 'corpus hash changed',
    };
  }

  // -----------------------------------------------------------------------
  // Embedding helper (hard timeout, mirrors DocsRAG)
  // -----------------------------------------------------------------------

  private async generateEmbedding(text: string): Promise<number[]> {
    const timeoutMs = Number(process.env.DOCS_RAG_EMBED_TIMEOUT_MS) || 4000;
    try {
      const embedPromise = this.embeddingService.generateEmbedding(text.substring(0, 4000));
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`embedding timeout after ${timeoutMs}ms`)), timeoutMs),
      );
      const result = await Promise.race([embedPromise, timeoutPromise]);
      const vec = Array.isArray(result) ? result : (result as any)?.embedding;
      return Array.isArray(vec) ? vec : [];
    } catch (err: any) {
      this.logger.warn({ error: err.message, timeoutMs }, '[AdminRAG] Embedding generation failed or timed out');
      return [];
    }
  }
}
