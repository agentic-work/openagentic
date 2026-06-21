/**
 * Milvus Vector Store Service
 * Handles per-user vector collections for artifacts and RAG
 *
 * Uses provider embeddings directly through embedding service
 */

import { MilvusClient, DataType, ConsistencyLevelEnum, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import sharp from 'sharp';
import mammoth from 'mammoth';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { prisma } from '../utils/prisma.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import type { ProviderManager } from './llm-providers/ProviderManager.js';

const logger = pino({
  name: 'milvus-vector-service',
  level: process.env.LOG_LEVEL || 'info'
});

// Vector dimensions discovered dynamically from models
const EMBEDDING_DIMENSIONS: Record<string, number> = {
  // Populated dynamically during model discovery
};

// Artifact types we support
export enum ArtifactType {
  DOCUMENT = 'document',
  IMAGE = 'image',
  CODE = 'code',
  MEMORY = 'memory',
  CONVERSATION = 'conversation',
  KNOWLEDGE = 'knowledge',
  FILE = 'file'
}

// Metadata structure for artifacts
export interface ArtifactMetadata {
  id: string;
  userId: string;
  type: ArtifactType;
  title: string;
  description?: string;
  source?: string;
  mimeType?: string;
  fileSize?: number;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
  lastAccessed?: Date;
  permissions?: {
    isPublic?: boolean;
    sharedWith?: string[];
  };
  processingInfo?: {
    chunks?: number;
    embeddingModel?: string;
    processingTime?: number;
  };
  contentHash?: string;
  originalContent?: string; // For small content, store original
  fileUrl?: string; // For larger files, store S3/blob URL
  thumbnailUrl?: string; // For images
  extractedText?: string; // For PDFs/images after OCR
}

export class MilvusVectorService {
  private client: MilvusClient;
  private embeddingService: UniversalEmbeddingService;
  private providerManager?: ProviderManager;
  private logger = logger;
  private embeddingDimension: number;

  constructor(providerManager?: ProviderManager) {
    this.providerManager = providerManager;
    // Initialize Milvus client
    if (!process.env.MILVUS_HOST || !process.env.MILVUS_PORT) {
      throw new Error('MILVUS_HOST and MILVUS_PORT must be configured');
    }

    this.client = new MilvusClient({
      address: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
      timeout: 60000 // 60 second timeout to handle slow Milvus operations
    });

    // Initialize embedding service (auto-detects from environment)
    this.embeddingService = new UniversalEmbeddingService(logger);
    const embeddingInfo = this.embeddingService.getInfo();
    this.embeddingDimension = embeddingInfo.dimensions;

    logger.info({
      embeddingDimensions: this.embeddingDimension,
      model: embeddingInfo.model,
      provider: embeddingInfo.provider,
      hasProviderManager: !!providerManager
    }, 'Milvus Vector Service initialized with embeddings');
  }

  /**
   * Initialize Milvus and create necessary collections
   */
  async initialize(): Promise<void> {
    try {
      // TODO: Implement Azure OpenAI embedding model discovery
      // Skip embedding model discovery for now
      logger.warn('Skipping embedding model discovery - TODO: implement Azure OpenAI embeddings');

      // Check connection
      const checkHealth = await this.client.checkHealth();
      logger.info({ health: checkHealth }, 'Milvus health check');

      // Create global artifact collection if not exists
      // NOTE: Collection creation may fail without embedding dimensions
      // await this.createGlobalCollections();

      logger.warn('Milvus initialization complete - embedding features disabled');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Milvus');
      throw error;
    }
  }

  /**
   * Discover available embedding models
   * TODO: Implement Azure OpenAI embedding model discovery
   */
  private async discoverEmbeddingModels(): Promise<void> {
    // TODO: Implement Azure OpenAI embedding model discovery
    // Should use Azure OpenAI embedding deployments
    logger.warn('Embedding model discovery disabled - TODO: implement Azure OpenAI embeddings');
    throw new Error('Embedding functionality disabled');
  }

  /**
   * Create global collections for system-wide artifacts
   */
  private async createGlobalCollections(): Promise<void> {
    const collections = [
      'global_knowledge_base',
      'system_documentation',
      'shared_artifacts'
    ];
    
    for (const collectionName of collections) {
      await this.createCollectionIfNotExists(collectionName);
    }
  }

  /**
   * Get or create a per-user collection
   */
  async getUserCollection(userId: string): Promise<string> {
    // Create a sanitized collection name
    const userHash = createHash('md5').update(userId).digest('hex').substring(0, 16);
    const collectionName = `user_${userHash}_artifacts`;
    
    await this.createCollectionIfNotExists(collectionName);
    
    // Track in database using Prisma
    try {
      await prisma.userVectorCollections.upsert({
        where: {
          user_id_collection_name: {
            user_id: userId,
            collection_name: collectionName
          }
        },
        update: {
          updated_at: new Date()
        },
        create: {
          user_id: userId,
          collection_name: collectionName,
          vector_dimension: this.embeddingDimension,
          index_type: 'IVF_FLAT',
          metadata: {
            created_by: 'MilvusVectorService',
            embedding_model: this.embeddingService.getInfo().model
          }
        }
      });
    } catch (error) {
      this.logger.warn({ error, userId, collectionName }, 'Failed to track collection in database');
    }
    
    return collectionName;
  }

  /**
   * Create a collection if it doesn't exist
   */
  private async createCollectionIfNotExists(collectionName: string): Promise<void> {
    try {
      const hasCollection = await this.client.hasCollection({ collection_name: collectionName });
      
      if (!hasCollection.value) {
        logger.info({ collectionName }, 'Creating new collection');
        
        // Define schema for artifact storage
        const fields = [
          {
            name: 'id',
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 128,
          },
          {
            name: 'user_id',
            data_type: DataType.VarChar,
            max_length: 128,
          },
          {
            name: 'artifact_type',
            data_type: DataType.VarChar,
            max_length: 50,
          },
          {
            name: 'title',
            data_type: DataType.VarChar,
            max_length: 500,
          },
          {
            name: 'content',
            data_type: DataType.VarChar,
            max_length: 65535, // Max for Milvus varchar
          },
          {
            name: 'embedding',
            data_type: DataType.FloatVector,
            dim: this.embeddingDimension,
          },
          {
            name: 'metadata',
            data_type: DataType.JSON,
          },
          {
            name: 'created_at',
            data_type: DataType.Int64,
          }
        ];
        
        await this.client.createCollection({
          collection_name: collectionName,
          fields,
          enable_dynamic_field: true,
          consistency_level: 'Strong' as any,  // Fix for Milvus SDK type issue
        });
        
        // Create indexes for better search performance
        await this.client.createIndex({
          collection_name: collectionName,
          field_name: 'embedding',
          index_type: 'IVF_FLAT',
          metric_type: 'L2',
          params: { nlist: 1024 },
        });
        
        // Create scalar indexes
        await this.client.createIndex({
          collection_name: collectionName,
          field_name: 'artifact_type',
          index_type: 'INVERTED',
        });
        
        // Load collection into memory
        await this.client.loadCollection({
          collection_name: collectionName,
        });
        
        logger.info({ collectionName }, 'Collection created and loaded');
      }
    } catch (error) {
      logger.error({ error, collectionName }, 'Failed to create collection');
      throw error;
    }
  }

  /**
   * Store an artifact (document, image, file) in user's vector collection
   */
  async storeArtifact(
    userId: string,
    artifact: {
      type: ArtifactType;
      title: string;
      content: Buffer | string;
      mimeType?: string;
      metadata?: Partial<ArtifactMetadata>;
    }
  ): Promise<string> {
    try {
      // Use the ID from metadata if provided, otherwise generate a new one
      const artifactId = artifact.metadata?.id || `artifact_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Process content based on type
      let processedContent: string;
      let embedding: number[];
      let extractedMetadata: Partial<ArtifactMetadata> = {};
      
      switch (artifact.type) {
        case ArtifactType.DOCUMENT:
          processedContent = await this.processDocument(artifact.content, artifact.mimeType);
          embedding = await this.generateTextEmbedding(processedContent);
          break;
          
        case ArtifactType.IMAGE:
          const imageData = await this.processImage(artifact.content as Buffer);
          processedContent = imageData.description;
          embedding = await this.generateImageEmbedding(artifact.content as Buffer);
          extractedMetadata = imageData.metadata;
          break;
          
        case ArtifactType.CODE:
          processedContent = typeof artifact.content === 'string' 
            ? artifact.content 
            : artifact.content.toString('utf-8');
          embedding = await this.generateCodeEmbedding(processedContent);
          break;
          
        default:
          processedContent = typeof artifact.content === 'string'
            ? artifact.content
            : artifact.content.toString('utf-8');
          embedding = await this.generateTextEmbedding(processedContent);
      }
      
      // Chunk large content
      const chunks = this.chunkContent(processedContent);
      const chunkIds: string[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `${artifactId}_chunk_${i}`;
        const chunkEmbedding = await this.generateTextEmbedding(chunks[i]);
        
        // Get user collection name
        const collectionName = await this.getUserCollection(userId);
        
        // Store in Milvus
        await this.client.insert({
          collection_name: collectionName,
          data: [{
            id: chunkId,
            user_id: userId,
            artifact_type: artifact.type,
            title: `${artifact.title} (Part ${i + 1}/${chunks.length})`,
            content: chunks[i],
            embedding: chunkEmbedding,
            metadata: JSON.stringify({
              ...artifact.metadata,
              ...extractedMetadata,
              artifactId,
              chunkIndex: i,
              totalChunks: chunks.length,
              contentHash: createHash('sha256').update(chunks[i]).digest('hex'),
            }),
            created_at: Date.now(),
          }],
        });
        
        chunkIds.push(chunkId);
      }

      // Flush to make data immediately queryable
      const collectionName = await this.getUserCollection(userId);
      await this.client.flush({
        collection_names: [collectionName]
      });
      this.logger.info({ collectionName, chunks: chunks.length }, 'Flushed collection after artifact insert');

      // Store metadata in PostgreSQL using Prisma
      try {
        await prisma.artifactMetadata.create({
          data: {
            id: artifactId,
            collection_id: (await prisma.userVectorCollections.findFirst({
              where: {
                user_id: userId,
                collection_name: await this.getUserCollection(userId)
              }
            }))?.id || 'unknown',
            artifact_type: artifact.type,
            artifact_name: artifact.title,
            content_hash: createHash('sha256').update(processedContent).digest('hex'),
            vector_embedding: embedding,
            metadata: {
              ...artifact.metadata,
              ...extractedMetadata,
              chunks: chunks.length,
              embeddingModel: this.embeddingService.getInfo().model
            },
            created_by: userId
          }
        });
      } catch (error) {
        this.logger.warn({ error, artifactId }, 'Failed to store artifact metadata in PostgreSQL');
      }
      
      logger.info({ artifactId, userId, chunks: chunks.length }, 'Artifact stored successfully');
      return artifactId;
      
    } catch (error) {
      logger.error({ error, userId }, 'Failed to store artifact');
      throw error;
    }
  }

  /**
   * Search for relevant artifacts using semantic search
   */
  async searchArtifacts(
    userId: string,
    query: string,
    options: {
      limit?: number;
      types?: ArtifactType[];
      tags?: string[];
      includeShared?: boolean;
      threshold?: number;
    } = {}
  ): Promise<Array<{
    id: string;
    title: string;
    content: string;
    score: number;
    metadata: any;
  }>> {
    try {
      const searchStartTime = Date.now();
      const { limit = 10, types, includeShared = false, threshold = 0.3 } = options; // Lower threshold for better recall

      // Generate query embedding
      const queryEmbedding = await this.generateTextEmbedding(query);
      
      // Determine collections to search
      const collections: string[] = [await this.getUserCollection(userId)];
      if (includeShared) {
        collections.push('shared_artifacts', 'global_knowledge_base');
      }
      
      const allResults = [];
      
      for (const collectionName of collections) {
        // Build filter expression
        let filter = `user_id == "${userId}"`;
        if (types && types.length > 0) {
          const typeFilter = types.map(t => `artifact_type == "${t}"`).join(' || ');
          filter = `(${filter}) && (${typeFilter})`;
        }
        
        // Search in Milvus
        const searchResult = await this.client.search({
          collection_name: collectionName,
          data: [queryEmbedding],
          output_fields: ['id', 'title', 'content', 'metadata', 'artifact_type'],
          limit,
          metric_type: 'L2',
          filter,
        });
        
        // Process results - Milvus returns array of arrays (one per query vector)
        // We only have one query vector, so get the first result set
        const hits = Array.isArray(searchResult.results)
          ? (searchResult.results.length > 0 && Array.isArray(searchResult.results[0])
              ? searchResult.results[0]
              : searchResult.results)
          : [];

        this.logger.info({
          collectionName,
          hitsCount: hits.length,
          rawResultsType: typeof searchResult.results,
          rawResultsIsArray: Array.isArray(searchResult.results),
          threshold
        }, 'Vector search raw results');

        for (const hit of hits) {
          const score = 1 / (1 + (hit.distance || hit.score || 0)); // Convert distance to similarity score
          const metadata = typeof hit.metadata === 'string' ? JSON.parse(hit.metadata || '{}') : (hit.metadata || {});
          // Extract original artifact ID from metadata (chunk IDs have _chunk_X suffix)
          const artifactId = metadata.artifactId || hit.id.split('_chunk_')[0];
          this.logger.info({ hitId: hit.id, artifactId, metadataArtifactId: metadata.artifactId, distance: hit.distance, score, threshold }, 'Processing vector search hit');
          if (score >= threshold) {
            allResults.push({
              id: artifactId, // Use original artifact ID, not chunk ID
              title: hit.title,
              content: hit.content,
              score,
              metadata,
            });
          }
        }
      }
      
      // Deduplicate by artifact ID (multiple chunks from same artifact may match)
      const seenIds = new Set<string>();
      const uniqueResults = allResults.filter(r => {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
        return true;
      });

      // Sort by score and limit
      uniqueResults.sort((a, b) => b.score - a.score);
      const finalResults = uniqueResults.slice(0, limit);
      
      // Track usage using Prisma
      try {
        await prisma.vectorSearchLogs.create({
          data: {
            user_id: userId,
            query_text: query,
            results_count: finalResults.length,
            response_time_ms: Date.now() - searchStartTime,
            metadata: {
              types: types,
              includeShared: includeShared,
              threshold: threshold
            }
          }
        });
      } catch (error) {
        this.logger.warn({ error, userId }, 'Failed to track search usage');
      }
      
      logger.info({ userId, query, results: finalResults.length }, 'Artifact search completed');
      return finalResults;
      
    } catch (error) {
      logger.error({ error, userId, query }, 'Failed to search artifacts');
      throw error;
    }
  }

  /**
   * Delete an artifact from vector storage
   */
  async deleteArtifact(userId: string, artifactId: string): Promise<void> {
    try {
      // For now, just log - actual deletion would depend on vector DB capabilities
      this.logger.info({ userId, artifactId }, 'Artifact deletion requested from vector storage');
    } catch (error) {
      this.logger.error({ err: error, userId, artifactId }, 'Failed to delete artifact from vector storage');
      throw new Error(`Failed to delete artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Health check for vector service
   */
  async healthCheck(): Promise<boolean> {
    // Basic health check - could be expanded to check Milvus connectivity.
    // Nothing here can throw yet, so this is a constant healthy signal.
    return true;
  }

  /**
   * Process document content (PDF, Word, Markdown, etc.)
   */
  private async processDocument(content: Buffer | string, mimeType?: string): Promise<string> {
    let text = '';
    
    if (Buffer.isBuffer(content)) {
      switch (mimeType) {
        case 'application/pdf':
          // PDF parsing removed - return placeholder
          text = '[PDF content extraction not supported - please convert to text format]';
          logger.warn('PDF parsing requested but not supported, returning placeholder text');
          break;
          
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
          const result = await mammoth.extractRawText({ buffer: content });
          text = result.value;
          break;
          
        case 'text/markdown':
          text = content.toString('utf-8');
          const processor = unified().use(remarkParse).use(remarkStringify);
          const file = await processor.process(text);
          text = String(file);
          break;
          
        default:
          text = content.toString('utf-8');
      }
    } else {
      text = content;
    }
    
    // Clean and normalize text
    text = text
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable characters
      .trim();
    
    return text;
  }

  /**
   * Process image and extract features
   */
  private async processImage(imageBuffer: Buffer): Promise<{
    description: string;
    metadata: Partial<ArtifactMetadata>;
  }> {
    try {
      // Get image metadata
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      
      // Generate thumbnail
      const thumbnail = await image
        .resize(256, 256, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      // Generate image description using vision model
      const description = await this.generateImageDescription(imageBuffer, metadata);
      
      return {
        description,
        metadata: {
          processingInfo: {
            chunks: 1,
            embeddingModel: 'azure-openai-vision',
          },
          fileSize: imageBuffer.length,
          mimeType: `image/${metadata.format}`,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to process image');
      return {
        description: 'Image processing failed',
        metadata: {},
      };
    }
  }

  /**
   * Chunk large content into smaller pieces
   */
  private chunkContent(content: string, maxChunkSize: number = 2000): string[] {
    const chunks: string[] = [];
    // ReDoS-hardened: bound the no-punctuation run (was /[^.!?]+[.!?]+/ — O(n²) on punctuation-free content).
    // The {1,2000} cap matches maxChunkSize, so a punctuation-free blob is split at the chunk boundary anyway.
    const sentences = content.match(/[^.!?]{1,2000}[.!?]+/g) || [content];
    
    let currentChunk = '';
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += ' ' + sentence;
      }
    }
    
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [content.substring(0, maxChunkSize)];
  }

  /**
   * Generate text embedding using configured embedding provider
   */
  private async generateTextEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingService.generateEmbedding(text);
      return result.embedding;
    } catch (error) {
      this.logger.error({ error }, 'Failed to generate text embedding');
      // Return zero vector as fallback
      return new Array(this.embeddingDimension).fill(0);
    }
  }

  /**
   * Generate code embedding with special handling
   */
  private async generateCodeEmbedding(code: string): Promise<number[]> {
    // Add code-specific context for better embeddings
    const codeContext = `Programming code:\n${code}`;
    return this.generateTextEmbedding(codeContext);
  }

  /**
   * Generate image embedding
   * TODO: Implement using Azure OpenAI vision model
   */
  private async generateImageEmbedding(imageBuffer: Buffer): Promise<number[]> {
    // TODO: Implement Azure OpenAI vision embeddings
    throw new Error('Image embedding functionality disabled - TODO: implement Azure OpenAI vision embeddings');
  }

  /**
   * Generate text description of image using vision model
   * TODO: Implement using Azure OpenAI vision model
   */
  private async generateImageDescription(imageBuffer: Buffer, metadata?: any): Promise<string> {
    // Fallback to basic metadata description
    if (metadata) {
      const sizeKB = Math.round((imageBuffer.length || metadata.size || 0) / 1024);
      return `Image: ${metadata.width}x${metadata.height} ${metadata.format} (${sizeKB}KB)`;
    }

    return 'Image content (description generation disabled - TODO: implement Azure OpenAI vision)';
  }

  /**
   * Detect image MIME type from buffer
   */
  private async detectImageMimeType(imageBuffer: Buffer): Promise<string> {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      const format = metadata.format;
      
      switch (format) {
        case 'jpeg':
          return 'image/jpeg';
        case 'png':
          return 'image/png';
        case 'webp':
          return 'image/webp';
        case 'gif':
          return 'image/gif';
        default:
          return 'image/jpeg'; // Default fallback
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to detect image format, using jpeg default');
      return 'image/jpeg';
    }
  }

  /**
   * Delete artifacts for a user
   */
  async deleteUserArtifacts(userId: string, artifactIds?: string[]): Promise<void> {
    try {
      const collectionName = await this.getUserCollection(userId);
      
      if (artifactIds && artifactIds.length > 0) {
        // Delete specific artifacts
        const filter = `id in [${artifactIds.map(id => `"${id}"`).join(', ')}]`;
        await this.client.deleteEntities({
          collection_name: collectionName,
          filter,
        });
      } else {
        // Delete all user artifacts
        await this.client.deleteEntities({
          collection_name: collectionName,
          filter: `user_id == "${userId}"`,
        });
      }
      
      logger.info({ userId, artifactIds }, 'Artifacts deleted');
    } catch (error) {
      logger.error({ error, userId }, 'Failed to delete artifacts');
      throw error;
    }
  }

  /**
   * Get artifact statistics for a user
   */
  async getUserArtifactStats(userId: string): Promise<{
    totalArtifacts: number;
    totalSize: number;
    typeDistribution: Record<string, number>;
    storageUsed: number;
  }> {
    try {
      const collectionName = await this.getUserCollection(userId);
      
      // Get collection stats
      const stats = await this.client.getCollectionStatistics({
        collection_name: collectionName,
      });
      
      // Query PostgreSQL for detailed stats using Prisma
      const artifacts = await prisma.artifactMetadata.findMany({
        where: {
          created_by: userId
        },
        select: {
          artifact_type: true,
          metadata: true
        }
      });
      
      const typeDistribution: Record<string, number> = {};
      let totalSize = 0;
      
      for (const artifact of artifacts) {
        const type = artifact.artifact_type;
        typeDistribution[type] = (typeDistribution[type] || 0) + 1;
        const metadata = artifact.metadata as any;
        if (metadata?.fileSize) {
          totalSize += parseInt(metadata.fileSize || '0');
        }
      }
      
      return {
        totalArtifacts: parseInt(stats.data.row_count || '0'),
        totalSize,
        typeDistribution,
        storageUsed: totalSize, // In bytes
      };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get artifact stats');
      throw error;
    }
  }

  /**
   * Share an artifact with other users
   */
  async shareArtifact(
    artifactId: string,
    ownerId: string,
    shareWith: string[]
  ): Promise<void> {
    try {
      // Copy artifact to shared collection
      const ownerCollection = await this.getUserCollection(ownerId);
      const sharedCollection = 'shared_artifacts';
      
      // Get artifact from owner's collection
      const queryResult = await this.client.query({
        collection_name: ownerCollection,
        filter: `id == "${artifactId}"`,
        output_fields: ['*'],
      });
      
      if (queryResult.data.length === 0) {
        throw new Error('Artifact not found');
      }
      
      // Insert into shared collection with updated metadata
      const artifact = queryResult.data[0];
      const existingMetadata = JSON.parse(artifact.metadata || '{}');
      const updatedMetadata = {
        ...existingMetadata,
        sharedBy: ownerId,
        sharedWith: shareWith,
        sharedAt: new Date().toISOString()
      };
      
      await this.client.insert({
        collection_name: sharedCollection,
        data: [{
          ...artifact,
          metadata: JSON.stringify(updatedMetadata),
        }],
      });
      
      // Update PostgreSQL using Prisma
      try {
        for (const sharedUserId of shareWith) {
          await prisma.artifactShares.create({
            data: {
              artifact_id: artifactId,
              shared_by: ownerId,
              shared_with: sharedUserId,
              permission_level: 'read',
              expires_at: null // No expiration
            }
          });
        }
      } catch (error) {
        this.logger.warn({ error, artifactId }, 'Failed to update share records in PostgreSQL');
      }
      
      logger.info({ artifactId, ownerId, shareWith }, 'Artifact shared');
    } catch (error) {
      logger.error({ error, artifactId, ownerId }, 'Failed to share artifact');
      throw error;
    }
  }

  /**
   * Create embedding for text using configured embedding provider
   */
  private async createEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingService.generateEmbedding(text);
      return result.embedding;
    } catch (error) {
      this.logger.error({ error }, 'Failed to create embedding');
      // Return zero vector as fallback
      return new Array(this.embeddingDimension).fill(0);
    }
  }

  /**
   * Search user memories for tiered context management
   * Used by MemoryContextService for Tier 2 and Tier 3 memories
   */
  async searchUserMemories(userId: string, query: any): Promise<any[]> {
    try {
      // Ensure we have a collection
      const hasCollection = await this.client.hasCollection({
        collection_name: `user_memories_${userId.replace(/-/g, '_')}`
      });

      if (!hasCollection.value) {
        this.logger.debug(`No memory collection for user ${userId}`);
        return [];
      }

      // Create embedding for the query
      const queryEmbedding = await this.createEmbedding(query.text || '');
      
      // Search in user's memory collection
      const searchResult = await this.client.search({
        collection_name: `user_memories_${userId.replace(/-/g, '_')}`,
        data: [queryEmbedding],
        limit: query.maxResults || 10,
        output_fields: ['memory_id', 'type', 'content', 'summary', 'entities', 'timestamp', 'session_id'],
        metric_type: MetricType.COSINE
      });

      if (!searchResult || !searchResult.results || searchResult.results.length === 0) {
        return [];
      }

      // Transform results to RankedMemory format
      return searchResult.results.map((result: any) => ({
        id: result.memory_id,
        userId,
        type: result.type || 'conversation_summary',
        content: result.content,
        summary: result.summary || result.content.substring(0, 200),
        entities: result.entities || [],
        timestamp: result.timestamp,
        sessionId: result.session_id,
        relevanceScore: result.score,
        tokenCount: Math.ceil((result.content?.length || 0) / 4)
      }));
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to search user memories');
      return [];
    }
  }

  /**
   * Store a memory for a user (conversation summary or domain knowledge)
   */
  async storeMemory(userId: string, memory: any): Promise<void> {
    try {
      // Ensure collection exists
      const collectionName = `user_memories_${userId.replace(/-/g, '_')}`;
      const hasCollection = await this.client.hasCollection({
        collection_name: collectionName
      });

      if (!hasCollection.value) {
        // Create collection with proper schema using dynamically discovered dimensions
        const embeddingDimension = this.embeddingDimension;
        await this.client.createCollection({
          collection_name: collectionName,
          dimension: embeddingDimension, // Use dynamically discovered embedding dimensions
          metric_type: MetricType.COSINE,
          schema: [
            { name: 'memory_id', data_type: DataType.VarChar, max_length: 100, is_primary_key: true },
            { name: 'embedding', data_type: DataType.FloatVector, dim: embeddingDimension },
            { name: 'type', data_type: DataType.VarChar, max_length: 50 },
            { name: 'content', data_type: DataType.VarChar, max_length: 8192 },
            { name: 'summary', data_type: DataType.VarChar, max_length: 1024 },
            { name: 'entities', data_type: DataType.JSON },
            { name: 'timestamp', data_type: DataType.Int64 },
            { name: 'session_id', data_type: DataType.VarChar, max_length: 100 }
          ]
        });

        await this.client.createIndex({
          collection_name: collectionName,
          field_name: 'embedding',
          index_type: IndexType.IVF_FLAT,
          metric_type: MetricType.COSINE,
          params: { nlist: 128 }
        });

        await this.client.loadCollection({ collection_name: collectionName });
      }

      // Create embedding for the memory content
      const embedding = await this.createEmbedding(memory.content);

      // Store the memory
      await this.client.insert({
        collection_name: collectionName,
        data: [{
          memory_id: memory.id || `memory_${Date.now()}`,
          embedding,
          type: memory.type || 'conversation_summary',
          content: memory.content.substring(0, 8192),
          summary: memory.summary || memory.content.substring(0, 1024),
          entities: JSON.stringify(memory.entities || []),
          timestamp: memory.timestamp || Date.now(),
          session_id: memory.sessionId || ''
        }]
      });

      this.logger.debug(`Stored memory for user ${userId}: ${memory.type}`);
    } catch (error) {
      this.logger.error({ error, userId, memory }, 'Failed to store memory');
      throw error;
    }
  }

  /**
   * Index a conversation by generating summaries and extracting entities
   */
  async indexConversation(userId: string, sessionId: string, messages: any[]): Promise<void> {
    try {
      if (!messages || messages.length < 3) {
        return; // Need at least a few messages to summarize
      }

      // Generate conversation summary using LLM
      const summary = await this.generateConversationSummary(messages);
      
      // Extract entities from the conversation
      const entities = await this.extractEntities(messages);

      // Store as a conversation summary memory
      await this.storeMemory(userId, {
        id: `summary_${sessionId}_${Date.now()}`,
        type: 'conversation_summary',
        content: summary,
        summary: summary.substring(0, 500),
        entities,
        timestamp: Date.now(),
        sessionId
      });

      // Store important domain knowledge as separate memories
      const domainKnowledge = await this.extractDomainKnowledge(messages);
      for (const knowledge of domainKnowledge) {
        await this.storeMemory(userId, {
          id: `knowledge_${sessionId}_${Date.now()}_${Math.random()}`,
          type: 'domain_knowledge',
          content: knowledge.content,
          summary: knowledge.summary,
          entities: knowledge.entities,
          timestamp: Date.now(),
          sessionId
        });
      }

      this.logger.info(`Indexed conversation ${sessionId} for user ${userId}`);
    } catch (error) {
      this.logger.error({ error, userId, sessionId }, 'Failed to index conversation');
    }
  }

  /**
   * Generate a summary of the conversation using LLM
   * Extracts key information, results, and data that should be remembered
   */
  private async generateConversationSummary(messages: any[]): Promise<string> {
    try {
      // If no ProviderManager available, fall back to basic extraction
      if (!this.providerManager) {
        this.logger.warn('ProviderManager not available - using basic summary extraction');
        return this.extractBasicSummary(messages);
      }

      // Build conversation context for summarization
      const conversationText = messages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role.toUpperCase()}: ${m.content || '[no content]'}`)
        .join('\n\n');

      // Limit conversation text to avoid token limits
      const truncatedText = conversationText.substring(0, 8000);

      const summaryPrompt = `You are a memory indexing assistant. Analyze this conversation and extract a concise summary that captures:

1. **Key Facts & Results**: Any specific data, names, numbers, or results mentioned (e.g., Azure subscription names, AWS account IDs, IAM users, resource counts, etc.)
2. **Actions Performed**: What was done in this conversation (e.g., "Listed Azure subscriptions", "Retrieved IAM users")
3. **Important Information**: Anything the user might want to recall later

CONVERSATION:
${truncatedText}

Provide a summary in this format:
---
FACTS:
- [List specific facts, names, IDs, results]

ACTIONS:
- [List what was done]

SUMMARY:
[1-2 sentence overview]
---`;

      // SoT — admin.model_role_assignments rows resolved via
      // ModelConfigurationService. Prefer the 'compaction' service slot
      // (cheap summarization tier); fall through to the default chat model.
      // Reading process.env.SUMMARIZATION_MODEL or hardcoding a literal
      // would bypass the registry and break per-env model swaps.
      const { ModelConfigurationService } = await import('./ModelConfigurationService.js');
      const compactionAssignment = await ModelConfigurationService.getServiceModel('compaction').catch(() => null);
      const summaryModel = compactionAssignment?.modelId
        ?? await ModelConfigurationService.getDefaultChatModel().catch(() => '');
      if (!summaryModel) {
        this.logger.warn('[Milvus] No chat/compaction model configured — falling back to extractive summary');
        return this.extractBasicSummary(messages);
      }
      const response = await this.providerManager.createCompletion({
        messages: [
          { role: 'system', content: 'You are a precise memory indexing assistant. Extract and preserve key facts, results, and data from conversations.' },
          { role: 'user', content: summaryPrompt }
        ],
        model: summaryModel,
        temperature: 0.3,
        max_tokens: 500
      });

      // Handle both streaming and non-streaming responses
      if (response && typeof response === 'object' && 'choices' in response) {
        const content = response.choices[0]?.message?.content || '';
        this.logger.info({ summaryLength: content.length }, 'Generated conversation summary via LLM');
        return content;
      }

      // Fallback to basic extraction if LLM call fails
      return this.extractBasicSummary(messages);

    } catch (error) {
      this.logger.error({ error }, 'Failed to generate LLM summary, falling back to basic extraction');
      return this.extractBasicSummary(messages);
    }
  }

  /**
   * Extract basic summary without LLM (fallback)
   */
  private extractBasicSummary(messages: any[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content) {
        // Extract tables (markdown tables often contain important data)
        const tables = msg.content.match(/\|.*\|[\s\S]*?\n(?=\n[^|]|$)/g);
        if (tables) {
          parts.push('DATA TABLES:\n' + tables.join('\n'));
        }

        // Extract bullet points with specific data
        const bulletPoints = msg.content.match(/^[*-]\s+.{10,}$/gm);
        if (bulletPoints) {
          parts.push('KEY POINTS:\n' + bulletPoints.slice(0, 10).join('\n'));
        }

        // Extract any structured information (key: value patterns)
        const keyValuePairs = msg.content.match(/\b\w+(?:\s+\w+)?:\s+[^\n,]+/g);
        if (keyValuePairs) {
          parts.push('EXTRACTED INFO:\n' + keyValuePairs.slice(0, 15).join('\n'));
        }
      }
    }

    return parts.length > 0
      ? parts.join('\n\n')
      : 'Conversation indexed for semantic search';
  }

  /**
   * Extract entities from the conversation
   */
  private async extractEntities(messages: any[]): Promise<string[]> {
    try {
      const conversationText = messages
        .map(m => m.content)
        .join(' ');

      // Simple entity extraction - can be enhanced with NER
      const entities = new Set<string>();
      
      // Extract URLs
      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = conversationText.match(urlRegex) || [];
      urls.forEach(url => entities.add(url));

      // Extract email addresses
      // ReDoS-hardened: bounded segments (was /[\w.-]+@[\w.-]+\.\w+/ — O(n²) on large conversation text).
      const emailRegex = /[\w.-]{1,64}@[\w.-]{1,255}\.\w{2,24}/g;
      const emails = conversationText.match(emailRegex) || [];
      emails.forEach(email => entities.add(email));

      // Extract capitalized words (potential proper nouns)
      const properNouns = conversationText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
      properNouns.forEach((noun: string) => {
        if (noun && noun.length > 3) entities.add(noun);
      });

      return Array.from(entities).slice(0, 20); // Limit to 20 entities
    } catch (error) {
      this.logger.error({ error }, 'Failed to extract entities');
      return [];
    }
  }

  /**
   * Extract domain knowledge from the conversation
   * Captures actual results, data, and important information
   */
  private async extractDomainKnowledge(messages: any[]): Promise<any[]> {
    const knowledge: any[] = [];

    // Get the user's original question for context
    const userQuestion = messages.find(m => m.role === 'user')?.content || '';

    for (const message of messages) {
      if (message.role === 'assistant' && message.content) {
        const content = message.content;

        // Extract markdown tables (often contain important data like Azure subscriptions, IAM users, etc.)
        const tableRegex = /\|[^\n]+\|[\s\S]*?(?=\n\n|\n[^|]|$)/g;
        const tables = content.match(tableRegex);
        if (tables) {
          for (const table of tables) {
            if (table.includes('|') && table.split('\n').length > 2) {
              knowledge.push({
                content: `User asked: "${userQuestion.substring(0, 200)}"\n\nResult:\n${table}`,
                summary: `Table data from query: ${userQuestion.substring(0, 100)}`,
                entities: this.extractEntitiesFromTable(table)
              });
            }
          }
        }

        // Extract JSON data blocks (often contain API results)
        const jsonBlocks = content.match(/```json[\s\S]*?```/g);
        if (jsonBlocks) {
          for (const json of jsonBlocks) {
            knowledge.push({
              content: `Query: "${userQuestion.substring(0, 200)}"\n\n${json}`,
              summary: `JSON data from: ${userQuestion.substring(0, 100)}`,
              entities: ['json', 'data', 'api_result']
            });
          }
        }

        // Extract code blocks
        const codeBlocks = content.match(/```(?!json)[\s\S]*?```/g);
        if (codeBlocks) {
          for (const code of codeBlocks.slice(0, 3)) { // Limit to 3 code blocks
            knowledge.push({
              content: code,
              summary: 'Code example from conversation',
              entities: ['code', 'programming']
            });
          }
        }

        // Extract numbered/bulleted lists with actual data
        const listRegex = /(?:^|\n)(?:[*-]|\d+\.)\s+.+(?:\n(?:[*-]|\d+\.)\s+.+)*/g;
        const lists = content.match(listRegex);
        if (lists) {
          for (const list of lists) {
            // Only capture lists with substantive content (not just navigation/instructions)
            if (list.length > 100 && !list.includes('click') && !list.includes('navigate')) {
              knowledge.push({
                content: `Context: ${userQuestion.substring(0, 150)}\n\n${list}`,
                summary: `List of items: ${this.extractListSummary(list)}`,
                entities: this.extractEntitiesFromList(list)
              });
            }
          }
        }

        // Extract key-value information (subscription IDs, account numbers, etc.)
        const kvPairs = content.match(/(?:subscription|account|user|id|name|arn|resource)[\s\w]*:\s*[^\n]+/gi);
        if (kvPairs && kvPairs.length > 0) {
          knowledge.push({
            content: `Query: "${userQuestion.substring(0, 150)}"\n\nExtracted Information:\n${kvPairs.slice(0, 20).join('\n')}`,
            summary: `Key information from: ${userQuestion.substring(0, 80)}`,
            entities: kvPairs.slice(0, 10).map(p => p.split(':')[0].trim().toLowerCase())
          });
        }
      }
    }

    return knowledge.slice(0, 8); // Limit to 8 knowledge items per conversation
  }

  /**
   * Extract entities from a markdown table
   */
  private extractEntitiesFromTable(table: string): string[] {
    const entities: string[] = [];

    // Extract header names
    const headerMatch = table.match(/\|([^|]+)/g);
    if (headerMatch) {
      headerMatch.forEach(h => {
        const clean = h.replace(/\|/g, '').trim().toLowerCase();
        if (clean && clean.length > 2 && clean !== '---') {
          entities.push(clean);
        }
      });
    }

    // Common resource identifiers
    if (table.toLowerCase().includes('subscription')) entities.push('azure', 'subscription');
    if (table.toLowerCase().includes('aws')) entities.push('aws');
    if (table.toLowerCase().includes('iam')) entities.push('iam', 'users');
    if (table.toLowerCase().includes('resource')) entities.push('resource', 'cloud');

    return [...new Set(entities)].slice(0, 10);
  }

  /**
   * Extract a short summary from a list
   */
  private extractListSummary(list: string): string {
    const items = list.split('\n').filter(l => l.trim());
    return `${items.length} items starting with: ${items[0]?.substring(0, 50) || 'unknown'}`;
  }

  /**
   * Extract entities from a list
   */
  private extractEntitiesFromList(list: string): string[] {
    const entities: string[] = [];

    // Look for specific patterns
    if (list.includes('Azure') || list.includes('azure')) entities.push('azure');
    if (list.includes('AWS') || list.includes('aws')) entities.push('aws');
    if (list.includes('subscription')) entities.push('subscription');
    if (list.includes('IAM') || list.includes('iam')) entities.push('iam');
    if (list.includes('user')) entities.push('user');
    if (list.includes('resource')) entities.push('resource');

    return [...new Set(entities)];
  }

  /**
   * Store a single conversation message with embedding for semantic search.
   */
  async storeConversationMessage(data: {
    user_id: string;
    session_id: string;
    message_id: string;
    role: string;
    content: string;
    embedding: number[];
    metadata?: any;
  }): Promise<void> {
    try {
      // Get or create user collection for conversations
      const collectionName = `user_${createHash('md5').update(data.user_id).digest('hex').substring(0, 16)}_conversations`;

      // Create collection if it doesn't exist
      await this.createConversationCollectionIfNotExists(collectionName);

      // Insert the conversation
      await this.client.insert({
        collection_name: collectionName,
        data: [{
          id: `${data.session_id}_${data.message_id}`,
          user_id: data.user_id,
          artifact_type: 'conversation',
          title: `${data.role}: ${data.content.substring(0, 100)}`,
          content: data.content,
          embedding: data.embedding,
          metadata: JSON.stringify(data.metadata || {}),
          created_at: Date.now()
        }]
      });

      this.logger.debug({ user_id: data.user_id, message_id: data.message_id }, 'Conversation message stored');
    } catch (error) {
      this.logger.error({ error, user_id: data.user_id }, 'Failed to store conversation message');
      throw error;
    }
  }

  /**
   * Search for similar conversations using vector similarity.
   */
  async searchSimilarConversations(
    userId: string,
    queryEmbedding: number[],
    topK: number = 5
  ): Promise<Array<{ id: string; score: number; content: string; metadata?: any }>> {
    try {
      const collectionName = `user_${createHash('md5').update(userId).digest('hex').substring(0, 16)}_conversations`;

      // Check if collection exists
      const hasCollection = await this.client.hasCollection({ collection_name: collectionName });
      if (!hasCollection.value) {
        this.logger.debug({ userId }, 'No conversation collection found');
        return [];
      }

      // Search using vector similarity
      const searchResults = await this.client.search({
        collection_name: collectionName,
        data: [queryEmbedding],
        limit: topK,
        output_fields: ['id', 'content', 'metadata'],
        metric_type: 'L2'
      });

      return searchResults[0]?.map((result: any) => ({
        id: result.id,
        score: 1 / (1 + result.distance), // Convert L2 distance to similarity score
        content: result.content,
        metadata: result.metadata ? JSON.parse(result.metadata) : undefined
      })) || [];

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to search conversations');
      return [];
    }
  }

  /**
   * Search user memories by embedding similarity.
   */
  async searchMemoriesByEmbedding(
    userId: string,
    queryEmbedding: number[],
    topK: number = 3
  ): Promise<Array<{ id: string; content: string; score: number; metadata?: any }>> {
    try {
      // Search in user's conversation collection for memory-like content
      return await this.searchSimilarConversations(userId, queryEmbedding, topK);
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to search memories');
      return [];
    }
  }

  /**
   * Create conversation collection if it doesn't exist
   * @private
   */
  private async createConversationCollectionIfNotExists(collectionName: string): Promise<void> {
    try {
      const hasCollection = await this.client.hasCollection({ collection_name: collectionName });

      if (!hasCollection.value) {
        this.logger.info({ collectionName }, 'Creating conversation collection');

        const fields = [
          {
            name: 'id',
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 256,
          },
          {
            name: 'user_id',
            data_type: DataType.VarChar,
            max_length: 128,
          },
          {
            name: 'artifact_type',
            data_type: DataType.VarChar,
            max_length: 50,
          },
          {
            name: 'title',
            data_type: DataType.VarChar,
            max_length: 500,
          },
          {
            name: 'content',
            data_type: DataType.VarChar,
            max_length: 65535,
          },
          {
            name: 'embedding',
            data_type: DataType.FloatVector,
            dim: this.embeddingDimension,
          },
          {
            name: 'metadata',
            data_type: DataType.VarChar,
            max_length: 65535,
          },
          {
            name: 'created_at',
            data_type: DataType.Int64,
          }
        ];

        await this.client.createCollection({
          collection_name: collectionName,
          fields,
          enable_dynamic_field: true,
        });

        // Create index
        await this.client.createIndex({
          collection_name: collectionName,
          field_name: 'embedding',
          index_type: 'IVF_FLAT',
          metric_type: 'L2',
          params: { nlist: 1024 },
        });

        // Load collection
        await this.client.loadCollection({
          collection_name: collectionName,
        });

        this.logger.info({ collectionName }, 'Conversation collection created');
      }
    } catch (error) {
      this.logger.error({ error, collectionName }, 'Failed to create conversation collection');
      throw error;
    }
  }
}

export default MilvusVectorService;