/**
 * Chat RAG Service
 *
 * Searches Milvus knowledge bases (shared + user private) before each LLM call
 * and injects relevant context into the system prompt.
 *
 * Security model:
 * - Shared knowledge: accessible to all authenticated users (PII-scrubbed content only)
 * - Private collections: accessible only to the owning user (per-user isolation)
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { Logger } from 'pino';
import { getMilvusClient } from '../utils/MilvusConnectionManager.js';

interface RAGResult {
  content: string;
  score: number;
  source: 'shared' | 'private';
  metadata?: any;
}

interface RAGContext {
  results: RAGResult[];
  systemPromptInjection: string;
  searchTimeMs: number;
}

export class ChatRAGService {
  private logger: Logger;
  private milvusClient: MilvusClient;
  private embeddingDim: number;
  private universalEmbedding: any; // UniversalEmbeddingService (dynamic import to avoid circular)

  constructor(logger: Logger) {
    this.logger = logger;
    // Get Milvus client from singleton accessor or create a new connection
    this.milvusClient = getMilvusClient() ?? undefined!;
    if (!this.milvusClient) {
      const addr = process.env.MILVUS_ADDRESS || `${process.env.MILVUS_HOST || 'openagentic-milvus'}:${process.env.MILVUS_PORT || '19530'}`;
      this.milvusClient = new MilvusClient({
        address: addr,
        username: process.env.MILVUS_USERNAME || 'root',
        password: process.env.MILVUS_PASSWORD || '',
      });
      this.logger.info({ address: addr }, '[ChatRAG] Created direct Milvus connection');
    }
    // Embedding dim must match what UniversalEmbeddingService produces.
    // Reads EMBEDDING_DIMENSIONS (3072 for Azure text-embedding-3-large in
    // dev; 768 for Ollama nomic-embed-text in self-hosted only setups).
    this.embeddingDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '3072', 10);
  }

  /**
   * Search knowledge bases and build RAG context for a user query.
   * Searches both shared_knowledge and user_{userId}_private collections.
   */
  async getRAGContext(query: string, userId: string, topK: number = 5): Promise<RAGContext> {
    const start = Date.now();
    const results: RAGResult[] = [];

    if (!this.milvusClient) {
      this.logger.warn('[ChatRAG] Milvus client not available, skipping RAG');
      return { results: [], systemPromptInjection: '', searchTimeMs: 0 };
    }

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        this.logger.warn('[ChatRAG] Failed to generate query embedding');
        return { results: [], systemPromptInjection: '', searchTimeMs: Date.now() - start };
      }

      // Search shared knowledge base (legacy Milvus collection)
      const sharedResults = await this.searchCollection(
        'shared_knowledge', queryEmbedding, topK, 'shared'
      );
      results.push(...sharedResults);

      // Search SharedKBService — the new cluster-wide pgvector-backed KB
      // (admin-curated sources: webpages, documents, RSS, HTTP, database, agent)
      try {
        const { getSharedKBService } = await import('./SharedKBService.js');
        const svc = getSharedKBService(this.logger);
        const sharedKBResults = await svc.search(query, topK);
        for (const r of sharedKBResults) {
          results.push({
            content: r.content,
            score: 1 - r.similarity, // cosine distance form
            metadata: {
              ...r.metadata,
              source: `sharedkb:${r.sourceName}`,
              sourceType: r.sourceType,
              documentId: r.documentId,
            },
            source: 'shared' as any,
          });
        }
        if (sharedKBResults.length > 0) {
          this.logger.info({ count: sharedKBResults.length }, '[ChatRAG] SharedKBService results merged');
        }
      } catch (err: any) {
        this.logger.debug({ err: err.message }, '[ChatRAG] SharedKBService search skipped');
      }

      // Search user's private collection
      const userCollection = this.getUserCollectionName(userId);
      const privateResults = await this.searchCollection(
        userCollection, queryEmbedding, topK, 'private'
      );
      results.push(...privateResults);

      // Also search user_documents (legacy collection with user_id filter)
      const userDocsResults = await this.searchUserDocuments(
        queryEmbedding, userId, topK
      );
      results.push(...userDocsResults);

      // Sort by relevance score (lower = better for L2/COSINE distance)
      results.sort((a, b) => a.score - b.score);

      // Take top K overall
      const topResults = results.slice(0, topK);

      // Build system prompt injection
      const systemPromptInjection = this.buildContextPrompt(topResults);

      const searchTimeMs = Date.now() - start;
      this.logger.info({
        userId,
        queryLength: query.length,
        totalResults: topResults.length,
        sharedResults: sharedResults.length,
        privateResults: privateResults.length,
        userDocsResults: userDocsResults.length,
        searchTimeMs
      }, '[ChatRAG] Knowledge search completed');

      return { results: topResults, systemPromptInjection, searchTimeMs };
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[ChatRAG] RAG search failed (non-blocking)');
      return { results: [], systemPromptInjection: '', searchTimeMs: Date.now() - start };
    }
  }

  /**
   * Ingest content into a Milvus collection (shared or private).
   * Shared collections run through DLP scanner to strip PII/PHI/secrets/credentials.
   * Private collections skip DLP (user's own data, encrypted with their key).
   */
  async ingestContent(
    content: string,
    collection: 'shared' | 'private',
    userId: string,
    metadata: Record<string, any> = {}
  ): Promise<{ chunksIngested: number; dlpFindings?: number; dlpBlocked?: boolean }> {
    const collectionName = collection === 'shared'
      ? 'shared_knowledge'
      : this.getUserCollectionName(userId);

    // DLP SCRUBBING: Shared knowledge bases MUST be scrubbed for PII/secrets
    let processedContent = content;
    let dlpFindings = 0;
    let dlpBlocked = false;

    if (collection === 'shared') {
      try {
        const { getDLPScanner } = await import('./DLPScannerService.js');
        const dlp = getDLPScanner(this.logger);

        const { text: scrubbedText, blocked, result } = dlp.scanAndAct(content, {
          userId,
          scanPoint: 'workflow_data',
        });

        dlpFindings = result.findings.length;

        if (blocked) {
          dlpBlocked = true;
          this.logger.warn({
            userId,
            findingsCount: result.findings.length,
            severity: result.severity,
            categories: [...new Set(result.findings.map(f => f.category))],
          }, '[ChatRAG] DLP BLOCKED shared knowledge ingestion - content too sensitive');
          return { chunksIngested: 0, dlpFindings, dlpBlocked: true };
        }

        if (scrubbedText !== content) {
          processedContent = scrubbedText;
          this.logger.info({
            userId,
            redactionCount: result.findings.length,
            categories: [...new Set(result.findings.map(f => f.category))],
            originalLength: content.length,
            scrubbedLength: scrubbedText.length,
          }, '[ChatRAG] DLP scrubbed shared knowledge - PII/secrets redacted');
        } else {
          this.logger.info({ userId }, '[ChatRAG] DLP scan passed - no sensitive data found');
        }
      } catch (dlpError: any) {
        // DLP failure should NOT block ingestion - log and continue with original content
        this.logger.warn({ error: dlpError.message }, '[ChatRAG] DLP scan failed (non-blocking), ingesting unscrubbed');
      }
    }

    // Ensure collection exists
    await this.ensureCollection(collectionName);

    // Chunk the processed (scrubbed for shared, original for private) content
    const chunks = this.chunkText(processedContent, 1500, 200);
    this.logger.info({ collectionName, chunks: chunks.length, contentLength: processedContent.length, dlpFindings }, '[ChatRAG] Ingesting content');

    let ingested = 0;
    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await this.generateEmbedding(chunks[i]);
        if (!embedding || embedding.length === 0) continue;

        await this.milvusClient.insert({
          collection_name: collectionName,
          data: [{
            chunk_id: `${Date.now()}-${i}`,
            file_id: metadata.source || 'ingestion',
            user_id: collection === 'shared' ? 'shared' : userId,
            chunk_index: i,
            content: chunks[i].substring(0, 1990), // Respect VarChar limit
            embedding,
            metadata: JSON.stringify({ ...metadata, chunk_index: i, ingested_at: new Date().toISOString() })
          }]
        });
        ingested++;
      } catch (err: any) {
        this.logger.warn({ error: err.message, chunk: i }, '[ChatRAG] Failed to ingest chunk');
      }
    }

    // Flush to make searchable
    await this.milvusClient.flush({ collection_names: [collectionName] });
    this.logger.info({ collectionName, ingested, total: chunks.length, dlpFindings }, '[ChatRAG] Ingestion complete');
    return { chunksIngested: ingested, dlpFindings, dlpBlocked };
  }

  // --- Private helpers ---

  private async searchCollection(
    collectionName: string,
    queryEmbedding: number[],
    topK: number,
    source: 'shared' | 'private'
  ): Promise<RAGResult[]> {
    try {
      const hasCollection = await this.milvusClient.hasCollection({ collection_name: collectionName });
      if (!hasCollection.value) return [];

      // Ensure loaded
      try { await this.milvusClient.loadCollection({ collection_name: collectionName }); } catch {}

      const results = await this.milvusClient.search({
        collection_name: collectionName,
        data: [queryEmbedding],
        output_fields: ['content', 'metadata', 'chunk_id'],
        limit: topK,
      });

      return (results.results || []).map((r: any) => ({
        content: r.content || '',
        score: r.score || 0,
        source,
        metadata: r.metadata ? JSON.parse(r.metadata) : {}
      })).filter((r: RAGResult) => r.content.length > 20); // Filter empty/tiny results
    } catch (err: any) {
      this.logger.debug({ collectionName, error: err.message }, '[ChatRAG] Collection search failed');
      return [];
    }
  }

  private async searchUserDocuments(
    queryEmbedding: number[],
    userId: string,
    topK: number
  ): Promise<RAGResult[]> {
    try {
      const hasCollection = await this.milvusClient.hasCollection({ collection_name: 'user_documents' });
      if (!hasCollection.value) return [];

      try { await this.milvusClient.loadCollection({ collection_name: 'user_documents' }); } catch {}

      // Search with user_id filter for private docs, or 'shared' for shared docs
      const results = await this.milvusClient.search({
        collection_name: 'user_documents',
        data: [queryEmbedding],
        output_fields: ['content', 'metadata', 'user_id', 'chunk_id'],
        limit: topK,
        filter: `user_id == "${userId}" || user_id == "shared"`,
      });

      return (results.results || []).map((r: any) => ({
        content: r.content || '',
        score: r.score || 0,
        source: r.user_id === 'shared' ? 'shared' as const : 'private' as const,
        metadata: r.metadata ? JSON.parse(r.metadata) : {}
      })).filter((r: RAGResult) => r.content.length > 20);
    } catch (err: any) {
      this.logger.debug({ error: err.message }, '[ChatRAG] user_documents search failed');
      return [];
    }
  }

  private buildContextPrompt(results: RAGResult[]): string {
    if (results.length === 0) return '';

    const contextBlocks = results.map((r, i) =>
      `[Source ${i + 1} (${r.source})]:\n${r.content}`
    ).join('\n\n');

    return `\n\n--- KNOWLEDGE BASE CONTEXT ---\nThe following information was retrieved from the knowledge base and may be relevant to the user's question. Use this context to provide accurate, specific answers. If the context doesn't contain relevant information, rely on your general knowledge but note that.\n\n${contextBlocks}\n--- END KNOWLEDGE BASE CONTEXT ---\n`;
  }

  private async ensureCollection(collectionName: string): Promise<void> {
    const has = await this.milvusClient.hasCollection({ collection_name: collectionName });
    if (has.value) return;

    await this.milvusClient.createCollection({
      collection_name: collectionName,
      fields: [
        { name: 'id', data_type: 'Int64', is_primary_key: true, autoID: true },
        { name: 'chunk_id', data_type: 'VarChar', max_length: 100 },
        { name: 'file_id', data_type: 'VarChar', max_length: 100 },
        { name: 'user_id', data_type: 'VarChar', max_length: 100 },
        { name: 'chunk_index', data_type: 'Int64' },
        { name: 'content', data_type: 'VarChar', max_length: 2000 },
        { name: 'embedding', data_type: 'FloatVector', dim: this.embeddingDim },
        { name: 'metadata', data_type: 'VarChar', max_length: 1000 },
      ],
    });

    await this.milvusClient.createIndex({
      collection_name: collectionName,
      field_name: 'embedding',
      index_type: 'IVF_FLAT',
      metric_type: 'COSINE',
      params: { nlist: 128 }
    });

    await this.milvusClient.loadCollection({ collection_name: collectionName });
    this.logger.info({ collectionName }, '[ChatRAG] Created and loaded collection');
  }

  private getUserCollectionName(userId: string): string {
    // Sanitize user ID for collection name (Milvus allows alphanumeric + underscore)
    const sanitized = userId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    return `user_${sanitized}_private`;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Delegate to UniversalEmbeddingService so ingest and search use the
    // SAME provider+dim. Pre-2026-05-15 ChatRAGService hardcoded a fetch to
    // Ollama at a fixed URL while the search side (SharedKBService) used
    // UniversalEmbeddingService — different providers, different dims —
    // which meant ingested chunks were silently unreachable via the search
    // path on the dev environment. See `[ChatRAG] DLP scan passed` / `Ingestion
    // complete: ingested=1` + `Knowledge search completed: sharedResults=0`
    // wire evidence from execution 83d527dc-0a26-4243-afeb-024e938c428a.
    try {
      if (!this.universalEmbedding) {
        const { UniversalEmbeddingService } = await import('./UniversalEmbeddingService.js');
        this.universalEmbedding = new UniversalEmbeddingService(this.logger);
      }
      const result = await this.universalEmbedding.generateEmbedding(text);
      if (!result || !Array.isArray(result.embedding)) return [];
      return result.embedding;
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[ChatRAG] Embedding generation failed');
      return [];
    }
  }

  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    // Split by sections first (## headings)
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
}
