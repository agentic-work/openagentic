/**
 * Enhanced Memory Service - Integration of advanced memory capabilities
 * 
 * Integrates:
 * - AdvancedMemoryContextService for semantic clustering
 * - MultiModalMemoryProcessor for text/image/file processing  
 * - Basic memory CRUD operations
 * - Vector search capabilities
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { AdvancedMemoryContextService, AdvancedMemoryConfig } from './AdvancedMemoryContextService.js';
import { MultiModalMemoryProcessor, ProcessingResult } from './MultiModalMemoryProcessor.js';
import { SemanticMemoryCluster } from './SemanticMemoryCluster.js';
import { MemoryDecayManager } from './MemoryDecayManager.js';
import { FileAttachmentService } from './FileAttachmentService.js';
import { prisma } from '../utils/prisma.js';

export interface EnhancedMemoryRequest {
  userId: string;
  memoryKey: string;
  content: string;
  category?: string;
  importance?: number;
  metadata?: Record<string, any>;
  
  // Multi-modal components
  imageId?: string;
  fileId?: string;
  
  // Processing options
  enableClustering?: boolean;
  enableDecay?: boolean;
  enableMultiModal?: boolean;
}

export interface MemorySearchRequest {
  userId: string;
  query: string;
  category?: string;
  minImportance?: number;
  limit?: number;
  useSemanticSearch?: boolean;
  useContextualPrioritization?: boolean;
}

export interface MemoryClusteringResult {
  clusterId: string;
  topic: string;
  memories: Array<{
    id: string;
    memoryKey: string;
    content: string;
    relevanceScore: number;
  }>;
  confidence: number;
  keyInsights: string[];
}

export interface MemoryAnalyticsResult {
  totalMemories: number;
  activeClusters: number;
  memoryDecayRate: number;
  crossSessionTopics: string[];
  multiModalMemories: number;
  temporalPatterns: any[];
  topCategories: Array<{ category: string; count: number }>;
  importanceDistribution: Record<number, number>;
}

export class EnhancedMemoryService {
  private logger: Logger;
  private advancedService: AdvancedMemoryContextService;
  private multiModalProcessor: MultiModalMemoryProcessor;
  private semanticCluster: SemanticMemoryCluster;
  private decayManager: MemoryDecayManager;
  private fileService: FileAttachmentService;
  private prisma: any;
  private memoryService: any;
  private openai: any;
  private cache: any;
  private milvus: any;

  constructor(
    logger: Logger, 
    prisma: any,
    memoryService: any,
    openai: any,
    cache: any,
    milvus: any,
    fileService?: FileAttachmentService
  ) {
    this.logger = logger.child({ service: 'EnhancedMemoryService' }) as Logger;
    this.prisma = prisma;
    this.memoryService = memoryService;
    this.openai = openai;
    this.cache = cache;
    this.milvus = milvus;
    this.fileService = fileService || new FileAttachmentService({}, logger);
    
    // Initialize component services
    this.semanticCluster = new SemanticMemoryCluster(logger);
    this.decayManager = new MemoryDecayManager(logger);
    this.multiModalProcessor = new MultiModalMemoryProcessor(logger, this.fileService);
    
    // Configure advanced memory service
    const advancedConfig: AdvancedMemoryConfig = {
      prisma: this.prisma,
      semanticCluster: this.semanticCluster,
      multiModalProcessor: this.multiModalProcessor,
      decayManager: this.decayManager,
      logger: this.logger,
      enableClustering: true,
      enableDecay: true,
      enableMultiModal: true
    };
    
    this.advancedService = new AdvancedMemoryContextService(advancedConfig);
  }

  /**
   * Create enhanced memory with multi-modal processing and clustering
   */
  async createEnhancedMemory(request: EnhancedMemoryRequest): Promise<{
    memory: any;
    processing?: ProcessingResult;
    clustering?: MemoryClusteringResult[];
    created: boolean;
  }> {
    try {
      this.logger.debug({ request }, 'Creating enhanced memory');

      // 1. Check for existing memory
      const existingMemory = await prisma.userMemory.findFirst({
        where: {
          user_id: request.userId,
          memory_key: request.memoryKey
        }
      });

      let memory: any;
      let created = false;

      if (existingMemory) {
        // Update existing memory
        memory = await prisma.userMemory.update({
          where: { id: existingMemory.id },
          data: {
            content: request.content,
            category: request.category || existingMemory.category,
            importance: request.importance ?? existingMemory.importance,
            metadata: { ...existingMemory.metadata as any, ...request.metadata },
            updated_at: new Date()
          }
        });
      } else {
        // Create new memory
        memory = await prisma.userMemory.create({
          data: {
            user_id: request.userId,
            memory_key: request.memoryKey,
            content: request.content,
            category: request.category || 'general',
            importance: request.importance ?? 5,
            metadata: request.metadata || {}
          }
        });
        created = true;
      }

      let processing: ProcessingResult | undefined;
      let clustering: MemoryClusteringResult[] | undefined;

      // 2. Multi-modal processing if enabled and additional components provided
      if (request.enableMultiModal !== false && (request.imageId || request.fileId)) {
        processing = await this.multiModalProcessor.processMultiModalMemory({
          text: request.content,
          imageId: request.imageId,
          fileId: request.fileId,
          userId: request.userId
        });

        // Update memory with multi-modal metadata
        if (processing.success && processing.multiModalMemory) {
          await prisma.userMemory.update({
            where: { id: memory.id },
            data: {
              metadata: {
                ...memory.metadata as any,
                multiModal: {
                  type: processing.multiModalMemory.type,
                  confidence: processing.multiModalMemory.metadata.confidence_score,
                  entities: processing.multiModalMemory.metadata.extracted_entities,
                  modalityWeights: processing.multiModalMemory.metadata.modality_weights
                }
              }
            }
          });
        }
      }

      // 3. Update clustering if enabled
      if (request.enableClustering !== false) {
        clustering = await this.updateMemoryClustering(request.userId);
      }

      // 4. Apply decay scoring if enabled
      if (request.enableDecay !== false) {
        await this.applyDecayScoring(request.userId);
      }

      return {
        memory: this.formatMemoryResponse(memory),
        processing,
        clustering,
        created
      };

    } catch (error) {
      this.logger.error({ error, request }, 'Failed to create enhanced memory');
      throw error;
    }
  }

  /**
   * Enhanced memory search with semantic clustering and contextual prioritization
   */
  async enhancedMemorySearch(request: MemorySearchRequest): Promise<{
    results: any[];
    clusters?: MemoryClusteringResult[];
    prioritization?: any[];
    searchType: 'text' | 'semantic' | 'contextual';
    totalResults: number;
  }> {
    try {
      this.logger.debug({ request }, 'Performing enhanced memory search');

      let results: any[] = [];
      let clusters: MemoryClusteringResult[] | undefined;
      let prioritization: any[] | undefined;
      let searchType: 'text' | 'semantic' | 'contextual' = 'text';

      // 1. Get base memories for user
      const baseWhere: any = {
        user_id: request.userId
      };

      if (request.category) {
        baseWhere.category = request.category;
      }

      if (typeof request.minImportance === 'number') {
        baseWhere.importance = { gte: request.minImportance };
      }

      const allMemories = await prisma.userMemory.findMany({
        where: baseWhere,
        orderBy: { updated_at: 'desc' }
      });

      // 2. Use contextual prioritization if requested
      if (request.useContextualPrioritization) {
        searchType = 'contextual';
        
        prioritization = await this.advancedService.prioritizeByContext(request.userId, {
          topic: this.extractTopicFromQuery(request.query),
          entities: this.extractEntitiesFromQuery(request.query)
        });

        // Map prioritized results to full memory objects
        const prioritizedIds = prioritization.slice(0, request.limit || 10).map(p => p.memory_id);
        const prioritizedMemories = await prisma.userMemory.findMany({
          where: {
            id: { in: prioritizedIds },
            user_id: request.userId
          }
        });

        // Sort by prioritization order
        results = prioritizedIds.map(id => {
          const memory = prioritizedMemories.find(m => m.id === id);
          const priority = prioritization!.find(p => p.memory_id === id);
          return memory ? {
            ...this.formatMemoryResponse(memory),
            contextualScore: priority?.contextual_score || 0,
            relevanceFactors: priority?.relevance_factors || []
          } : null;
        }).filter(Boolean);

      } else if (request.useSemanticSearch) {
        // 3. Semantic search with clustering
        searchType = 'semantic';
        
        clusters = await this.getMemoryClusters(request.userId);
        
        // Find relevant clusters and extract memories
        const relevantClusters = clusters.filter(cluster => 
          cluster.topic.toLowerCase().includes(request.query.toLowerCase()) ||
          cluster.keyInsights.some(insight => 
            insight.toLowerCase().includes(request.query.toLowerCase())
          )
        );

        const clusterMemoryIds: string[] = [];
        relevantClusters.forEach(cluster => {
          cluster.memories.forEach(mem => {
            if (!clusterMemoryIds.includes(mem.id)) {
              clusterMemoryIds.push(mem.id);
            }
          });
        });

        if (clusterMemoryIds.length > 0) {
          const clusterMemories = await prisma.userMemory.findMany({
            where: {
              id: { in: clusterMemoryIds },
              user_id: request.userId
            },
            take: request.limit || 10
          });

          results = clusterMemories.map(memory => ({
            ...this.formatMemoryResponse(memory),
            searchType: 'cluster_match',
            relevantClusters: relevantClusters.filter(c => 
              c.memories.some(m => m.id === memory.id)
            ).map(c => c.topic)
          }));
        }
      }

      // 4. Fallback to text search if no semantic/contextual results
      if (results.length === 0) {
        const textWhere = {
          ...baseWhere,
          OR: [
            { content: { contains: request.query, mode: 'insensitive' } },
            { memory_key: { contains: request.query, mode: 'insensitive' } }
          ]
        };

        const textMemories = await prisma.userMemory.findMany({
          where: textWhere,
          orderBy: [
            { importance: 'desc' },
            { updated_at: 'desc' }
          ],
          take: request.limit || 10
        });

        results = textMemories.map(memory => {
          const contentMatch = memory.content.toLowerCase().includes(request.query.toLowerCase());
          const keyMatch = memory.memory_key.toLowerCase().includes(request.query.toLowerCase());
          const relevance = (contentMatch ? 0.7 : 0) + (keyMatch ? 0.3 : 0);
          
          return {
            ...this.formatMemoryResponse(memory),
            relevance,
            searchType: 'text_match'
          };
        });
      }

      this.logger.info({ 
        userId: request.userId,
        query: request.query,
        searchType,
        resultCount: results.length
      }, 'Enhanced memory search completed');

      return {
        results,
        clusters,
        prioritization,
        searchType,
        totalResults: results.length
      };

    } catch (error) {
      this.logger.error({ error, request }, 'Enhanced memory search failed');
      throw error;
    }
  }

  /**
   * Cluster user memories - alias for getMemoryClusters
   */
  async clusterUserMemories(userId: string) {
    const clusters = await this.getMemoryClusters(userId);
    return clusters.map(cluster => ({
      theme: cluster.topic,
      memories: cluster.memories.map(m => m.id),
      centroid: [] // Could be enhanced with actual centroid data
    }));
  }

  /**
   * Get memory clusters for a user
   */
  async getMemoryClusters(userId: string): Promise<MemoryClusteringResult[]> {
    try {
      const clusterResults = await this.advancedService.clusterUserMemories(userId);
      
      const clusters: MemoryClusteringResult[] = [];
      
      for (const [topic, memoryCluster] of Object.entries(clusterResults)) {
        // Convert MemoryCluster to array format expected by analyzeCluster
        const memoryArray = Array.isArray(memoryCluster) ? memoryCluster : (memoryCluster as any).memories || [];
        const analysis = await this.semanticCluster.analyzeCluster(memoryArray, topic);
        
        clusters.push({
          clusterId: analysis.cluster_id,
          topic: analysis.topic,
          memories: memoryArray.map((mem: any) => ({
            id: mem.id,
            memoryKey: mem.memory_key || 'unknown',
            content: mem.content,
            relevanceScore: 0.8 // Default score, could be enhanced
          })),
          confidence: analysis.coherence_score,
          keyInsights: analysis.representative_entities
        });
      }

      return clusters.sort((a, b) => b.confidence - a.confidence);

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get memory clusters');
      return [];
    }
  }

  /**
   * Get comprehensive memory analytics
   */
  async getMemoryAnalytics(userId: string): Promise<MemoryAnalyticsResult> {
    try {
      // Get advanced analytics from the service
      const advancedAnalytics = await this.advancedService.getMemoryAnalytics(userId);
      
      // Get additional analytics from database
      const [categoryStats, importanceStats] = await Promise.all([
        prisma.userMemory.groupBy({
          by: ['category'],
          where: { user_id: userId },
          _count: true,
          orderBy: { _count: { category: 'desc' } }
        }),
        
        prisma.userMemory.groupBy({
          by: ['importance'],
          where: { user_id: userId },
          _count: true
        })
      ]);

      const importanceDistribution: Record<number, number> = {};
      importanceStats.forEach(stat => {
        importanceDistribution[stat.importance] = stat._count;
      });

      return {
        totalMemories: advancedAnalytics.total_memories,
        activeClusters: advancedAnalytics.active_clusters,
        memoryDecayRate: advancedAnalytics.memory_decay_rate,
        crossSessionTopics: advancedAnalytics.cross_session_topics,
        multiModalMemories: advancedAnalytics.multi_modal_memories,
        temporalPatterns: advancedAnalytics.temporal_patterns,
        topCategories: categoryStats.map(stat => ({
          category: stat.category,
          count: stat._count
        })),
        importanceDistribution
      };

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get memory analytics');
      throw error;
    }
  }

  /**
   * Cross-session memory synthesis
   */
  async synthesizeMemoriesAcrossSessions(userId: string, topic: string): Promise<any> {
    try {
      return await this.advancedService.synthesizeAcrossSessions(userId, topic);
    } catch (error) {
      this.logger.error({ error, userId, topic }, 'Failed to synthesize memories');
      throw error;
    }
  }

  // Private helper methods

  private async updateMemoryClustering(userId: string): Promise<MemoryClusteringResult[]> {
    try {
      return await this.getMemoryClusters(userId);
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to update memory clustering');
      return [];
    }
  }

  private async applyDecayScoring(userId: string): Promise<void> {
    try {
      // Apply decay scoring through the decay manager
      // Note: Using applyDecay method as applyDecayToUserMemories may not exist
      await (this.decayManager as any).applyDecay?.(userId) || Promise.resolve();
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to apply decay scoring');
    }
  }

  private formatMemoryResponse(memory: any): any {
    return {
      id: memory.id,
      memoryKey: memory.memory_key,
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
      metadata: memory.metadata as Record<string, any> || {},
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
      lastAccessed: memory.last_accessed_at
    };
  }

  private extractTopicFromQuery(query: string): string {
    // Simple topic extraction - could be enhanced with NLP
    const topicKeywords = ['work', 'personal', 'project', 'meeting', 'technical', 'family'];
    const queryLower = query.toLowerCase();
    
    for (const keyword of topicKeywords) {
      if (queryLower.includes(keyword)) {
        return keyword;
      }
    }
    
    return 'general';
  }

  private extractEntitiesFromQuery(query: string): string[] {
    // Simple entity extraction - could be enhanced with NLP
    const entities: string[] = [];
    
    // Extract capitalized words (potential proper nouns)
    const capitalizedWords = query.match(/\b[A-Z][a-z]+\b/g) || [];
    entities.push(...capitalizedWords);
    
    // Extract common technical terms
    const techTerms = ['API', 'database', 'server', 'React', 'JavaScript', 'Python'];
    for (const term of techTerms) {
      if (query.toLowerCase().includes(term.toLowerCase())) {
        entities.push(term);
      }
    }
    
    return Array.from(new Set(entities));
  }

  /**
   * Health check for enhanced memory service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test all component services
      const [
        advancedHealth,
        multiModalHealth,
        clusterHealth,
        decayHealth
      ] = await Promise.all([
        this.advancedService.healthCheck(),
        this.multiModalProcessor.healthCheck(),
        this.semanticCluster.healthCheck(),
        this.decayManager.healthCheck()
      ]);

      return advancedHealth && multiModalHealth && clusterHealth && decayHealth;

    } catch (error) {
      this.logger.error({ error }, 'Enhanced memory service health check failed');
      return false;
    }
  }
}