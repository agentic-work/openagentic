/**
 * Docs RAG Service
 *
 * Manages a Milvus vector collection (`platform_docs`) containing all
 * OpenAgentic documentation content.  Provides:
 *   - ingestDocs()       — fetch manifests from UI service, chunk, embed, upsert
 *   - search()           — embed a query and return top-K relevant chunks
 *   - getCollectionStats() — admin monitoring helper
 *
 * Uses UniversalEmbeddingService for provider-agnostic embedding generation
 * (Azure OpenAI, Bedrock, Vertex, Ollama, etc.) — NO hardcoded model names
 * or dimensions. See docs/rules/no-hardcoded-models.md.
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { Logger } from 'pino';
import { MilvusConnectionManager } from '../utils/MilvusConnectionManager.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocsSearchResult {
  content: string;
  score: number;
  metadata: {
    domain: string;
    section: string;
    title: string;
    [key: string]: unknown;
  };
}

interface DocSection {
  id: string;
  title: string;
  description?: string;
  content?: string;
  keywords?: string[];
  adminOnly?: boolean;
  items?: Array<{
    name: string;
    description?: string;
    type?: string;
    properties?: Record<string, unknown>;
  }>;
}

interface DocManifest {
  domain: string;
  title: string;
  description?: string;
  sections: DocSection[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTION_NAME = 'platform_docs';
const FEEDBACK_COLLECTION = 'docs_feedback';
// EMBEDDING_DIM removed 2026-04-11 — collection dim is now read from the
// active embedding provider at create time. See docs/rules/no-hardcoded-models.md.
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
// Use public ingress URL — internal service blocked by NetworkPolicy
const UI_DOCS_BASE_URL = process.env.DOCS_MANIFEST_URL || 'https://chat-dev.openagentic.io/docs/generated';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: DocsRAGService | null = null;

export function getDocsRAGService(logger: Logger): DocsRAGService {
  if (!_instance) {
    _instance = new DocsRAGService(logger);
  }
  return _instance;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DocsRAGService {
  private logger: Logger;
  private milvusManager: MilvusConnectionManager;
  private milvusClient: MilvusClient | null = null;
  private embeddingService: UniversalEmbeddingService;
  private embeddingDim: number | null = null;  // resolved lazily from service info
  private collectionReady = false;

  constructor(logger: Logger) {
    this.logger = logger;
    this.milvusManager = new MilvusConnectionManager(logger);
    // UniversalEmbeddingService auto-detects provider from env/DB config —
    // no hardcoded model or dimension. Throws loud at construction if
    // no embedding provider is configured.
    this.embeddingService = new UniversalEmbeddingService(logger);
  }

  /**
   * Lazily resolve embedding dimension from the configured provider.
   * Used at collection-create time so the Milvus schema matches whatever
   * the active embedding model actually produces.
   */
  private async getEmbeddingDim(): Promise<number> {
    if (this.embeddingDim !== null) return this.embeddingDim;
    const info = this.embeddingService.getInfo?.();
    if (info?.dimensions && info.dimensions > 0) {
      this.embeddingDim = info.dimensions;
      return this.embeddingDim;
    }
    // Fall back to generating a tiny probe embedding to discover dims
    try {
      const probe = await this.embeddingService.generateEmbedding('probe');
      const vec = Array.isArray(probe) ? probe : (probe as any).embedding;
      if (Array.isArray(vec) && vec.length > 0) {
        this.embeddingDim = vec.length;
        return this.embeddingDim;
      }
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[DocsRAG] Failed to probe embedding dimensions');
    }
    throw new Error('[DocsRAG] Could not resolve embedding dimensions — UniversalEmbeddingService returned empty/invalid response');
  }

  // -----------------------------------------------------------------------
  // Connection helpers
  // -----------------------------------------------------------------------

  private async getClient(): Promise<MilvusClient | null> {
    // Reuse existing client if still connected
    if (this.milvusClient && this.milvusManager.isConnected()) {
      return this.milvusClient;
    }

    // Try the global client first (set by server startup)
    const globalClient: MilvusClient | undefined = (global as any).milvusClient || (global as any).milvus;
    if (globalClient) {
      this.milvusClient = globalClient;
      return this.milvusClient;
    }

    // Fall back to creating our own connection via MilvusConnectionManager
    try {
      this.milvusClient = await this.milvusManager.connect(3, 2000);
      return this.milvusClient;
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[DocsRAG] Milvus not available');
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Collection management
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
      this.logger.info({ dim, collection: COLLECTION_NAME }, '[DocsRAG] Creating collection with dynamic dimension');

      await client.createCollection({
        collection_name: COLLECTION_NAME,
        fields: [
          { name: 'id', data_type: 'Int64', is_primary_key: true, autoID: true },
          { name: 'chunk_id', data_type: 'VarChar', max_length: 200 },
          { name: 'domain', data_type: 'VarChar', max_length: 100 },
          { name: 'section', data_type: 'VarChar', max_length: 200 },
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
      this.logger.info('[DocsRAG] Created and loaded platform_docs collection');
      return true;
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[DocsRAG] Failed to ensure collection');
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Ingestion
  // -----------------------------------------------------------------------

  /**
   * Fetch all doc manifests from the UI service, chunk the content,
   * embed each chunk, and upsert into the platform_docs collection.
   *
   * Idempotent: drops old data before inserting new.
   */
  async ingestDocs(): Promise<{ chunksIngested: number }> {
    const client = await this.getClient();
    if (!client) {
      this.logger.warn('[DocsRAG] Milvus not available — skipping ingestion');
      return { chunksIngested: 0 };
    }

    // Ensure collection exists
    const ready = await this.ensureCollection();
    if (!ready) return { chunksIngested: 0 };

    // Drop old data by dropping & recreating the collection
    try {
      await client.dropCollection({ collection_name: COLLECTION_NAME });
      this.collectionReady = false;
      await this.ensureCollection();
      this.logger.info('[DocsRAG] Dropped and recreated collection for fresh ingestion');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[DocsRAG] Error dropping collection — continuing');
    }

    // Fetch manifests
    const manifests = await this.fetchManifests();
    if (manifests.length === 0) {
      this.logger.warn('[DocsRAG] No manifests found — nothing to ingest');
      return { chunksIngested: 0 };
    }

    this.logger.info({ manifestCount: manifests.length }, '[DocsRAG] Fetched manifests, starting chunking');

    // Build chunks from all manifests
    const allChunks: Array<{
      chunk_id: string;
      domain: string;
      section: string;
      content: string;
      metadata: string;
    }> = [];

    for (const manifest of manifests) {
      const domainName = manifest.domain || 'unknown';
      const domainTitle = manifest.title || domainName;

      for (const sec of manifest.sections || []) {
        // Build full text for the section
        const textParts: string[] = [];
        textParts.push(`# ${domainTitle} — ${sec.title}`);
        if (sec.description) textParts.push(sec.description);
        if (sec.content) textParts.push(sec.content);

        if (sec.items && sec.items.length > 0) {
          for (const item of sec.items) {
            let itemLine = `- **${item.name}**`;
            if (item.description) itemLine += `: ${item.description}`;
            if (item.properties) {
              const propStr = Object.entries(item.properties)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ');
              itemLine += ` (${propStr})`;
            }
            textParts.push(itemLine);
          }
        }

        const sectionText = textParts.join('\n');
        const chunks = this.chunkText(sectionText, CHUNK_SIZE, CHUNK_OVERLAP);

        for (let i = 0; i < chunks.length; i++) {
          allChunks.push({
            chunk_id: `${domainName}/${sec.id}/${i}`,
            domain: domainName.substring(0, 100),
            section: sec.title.substring(0, 200),
            content: chunks[i].substring(0, 3990),
            metadata: JSON.stringify({
              domain: domainName,
              section: sec.id,
              title: sec.title,
              domainTitle,
              keywords: sec.keywords || [],
              adminOnly: sec.adminOnly || false,
              chunkIndex: i,
              totalChunks: chunks.length,
              ingestedAt: new Date().toISOString(),
            }).substring(0, 1990),
          });
        }
      }
    }

    this.logger.info({ totalChunks: allChunks.length }, '[DocsRAG] Chunking complete, starting embedding & insertion');

    // Embed and insert in batches
    let ingested = 0;
    const BATCH_SIZE = 10;

    for (let batchStart = 0; batchStart < allChunks.length; batchStart += BATCH_SIZE) {
      const batch = allChunks.slice(batchStart, batchStart + BATCH_SIZE);

      // Generate embeddings for the batch
      const embeddings = await Promise.all(
        batch.map((chunk) => this.generateEmbedding(chunk.content)),
      );

      // Build insert data (skip chunks with failed embeddings)
      const insertData: any[] = [];
      for (let i = 0; i < batch.length; i++) {
        const emb = embeddings[i];
        if (!emb || emb.length === 0) {
          this.logger.warn({ chunkId: batch[i].chunk_id }, '[DocsRAG] Embedding failed — skipping chunk');
          continue;
        }
        insertData.push({
          chunk_id: batch[i].chunk_id,
          domain: batch[i].domain,
          section: batch[i].section,
          content: batch[i].content,
          embedding: emb,
          metadata: batch[i].metadata,
        });
      }

      if (insertData.length > 0) {
        try {
          await client.insert({
            collection_name: COLLECTION_NAME,
            data: insertData,
          });
          ingested += insertData.length;
        } catch (err: any) {
          this.logger.warn({ error: err.message, batchStart }, '[DocsRAG] Batch insert failed');
        }
      }
    }

    // Flush to make data searchable
    try {
      await client.flush({ collection_names: [COLLECTION_NAME] });
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[DocsRAG] Flush failed');
    }

    this.logger.info({ ingested, total: allChunks.length }, '[DocsRAG] Ingestion complete');
    return { chunksIngested: ingested };
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  /**
   * Embed the query and search the platform_docs collection.
   * Returns empty results if Milvus is unavailable.
   */
  async search(query: string, topK: number = 5): Promise<DocsSearchResult[]> {
    const client = await this.getClient();
    if (!client) {
      this.logger.debug('[DocsRAG] Milvus not available — returning empty results');
      return [];
    }

    try {
      const hasCollection = await client.hasCollection({ collection_name: COLLECTION_NAME });
      if (!hasCollection.value) {
        this.logger.debug('[DocsRAG] platform_docs collection does not exist');
        return [];
      }

      // Ensure loaded
      try {
        await client.loadCollection({ collection_name: COLLECTION_NAME });
      } catch { /* already loaded */ }

      const queryEmbedding = await this.generateEmbedding(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        this.logger.warn('[DocsRAG] Failed to generate query embedding');
        return [];
      }

      const results = await client.search({
        collection_name: COLLECTION_NAME,
        data: [queryEmbedding],
        output_fields: ['content', 'metadata', 'domain', 'section'],
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
              domain: r.domain || meta.domain || '',
              section: meta.section || r.section || '',
              title: meta.title || r.section || '',
              ...meta,
            },
          };
        })
        .filter((r: DocsSearchResult) => r.content.length > 20);
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[DocsRAG] Search failed (non-blocking)');
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  async getCollectionStats(): Promise<{
    exists: boolean;
    rowCount: number;
    loaded: boolean;
  }> {
    const client = await this.getClient();
    if (!client) return { exists: false, rowCount: 0, loaded: false };

    try {
      const has = await client.hasCollection({ collection_name: COLLECTION_NAME });
      if (!has.value) return { exists: false, rowCount: 0, loaded: false };

      const stats = await client.getCollectionStatistics({ collection_name: COLLECTION_NAME });
      const rowCount = parseInt(stats.data?.row_count || '0', 10);

      return { exists: true, rowCount, loaded: true };
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[DocsRAG] Failed to get collection stats');
      return { exists: false, rowCount: 0, loaded: false };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async fetchManifests(): Promise<DocManifest[]> {
    try {
      const indexRes = await fetch(`${UI_DOCS_BASE_URL}/index.json`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!indexRes.ok) {
        this.logger.warn({ status: indexRes.status }, '[DocsRAG] Failed to fetch docs index');
        return [];
      }

      const index = (await indexRes.json()) as { manifests?: Array<{ file: string }> };
      const files = (index.manifests || []).map((m) => m.file);

      const manifests: DocManifest[] = [];
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const res = await fetch(`${UI_DOCS_BASE_URL}/${file}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) return (await res.json()) as DocManifest;
          return null;
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          manifests.push(result.value);
        }
      }

      return manifests;
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[DocsRAG] Failed to fetch manifests');
      return [];
    }
  }

  /**
   * Generate embedding via UniversalEmbeddingService.
   *
   * No hardcoded model, no hardcoded endpoint. Provider is resolved from
   * DB (set by server.ts LLMProviderSeeder) or env vars. Works with
   * Azure OpenAI / Bedrock / Vertex / Ollama / OpenAI-compatible.
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingService.generateEmbedding(text.substring(0, 4000));
      const vec = Array.isArray(result) ? result : (result as any)?.embedding;
      return Array.isArray(vec) ? vec : [];
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[DocsRAG] Embedding generation failed');
      return [];
    }
  }

  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    // Split by headings first
    const sections = text.split(/(?=^#{1,3}\s)/m);
    let currentChunk = '';

    for (const section of sections) {
      if (currentChunk.length + section.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Keep overlap from end of previous chunk
        currentChunk = currentChunk.slice(-overlap) + section;
      } else {
        currentChunk += section;
      }
    }

    if (currentChunk.trim().length > 50) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text.substring(0, chunkSize)];
  }

  // =========================================================================
  // FEEDBACK COLLECTION — user feedback on docs assistant answers
  // =========================================================================

  /**
   * Ensure the docs_feedback collection exists in Milvus.
   */
  async ensureFeedbackCollection(): Promise<void> {
    const client = await this.getClient();
    if (!client) return;

    try {
      const has = await client.hasCollection({ collection_name: FEEDBACK_COLLECTION });
      if (has.value) return;

      const dim = await this.getEmbeddingDim();

      await client.createCollection({
        collection_name: FEEDBACK_COLLECTION,
        fields: [
          { name: 'id', data_type: 5 /* Int64 */, is_primary_key: true, autoID: true },
          { name: 'question', data_type: 21 /* VarChar */, max_length: 2000 },
          { name: 'answer', data_type: 21 /* VarChar */, max_length: 4000 },
          { name: 'feedback', data_type: 21 /* VarChar */, max_length: 500 },
          { name: 'rating', data_type: 5 /* Int64 */ },
          { name: 'user_id', data_type: 21 /* VarChar */, max_length: 200 },
          { name: 'embedding', data_type: 101 /* FloatVector */, dim },
          { name: 'metadata', data_type: 21 /* VarChar */, max_length: 1000 },
        ],
      });

      await client.createIndex({
        collection_name: FEEDBACK_COLLECTION,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 64 },
      });

      await client.loadCollection({ collection_name: FEEDBACK_COLLECTION });
      this.logger.info('[DocsRAG] Created docs_feedback collection');
    } catch (err) {
      this.logger.warn({ err }, '[DocsRAG] Failed to create feedback collection');
    }
  }

  /**
   * Store user feedback about a docs assistant answer.
   */
  async storeFeedback(params: {
    question: string;
    answer: string;
    feedback: string;
    rating: number; // 1-5
    userId: string;
  }): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    try {
      await this.ensureFeedbackCollection();

      const embedding = await this.generateEmbedding(params.question);
      if (!embedding) return false;

      await client.insert({
        collection_name: FEEDBACK_COLLECTION,
        data: [{
          question: params.question.substring(0, 1990),
          answer: params.answer.substring(0, 3990),
          feedback: params.feedback.substring(0, 490),
          rating: params.rating,
          user_id: params.userId,
          embedding,
          metadata: JSON.stringify({
            timestamp: new Date().toISOString(),
            rating: params.rating,
          }),
        }],
      });

      this.logger.info({
        rating: params.rating,
        userId: params.userId,
      }, '[DocsRAG] Stored user feedback');
      return true;
    } catch (err) {
      this.logger.warn({ err }, '[DocsRAG] Failed to store feedback');
      return false;
    }
  }

  /**
   * Search feedback for similar past questions (to improve future answers).
   */
  async searchFeedback(query: string, topK: number = 3): Promise<Array<{ question: string; answer: string; feedback: string; rating: number }>> {
    const client = await this.getClient();
    if (!client) return [];

    try {
      await this.ensureFeedbackCollection();

      const embedding = await this.generateEmbedding(query);
      if (!embedding) return [];

      const results = await client.search({
        collection_name: FEEDBACK_COLLECTION,
        data: [embedding],
        limit: topK,
        output_fields: ['question', 'answer', 'feedback', 'rating'],
        filter: 'rating >= 4', // Only use positively rated feedback
      });

      return (results.results || []).map((r: any) => ({
        question: r.question,
        answer: r.answer,
        feedback: r.feedback,
        rating: r.rating,
      }));
    } catch {
      return [];
    }
  }
}
