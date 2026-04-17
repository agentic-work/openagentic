/**
 * RAG (Retrieval-Augmented Generation) Pipeline Stage
 *
 * This stage handles knowledge retrieval from vector databases to enhance
 * AI responses with relevant context from documentation and previous chats.
 *
 * Features:
 * - Document retrieval from Milvus vector database
 * - Previous chat context retrieval
 * - User artifact/report retrieval (reports, exports, saved files)
 * - User-specific knowledge scoping
 * - Admin access to all knowledge bases
 * - Relevance scoring and ranking
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ArtifactService } from '../../../services/ArtifactService.js';
import { evaluateRagIntent } from '../../../services/RagIntentGate.js';
import type { Logger } from 'pino';

/**
 * Per-stage RAG configuration. Note: there used to be an `enabled: boolean`
 * field here that was hardcoded to `true` everywhere it was set —
 * effectively dead since the kill switch had moved to the pipeline-level
 * `ChatPipelineConfig.enableRAG` flag. Removed (openagentic-omhs#330
 * follow-up). Per-request gating now lives in RagIntentGate which
 * decides whether retrieval should run for a given user message.
 */
interface RAGConfig {
  maxDocs: number;
  maxChats: number;
  maxArtifacts: number;
  minRelevanceScore: number;
  collections: string[];
  enableArtifactSearch: boolean;
}

interface RetrievedKnowledge {
  docs: Array<{
    content: string;
    metadata: {
      source?: string;
      title?: string;
      url?: string;
      timestamp?: Date;
    };
    score: number;
  }>;
  chats: Array<{
    content: string;
    metadata: {
      sessionId: string;
      userId: string;
      timestamp: Date;
    };
    score: number;
  }>;
  artifacts: Array<{
    content: string;
    metadata: {
      id: string;
      title: string;
      filename: string;
      mimeType: string;
      type: string;
      tags?: string[];
      createdAt: Date;
    };
    score: number;
  }>;
  metadata: {
    retrievalTime: number;
    totalResults: number;
    collections: string[];
    artifactsRetrieved?: number;
  };
}

export class RAGStage implements PipelineStage {
  name = 'rag';
  private logger: Logger;
  private artifactService: ArtifactService | null = null;
  private defaultConfig: RAGConfig = {
    maxDocs: 5,
    maxChats: 3,
    maxArtifacts: 5,
    minRelevanceScore: 0.3,  // Lower threshold for better recall (0.6 was too strict)
    collections: ['app_documentation', 'user_chats', 'knowledge_base'],
    enableArtifactSearch: true  // Always search user artifacts (reports, exports)
  };

  constructor(
    private knowledgeService: any,
    private milvusService: any,
    logger: any,
    private config?: Partial<RAGConfig>
  ) {
    this.logger = logger.child({ stage: this.name });
    this.config = { ...this.defaultConfig, ...config };

    // Initialize artifact service for report/export retrieval
    try {
      this.artifactService = new ArtifactService(this.logger);
      this.logger.info('[RAG] ArtifactService initialized for report retrieval');
    } catch (error) {
      this.logger.warn({ error: error.message }, '[RAG] ArtifactService unavailable, artifact search disabled');
    }
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    try {
      // ── Intent gate ────────────────────────────────────────────────────
      // Skip retrieval for messages that don't actually want platform docs.
      // Without this, every chat — including "what are my Azure costs" or
      // "create a chart" — fired Milvus searches across multiple
      // collections and bloated the system prompt with irrelevant doc
      // excerpts. See openagentic-omhs#330 follow-up.
      //
      // Artifact search (user reports / exports) is intentionally KEPT
      // running on every message — it's user-scoped, fast, and surfaces
      // the user's own past work which is contextually useful regardless
      // of intent. Only the documentation-collection retrieval is gated.
      const intent = evaluateRagIntent(context.request.message);
      if (!intent.shouldFetchRag) {
        // Logged at info level so we can see the gate decisions in
        // production logs and tune the heuristic from real traffic.
        // A quiet gate is harder to debug than a chatty one.
        this.logger.info({
          userId: context.user?.id,
          reason: intent.reason,
          matched: intent.matched,
          messagePreview: context.request.message?.substring(0, 80),
        }, '[RAG] Skipped by intent gate — no documentation lookup');
        // Still run artifact search if available — see comment above.
        if (this.artifactService) {
          // (artifactService search lives inside retrieveKnowledge — call
          // a slim variant later if we want; for now just early-return so
          // we don't pay Milvus cost. Artifact-only path TBD as
          // follow-up since artifactService.search is wrapped inside
          // retrieveKnowledge today.)
        }
        return context;
      }

      this.logger.info({
        userId: context.user?.id,
        message: context.request.message.substring(0, 100),
        isAdmin: context.user?.isAdmin,
        ragGateReason: intent.reason,
        ragGateMatched: intent.matched,
      }, '[RAG] Intent gate FIRED — starting knowledge retrieval');

      // Check if any services are available (artifact service can work alone)
      if (!this.knowledgeService && !this.milvusService && !this.artifactService) {
        this.logger.warn('No knowledge services available, skipping RAG');
        return context;
      }

      // Retrieve relevant knowledge
      const knowledge = await this.retrieveKnowledge(context);

      const hasKnowledge = knowledge && (
        knowledge.docs.length > 0 ||
        knowledge.chats.length > 0 ||
        knowledge.artifacts.length > 0
      );

      if (hasKnowledge) {
        // Store in context for prompt enhancement
        context.ragContext = knowledge;

        // Add metadata for tracking
        context.metadata = {
          ...context.metadata,
          ragEnabled: true,
          ragDocsRetrieved: knowledge.docs.length,
          ragChatsRetrieved: knowledge.chats.length,
          ragArtifactsRetrieved: knowledge.artifacts.length,
          ragRetrievalTime: Date.now() - startTime
        };

        // Emit RAG status for UI. Includes a `sources` array (top docs +
        // their collection / source metadata) so the chat-mode tool card
        // can show per-doc icons inline rather than just "5 docs". See
        // openagentic-omhs#330 — user wants 'icons + names + collection'
        // visible in the RAG tag instead of an opaque count.
        const sources = knowledge.docs.slice(0, 5).map((d: any) => ({
          title: d.metadata?.title || d.metadata?.source || d.metadata?.url || 'document',
          collection: d.metadata?.collection || d.metadata?.source,
          url: d.metadata?.url,
          score: d.score,
        }));
        context.emit('rag_status', {
          docsRetrieved: knowledge.docs.length,
          chatsRetrieved: knowledge.chats.length,
          artifactsRetrieved: knowledge.artifacts.length,
          collections: knowledge.metadata.collections,
          retrievalTime: knowledge.metadata.retrievalTime,
          sources,
        });

        this.logger.info({
          userId: context.user?.id,
          docsRetrieved: knowledge.docs.length,
          chatsRetrieved: knowledge.chats.length,
          artifactsRetrieved: knowledge.artifacts.length,
          retrievalTime: Date.now() - startTime
        }, '[RAG] Knowledge retrieval completed');
      } else {
        this.logger.info({
          userId: context.user?.id
        }, '[RAG] No relevant knowledge found');
      }

      return context;

    } catch (error) {
      this.logger.error({
        error: error.message,
        userId: context.user?.id,
        executionTime: Date.now() - startTime
      }, '[RAG] Knowledge retrieval failed');

      // RAG failures shouldn't block the pipeline
      context.emit('warning', {
        message: 'Knowledge retrieval unavailable',
        code: 'RAG_RETRIEVAL_FAILED'
      });

      return context;
    }
  }

  private async retrieveKnowledge(context: PipelineContext): Promise<RetrievedKnowledge | null> {
    const startTime = Date.now();
    const isAdmin = context.user?.isAdmin === true;
    const userId = context.user?.id;
    const message = context.request.message;

    const results: RetrievedKnowledge = {
      docs: [],
      chats: [],
      artifacts: [],
      metadata: {
        retrievalTime: 0,
        totalResults: 0,
        collections: []
      }
    };

    try {
      // PERFORMANCE FIX: Check Redis cache for embedding first - NEVER block user for embedding generation
      // If not cached, skip Milvus search and queue background embedding generation
      let cachedEmbedding: number[] | null = null;
      const redisService = context.redisService;

      if (this.milvusService && redisService) {
        const embeddingCacheKey = `rag:embedding:${this.hashQuery(message)}`;

        try {
          // Try to get cached embedding from Redis (< 1ms)
          const cached = await redisService.get(embeddingCacheKey);
          if (cached) {
            cachedEmbedding = typeof cached === 'string' ? JSON.parse(cached) : cached;
            this.logger.debug({ cacheHit: true, dimensions: cachedEmbedding?.length }, '[RAG] Embedding cache HIT');
          } else {
            // Cache miss - generate embedding inline (Ollama is fast ~50ms)
            this.logger.debug({ cacheHit: false }, '[RAG] Embedding cache MISS - generating inline');
            try {
              cachedEmbedding = await this.generateEmbedding(message);
              if (cachedEmbedding && cachedEmbedding.length > 0) {
                // Cache for future requests (fire and forget)
                redisService.set(embeddingCacheKey, JSON.stringify(cachedEmbedding), 'EX', 86400).catch(() => {});
                this.logger.debug({ dimensions: cachedEmbedding.length }, '[RAG] Inline embedding generated and cached');
              }
            } catch (embErr: any) {
              this.logger.warn({ error: embErr.message }, '[RAG] Inline embedding generation failed');
            }
          }
        } catch (redisError: any) {
          this.logger.warn({ error: redisError.message }, '[RAG] Redis cache check failed, skipping Milvus search');
        }
      }

      // Parallel retrieval from different sources
      const retrievalPromises: Promise<any>[] = [];

      // 1. Retrieve from documentation
      if (this.knowledgeService) {
        retrievalPromises.push(
          this.knowledgeService.search(message, {
            collections: ['app_documentation', 'shared_knowledge'],
            limit: isAdmin ? this.config!.maxDocs : Math.floor(this.config!.maxDocs! / 2),
            minScore: this.config!.minRelevanceScore
          }).then((docs: any[]) => {
            results.docs = docs || [];
            results.metadata.collections.push('app_documentation');
          }).catch((error: any) => {
            this.logger.warn({ error: error.message }, 'Failed to retrieve documentation');
          })
        );
      }

      // 2. Retrieve from Milvus if available (using cached embedding)
      if (this.milvusService && cachedEmbedding) {
        // Search in knowledge base collection - reuse cached embedding
        retrievalPromises.push(
          this.searchMilvusCollectionWithEmbedding('knowledge_base', cachedEmbedding, this.config!.maxDocs!).then(docs => {
            if (docs && docs.length > 0) {
              results.docs.push(...docs);
              results.metadata.collections.push('knowledge_base');
            }
          }).catch(error => {
            this.logger.warn({ error: error.message }, 'Failed to search knowledge_base collection');
          })
        );

        // Search user_documents (shared + user-scoped via filter)
        if (userId) {
          const userDocsFilter = isAdmin ? {} : { userId };
          retrievalPromises.push(
            this.searchMilvusCollectionWithEmbedding(
              'user_documents', cachedEmbedding, this.config!.maxDocs!,
              // Search both shared and user's own documents
              { $or: [{ userId: 'shared' }, { userId }] }
            ).then(docs => {
              if (docs && docs.length > 0) {
                results.docs.push(...docs);
                results.metadata.collections.push('user_documents');
              }
            }).catch(error => {
              this.logger.warn({ error: error.message }, 'Failed to search user_documents collection');
            })
          );

          // Also search user's private collection
          const privateCollection = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}_private`;
          retrievalPromises.push(
            this.searchMilvusCollectionWithEmbedding(
              privateCollection, cachedEmbedding, this.config!.maxDocs!
            ).then(docs => {
              if (docs && docs.length > 0) {
                results.docs.push(...docs);
                results.metadata.collections.push(privateCollection);
              }
            }).catch(error => {
              // Private collection may not exist yet - not an error
              this.logger.debug({ error: error.message, collection: privateCollection }, 'Private collection search skipped');
            })
          );

          // Search shared_knowledge collection
          retrievalPromises.push(
            this.searchMilvusCollectionWithEmbedding(
              'shared_knowledge', cachedEmbedding, this.config!.maxDocs!
            ).then(docs => {
              if (docs && docs.length > 0) {
                results.docs.push(...docs);
                results.metadata.collections.push('shared_knowledge');
              }
            }).catch(error => {
              this.logger.debug({ error: error.message }, 'shared_knowledge search skipped');
            })
          );
        }

        // Search in user chats (only for the user's own chats unless admin) - reuse cached embedding
        if (userId) {
          const chatFilter = isAdmin ? {} : { userId };
          retrievalPromises.push(
            this.searchMilvusCollectionWithEmbedding('user_chats', cachedEmbedding, this.config!.maxChats!, chatFilter).then(chats => {
              if (chats && chats.length > 0) {
                results.chats = chats;
                results.metadata.collections.push('user_chats');
              }
            }).catch(error => {
              this.logger.warn({ error: error.message }, 'Failed to search user_chats collection');
            })
          );
        }
      }

      // 3. Search user artifacts (reports, exports, saved files)
      if (this.artifactService && this.config!.enableArtifactSearch && userId) {
        retrievalPromises.push(
          this.artifactService.searchArtifacts(userId, {
            query: message,
            limit: this.config!.maxArtifacts!,
            threshold: this.config!.minRelevanceScore
          }).then((response: { results: any[]; total: number }) => {
            const artifacts = response.results || [];
            if (artifacts.length > 0) {
              results.artifacts = artifacts.map(a => ({
                content: a.extractedText || a.description || `[${a.filename}]`,
                metadata: {
                  id: a.id,
                  title: a.title || a.filename,
                  filename: a.filename,
                  mimeType: a.mimeType,
                  type: a.type || 'file',
                  tags: a.tags,
                  createdAt: a.createdAt
                },
                score: a.score || 0.8
              }));
              results.metadata.collections.push('artifacts');
              results.metadata.artifactsRetrieved = results.artifacts.length;
            }
          }).catch((error: any) => {
            this.logger.warn({ error: error.message }, 'Failed to search artifacts');
          })
        );
      }

      // Wait for all retrievals to complete
      await Promise.all(retrievalPromises);

      // ── Quality filter + dedup ──────────────────────────────────────────
      // Corpus noise observed in prod (user report 2026-04-17):
      //   * `flow-generated` demo seed documents — test fixtures from flow
      //     authoring, never actual platform knowledge. Drop outright.
      //   * Near-duplicate titles across collections (same doc ingested
      //     into app_documentation AND shared_knowledge AND user_documents)
      //     so the user sees "FIVE rag docs, all the same".
      // The metric-agnostic dedup below keeps the first occurrence (which
      // is the highest-scored after the sort) and discards lower-ranked
      // dupes regardless of which collection they came from.
      const BAD_COLLECTIONS = new Set(['flow-generated', 'flow_generated', 'flow-demo']);
      const titleKey = (d: any): string => {
        const m = d?.metadata || {};
        return String(m.title || m.source || m.url || m.filename || '')
          .toLowerCase()
          .replace(/[#*`_\s]+/g, ' ')
          .trim()
          .slice(0, 80);
      };
      const seenTitles = new Set<string>();
      results.docs = results.docs.filter((d: any) => {
        const coll = d?.metadata?.collection || d?.metadata?.source;
        if (coll && BAD_COLLECTIONS.has(String(coll))) return false;
        const k = titleKey(d);
        if (!k) return true;
        if (seenTitles.has(k)) return false;
        seenTitles.add(k);
        return true;
      });

      // Sort by relevance score
      results.docs.sort((a, b) => b.score - a.score);
      results.chats.sort((a, b) => b.score - a.score);
      results.artifacts.sort((a, b) => b.score - a.score);

      // Limit results
      results.docs = results.docs.slice(0, this.config!.maxDocs!);
      results.chats = results.chats.slice(0, this.config!.maxChats!);
      results.artifacts = results.artifacts.slice(0, this.config!.maxArtifacts!);

      // Update metadata
      results.metadata.retrievalTime = Date.now() - startTime;
      results.metadata.totalResults = results.docs.length + results.chats.length + results.artifacts.length;

      return results.metadata.totalResults > 0 ? results : null;

    } catch (error) {
      this.logger.error({
        error: error.message,
        userId
      }, '[RAG] Failed to retrieve knowledge');
      return null;
    }
  }

  private async searchMilvusCollection(
    collection: string,
    query: string,
    limit: number,
    filter?: any
  ): Promise<any[]> {
    try {
      // Check if collection exists
      const hasCollection = await this.milvusService.hasCollection({
        collection_name: collection
      });

      if (!hasCollection.value) {
        this.logger.debug(`Collection ${collection} does not exist`);
        return [];
      }

      // Generate embedding for query
      const embedding = await this.generateEmbedding(query);
      if (!embedding) {
        return [];
      }

      // Search in Milvus (SDK v2 format)
      try { await this.milvusService.loadCollection({ collection_name: collection }); } catch {}

      const searchParams: any = {
        collection_name: collection,
        data: [embedding],
        limit,
        output_fields: ['content', 'metadata'],
      };

      if (filter) {
        const filterStr = this.buildMilvusFilter(filter);
        if (filterStr) searchParams.filter = filterStr;
      }

      const searchResult = await this.milvusService.search(searchParams);
      const results = searchResult.results || searchResult.data || [];

      if (results.length > 0) {
        return results.map((result: any) => ({
          content: result.content || '',
          metadata: (() => { try { return typeof result.metadata === 'string' ? JSON.parse(result.metadata) : (result.metadata || {}); } catch { return {}; } })(),
          score: result.score || 0
        })).filter((r: any) => r.content.length > 10);
      }

      return [];

    } catch (error) {
      this.logger.error({
        error: error.message,
        collection
      }, 'Failed to search Milvus collection');
      return [];
    }
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      // Use the embedding service if available
      if (this.knowledgeService?.generateEmbedding) {
        return await this.knowledgeService.generateEmbedding(text);
      }

      // Fallback: Use Ollama embedding directly
      const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.EMBEDDING_OLLAMA_BASE_URL || 'http://10.2.10.142:11434';
      const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || 'nomic-embed-text';

      const resp = await fetch(`${ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embeddingModel, prompt: text.substring(0, 4000) })
      });

      if (!resp.ok) {
        this.logger.warn({ status: resp.status }, '[RAG] Ollama embedding request failed');
        return null;
      }

      const data = await resp.json() as any;
      if (data.embedding && Array.isArray(data.embedding)) {
        return data.embedding;
      }

      this.logger.warn('[RAG] No embedding in Ollama response');
      return null;

    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Failed to generate embedding');
      return null;
    }
  }

  /**
   * Hash query for Redis cache key (fast, consistent)
   */
  private hashQuery(query: string): string {
    // Simple hash - normalize whitespace and lowercase for better cache hits
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Queue background embedding generation - NEVER blocks user request
   * Generates embedding and caches to Redis for future requests
   */
  private async queueBackgroundEmbedding(query: string, cacheKey: string, redisService: any): Promise<void> {
    // Fire and forget - run in background without awaiting
    setImmediate(async () => {
      try {
        const embedding = await this.generateEmbedding(query);
        if (embedding && embedding.length > 0) {
          // Cache embedding to Redis with 24h TTL
          await redisService.set(cacheKey, JSON.stringify(embedding), 'EX', 86400);
          this.logger.info({ cacheKey, dimensions: embedding.length }, '[RAG] Background embedding cached to Redis');
        }
      } catch (error: any) {
        this.logger.warn({ error: error.message, cacheKey }, '[RAG] Background embedding generation failed');
      }
    });
  }

  /**
   * Search Milvus collection using pre-computed embedding (no embedding generation)
   */
  private async searchMilvusCollectionWithEmbedding(
    collection: string,
    embedding: number[],
    limit: number,
    filter?: any
  ): Promise<any[]> {
    try {
      // Check if collection exists
      const hasCollection = await this.milvusService.hasCollection({
        collection_name: collection
      });

      if (!hasCollection.value) {
        this.logger.debug(`Collection ${collection} does not exist`);
        return [];
      }

      // Ensure collection is loaded
      try { await this.milvusService.loadCollection({ collection_name: collection }); } catch {}

      // Search in Milvus using pre-computed embedding (SDK v2 format)
      const searchParams: any = {
        collection_name: collection,
        data: [embedding],
        limit,
        output_fields: ['content', 'metadata'],
      };

      if (filter) {
        const filterStr = this.buildMilvusFilter(filter);
        if (filterStr) searchParams.filter = filterStr;
      }

      const searchResult = await this.milvusService.search(searchParams);

      // SDK v2 returns results directly in searchResult.results
      const results = searchResult.results || searchResult.data || [];
      if (results.length > 0) {
        this.logger.info({ collection, resultCount: results.length }, '[RAG] Milvus search returned results');
        return results.map((result: any) => ({
          content: result.content || '',
          metadata: (() => { try { return typeof result.metadata === 'string' ? JSON.parse(result.metadata) : (result.metadata || {}); } catch { return {}; } })(),
          score: result.score || 0
        })).filter((r: any) => r.content.length > 10);
      }

      return [];

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        collection
      }, 'Failed to search Milvus collection with embedding');
      return [];
    }
  }

  private buildMilvusFilter(filter: any): string {
    const conditions: string[] = [];

    // Handle $or filter for user_documents (shared + private)
    if (filter.$or) {
      const orConds = filter.$or.map((f: any) => {
        if (f.userId) return `user_id == "${f.userId}"`;
        return null;
      }).filter(Boolean);
      if (orConds.length > 0) return `(${orConds.join(' || ')})`;
    }

    if (filter.userId) {
      conditions.push(`user_id == "${filter.userId}"`);
    }

    if (filter.sessionId) {
      conditions.push(`sessionId == "${filter.sessionId}"`);
    }

    if (filter.afterDate) {
      conditions.push(`timestamp > ${filter.afterDate.getTime()}`);
    }

    return conditions.join(' && ');
  }

  async rollback(context: PipelineContext): Promise<void> {
    // Clean up RAG context
    delete context.ragContext;

    if (context.metadata) {
      delete context.metadata.ragEnabled;
      delete context.metadata.ragDocsRetrieved;
      delete context.metadata.ragChatsRetrieved;
      delete context.metadata.ragArtifactsRetrieved;
      delete context.metadata.ragRetrievalTime;
    }

    this.logger.debug({
      messageId: context.messageId
    }, '[RAG] RAG stage rollback completed');
  }
}