/**
 * Knowledge Ingestion Service
 * 
 * Ingests documentation and chat logs into Milvus for comprehensive RAG
 * Handles:
 * - Project documentation (MD, TXT files)
 * - Chat conversation logs
 * - Code comments and docstrings
 * - API documentation
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import { getModelCapabilityDiscoveryService } from './ModelCapabilityDiscoveryService.js';
import { dynamicModelManager } from './DynamicModelManager.js';

interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    type: 'documentation' | 'chat' | 'code' | 'api';
    title?: string;
    author?: string;
    timestamp?: Date;
    tags?: string[];
    userId?: string;
    sessionId?: string;
    isPrivate?: boolean;
    category?: string;
    relevance?: number;
  };
  embedding?: number[];
}

interface IngestionStats {
  totalDocuments: number;
  totalChunks: number;
  successfulChunks: number;
  failedChunks: number;
  collections: {
    documentation: number;
    chats: number;
    code: number;
  };
}

export class KnowledgeIngestionService {
  private milvus: MilvusClient;
  private prisma?: PrismaClient;
  private logger: Logger;
  private mcpProxyEndpoint: string;
  private collectionNames = {
    documentation: 'app_documentation',
    chats: 'chat_conversations',
    code: 'code_knowledge'
  };
  private stats: IngestionStats = {
    totalDocuments: 0,
    totalChunks: 0,
    successfulChunks: 0,
    failedChunks: 0,
    collections: {
      documentation: 0,
      chats: 0,
      code: 0
    }
  };

  constructor(milvus: MilvusClient, logger: Logger, prisma?: PrismaClient) {
    this.milvus = milvus;
    this.prisma = prisma;
    this.logger = logger.child({ service: 'KnowledgeIngestion' });
    this.mcpProxyEndpoint = process.env.MCP_PROXY_ENDPOINT || 'http://openagentic-mcp-proxy:8080';
  }

  /**
   * Initialize Milvus collections for different knowledge types
   */
  async initializeCollections(): Promise<void> {
    for (const [type, collectionName] of Object.entries(this.collectionNames)) {
      try {
        // Check if collection exists
        const exists = await this.milvus.hasCollection({ collection_name: collectionName });
        
        if (!exists.value) {
          this.logger.info(`Creating collection: ${collectionName}`);
          
          await this.milvus.createCollection({
            collection_name: collectionName,
            fields: [
              {
                name: 'id',
                data_type: 5, // Int64
                is_primary_key: true,
                autoID: true
              },
              {
                name: 'content',
                data_type: 21, // VarChar
                max_length: 65535
              },
              {
                name: 'embedding',
                data_type: 101, // FloatVector
                dim: 1536 // OpenAI embedding dimension
              },
              {
                name: 'source',
                data_type: 21, // VarChar
                max_length: 1000
              },
              {
                name: 'type',
                data_type: 21, // VarChar
                max_length: 50
              },
              {
                name: 'metadata',
                data_type: 23, // JSON
              },
              {
                name: 'timestamp',
                data_type: 5, // Int64 (Unix timestamp)
              }
            ]
          });

          // Create index for vector search
          await this.milvus.createIndex({
            collection_name: collectionName,
            field_name: 'embedding',
            index_type: 'IVF_FLAT',
            metric_type: 'COSINE',
            params: { nlist: 128 }
          });

          // Load collection into memory
          await this.milvus.loadCollection({ collection_name: collectionName });
        }
      } catch (error) {
        this.logger.error({ error, collection: collectionName }, 'Failed to initialize collection');
      }
    }
  }

  /**
   * Get embedding model from discovery service
   */
  private async getEmbeddingModel(): Promise<string> {
    // Try ModelCapabilityDiscoveryService first (SOT)
    const discoveryService = getModelCapabilityDiscoveryService();
    if (discoveryService) {
      const models = await discoveryService.searchModelsByCapability('embedding');
      if (models && models.length > 0) {
        return models[0].modelId;
      }
    }
    
    // Fallback to DynamicModelManager
    const embeddingInfo = await dynamicModelManager.getEmbeddingModel();
    if (embeddingInfo) {
      return embeddingInfo.model;
    }
    
    throw new Error('No embedding models available');
  }

  /**
   * Generate embeddings using MCP Proxy
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.mcpProxyEndpoint}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MCP_PROXY_API_KEY || ''}`
        },
        body: JSON.stringify({
          model: await this.getEmbeddingModel(),
          input: text
        })
      });

      if (!response.ok) {
        throw new Error(`Embedding generation failed: ${response.statusText}`);
      }

      const data = await response.json();
      return (data as any).data[0].embedding;
    } catch (error) {
      this.logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Smart text chunking with overlap
   */
  chunkText(text: string, maxChunkSize: number = 1500, overlap: number = 200): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    let currentChunk = '';
    let chunkStart = 0;
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
        // Save current chunk
        chunks.push({
          id: crypto.randomBytes(16).toString('hex'),
          content: currentChunk.trim(),
          metadata: {
            source: 'text_chunk',
            type: 'documentation',
            tags: []
          }
        });
        
        // Start new chunk with overlap
        const overlapSentences = [];
        let overlapLength = 0;
        for (let j = i - 1; j >= chunkStart && overlapLength < overlap; j--) {
          overlapSentences.unshift(sentences[j]);
          overlapLength += sentences[j].length;
        }
        currentChunk = overlapSentences.join(' ') + sentence;
        chunkStart = i;
      } else {
        currentChunk += sentence;
      }
    }
    
    // Add remaining chunk
    if (currentChunk.trim()) {
      chunks.push({
        id: crypto.randomBytes(16).toString('hex'),
        content: currentChunk.trim(),
        metadata: {
          source: 'text_chunk',
          type: 'documentation',
          tags: []
        }
      });
    }
    
    return chunks;
  }

  /**
   * Ingest all project documentation
   */
  async ingestDocumentation(): Promise<void> {
    this.logger.info('Starting documentation ingestion...');
    
    // Configurable docs root; defaults to the deployed app's docs directory.
    const docsRoot = process.env.KNOWLEDGE_DOCS_DIR || path.resolve(process.cwd(), 'docs');
    const baseDirs = [
      // Main project docs
      docsRoot,
      // Docusaurus docs site
      path.join(docsRoot, 'services/docs')
    ];
    
    const docPatterns = [
      '**/*.md',
      '**/README*',
      '**/*.mdx',  // Docusaurus MDX files
      '**/*.txt',
      '!**/node_modules/**',
      '!**/dist/**',
      '!**/.git/**',
      '!**/.docusaurus/**',
      '!**/build/**'
    ];

    for (const baseDir of baseDirs) {
      this.logger.info(`Ingesting documentation from: ${baseDir}`);
      
      for (const pattern of docPatterns) {
        const files = await glob(pattern, { 
          cwd: baseDir,
          absolute: true,
          ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.docusaurus/**', '**/build/**']
        });
        
        for (const filePath of files) {
          try {
            await this.ingestDocumentFile(filePath);
            this.stats.totalDocuments++;
          } catch (error) {
            this.logger.error({ error, file: filePath }, 'Failed to ingest document');
          }
        }
      }
    }
  }

  /**
   * Ingest a single documentation file
   */
  async ingestDocumentFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      const docsRoot = process.env.KNOWLEDGE_DOCS_DIR || path.resolve(process.cwd(), 'docs');
      const relativePath = path.relative(docsRoot, filePath);
      
      // Extract title from markdown
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : fileName;
      
      // Determine category from path
      const category = this.categorizeDocument(relativePath);
      
      // Chunk the document
      const chunks = this.chunkText(content);
      
      for (const chunk of chunks) {
        // Enhance chunk metadata
        chunk.metadata = {
          ...chunk.metadata,
          source: relativePath,
          type: 'documentation',
          title,
          category,
          timestamp: new Date(),
          tags: this.extractTags(content)
        };
        
        // Generate embedding
        chunk.embedding = await this.generateEmbedding(chunk.content);
        
        // Store in Milvus
        await this.storeInMilvus(chunk, this.collectionNames.documentation);
        this.stats.successfulChunks++;
        this.stats.collections.documentation++;
      }
      
      this.logger.info({ file: fileName, chunks: chunks.length }, 'Document ingested');
    } catch (error) {
      this.logger.error({ error, file: filePath }, 'Failed to process document');
      this.stats.failedChunks++;
    }
  }

  /**
   * Ingest raw content into a knowledge base collection.
   * Used by artifact-to-knowledge-base pipeline (with DLP gate upstream).
   */
  async ingestContent(opts: {
    content: string;
    title: string;
    source: string;
    collectionName: string;
    metadata?: Record<string, any>;
  }): Promise<{ chunks: number }> {
    const { content, title, source, collectionName, metadata } = opts;
    const chunks = this.chunkText(content);
    let stored = 0;

    for (const chunk of chunks) {
      chunk.metadata = {
        ...chunk.metadata,
        ...metadata,
        source,
        type: 'documentation',
        title,
        timestamp: new Date(),
      };
      chunk.embedding = await this.generateEmbedding(chunk.content);
      await this.storeInMilvus(chunk, collectionName);
      stored++;
      this.stats.successfulChunks++;
    }

    this.logger.info({ title, source, chunks: stored, collection: collectionName }, 'Content ingested into knowledge base');
    return { chunks: stored };
  }

  /**
   * Ingest chat conversations from database
   */
  async ingestChatLogs(options: {
    limit?: number;
    startDate?: Date;
    endDate?: Date;
    excludePrivate?: boolean;
  } = {}): Promise<void> {
    this.logger.info('Starting chat log ingestion...');
    
    try {
      // Fetch chat sessions
      const sessions = await this.prisma.chatSession.findMany({
        where: {
          created_at: {
            gte: options.startDate,
            lte: options.endDate
          }
        },
        include: {
          messages: {
            orderBy: { created_at: 'asc' }
          }
        },
        take: options.limit
      });
      
      for (const session of sessions) {
        // Group messages into conversation chunks
        const conversationChunks = this.chunkConversation(session.messages);
        
        for (const chunk of conversationChunks) {
          try {
            // Prepare chunk data
            const documentChunk: DocumentChunk = {
              id: crypto.randomBytes(16).toString('hex'),
              content: chunk.content,
              metadata: {
                source: `chat_session_${session.id}`,
                type: 'chat',
                sessionId: session.id,
                userId: session.user_id,
                timestamp: chunk.timestamp,
                isPrivate: options.excludePrivate ? false : true,
                tags: chunk.topics || []
              }
            };
            
            // Generate embedding
            documentChunk.embedding = await this.generateEmbedding(chunk.content);
            
            // Store in Milvus
            await this.storeInMilvus(documentChunk, this.collectionNames.chats);
            this.stats.successfulChunks++;
            this.stats.collections.chats++;
          } catch (error) {
            this.logger.error({ error, sessionId: session.id }, 'Failed to ingest chat chunk');
            this.stats.failedChunks++;
          }
        }
      }
      
      this.logger.info({ sessions: sessions.length }, 'Chat logs ingested');
    } catch (error) {
      this.logger.error({ error }, 'Failed to ingest chat logs');
    }
  }

  /**
   * Chunk conversation into searchable segments
   */
  private chunkConversation(messages: any[]): any[] {
    const chunks = [];
    const windowSize = 5; // Group 5 messages together
    
    for (let i = 0; i < messages.length; i += windowSize) {
      const window = messages.slice(i, Math.min(i + windowSize, messages.length));
      
      // Format conversation chunk
      const content = window.map(msg => 
        `${msg.role}: ${msg.content}`
      ).join('\n\n');
      
      // Extract topics from conversation
      const topics = this.extractTopicsFromChat(content);
      
      chunks.push({
        content,
        timestamp: window[0].created_at,
        topics
      });
    }
    
    return chunks;
  }

  /**
   * Extract topics from chat content
   */
  private extractTopicsFromChat(content: string): string[] {
    const topics: string[] = [];
    
    // Look for technical terms
    const techTerms = content.match(/\b(API|database|authentication|deployment|error|bug|feature|integration|performance|security)\b/gi);
    if (techTerms) {
      topics.push(...new Set(techTerms.map(t => t.toLowerCase())));
    }
    
    // Look for service names
    const services = content.match(/\b(milvus|redis|postgres|docker|kubernetes|azure|aws)\b/gi);
    if (services) {
      topics.push(...new Set(services.map(s => s.toLowerCase())));
    }
    
    return topics;
  }

  /**
   * Store document chunk in Milvus
   */
  private async storeInMilvus(chunk: DocumentChunk, collectionName: string): Promise<void> {
    try {
      await this.milvus.insert({
        collection_name: collectionName,
        data: [{
          content: chunk.content,
          embedding: chunk.embedding,
          source: chunk.metadata.source,
          type: chunk.metadata.type,
          metadata: JSON.stringify(chunk.metadata),
          timestamp: Math.floor((chunk.metadata.timestamp?.getTime() || Date.now()) / 1000)
        }]
      });
      
      this.stats.totalChunks++;
    } catch (error) {
      this.logger.error({ error, collection: collectionName }, 'Failed to store in Milvus');
      throw error;
    }
  }

  /**
   * Categorize document based on path
   */
  private categorizeDocument(filePath: string): string {
    if (filePath.includes('/api/')) return 'api';
    if (filePath.includes('/docs/')) return 'documentation';
    if (filePath.includes('/architecture/')) return 'architecture';
    if (filePath.includes('/mcp/')) return 'mcp';
    if (filePath.includes('/chat/')) return 'chat';
    if (filePath.includes('/auth/')) return 'authentication';
    if (filePath.includes('/deployment/')) return 'deployment';
    if (filePath.includes('/database/')) return 'database';
    return 'general';
  }

  /**
   * Extract tags from content
   */
  private extractTags(content: string): string[] {
    const tags: string[] = [];
    
    // Extract hashtags
    const hashtags = content.match(/#\w+/g);
    if (hashtags) {
      tags.push(...hashtags.map(tag => tag.slice(1).toLowerCase()));
    }
    
    // Extract code language indicators
    const codeBlocks = content.match(/```(\w+)/g);
    if (codeBlocks) {
      tags.push(...codeBlocks.map(block => block.slice(3).toLowerCase()));
    }
    
    return [...new Set(tags)];
  }

  /**
   * Get ingestion statistics
   */
  getStats(): IngestionStats {
    return this.stats;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalDocuments: 0,
      totalChunks: 0,
      successfulChunks: 0,
      failedChunks: 0,
      collections: {
        documentation: 0,
        chats: 0,
        code: 0
      }
    };
  }

  /**
   * Search across all knowledge bases
   */
  async searchKnowledge(query: string, options: {
    collections?: string[];
    limit?: number;
    includePrivate?: boolean;
    userId?: string;
  } = {}): Promise<any[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    const collections = options.collections || Object.values(this.collectionNames);
    const results = [];
    
    for (const collection of collections) {
      try {
        const searchResults = await this.milvus.search({
          collection_name: collection,
          data: [queryEmbedding],
          limit: options.limit || 5,
          output_fields: ['content', 'source', 'type', 'metadata']
        });
        
        // Filter private content if needed
        const filtered = searchResults.results.filter(result => {
          const metadata = JSON.parse(result.metadata || '{}');
          if (!options.includePrivate && metadata.isPrivate) {
            return metadata.userId === options.userId;
          }
          return true;
        });
        
        results.push(...filtered);
      } catch (error) {
        this.logger.error({ error, collection }, 'Search failed');
      }
    }
    
    // Sort by similarity score
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Public search method for RAG pipeline
   * Maps collection names and formats results
   */
  async search(query: string, options: {
    collections?: string[];
    limit?: number;
    userId?: string;
    includePrivate?: boolean;
    includeSources?: boolean;
  } = {}): Promise<any[]> {
    // Map collection names to internal names
    const mappedCollections = options.collections?.map(name => {
      if (name === 'app_documentation') return this.collectionNames.documentation;
      if (name === 'chat_conversations') return this.collectionNames.chats;
      if (name === 'code_knowledge') return this.collectionNames.code;
      return name;
    });

    const results = await this.searchKnowledge(query, {
      collections: mappedCollections,
      limit: options.limit,
      includePrivate: options.includePrivate,
      userId: options.userId
    });

    // Format results for RAG pipeline
    return results.map(result => ({
      content: result.content,
      score: result.score,
      metadata: {
        ...JSON.parse(result.metadata || '{}'),
        source: result.source,
        type: result.type
      }
    }));
  }
}