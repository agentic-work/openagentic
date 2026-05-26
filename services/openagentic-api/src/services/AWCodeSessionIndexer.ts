/**
 * AWCode Session Indexer
 * Indexes AWCode CLI sessions into Milvus for semantic search and knowledge retrieval
 *
 * This enables:
 * - Finding similar past sessions based on context
 * - Retrieving solutions from previous coding sessions
 * - Cross-user knowledge sharing (if enabled)
 * - Intelligent context augmentation for new sessions
 */

import { MilvusClient, DataType, ErrorCode } from '@zilliz/milvus2-sdk-node';
import { prisma } from '../utils/prisma.js';

// Milvus connection configuration
const MILVUS_HOST = process.env.MILVUS_HOST || 'milvus';
const MILVUS_PORT = process.env.MILVUS_PORT || '19530';
const MILVUS_USER = process.env.MILVUS_USER || '';
const MILVUS_PASSWORD = process.env.MILVUS_PASSWORD || '';

// Collection names
const AWCODE_SESSIONS_COLLECTION = 'awcode_session_knowledge';
const AWCODE_SOLUTIONS_COLLECTION = 'awcode_shared_solutions';

// H9: dimensions come from the embedding service at runtime
// (this.embeddingService.getInfo().dimensions). No model-pinned default —
// see docs/rules/no-hardcoded-models.md.

// Chunk settings
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

export interface SessionKnowledge {
  sessionId: string;
  userId: string;
  title?: string;
  summary?: string;
  content: string;
  contentType: 'query' | 'solution' | 'error' | 'code' | 'context';
  metadata?: {
    model?: string;
    workspacePath?: string;
    toolsUsed?: string[];
    filesModified?: string[];
    errorType?: string;
    tags?: string[];
  };
}

export interface SearchResult {
  id: string;
  sessionId: string;
  userId: string;
  content: string;
  contentType: string;
  score: number;
  metadata: any;
}

export class AWCodeSessionIndexer {
  private client: MilvusClient | null = null;
  private embeddingService: any = null;
  private initialized = false;
  // H9: stored at initialize() from embeddingService.getInfo().dimensions.
  // Used for both Milvus schema dim and zero-vector fallback shape.
  private embeddingDim = 0;

  constructor() {
    // Lazy initialization
  }

  /**
   * Initialize Milvus connection and create collections if needed
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      this.client = new MilvusClient({
        address: `${MILVUS_HOST}:${MILVUS_PORT}`,
        username: MILVUS_USER || undefined,
        password: MILVUS_PASSWORD || undefined,
      });

      // Test connection
      const health = await this.client.checkHealth();
      if (!health.isHealthy) {
        console.error('[AWCodeIndexer] Milvus is not healthy');
        return false;
      }

      // Load embedding service dynamically
      try {
        const { UniversalEmbeddingService } = await import('./UniversalEmbeddingService.js');
        this.embeddingService = new UniversalEmbeddingService();
        this.embeddingDim = this.embeddingService.getInfo().dimensions;
      } catch {
        console.warn('[AWCodeIndexer] UniversalEmbeddingService not available, using fallback');
      }

      // Without a real embedding dim, the Milvus schema would be malformed
      // (or a stale collection's dim would mismatch new embeddings). Bail
      // before creating collections rather than silently bake the wrong dim.
      if (!this.embeddingDim) {
        console.warn('[AWCodeIndexer] No embedding dim available; skipping collection ensure.');
        return false;
      }

      // Create collections if they don't exist
      await this.ensureCollections();

      this.initialized = true;
      console.log('[AWCodeIndexer] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[AWCodeIndexer] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Create required collections in Milvus
   */
  private async ensureCollections(): Promise<void> {
    if (!this.client) return;

    // Check if sessions collection exists
    const sessionsExists = await this.client.hasCollection({
      collection_name: AWCODE_SESSIONS_COLLECTION,
    });

    if (!sessionsExists.value) {
      console.log(`[AWCodeIndexer] Creating collection: ${AWCODE_SESSIONS_COLLECTION}`);

      await this.client.createCollection({
        collection_name: AWCODE_SESSIONS_COLLECTION,
        fields: [
          { name: 'id', data_type: DataType.VarChar, max_length: 64, is_primary_key: true },
          { name: 'session_id', data_type: DataType.VarChar, max_length: 64 },
          { name: 'user_id', data_type: DataType.VarChar, max_length: 64 },
          { name: 'content', data_type: DataType.VarChar, max_length: 65535 },
          { name: 'content_type', data_type: DataType.VarChar, max_length: 32 },
          { name: 'title', data_type: DataType.VarChar, max_length: 256 },
          { name: 'model', data_type: DataType.VarChar, max_length: 64 },
          { name: 'workspace', data_type: DataType.VarChar, max_length: 512 },
          { name: 'tools_used', data_type: DataType.VarChar, max_length: 1024 },
          { name: 'files_modified', data_type: DataType.VarChar, max_length: 2048 },
          { name: 'tags', data_type: DataType.VarChar, max_length: 512 },
          { name: 'created_at', data_type: DataType.Int64 },
          { name: 'embedding', data_type: DataType.FloatVector, dim: this.embeddingDim },
        ],
      });

      // Create index for vector search
      await this.client.createIndex({
        collection_name: AWCODE_SESSIONS_COLLECTION,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 128 },
      });

      // Load collection
      await this.client.loadCollection({
        collection_name: AWCODE_SESSIONS_COLLECTION,
      });

      console.log(`[AWCodeIndexer] Collection ${AWCODE_SESSIONS_COLLECTION} created and loaded`);
    }

    // Check if shared solutions collection exists
    const solutionsExists = await this.client.hasCollection({
      collection_name: AWCODE_SOLUTIONS_COLLECTION,
    });

    if (!solutionsExists.value) {
      console.log(`[AWCodeIndexer] Creating collection: ${AWCODE_SOLUTIONS_COLLECTION}`);

      await this.client.createCollection({
        collection_name: AWCODE_SOLUTIONS_COLLECTION,
        fields: [
          { name: 'id', data_type: DataType.VarChar, max_length: 64, is_primary_key: true },
          { name: 'source_session_id', data_type: DataType.VarChar, max_length: 64 },
          { name: 'contributor_id', data_type: DataType.VarChar, max_length: 64 },
          { name: 'problem', data_type: DataType.VarChar, max_length: 8192 },
          { name: 'solution', data_type: DataType.VarChar, max_length: 65535 },
          { name: 'category', data_type: DataType.VarChar, max_length: 64 },
          { name: 'tags', data_type: DataType.VarChar, max_length: 512 },
          { name: 'upvotes', data_type: DataType.Int64 },
          { name: 'created_at', data_type: DataType.Int64 },
          { name: 'embedding', data_type: DataType.FloatVector, dim: this.embeddingDim },
        ],
      });

      // Create index
      await this.client.createIndex({
        collection_name: AWCODE_SOLUTIONS_COLLECTION,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 128 },
      });

      // Load collection
      await this.client.loadCollection({
        collection_name: AWCODE_SOLUTIONS_COLLECTION,
      });

      console.log(`[AWCodeIndexer] Collection ${AWCODE_SOLUTIONS_COLLECTION} created and loaded`);
    }
  }

  /**
   * Generate embedding for text content
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingService) {
      // Return zero vector if no embedding service available
      console.warn('[AWCodeIndexer] No embedding service available, returning zero vector');
      return new Array(this.embeddingDim).fill(0);
    }

    try {
      const result = await this.embeddingService.generateEmbedding(text);
      return result.embedding || new Array(this.embeddingDim).fill(0);
    } catch (error) {
      console.error('[AWCodeIndexer] Failed to generate embedding:', error);
      return new Array(this.embeddingDim).fill(0);
    }
  }

  /**
   * Index a complete session with all its messages
   */
  async indexSession(sessionId: string): Promise<boolean> {
    if (!await this.initialize()) return false;

    try {
      // Get session with messages from database
      const session = await prisma.aWCodeSession.findUnique({
        where: { id: sessionId },
        include: { messages: true },
      });

      if (!session) {
        console.warn(`[AWCodeIndexer] Session not found: ${sessionId}`);
        return false;
      }

      // Extract knowledge from session
      const knowledgeItems: SessionKnowledge[] = [];

      // Add session summary as context
      if (session.summary) {
        knowledgeItems.push({
          sessionId: session.id,
          userId: session.user_id,
          title: session.title || undefined,
          summary: session.summary,
          content: session.summary,
          contentType: 'context',
          metadata: {
            model: session.model || undefined,
            workspacePath: session.workspace_path || undefined,
            filesModified: session.files_modified || [],
          },
        });
      }

      // Process messages
      for (const message of session.messages) {
        // Index user queries
        if (message.role === 'user' && message.content) {
          knowledgeItems.push({
            sessionId: session.id,
            userId: session.user_id,
            title: session.title || undefined,
            content: message.content,
            contentType: 'query',
            metadata: {
              model: session.model || undefined,
            },
          });
        }

        // Index assistant solutions/code
        if (message.role === 'assistant' && message.content) {
          // Check if this is code
          const isCode = message.content.includes('```') ||
            message.files_written?.length > 0 ||
            message.tool_name?.includes('write') ||
            message.tool_name?.includes('edit');

          knowledgeItems.push({
            sessionId: session.id,
            userId: session.user_id,
            title: session.title || undefined,
            content: message.content,
            contentType: isCode ? 'code' : 'solution',
            metadata: {
              model: message.model || session.model || undefined,
              filesModified: message.files_written || [],
              toolsUsed: message.tool_name ? [message.tool_name] : [],
            },
          });
        }

        // Index errors for learning
        if (message.role === 'tool' && message.content?.toLowerCase().includes('error')) {
          knowledgeItems.push({
            sessionId: session.id,
            userId: session.user_id,
            title: session.title || undefined,
            content: message.content,
            contentType: 'error',
            metadata: {
              toolsUsed: message.tool_name ? [message.tool_name] : [],
              errorType: this.extractErrorType(message.content),
            },
          });
        }
      }

      // Index all knowledge items
      for (const item of knowledgeItems) {
        await this.indexKnowledge(item);
      }

      console.log(`[AWCodeIndexer] Indexed ${knowledgeItems.length} items from session ${sessionId}`);
      return true;
    } catch (error) {
      console.error(`[AWCodeIndexer] Failed to index session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Index a single knowledge item
   */
  async indexKnowledge(knowledge: SessionKnowledge): Promise<boolean> {
    if (!this.client || !await this.initialize()) return false;

    try {
      // Generate unique ID
      const id = `${knowledge.sessionId}_${knowledge.contentType}_${Date.now()}`;

      // Truncate content if too long, then chunk if needed
      let content = knowledge.content.substring(0, 65000);

      // Generate embedding
      const embedding = await this.generateEmbedding(content);

      // Prepare data for insertion
      const data = {
        id,
        session_id: knowledge.sessionId,
        user_id: knowledge.userId,
        content,
        content_type: knowledge.contentType,
        title: (knowledge.title || '').substring(0, 255),
        model: (knowledge.metadata?.model || '').substring(0, 63),
        workspace: (knowledge.metadata?.workspacePath || '').substring(0, 511),
        tools_used: JSON.stringify(knowledge.metadata?.toolsUsed || []).substring(0, 1023),
        files_modified: JSON.stringify(knowledge.metadata?.filesModified || []).substring(0, 2047),
        tags: JSON.stringify(knowledge.metadata?.tags || []).substring(0, 511),
        created_at: Date.now(),
        embedding,
      };

      await this.client.insert({
        collection_name: AWCODE_SESSIONS_COLLECTION,
        data: [data],
      });

      return true;
    } catch (error) {
      console.error('[AWCodeIndexer] Failed to index knowledge:', error);
      return false;
    }
  }

  /**
   * Search for similar session knowledge
   */
  async searchKnowledge(
    query: string,
    options: {
      userId?: string;
      contentTypes?: string[];
      limit?: number;
      threshold?: number;
    } = {}
  ): Promise<SearchResult[]> {
    if (!this.client || !await this.initialize()) return [];

    try {
      const embedding = await this.generateEmbedding(query);

      // Build filter expression
      const filters: string[] = [];
      if (options.userId) {
        filters.push(`user_id == "${options.userId}"`);
      }
      if (options.contentTypes && options.contentTypes.length > 0) {
        const types = options.contentTypes.map(t => `"${t}"`).join(', ');
        filters.push(`content_type in [${types}]`);
      }

      const searchParams: any = {
        collection_name: AWCODE_SESSIONS_COLLECTION,
        data: [embedding],
        limit: options.limit || 10,
        output_fields: ['session_id', 'user_id', 'content', 'content_type', 'title', 'model', 'tools_used', 'files_modified', 'tags', 'created_at'],
        metric_type: 'COSINE',
      };

      if (filters.length > 0) {
        searchParams.filter = filters.join(' && ');
      }

      const results = await this.client.search(searchParams);

      if (!results.results || results.results.length === 0) {
        return [];
      }

      const threshold = options.threshold || 0.5;

      return results.results
        .filter((r: any) => r.score >= threshold)
        .map((r: any) => ({
          id: r.id,
          sessionId: r.session_id,
          userId: r.user_id,
          content: r.content,
          contentType: r.content_type,
          score: r.score,
          metadata: {
            title: r.title,
            model: r.model,
            toolsUsed: JSON.parse(r.tools_used || '[]'),
            filesModified: JSON.parse(r.files_modified || '[]'),
            tags: JSON.parse(r.tags || '[]'),
            createdAt: r.created_at,
          },
        }));
    } catch (error) {
      console.error('[AWCodeIndexer] Search failed:', error);
      return [];
    }
  }

  /**
   * Get relevant context for a new session based on workspace and query
   */
  async getRelevantContext(
    userId: string,
    query: string,
    workspacePath?: string
  ): Promise<string> {
    const results = await this.searchKnowledge(query, {
      userId,
      contentTypes: ['solution', 'code', 'context'],
      limit: 5,
      threshold: 0.6,
    });

    if (results.length === 0) {
      return '';
    }

    // Build context from relevant past sessions
    const contextParts = results.map((r, i) => {
      const header = `--- Past Solution ${i + 1} (${r.contentType}) ---`;
      const title = r.metadata.title ? `Title: ${r.metadata.title}` : '';
      return `${header}\n${title}\n${r.content.substring(0, 2000)}`;
    });

    return `\n## Relevant Knowledge from Past Sessions:\n${contextParts.join('\n\n')}\n`;
  }

  /**
   * Share a solution to the shared solutions collection
   */
  async shareSolution(
    sessionId: string,
    userId: string,
    problem: string,
    solution: string,
    category: string,
    tags: string[] = []
  ): Promise<boolean> {
    if (!this.client || !await this.initialize()) return false;

    try {
      const id = `solution_${sessionId}_${Date.now()}`;
      const embedding = await this.generateEmbedding(`${problem}\n\n${solution}`);

      await this.client.insert({
        collection_name: AWCODE_SOLUTIONS_COLLECTION,
        data: [{
          id,
          source_session_id: sessionId,
          contributor_id: userId,
          problem: problem.substring(0, 8191),
          solution: solution.substring(0, 65534),
          category: category.substring(0, 63),
          tags: JSON.stringify(tags).substring(0, 511),
          upvotes: 0,
          created_at: Date.now(),
          embedding,
        }],
      });

      console.log(`[AWCodeIndexer] Shared solution from session ${sessionId}`);
      return true;
    } catch (error) {
      console.error('[AWCodeIndexer] Failed to share solution:', error);
      return false;
    }
  }

  /**
   * Search shared solutions across all users
   */
  async searchSharedSolutions(
    query: string,
    options: { category?: string; limit?: number; threshold?: number } = {}
  ): Promise<any[]> {
    if (!this.client || !await this.initialize()) return [];

    try {
      const embedding = await this.generateEmbedding(query);

      const filters: string[] = [];
      if (options.category) {
        filters.push(`category == "${options.category}"`);
      }

      const searchParams: any = {
        collection_name: AWCODE_SOLUTIONS_COLLECTION,
        data: [embedding],
        limit: options.limit || 10,
        output_fields: ['source_session_id', 'contributor_id', 'problem', 'solution', 'category', 'tags', 'upvotes', 'created_at'],
        metric_type: 'COSINE',
      };

      if (filters.length > 0) {
        searchParams.filter = filters.join(' && ');
      }

      const results = await this.client.search(searchParams);

      const threshold = options.threshold || 0.5;

      return (results.results || [])
        .filter((r: any) => r.score >= threshold)
        .map((r: any) => ({
          id: r.id,
          sourceSessionId: r.source_session_id,
          contributorId: r.contributor_id,
          problem: r.problem,
          solution: r.solution,
          category: r.category,
          tags: JSON.parse(r.tags || '[]'),
          upvotes: r.upvotes,
          score: r.score,
          createdAt: r.created_at,
        }));
    } catch (error) {
      console.error('[AWCodeIndexer] Failed to search shared solutions:', error);
      return [];
    }
  }

  /**
   * Extract error type from error message
   */
  private extractErrorType(message: string): string {
    const patterns = [
      { regex: /TypeError/i, type: 'TypeError' },
      { regex: /SyntaxError/i, type: 'SyntaxError' },
      { regex: /ReferenceError/i, type: 'ReferenceError' },
      { regex: /ModuleNotFound|ImportError/i, type: 'ImportError' },
      { regex: /PermissionDenied|EACCES/i, type: 'PermissionError' },
      { regex: /FileNotFound|ENOENT/i, type: 'FileNotFoundError' },
      { regex: /ConnectionError|ECONNREFUSED/i, type: 'ConnectionError' },
      { regex: /TimeoutError|ETIMEDOUT/i, type: 'TimeoutError' },
    ];

    for (const { regex, type } of patterns) {
      if (regex.test(message)) {
        return type;
      }
    }

    return 'Unknown';
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{ sessions: number; solutions: number }> {
    if (!this.client || !await this.initialize()) {
      return { sessions: 0, solutions: 0 };
    }

    try {
      const sessionsStats = await this.client.getCollectionStatistics({
        collection_name: AWCODE_SESSIONS_COLLECTION,
      });
      const solutionsStats = await this.client.getCollectionStatistics({
        collection_name: AWCODE_SOLUTIONS_COLLECTION,
      });

      return {
        sessions: parseInt(sessionsStats.data?.row_count || '0'),
        solutions: parseInt(solutionsStats.data?.row_count || '0'),
      };
    } catch (error) {
      console.error('[AWCodeIndexer] Failed to get stats:', error);
      return { sessions: 0, solutions: 0 };
    }
  }
}

// Export singleton instance
export const awcodeSessionIndexer = new AWCodeSessionIndexer();
