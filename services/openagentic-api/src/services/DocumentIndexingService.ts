/**
 * Document Indexing Service
 *
 * Bridges file uploads with Milvus vector storage for semantic search.
 * Automatically indexes uploaded documents, generates embeddings, and enables
 * cross-session document retrieval via vector similarity search.
 *
 * Features:
 * - Automatic document chunking for large files
 * - Embedding generation via MCP Proxy
 * - User-scoped vector storage (privacy)
 * - Async background processing
 * - Integration with existing RAG pipeline
 *
 * ====================================================================
 * TODO: IMPLEMENT LATER - NOT YET INITIALIZED OR WORKING
 * ====================================================================
 *
 * This service is partially implemented but NOT initialized in server startup.
 * To complete implementation:
 *
 * 1. Initialize in server.ts:
 *    ```
 *    const documentIndexingService = new DocumentIndexingService(prisma, logger, milvusClient);
 *    await documentIndexingService.initialize();
 *    (global as any).documentIndexingService = documentIndexingService;
 *    ```
 *
 * 2. Ensure document text extraction works for:
 *    - PDF files (pdf-parse)
 *    - Word docs (mammoth)
 *    - Plain text/markdown/code files
 *
 * 3. Test semantic search over uploaded documents
 *
 * 4. Wire up to RAG pipeline so AI can search uploaded docs
 *
 * Current status: Service exists but is NOT active in production.
 * ====================================================================
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { nanoid } from 'nanoid';
import axios from 'axios';

interface DocumentChunk {
  id: string;
  fileId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  metadata: {
    filename: string;
    mimeType: string;
    totalChunks: number;
    chunkSize: number;
    uploadedAt: Date;
    fileSize: number;
  };
}

interface SearchResult {
  fileId: string;
  filename: string;
  chunkContent: string;
  score: number;
  metadata: Record<string, any>;
}

export class DocumentIndexingService {
  private milvus: MilvusClient;
  private prisma: PrismaClient;
  private logger: Logger;
  private mcpProxyEndpoint: string;
  private embeddingModel: string;
  private collectionName = 'user_documents';
  private chunkSize = 1000; // characters per chunk
  private chunkOverlap = 200; // overlap between chunks for context

  constructor(
    milvus: MilvusClient,
    prisma: PrismaClient,
    logger: Logger
  ) {
    this.milvus = milvus;
    this.prisma = prisma;
    this.logger = logger.child({ service: 'DocumentIndexing' });
    this.mcpProxyEndpoint = process.env.MCP_PROXY_ENDPOINT || 'http://openagentic-mcp-proxy:8080';
    this.embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-gemma';
  }

  /**
   * Initialize Milvus collection for user documents
   */
  async initializeCollection(): Promise<void> {
    try {
      const exists = await this.milvus.hasCollection({
        collection_name: this.collectionName
      });

      if (exists.value) {
        this.logger.info(`Collection ${this.collectionName} already exists`);
        return;
      }

      this.logger.info(`Creating collection: ${this.collectionName}`);

      // Create collection with schema
      await this.milvus.createCollection({
        collection_name: this.collectionName,
        fields: [
          {
            name: 'id',
            data_type: 5, // Int64
            is_primary_key: true,
            autoID: true
          },
          {
            name: 'chunk_id',
            data_type: 21, // VarChar
            max_length: 100
          },
          {
            name: 'file_id',
            data_type: 21, // VarChar
            max_length: 100
          },
          {
            name: 'user_id',
            data_type: 21, // VarChar
            max_length: 100
          },
          {
            name: 'chunk_index',
            data_type: 5, // Int64
          },
          {
            name: 'content',
            data_type: 21, // VarChar
            max_length: 2000
          },
          {
            name: 'embedding',
            data_type: 101, // FloatVector
            dim: 768 // Gemini embedding dimension
          },
          {
            name: 'metadata',
            data_type: 21, // VarChar (JSON string)
            max_length: 1000
          }
        ]
      });

      // Create index on embedding field for fast similarity search
      await this.milvus.createIndex({
        collection_name: this.collectionName,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'L2',
        params: { nlist: 128 }
      });

      // Load collection into memory
      await this.milvus.loadCollection({
        collection_name: this.collectionName
      });

      this.logger.info(`Collection ${this.collectionName} created and loaded`);
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize collection');
      throw error;
    }
  }

  /**
   * Index a document after upload
   * Called asynchronously after text extraction
   */
  async indexDocument(fileId: string): Promise<void> {
    try {
      this.logger.info({ fileId }, 'Starting document indexing');

      // Get file record with extracted text
      const file = await this.prisma.fileAttachment.findUnique({
        where: { id: fileId }
      });

      if (!file) {
        throw new Error(`File not found: ${fileId}`);
      }

      // Get extracted text from metadata
      const metadata = file.metadata as any;
      const extractedText = metadata?.extractedText;

      if (!extractedText || extractedText.trim().length === 0) {
        this.logger.warn({ fileId }, 'No extracted text to index');
        return;
      }

      // Split into chunks
      const chunks = this.chunkText(extractedText);
      this.logger.info({
        fileId,
        totalChunks: chunks.length,
        textLength: extractedText.length
      }, 'Document chunked');

      // Process each chunk
      const documentChunks: DocumentChunk[] = chunks.map((content, index) => ({
        id: nanoid(),
        fileId: file.id,
        userId: file.user_id,
        chunkIndex: index,
        content,
        metadata: {
          filename: file.original_name,
          mimeType: file.mime_type,
          totalChunks: chunks.length,
          chunkSize: content.length,
          uploadedAt: file.created_at,
          fileSize: file.size
        }
      }));

      // Generate embeddings and insert into Milvus
      await this.insertChunks(documentChunks);

      // Update file metadata to track indexing
      await this.prisma.fileAttachment.update({
        where: { id: fileId },
        data: {
          metadata: {
            ...metadata,
            indexed: true,
            indexedAt: new Date().toISOString(),
            totalChunks: chunks.length
          }
        }
      });

      this.logger.info({
        fileId,
        chunksIndexed: chunks.length
      }, 'Document indexing completed');

    } catch (error) {
      this.logger.error({ error, fileId }, 'Failed to index document');

      // Mark as failed in metadata
      try {
        const file = await this.prisma.fileAttachment.findUnique({
          where: { id: fileId }
        });
        if (file) {
          await this.prisma.fileAttachment.update({
            where: { id: fileId },
            data: {
              metadata: {
                ...(file.metadata as any || {}),
                indexed: false,
                indexingError: error.message,
                indexingFailedAt: new Date().toISOString()
              }
            }
          });
        }
      } catch (updateError) {
        this.logger.error({ updateError }, 'Failed to update error metadata');
      }
    }
  }

  /**
   * Search user's documents using semantic search
   */
  async searchDocuments(
    userId: string,
    query: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    try {
      this.logger.info({ userId, query, limit }, 'Searching user documents');

      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);

      // Search in Milvus
      const searchResults = await this.milvus.search({
        collection_name: this.collectionName,
        data: [queryEmbedding],
        limit,
        filter: `user_id == "${userId}"`,
        output_fields: ['chunk_id', 'file_id', 'chunk_index', 'content', 'metadata']
      });

      if (!searchResults.results || searchResults.results.length === 0) {
        return [];
      }

      // Format results
      const results: SearchResult[] = searchResults.results.map((result: any) => {
        const metadata = typeof result.metadata === 'string'
          ? JSON.parse(result.metadata)
          : result.metadata;

        return {
          fileId: result.file_id,
          filename: metadata.filename || 'Unknown',
          chunkContent: result.content,
          score: result.score,
          metadata
        };
      });

      this.logger.info({
        userId,
        resultsFound: results.length
      }, 'Document search completed');

      return results;

    } catch (error) {
      this.logger.error({ error, userId, query }, 'Document search failed');
      return [];
    }
  }

  /**
   * Delete document from vector storage
   */
  async deleteDocument(fileId: string): Promise<void> {
    try {
      this.logger.info({ fileId }, 'Deleting document from vector storage');

      // Delete all chunks for this file
      await this.milvus.delete({
        collection_name: this.collectionName,
        filter: `file_id == "${fileId}"`
      });

      this.logger.info({ fileId }, 'Document deleted from vector storage');
    } catch (error) {
      this.logger.error({ error, fileId }, 'Failed to delete document from vector storage');
    }
  }

  /**
   * Get document indexing statistics
   */
  async getIndexingStats(userId: string): Promise<{
    totalDocuments: number;
    indexedDocuments: number;
    totalChunks: number;
    failedDocuments: number;
  }> {
    try {
      // Get all user files
      const files = await this.prisma.fileAttachment.findMany({
        where: {
          user_id: userId,
          deleted_at: null
        }
      });

      const stats = {
        totalDocuments: files.length,
        indexedDocuments: 0,
        totalChunks: 0,
        failedDocuments: 0
      };

      files.forEach(file => {
        const metadata = file.metadata as any;
        if (metadata?.indexed === true) {
          stats.indexedDocuments++;
          stats.totalChunks += metadata.totalChunks || 0;
        } else if (metadata?.indexed === false) {
          stats.failedDocuments++;
        }
      });

      return stats;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get indexing stats');
      return {
        totalDocuments: 0,
        indexedDocuments: 0,
        totalChunks: 0,
        failedDocuments: 0
      };
    }
  }

  /**
   * Re-index a document (useful after failures)
   */
  async reindexDocument(fileId: string): Promise<void> {
    this.logger.info({ fileId }, 'Re-indexing document');

    // First delete existing chunks
    await this.deleteDocument(fileId);

    // Then re-index
    await this.indexDocument(fileId);
  }

  // Private helper methods

  /**
   * Chunk text into overlapping segments
   */
  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      // Get chunk with overlap
      const endIndex = Math.min(startIndex + this.chunkSize, text.length);
      let chunk = text.substring(startIndex, endIndex);

      // Try to break at sentence boundary if not at end
      if (endIndex < text.length) {
        const lastPeriod = chunk.lastIndexOf('. ');
        const lastNewline = chunk.lastIndexOf('\n');
        const breakPoint = Math.max(lastPeriod, lastNewline);

        if (breakPoint > this.chunkSize * 0.5) {
          chunk = chunk.substring(0, breakPoint + 1);
        }
      }

      chunks.push(chunk.trim());

      // Move to next chunk with overlap
      startIndex += chunk.length - this.chunkOverlap;

      // Prevent infinite loop
      if (startIndex <= chunks.length * (this.chunkSize - this.chunkOverlap) - this.chunkSize) {
        startIndex = chunks.length * (this.chunkSize - this.chunkOverlap);
      }
    }

    return chunks.filter(chunk => chunk.length > 0);
  }

  /**
   * Generate embedding using MCP Proxy
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        `${this.mcpProxyEndpoint}/embeddings`,
        {
          model: this.embeddingModel,
          input: text
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data?.data?.[0]?.embedding) {
        return response.data.data[0].embedding;
      }

      throw new Error('Invalid embedding response format');
    } catch (error) {
      this.logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Insert chunks into Milvus with embeddings
   */
  private async insertChunks(chunks: DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    try {
      // Generate embeddings for all chunks
      const embeddings = await Promise.all(
        chunks.map(chunk => this.generateEmbedding(chunk.content))
      );

      // Prepare data for insertion
      const data = chunks.map((chunk, index) => ({
        chunk_id: chunk.id,
        file_id: chunk.fileId,
        user_id: chunk.userId,
        chunk_index: chunk.chunkIndex,
        content: chunk.content.substring(0, 2000), // Max length
        embedding: embeddings[index],
        metadata: JSON.stringify(chunk.metadata).substring(0, 1000) // Max length
      }));

      // Insert into Milvus
      await this.milvus.insert({
        collection_name: this.collectionName,
        data
      });

      this.logger.info({
        chunksInserted: chunks.length
      }, 'Chunks inserted into Milvus');

    } catch (error) {
      this.logger.error({ error }, 'Failed to insert chunks into Milvus');
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor (Phase 4 — replaces (global as any).documentIndexingService)
// ---------------------------------------------------------------------------

let _documentIndexingServiceInstance: DocumentIndexingService | null = null;

export function setDocumentIndexingService(svc: DocumentIndexingService | null): void {
  _documentIndexingServiceInstance = svc;
}

export function getDocumentIndexingService(): DocumentIndexingService | null {
  return _documentIndexingServiceInstance;
}
