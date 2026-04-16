/**
 * Milvus Memory Service
 * 
 * Integrates Memory MCP data from Milvus with the MemoryContextService to provide
 * vector-based memory retrieval for context window management. Handles semantic
 * search, memory ranking, and efficient vector operations for user memories.
 * 
 * Features:
 * - Vector-based semantic memory search with similarity scoring
 * - Integration with MCP memory data structures and types
 * - Efficient memory ranking and relevance scoring algorithms
 * - Support for entity, topic, and text-based memory queries
 * - Configurable search thresholds and result limiting
 * - Memory deduplication and context optimization
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { Logger } from 'pino';
import { RankedMemory, Memory } from '../memory/types/Memory.js';
import { createHash } from 'crypto';
import { getModelCapabilityDiscoveryService } from './ModelCapabilityDiscoveryService.js';
import { dynamicModelManager } from './DynamicModelManager.js';

interface MemorySearchQuery {
  text?: string;
  entities?: string[];
  topics?: string[];
  limit?: number;
  threshold?: number;
}

export class MilvusMemoryService {
  private milvusClient: MilvusClient;
  private logger: any;
  
  constructor(logger: any) {
    this.logger = logger.child({ service: 'MilvusMemory' }) as Logger;
    
    if (!process.env.MILVUS_HOST || !process.env.MILVUS_PORT) {
      throw new Error('MILVUS_HOST and MILVUS_PORT must be configured');
    }
    
    this.milvusClient = new MilvusClient({
      address: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      username: process.env.MILVUS_USER,
      password: process.env.MILVUS_PASSWORD
    });
  }

  /**
   * Search user's memories in Milvus based on query
   * This is called by MemoryContextService.searchMemoriesByEmbedding
   */
  async searchUserMemories(
    userId: string, 
    query: MemorySearchQuery
  ): Promise<RankedMemory[]> {
    try {
      const collectionName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}_memory`;
      
      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });
      
      if (!hasCollection.value) {
        this.logger.debug(`No memory collection for user ${userId}`);
        return [];
      }
      
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query.text || '');
      
      // Search in Milvus
      const searchResult = await this.milvusClient.search({
        collection_name: collectionName,
        data: [queryEmbedding],
        output_fields: ['entity_id', 'entity_name', 'entity_type', 'observations', 'created_at'],
        limit: query.limit || 20,
        metric_type: 'COSINE',
        params: { nprobe: 10 }
      });
      
      // Convert Milvus results to RankedMemory format
      const memories: RankedMemory[] = [];
      
      if (searchResult.results && searchResult.results.length > 0) {
        for (const result of searchResult.results) {
          const memory: RankedMemory = {
            id: result.entity_id,
            userId,
            type: 'entity_fact',
            content: `${result.entity_name} (${result.entity_type}): ${result.observations}`,
            summary: result.observations,
            entities: [result.entity_name],
            embedding: [],
            importance: 0.8,
            createdAt: new Date(result.created_at).getTime(),
            lastAccessed: Date.now(),
            tokenCount: Math.ceil(result.observations.length / 4), // Rough estimate
            metadata: {
              entityType: result.entity_type,
              entityName: result.entity_name,
              score: result.score || 0
            },
            rank: 0, // Will be set after sorting
            relevanceScore: result.score || 0,
            reasons: [`Similarity score: ${result.score?.toFixed(3)}`]
          };
          
          memories.push(memory);
        }
      }
      
      // Sort by relevance score (descending) and set ranks
      memories.sort((a, b) => b.relevanceScore - a.relevanceScore);
      memories.forEach((memory, index) => {
        memory.rank = index + 1;
      });
      
      this.logger.info(`Found ${memories.length} memories for user ${userId}`);
      return memories;
      
    } catch (error) {
      this.logger.error(`Failed to search memories for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get all memories for a user (for context assembly)
   */
  async getUserMemories(userId: string, limit: number = 100): Promise<RankedMemory[]> {
    try {
      const collectionName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}_memory`;
      
      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });
      
      if (!hasCollection.value) {
        return [];
      }
      
      // Query all entities (no vector search, just retrieve)
      const queryResult = await this.milvusClient.query({
        collection_name: collectionName,
        expr: 'entity_id != ""', // Get all
        output_fields: ['entity_id', 'entity_name', 'entity_type', 'observations', 'created_at'],
        limit
      });
      
      // Convert to RankedMemory format
      const memories: RankedMemory[] = [];
      
      if (queryResult && Array.isArray(queryResult)) {
        for (const entity of queryResult) {
          const memory: RankedMemory = {
            id: entity.entity_id,
            userId,
            type: 'entity_fact',
            content: `${entity.entity_name} (${entity.entity_type}): ${entity.observations}`,
            summary: entity.observations,
            entities: [entity.entity_name],
            embedding: [],
            importance: 0.8,
            createdAt: new Date(entity.created_at).getTime(),
            lastAccessed: Date.now(),
            tokenCount: Math.ceil(entity.observations.length / 4),
            metadata: {
              entityType: entity.entity_type,
              entityName: entity.entity_name
            },
            rank: 0,
            relevanceScore: 1.0, // Default score for non-search queries
            reasons: ['Direct retrieval']
          };
          
          memories.push(memory);
        }
      }
      
      // Sort by creation time (most recent first) and set ranks
      memories.sort((a, b) => b.createdAt - a.createdAt);
      memories.forEach((memory, index) => {
        memory.rank = index + 1;
      });
      
      return memories;
      
    } catch (error) {
      this.logger.error(`Failed to get memories for user ${userId}:`, error);
      return [];
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
   * Generate embedding for text using current LLM provider
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Use MCP Proxy for embeddings (which routes to the active LLM provider)
      const mcpProxyEndpoint = process.env.MCP_PROXY_URL || 'http://mcp-proxy:3100';

      if (!mcpProxyEndpoint) {
        throw new Error('MCP_PROXY_URL configuration required');
      }

      const embeddingModel = await this.getEmbeddingModel();

      const response = await fetch(`${mcpProxyEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MCP_PROXY_API_KEY || ''}`
        },
        body: JSON.stringify({
          model: embeddingModel,
          input: text.substring(0, 8192),
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      if (!data.data || !data.data[0] || !data.data[0].embedding) {
        throw new Error('Invalid embedding response from provider');
      }

      return data.data[0].embedding;
    } catch (error) {
      this.logger.error({ error, text: text.substring(0, 100) }, 'Failed to generate embedding');

      // Retry once with exponential backoff
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const mcpProxyEndpoint = process.env.MCP_PROXY_URL || 'http://mcp-proxy:3100';
        const embeddingModelRetry = await this.getEmbeddingModel();

        const retryResponse = await fetch(`${mcpProxyEndpoint}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MCP_PROXY_API_KEY}`
          },
          body: JSON.stringify({
            model: embeddingModelRetry,
            input: text.substring(0, 8192),
            encoding_format: 'float'
          })
        });

        if (retryResponse.ok) {
          const retryData = await retryResponse.json() as any;
          if (retryData.data && retryData.data[0] && retryData.data[0].embedding) {
            this.logger.info('Successfully generated embedding on retry');
            return retryData.data[0].embedding;
          }
        }
      } catch (retryError) {
        this.logger.error({ retryError }, 'Retry failed for embedding generation');
      }

      // If all retries fail, throw error instead of using fake embedding
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Update access statistics for a memory
   */
  async updateMemoryAccess(userId: string, memoryId: string): Promise<void> {
    // This could update access counts in Milvus or a separate tracking table
    // For now, just log it
    this.logger.debug(`Memory ${memoryId} accessed by user ${userId}`);
  }

  /**
   * Get memory statistics for monitoring
   */
  async getMemoryStats(userId: string): Promise<{
    totalMemories: number;
    collections: string[];
    lastSync?: Date;
  }> {
    try {
      const collectionName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}_memory`;
      
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });
      
      if (!hasCollection.value) {
        return {
          totalMemories: 0,
          collections: []
        };
      }
      
      const stats = await this.milvusClient.getCollectionStatistics({
        collection_name: collectionName
      });
      
      return {
        totalMemories: parseInt(stats.data?.row_count || '0'),
        collections: [collectionName]
      };
      
    } catch (error) {
      this.logger.error(`Failed to get memory stats for user ${userId}:`, error);
      return {
        totalMemories: 0,
        collections: []
      };
    }
  }
}

// Singleton instance
let milvusMemoryInstance: MilvusMemoryService | null = null;

export function getMilvusMemoryService(logger: any): MilvusMemoryService {
  if (!milvusMemoryInstance) {
    milvusMemoryInstance = new MilvusMemoryService(logger);
  }
  return milvusMemoryInstance;
}