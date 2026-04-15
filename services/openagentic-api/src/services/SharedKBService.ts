/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Shared Knowledge Base Service
 *
 * Cluster-wide RAG knowledge base. Every user and every platform agent
 * can search against the same collection — ingest once, available to all.
 *
 * Storage split:
 *   - Postgres metadata: `shared_kb_sources`, `shared_kb_documents` (Prisma models).
 *     Tracks sources, per-doc hashes for dedup, chunk counts, metadata.
 *   - Postgres vectors: `shared_kb_chunks` table, created on demand with an
 *     untyped `halfvec` column that DatabaseService.ensureEmbeddingDimensions()
 *     re-sizes at startup. No hardcoded dim.
 *
 * Query path: `searchSharedKB(query, limit)` embeds the query via
 * UniversalEmbeddingService and runs a pgvector cosine search.
 *
 * Ingestion path: `ingestSource(sourceId)` dispatches to the right ingester
 * based on `source.type`, chunks the content via the same CHUNK_SIZE used
 * elsewhere, embeds each chunk, upserts.
 *
 * See docs/rules/no-hardcoded-models.md — no model IDs, no dims.
 */

import type { Logger } from 'pino';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SharedKBSourceType =
  | 'webpage'
  | 'document'
  | 'rss'
  | 'http'
  | 'database'
  | 'agent';

export interface WebpageSourceConfig {
  url: string;
  crawlDepth?: number;      // reserved — currently always 1
  cssSelector?: string;     // reserved — extract body scope
  followLinks?: boolean;    // reserved
}

export interface SharedKBChunk {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface IngestResult {
  sourceId: string;
  docsIngested: number;
  chunksIngested: number;
  durationMs: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNKS_TABLE = 'shared_kb_chunks';
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SharedKBService {
  private logger: Logger;
  private embeddingService: UniversalEmbeddingService;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'SharedKBService' });
    this.embeddingService = new UniversalEmbeddingService(this.logger);
  }

  /**
   * Ensure the chunks table exists. Dim is managed by
   * DatabaseService.ensureEmbeddingDimensions() — we just declare the column
   * as untyped halfvec here.
   */
  async ensureChunksTable(): Promise<void> {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${CHUNKS_TABLE} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id UUID NOT NULL,
        document_id UUID NOT NULL,
        chunk_index INT NOT NULL,
        content TEXT NOT NULL,
        embedding halfvec,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Supporting btree indexes (HNSW on embedding is created by
    // DatabaseService.ensureEmbeddingDimensions after dim is bound).
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_skb_chunks_source ON ${CHUNKS_TABLE}(source_id)
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_skb_chunks_doc ON ${CHUNKS_TABLE}(document_id)
      `);
    } catch {
      /* indexes may already exist */
    }
  }

  // =========================================================================
  // Source CRUD
  // =========================================================================

  async listSources(): Promise<any[]> {
    return (prisma as any).sharedKBSource.findMany({
      orderBy: { created_at: 'desc' },
    });
  }

  async getSource(id: string): Promise<any | null> {
    return (prisma as any).sharedKBSource.findUnique({ where: { id } });
  }

  async createSource(input: {
    name: string;
    description?: string;
    type: SharedKBSourceType;
    config: Record<string, unknown>;
    enabled?: boolean;
    schedule?: string | null;
    createdBy?: string;
  }): Promise<any> {
    this.validateConfig(input.type, input.config);
    return (prisma as any).sharedKBSource.create({
      data: {
        name: input.name,
        description: input.description,
        type: input.type,
        config: input.config as any,
        enabled: input.enabled ?? true,
        schedule: input.schedule ?? null,
        created_by: input.createdBy,
      },
    });
  }

  async updateSource(id: string, patch: {
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    schedule?: string | null;
  }): Promise<any> {
    const source = await this.getSource(id);
    if (!source) throw new Error(`SharedKB source not found: ${id}`);
    if (patch.config) this.validateConfig(source.type, patch.config);
    return (prisma as any).sharedKBSource.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.config !== undefined && { config: patch.config as any }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.schedule !== undefined && { schedule: patch.schedule }),
      },
    });
  }

  async deleteSource(id: string): Promise<void> {
    // Cascade deletes shared_kb_documents via Prisma relation; we also
    // nuke the chunks manually (they live in a non-Prisma table).
    await prisma.$executeRawUnsafe(
      `DELETE FROM ${CHUNKS_TABLE} WHERE source_id = $1::uuid`,
      id,
    );
    await (prisma as any).sharedKBSource.delete({ where: { id } });
  }

  private validateConfig(type: SharedKBSourceType, config: Record<string, unknown>): void {
    switch (type) {
      case 'webpage':
        if (!config.url || typeof config.url !== 'string') {
          throw new Error('webpage source requires config.url (string)');
        }
        try {
          new URL(config.url);
        } catch {
          throw new Error(`webpage source has invalid URL: ${config.url}`);
        }
        break;
      case 'document':
        if (!config.filename) throw new Error('document source requires config.filename');
        break;
      case 'rss':
      case 'http':
        if (!config.url) throw new Error(`${type} source requires config.url`);
        break;
      case 'database':
        if (!config.dataSourceId) throw new Error('database source requires config.dataSourceId');
        if (!config.sql) throw new Error('database source requires config.sql');
        break;
      case 'agent':
        if (!config.task) throw new Error('agent source requires config.task');
        break;
      default:
        throw new Error(`unknown SharedKB source type: ${type}`);
    }
  }

  // =========================================================================
  // Ingestion
  // =========================================================================

  /**
   * Run ingestion for a source. Dispatches to the right ingester,
   * deduplicates by content hash, embeds chunks, upserts.
   */
  async ingestSource(sourceId: string): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = {
      sourceId,
      docsIngested: 0,
      chunksIngested: 0,
      durationMs: 0,
      errors: [],
    };

    const source = await this.getSource(sourceId);
    if (!source) throw new Error(`SharedKB source not found: ${sourceId}`);
    if (!source.enabled) {
      result.errors.push('source is disabled');
      result.durationMs = Date.now() - start;
      return result;
    }

    await this.ensureChunksTable();
    await this.markIngestStart(sourceId);

    try {
      switch (source.type as SharedKBSourceType) {
        case 'webpage':
          await this.ingestWebpage(source, result);
          break;
        default:
          result.errors.push(`source type "${source.type}" not yet implemented`);
          break;
      }
      await this.markIngestSuccess(sourceId, result);
    } catch (err: any) {
      result.errors.push(err.message);
      await this.markIngestError(sourceId, err.message);
      this.logger.error({ err: err.message, sourceId }, '[SharedKB] ingestion failed');
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  /**
   * Webpage ingester: fetch URL, extract text, chunk, embed, upsert.
   */
  private async ingestWebpage(source: any, result: IngestResult): Promise<void> {
    const config = source.config as WebpageSourceConfig;
    const url = config.url;

    this.logger.info({ sourceId: source.id, url }, '[SharedKB] fetching webpage');

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'OpenAgentic-SharedKB/1.0 (+https://openagentics.io)',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }

    const html = await resp.text();
    const { title, text } = this.extractReadableText(html);
    const contentHash = crypto.createHash('sha256').update(text).digest('hex');

    // Dedup: if a doc with this content hash already exists under this
    // source, skip. If the source has changed since last crawl, upsert
    // a new doc (old chunks stay — deletion is explicit via deleteSource).
    const existing = await (prisma as any).sharedKBDocument.findUnique({
      where: { source_id_content_hash: { source_id: source.id, content_hash: contentHash } },
    });

    if (existing) {
      this.logger.info({ docId: existing.id, url }, '[SharedKB] webpage unchanged — skip');
      return;
    }

    // Chunk + embed
    const chunks = this.chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
    if (chunks.length === 0) {
      throw new Error('extracted 0 chunks from webpage');
    }

    const embeddings = await Promise.all(
      chunks.map(async (content) => {
        const out = await this.embeddingService.generateEmbedding(content);
        return Array.isArray(out) ? out : (out as any)?.embedding;
      }),
    );

    // Persist document row
    const doc = await (prisma as any).sharedKBDocument.create({
      data: {
        source_id: source.id,
        origin: url,
        title: title?.substring(0, 500) || null,
        content_hash: contentHash,
        chunk_count: chunks.length,
        tokens_est: Math.round(text.length / 4),
        metadata: {
          url,
          fetched_at: new Date().toISOString(),
          content_length: text.length,
        } as any,
      },
    });

    // Insert chunks into the vector table
    let successfulChunks = 0;
    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i];
      if (!emb || emb.length === 0) {
        result.errors.push(`chunk ${i}: empty embedding`);
        continue;
      }
      const vectorStr = `[${emb.join(',')}]`;
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${CHUNKS_TABLE} (source_id, document_id, chunk_index, content, embedding, metadata)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::halfvec, $6::jsonb)`,
          source.id,
          doc.id,
          i,
          chunks[i],
          vectorStr,
          JSON.stringify({ url, chunk_index: i, total_chunks: chunks.length }),
        );
        successfulChunks++;
      } catch (err: any) {
        result.errors.push(`chunk ${i}: ${err.message}`);
      }
    }

    // Update doc row with actual successful chunk count (in case some failed)
    if (successfulChunks !== chunks.length) {
      await (prisma as any).sharedKBDocument.update({
        where: { id: doc.id },
        data: { chunk_count: successfulChunks },
      });
    }

    result.docsIngested += 1;
    result.chunksIngested += successfulChunks;
    this.logger.info({ docId: doc.id, url, chunks: successfulChunks }, '[SharedKB] webpage ingested');

    // Opportunistically create the HNSW index on shared_kb_chunks.embedding
    // now that data exists. pgvector 0.8.2 crashes on empty-column HNSW
    // builds (SIGILL), so we defer until after first ingest.
    if (successfulChunks > 0) {
      try {
        const { DatabaseService } = await import('./DatabaseService.js');
        await DatabaseService.tryCreateHnswIndexIfReady(
          'public', 'shared_kb_chunks', 'embedding', 'idx_skb_chunks_embedding_hnsw',
        );
      } catch (idxErr: any) {
        this.logger.warn({ err: idxErr.message }, '[SharedKB] HNSW index creation deferred');
      }
    }
  }

  /**
   * Very minimal HTML → text extraction. Strips script/style, reduces
   * whitespace, attempts to pull out a <title>. For the MVP this avoids
   * adding cheerio or readability as dependencies; we can upgrade later.
   */
  private extractReadableText(html: string): { title: string | null; text: string } {
    // Title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : null;

    // Strip script/style blocks
    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');

    // Strip all tags
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    // Decode common HTML entities
    cleaned = cleaned
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");

    // Normalize whitespace
    const text = cleaned.replace(/\s+/g, ' ').trim();

    return { title, text };
  }

  /**
   * Chunk text with overlap. Same algorithm as ChatRAGService /
   * DocsRAGService — split by paragraphs first, then window to fit
   * within CHUNK_SIZE characters.
   */
  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    if (text.length <= chunkSize) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = start + chunkSize;
      if (end >= text.length) {
        chunks.push(text.slice(start));
        break;
      }
      // Try to break on a sentence boundary near the end of the window
      const slice = text.slice(start, end);
      const lastSentenceBreak = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('\n\n'),
      );
      if (lastSentenceBreak > chunkSize * 0.5) {
        end = start + lastSentenceBreak + 1;
      }
      chunks.push(text.slice(start, end).trim());
      start = end - overlap;
    }
    return chunks.filter((c) => c.length > 0);
  }

  // =========================================================================
  // Ingest status bookkeeping
  // =========================================================================

  private async markIngestStart(sourceId: string): Promise<void> {
    await (prisma as any).sharedKBSource.update({
      where: { id: sourceId },
      data: { last_ingest_status: 'running', last_ingest_error: null },
    });
  }

  private async markIngestSuccess(sourceId: string, result: IngestResult): Promise<void> {
    // Recompute totals from the documents table (authoritative)
    const agg = await (prisma as any).sharedKBDocument.aggregate({
      where: { source_id: sourceId },
      _count: { _all: true },
      _sum: { chunk_count: true },
    });
    await (prisma as any).sharedKBSource.update({
      where: { id: sourceId },
      data: {
        last_ingest_at: new Date(),
        last_ingest_status: result.errors.length > 0 ? 'partial' : 'success',
        last_ingest_error: result.errors.length > 0 ? result.errors.join('; ').substring(0, 2000) : null,
        doc_count: agg._count?._all || 0,
        chunk_count: agg._sum?.chunk_count || 0,
      },
    });
  }

  private async markIngestError(sourceId: string, message: string): Promise<void> {
    await (prisma as any).sharedKBSource.update({
      where: { id: sourceId },
      data: {
        last_ingest_at: new Date(),
        last_ingest_status: 'error',
        last_ingest_error: message.substring(0, 2000),
      },
    });
  }

  // =========================================================================
  // Query
  // =========================================================================

  /**
   * Semantic search across all enabled sources. Returns the top-K chunks
   * by cosine similarity. Used by ChatRAGService's RAG stage.
   */
  async search(query: string, limit: number = 5): Promise<Array<{
    content: string;
    similarity: number;
    sourceId: string;
    sourceName: string;
    sourceType: string;
    documentId: string;
    metadata: Record<string, unknown>;
  }>> {
    const embeddingResult = await this.embeddingService.generateEmbedding(query);
    const embedding = Array.isArray(embeddingResult)
      ? embeddingResult
      : (embeddingResult as any)?.embedding;
    if (!embedding || embedding.length === 0) return [];

    const vectorStr = `[${embedding.join(',')}]`;
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        c.content,
        c.metadata,
        c.source_id,
        c.document_id,
        1 - (c.embedding <=> $1::halfvec) AS similarity,
        s.name AS source_name,
        s.type AS source_type
      FROM ${CHUNKS_TABLE} c
      JOIN shared_kb_sources s ON s.id = c.source_id
      WHERE s.enabled = true AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::halfvec
      LIMIT $2
      `,
      vectorStr,
      limit,
    );

    return rows.map((r) => ({
      content: r.content,
      similarity: Number(r.similarity),
      sourceId: r.source_id,
      sourceName: r.source_name,
      sourceType: r.source_type,
      documentId: r.document_id,
      metadata: r.metadata || {},
    }));
  }

  /**
   * List documents for a given source (admin view).
   */
  async listDocuments(sourceId: string): Promise<any[]> {
    return (prisma as any).sharedKBDocument.findMany({
      where: { source_id: sourceId },
      orderBy: { ingested_at: 'desc' },
      take: 200,
    });
  }

  /**
   * Delete a single document and its chunks.
   */
  async deleteDocument(sourceId: string, docId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DELETE FROM ${CHUNKS_TABLE} WHERE document_id = $1::uuid`,
      docId,
    );
    await (prisma as any).sharedKBDocument.delete({ where: { id: docId } });

    // Refresh source counts
    const agg = await (prisma as any).sharedKBDocument.aggregate({
      where: { source_id: sourceId },
      _count: { _all: true },
      _sum: { chunk_count: true },
    });
    await (prisma as any).sharedKBSource.update({
      where: { id: sourceId },
      data: {
        doc_count: agg._count?._all || 0,
        chunk_count: agg._sum?.chunk_count || 0,
      },
    });
  }
}

// Singleton convenience
let _instance: SharedKBService | null = null;
export function getSharedKBService(logger: Logger): SharedKBService {
  if (!_instance) _instance = new SharedKBService(logger);
  return _instance;
}
