/**

 * 
 * Advanced Memory Context Service - Semantic clustering and advanced memory operations
 * 
 * Features:
 * - Semantic memory clustering
 * - Context-aware memory prioritization  
 * - Cross-session memory synthesis
 * - Advanced memory analytics
 */

import { PrismaClient } from '@prisma/client';
import { SemanticMemoryCluster } from './SemanticMemoryCluster.js';
import { MultiModalMemoryProcessor } from './MultiModalMemoryProcessor.js';
import { MemoryDecayManager } from './MemoryDecayManager.js';
import { prisma } from '../utils/prisma.js';

export interface AdvancedMemoryConfig {
  prisma: PrismaClient;
  semanticCluster: SemanticMemoryCluster;
  multiModalProcessor: MultiModalMemoryProcessor;
  decayManager: MemoryDecayManager;
  logger: any;
  enableClustering?: boolean;
  enableDecay?: boolean;
  enableMultiModal?: boolean;
}

export interface MemoryCluster {
  topic: string;
  memories: string[];
  confidence: number;
  created_at: number;
  updated_at: number;
}

export interface CrossSessionSynthesis {
  topic: string;
  synthesized_context: string;
  source_sessions: string[];
  confidence_score: number;
  key_insights: string[];
  created_at: number;
}

export interface ContextualPrioritization {
  memory_id: string;
  contextual_score: number;
  relevance_factors: string[];
  boost_applied: number;
}

export class AdvancedMemoryContextService {
  private config: AdvancedMemoryConfig;

  constructor(config: AdvancedMemoryConfig) {
    this.config = {
      enableClustering: true,
      enableDecay: true,
      enableMultiModal: true,
      ...config
    };
  }

  /**
   * Perform semantic clustering of user memories
   */
  async clusterUserMemories(userId: string): Promise<MemoryCluster[]> {
    try {
      this.config.logger.debug({ userId }, 'Starting semantic memory clustering');

      // Get all user memories - no deleted_at field in schema
      const memories = await this.config.prisma.userMemory.findMany({
        where: { 
          user_id: userId
        },
        orderBy: { created_at: 'desc' }
      });

      if (!this.config.enableClustering || memories.length < 2) {
        return [];
      }

      // Extract memory content and metadata from actual schema fields
      const memoryData = memories.map(memory => ({
        id: memory.id,
        content: memory.content,
        entities: (memory.metadata as any)?.entities || [],
        topic: this.extractTopicFromMemory(memory),
        created_at: memory.created_at.getTime()
      }));

      // Perform semantic clustering
      const clusters = await this.config.semanticCluster.clusterMemories(memoryData);

      // Format results
      const formattedClusters: MemoryCluster[] = [];
      
      for (const [topic, memoryIds] of Object.entries(clusters)) {
        if (Array.isArray(memoryIds) && memoryIds.length > 0) {
          formattedClusters.push({
            topic,
            memories: memoryIds.map(m => typeof m === 'string' ? m : m.id),
            confidence: this.calculateClusterConfidence(memoryIds),
            created_at: Date.now(),
            updated_at: Date.now()
          });
        }
      }

      this.config.logger.info({ 
        userId, 
        totalMemories: memories.length, 
        clustersFound: formattedClusters.length 
      }, 'Memory clustering completed');

      return formattedClusters;

    } catch (error) {
      this.config.logger.error({ userId, error: error.message }, 'Memory clustering failed');
      return [];
    }
  }

  /**
   * Prioritize memories based on current context
   */
  async prioritizeByContext(
    userId: string, 
    currentContext: {
      topic: string;
      entities: string[];
      urgency?: string;
      user_expertise?: string;
    }
  ): Promise<ContextualPrioritization[]> {
    try {
      this.config.logger.debug({ userId, currentContext }, 'Starting contextual prioritization');

      // Get user memories with available data
      const memories = await this.config.prisma.userMemory.findMany({
        where: { 
          user_id: userId
        },
        select: {
          id: true,
          content: true,
          metadata: true,
          memory_key: true,
          created_at: true,
          updated_at: true
        }
      });

      const prioritized: ContextualPrioritization[] = [];

      for (const memory of memories) {
        const memoryWithExtractedData = {
          ...memory,
          entities: (memory.metadata as any)?.entities || [],
          topic: this.extractTopicFromMemory(memory),
          importance: (memory.metadata as any)?.importance || 0.5,
          access_count: (memory.metadata as any)?.access_count || 0,
          last_accessed_at: memory.updated_at
        };
        
        const score = this.calculateContextualScore(memoryWithExtractedData, currentContext);
        const factors = this.identifyRelevanceFactors(memoryWithExtractedData, currentContext);
        
        prioritized.push({
          memory_id: memory.id,
          contextual_score: score,
          relevance_factors: factors,
          boost_applied: score - (memoryWithExtractedData.importance || 0.5)
        });
      }

      // Sort by contextual score (highest first)
      prioritized.sort((a, b) => b.contextual_score - a.contextual_score);

      this.config.logger.info({ 
        userId, 
        totalMemories: memories.length,
        topScore: prioritized[0]?.contextual_score || 0
      }, 'Contextual prioritization completed');

      return prioritized;

    } catch (error) {
      this.config.logger.error({ userId, error: error.message }, 'Contextual prioritization failed');
      return [];
    }
  }

  /**
   * Synthesize memories across sessions for a topic
   */
  async synthesizeAcrossSessions(userId: string, topic: string): Promise<CrossSessionSynthesis | null> {
    try {
      this.config.logger.debug({ userId, topic }, 'Starting cross-session synthesis');

      // Get memories related to the topic - extract topic from metadata
      const allMemories = await this.config.prisma.userMemory.findMany({
        where: {
          user_id: userId
        },
        select: {
          id: true,
          content: true,
          metadata: true,
          memory_key: true,
          created_at: true
        },
        orderBy: { created_at: 'desc' }
      });
      
      // Filter memories that match the topic
      const memories = allMemories.filter(memory => {
        const extractedTopic = this.extractTopicFromMemory(memory);
        return extractedTopic === topic;
      });

      if (memories.length < 2) {
        return null;
      }

      // Group by session - extract from memory_key or metadata
      const sessionGroups = new Map<string, typeof memories>();
      for (const memory of memories) {
        // Extract session ID from memory_key or metadata
        const sessionId = (memory.metadata as any)?.session_id || 
                         memory.memory_key.split('_')[0] || 
                         'default_session';
        
        if (!sessionGroups.has(sessionId)) {
          sessionGroups.set(sessionId, []);
        }
        sessionGroups.get(sessionId)!.push(memory);
      }

      if (sessionGroups.size < 2) {
        return null;
      }

      // Extract key insights and common themes
      const keyInsights = this.extractKeyInsights(memories);
      const synthesizedContext = this.generateSynthesizedContext(memories, keyInsights);
      const confidenceScore = this.calculateSynthesisConfidence(memories, sessionGroups.size);

      const synthesis: CrossSessionSynthesis = {
        topic,
        synthesized_context: synthesizedContext,
        source_sessions: Array.from(sessionGroups.keys()),
        confidence_score: confidenceScore,
        key_insights: keyInsights,
        created_at: Date.now()
      };

      this.config.logger.info({ 
        userId, 
        topic, 
        sessionsInvolved: sessionGroups.size,
        confidenceScore 
      }, 'Cross-session synthesis completed');

      return synthesis;

    } catch (error) {
      this.config.logger.error({ userId, topic, error: error.message }, 'Cross-session synthesis failed');
      return null;
    }
  }

  /**
   * Get advanced memory analytics for a user
   */
  async getMemoryAnalytics(userId: string): Promise<{
    total_memories: number;
    active_clusters: number;
    memory_decay_rate: number;
    cross_session_topics: string[];
    multi_modal_memories: number;
    temporal_patterns: any[];
  }> {
    try {
      // Get basic memory count
      const totalMemories = await this.config.prisma.userMemory.count({
        where: { user_id: userId }
      });

      // Get active clusters
      const clusters = await this.clusterUserMemories(userId);

      // Calculate decay rate with decay manager
      const decayRate = this.config.enableDecay 
        ? await this.config.decayManager.calculateUserDecayRate(userId)
        : 0;

      // Get cross-session topics
      const crossSessionTopics = await this.getCrossSessionTopics(userId);

      // Count multi-modal memories
      const multiModalCount = await this.config.prisma.userMemory.count({
        where: { 
          user_id: userId,
          metadata: {
            path: ['type'],
            equals: 'multi-modal'
          }
        }
      });

      // Get temporal patterns (simplified)
      const temporalPatterns = await this.getTemporalPatterns(userId);

      return {
        total_memories: totalMemories,
        active_clusters: clusters.length,
        memory_decay_rate: decayRate,
        cross_session_topics: crossSessionTopics,
        multi_modal_memories: multiModalCount,
        temporal_patterns: temporalPatterns
      };

    } catch (error) {
      this.config.logger.error({ userId, error: error.message }, 'Memory analytics failed');
      return {
        total_memories: 0,
        active_clusters: 0,
        memory_decay_rate: 0,
        cross_session_topics: [],
        multi_modal_memories: 0,
        temporal_patterns: []
      };
    }
  }

  // Private helper methods

  private calculateClusterConfidence(memories: any[]): number {
    if (memories.length < 2) return 0;
    if (memories.length >= 5) return 0.9;
    return 0.5 + (memories.length * 0.1);
  }

  private calculateContextualScore(memory: any, context: any): number {
    let score = memory.importance || 0.5;

    // Topic matching boost
    if (memory.topic === context.topic) {
      score += 0.3;
    }

    // Entity overlap boost
    const memoryEntities = memory.entities as string[] || [];
    const contextEntities = context.entities || [];
    const overlap = memoryEntities.filter(e => contextEntities.includes(e)).length;
    
    if (overlap > 0) {
      score += (overlap / Math.max(memoryEntities.length, contextEntities.length)) * 0.2;
    }

    // Recency boost
    const daysSinceAccessed = memory.last_accessed_at 
      ? (Date.now() - memory.last_accessed_at.getTime()) / (1000 * 60 * 60 * 24)
      : 30;
    
    if (daysSinceAccessed < 7) {
      score += 0.1;
    }

    // Urgency boost
    if (context.urgency === 'high' && memory.importance > 0.7) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  private identifyRelevanceFactors(memory: any, context: any): string[] {
    const factors: string[] = [];

    if (memory.topic === context.topic) {
      factors.push('Topic match');
    }

    const memoryEntities = memory.entities as string[] || [];
    const contextEntities = context.entities || [];
    const overlap = memoryEntities.filter(e => contextEntities.includes(e)).length;
    
    if (overlap > 0) {
      factors.push('Entity overlap');
    }

    if (memory.importance > 0.7) {
      factors.push('High importance');
    }

    if (memory.access_count > 5) {
      factors.push('Frequently accessed');
    }

    return factors;
  }

  private extractKeyInsights(memories: any[]): string[] {
    // Simple extraction - count entity frequency and extract top themes
    const entityCount: Record<string, number> = {};
    const themes: Set<string> = new Set();

    for (const memory of memories) {
      const entities = memory.entities as string[] || [];
      entities.forEach(entity => {
        entityCount[entity] = (entityCount[entity] || 0) + 1;
      });
      
      if (memory.topic) {
        themes.add(memory.topic);
      }
    }

    // Top entities as insights
    const topEntities = Object.entries(entityCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([entity]) => entity);

    const insights = [
      ...Array.from(themes).map(theme => `${theme.replace('_', ' ')} discussions`),
      ...topEntities.map(entity => `${entity} knowledge`)
    ];

    return insights.slice(0, 5); // Limit to top 5 insights
  }

  private generateSynthesizedContext(memories: any[], keyInsights: string[]): string {
    const memoryCount = memories.length;
    const topics = Array.from(new Set(memories.map(m => m.topic).filter(Boolean)));
    const timespan = this.calculateTimespan(memories);

    return `Synthesized knowledge from ${memoryCount} memories across ${topics.length} topics over ${timespan}. Key insights: ${keyInsights.join(', ')}. This represents consolidated learning and expertise development.`;
  }

  private calculateSynthesisConfidence(memories: any[], sessionCount: number): number {
    let confidence = 0.5;

    // More sessions = higher confidence
    confidence += Math.min(sessionCount * 0.1, 0.3);

    // More memories = higher confidence
    confidence += Math.min(memories.length * 0.02, 0.2);

    // Recent activity = higher confidence
    const recentMemories = memories.filter(m => 
      (Date.now() - m.created_at.getTime()) < (7 * 24 * 60 * 60 * 1000)
    );
    
    if (recentMemories.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  private calculateTimespan(memories: any[]): string {
    if (memories.length < 2) return '1 session';

    const dates = memories.map(m => m.created_at.getTime()).sort();
    const days = (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);

    if (days < 1) return 'same day';
    if (days < 7) return `${Math.ceil(days)} days`;
    if (days < 30) return `${Math.ceil(days / 7)} weeks`;
    return `${Math.ceil(days / 30)} months`;
  }

  private async getCrossSessionTopics(userId: string): Promise<string[]> {
    // Get all memories and extract topics from metadata/content
    const memories = await this.config.prisma.userMemory.findMany({
      where: {
        user_id: userId
      },
      select: {
        metadata: true,
        memory_key: true,
        content: true
      }
    });

    // Extract topics from memories and count occurrences
    const topicCounts: Record<string, number> = {};
    
    memories.forEach(memory => {
      const topic = this.extractTopicFromMemory(memory);
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });

    // Return topics that appear more than once
    return Object.entries(topicCounts)
      .filter(([_, count]) => count > 1)
      .map(([topic, _]) => topic);
  }

  private async getTemporalPatterns(userId: string): Promise<any[]> {
    // Simplified temporal pattern analysis
    const memories = await this.config.prisma.userMemory.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        created_at: true,
        updated_at: true,
        metadata: true
      },
      orderBy: { updated_at: 'desc' }
    });

    const patterns: any[] = [];
    
    // Group by hour of day for access patterns
    const hourlyAccess: Record<number, number> = {};
    
    for (const memory of memories) {
      if (memory.updated_at) {
        const hour = new Date(memory.updated_at).getHours();
        hourlyAccess[hour] = (hourlyAccess[hour] || 0) + 1;
      }
    }

    // Find peak access hours
    const peakHour = Object.entries(hourlyAccess)
      .sort(([,a], [,b]) => b - a)[0];

    if (peakHour) {
      patterns.push({
        type: 'peak_access_hour',
        hour: parseInt(peakHour[0]),
        frequency: peakHour[1],
        confidence: 0.8
      });
    }

    return patterns;
  }

  /**
   * Extract topic from memory based on memory_key or metadata
   */
  private extractTopicFromMemory(memory: { memory_key: string; metadata?: any; content: string }): string {
    // First try to get topic from metadata
    if (memory.metadata && typeof memory.metadata === 'object') {
      const metadata = memory.metadata as any;
      if (metadata.topic) {
        return metadata.topic;
      }
    }
    
    // Try to extract from memory_key pattern (e.g., "session_123_topic_work")
    const keyParts = memory.memory_key.split('_');
    const topicIndex = keyParts.findIndex(part => part === 'topic');
    if (topicIndex !== -1 && topicIndex < keyParts.length - 1) {
      return keyParts[topicIndex + 1];
    }
    
    // Fallback: try to infer from content keywords
    const content = memory.content.toLowerCase();
    if (content.includes('work') || content.includes('job') || content.includes('project')) {
      return 'work';
    } else if (content.includes('personal') || content.includes('family') || content.includes('home')) {
      return 'personal';
    } else if (content.includes('tech') || content.includes('code') || content.includes('programming')) {
      return 'technical';
    } else if (content.includes('meeting') || content.includes('discussion') || content.includes('call')) {
      return 'meetings';
    }
    
    return 'general';
  }

  /**
   * Health check for advanced memory service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test database connectivity
      await this.config.prisma.userMemory.count();
      
      // Test component services
      const clusterHealth = await this.config.semanticCluster.healthCheck();
      const multiModalHealth = this.config.enableMultiModal 
        ? await this.config.multiModalProcessor.healthCheck()
        : true;
      const decayHealth = this.config.enableDecay
        ? await this.config.decayManager.healthCheck()
        : true;

      return clusterHealth && multiModalHealth && decayHealth;
    } catch (error) {
      this.config.logger.error({ error: error.message }, 'Advanced memory service health check failed');
      return false;
    }
  }
}