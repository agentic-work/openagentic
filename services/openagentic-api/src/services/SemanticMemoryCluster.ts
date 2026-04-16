/**
 * 
 * Semantic Memory Clustering Service
 * 
 * Features:
 * - Groups related memories by semantic similarity
 * - Topic-based clustering with entity matching
 * - Hierarchical clustering for complex relationships
 * - Dynamic cluster updating
 */

import type { Logger } from 'pino';

export interface MemoryItem {
  id: string;
  content: string;
  entities: string[];
  topic: string;
  created_at: number;
}

export interface ClusteringResult {
  [topic: string]: MemoryItem[];
}

export interface ClusterAnalysis {
  cluster_id: string;
  topic: string;
  size: number;
  coherence_score: number;
  representative_entities: string[];
  created_at: number;
}

export class SemanticMemoryCluster {
  private logger: any;
  private config: {
    minClusterSize: number;
    maxClusters: number;
    coherenceThreshold: number;
    entityWeight: number;
    contentWeight: number;
  };

  constructor(logger: any, config?: Partial<typeof SemanticMemoryCluster.prototype.config>) {
    this.logger = logger.child({ service: 'SemanticMemoryCluster' }) as Logger;
    this.config = {
      minClusterSize: 2,
      maxClusters: 20,
      coherenceThreshold: 0.6,
      entityWeight: 0.4,
      contentWeight: 0.6,
      ...config
    };
  }

  /**
   * Cluster memories by semantic similarity
   */
  async clusterMemories(memories: MemoryItem[]): Promise<ClusteringResult> {
    try {
      this.logger.debug({ memoryCount: memories.length }, 'Starting semantic clustering');

      if (memories.length < this.config.minClusterSize) {
        this.logger.warn('Insufficient memories for clustering');
        return {};
      }

      // Step 1: Initial topic-based grouping
      const topicGroups = this.groupByTopic(memories);
      
      // Step 2: Refine clusters with entity similarity
      const refinedClusters = this.refineWithEntitySimilarity(topicGroups);
      
      // Step 3: Merge similar clusters
      const mergedClusters = this.mergeSimilarClusters(refinedClusters);
      
      // Step 4: Filter by minimum size and quality
      const finalClusters = this.filterClusters(mergedClusters);

      this.logger.info({ 
        inputMemories: memories.length,
        initialTopics: Object.keys(topicGroups).length,
        finalClusters: Object.keys(finalClusters).length
      }, 'Semantic clustering completed');

      return finalClusters;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Semantic clustering failed');
      return {};
    }
  }

  /**
   * Analyze cluster quality and characteristics
   */
  async analyzeCluster(memories: MemoryItem[], topic: string): Promise<ClusterAnalysis> {
    const entities = this.extractClusterEntities(memories);
    const coherenceScore = this.calculateCoherenceScore(memories);
    
    return {
      cluster_id: this.generateClusterId(topic),
      topic,
      size: memories.length,
      coherence_score: coherenceScore,
      representative_entities: entities.slice(0, 5), // Top 5 entities
      created_at: Date.now()
    };
  }

  /**
   * Update clusters with new memory
   */
  async updateClustersWithNewMemory(
    existingClusters: ClusteringResult,
    newMemory: MemoryItem
  ): Promise<ClusteringResult> {
    try {
      this.logger.debug({ memoryId: newMemory.id }, 'Updating clusters with new memory');

      // Find best matching cluster
      const bestCluster = this.findBestMatchingCluster(existingClusters, newMemory);
      
      if (bestCluster && this.calculateMemoryClusterSimilarity(newMemory, existingClusters[bestCluster]) > 0.7) {
        // Add to existing cluster
        existingClusters[bestCluster].push(newMemory);
        this.logger.debug({ clusterId: bestCluster }, 'Memory added to existing cluster');
      } else {
        // Create new cluster or add to miscellaneous
        const newTopic = newMemory.topic || 'miscellaneous';
        if (!existingClusters[newTopic]) {
          existingClusters[newTopic] = [];
        }
        existingClusters[newTopic].push(newMemory);
        this.logger.debug({ newTopic }, 'Memory added to new/misc cluster');
      }

      return existingClusters;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Cluster update failed');
      return existingClusters;
    }
  }

  /**
   * Get cluster recommendations for memory placement
   */
  async getClusterRecommendations(
    memory: MemoryItem,
    existingClusters: ClusteringResult
  ): Promise<Array<{ topic: string; score: number; reasons: string[] }>> {
    const recommendations: Array<{ topic: string; score: number; reasons: string[] }> = [];

    for (const [topic, clusterMemories] of Object.entries(existingClusters)) {
      const score = this.calculateMemoryClusterSimilarity(memory, clusterMemories);
      const reasons = this.identifyMatchingReasons(memory, clusterMemories);
      
      if (score > 0.3) { // Minimum threshold for recommendation
        recommendations.push({ topic, score, reasons });
      }
    }

    // Sort by score (highest first)
    return recommendations.sort((a, b) => b.score - a.score);
  }

  // Private helper methods

  private groupByTopic(memories: MemoryItem[]): ClusteringResult {
    const groups: ClusteringResult = {};
    
    for (const memory of memories) {
      const topic = memory.topic || 'general';
      if (!groups[topic]) {
        groups[topic] = [];
      }
      groups[topic].push(memory);
    }

    return groups;
  }

  private refineWithEntitySimilarity(topicGroups: ClusteringResult): ClusteringResult {
    const refinedClusters: ClusteringResult = {};

    for (const [topic, memories] of Object.entries(topicGroups)) {
      if (memories.length <= 3) {
        // Small groups don't need refinement
        refinedClusters[topic] = memories;
        continue;
      }

      // Split large topic groups based on entity similarity
      const subClusters = this.splitByEntitySimilarity(memories, topic);
      Object.assign(refinedClusters, subClusters);
    }

    return refinedClusters;
  }

  private splitByEntitySimilarity(memories: MemoryItem[], baseTopic: string): ClusteringResult {
    const subClusters: ClusteringResult = {};
    const unassigned = [...memories];
    let clusterIndex = 0;

    while (unassigned.length > 0) {
      const seed = unassigned.shift()!;
      const clusterKey = memories.length > 5 ? `${baseTopic}_${clusterIndex}` : baseTopic;
      subClusters[clusterKey] = [seed];

      // Find similar memories to add to this cluster
      for (let i = unassigned.length - 1; i >= 0; i--) {
        const memory = unassigned[i];
        const similarity = this.calculateEntitySimilarity(seed.entities, memory.entities);
        
        if (similarity > 0.4) { // Entity similarity threshold
          subClusters[clusterKey].push(memory);
          unassigned.splice(i, 1);
        }
      }

      clusterIndex++;
      
      // Prevent infinite loops with too many clusters
      if (clusterIndex > this.config.maxClusters) {
        // Add remaining to last cluster
        if (unassigned.length > 0) {
          subClusters[clusterKey].push(...unassigned);
        }
        break;
      }
    }

    return subClusters;
  }

  private mergeSimilarClusters(clusters: ClusteringResult): ClusteringResult {
    const merged: ClusteringResult = {};
    const processed = new Set<string>();

    for (const [topicA, memoriesA] of Object.entries(clusters)) {
      if (processed.has(topicA)) continue;

      let mergedMemories = [...memoriesA];
      let mergedTopic = topicA;

      // Look for similar clusters to merge
      for (const [topicB, memoriesB] of Object.entries(clusters)) {
        if (topicA === topicB || processed.has(topicB)) continue;

        const similarity = this.calculateClusterSimilarity(memoriesA, memoriesB);
        
        if (similarity > 0.6) { // Cluster similarity threshold
          mergedMemories.push(...memoriesB);
          processed.add(topicB);
          
          // Choose the more general topic name
          if (topicB.length < mergedTopic.length || topicB.includes(topicA)) {
            mergedTopic = topicB;
          }
        }
      }

      merged[mergedTopic] = mergedMemories;
      processed.add(topicA);
    }

    return merged;
  }

  private filterClusters(clusters: ClusteringResult): ClusteringResult {
    const filtered: ClusteringResult = {};

    for (const [topic, memories] of Object.entries(clusters)) {
      // Filter by minimum size
      if (memories.length < this.config.minClusterSize) {
        continue;
      }

      // Filter by coherence score
      const coherence = this.calculateCoherenceScore(memories);
      if (coherence < this.config.coherenceThreshold) {
        continue;
      }

      filtered[topic] = memories;
    }

    return filtered;
  }

  private calculateEntitySimilarity(entitiesA: string[], entitiesB: string[]): number {
    if (entitiesA.length === 0 || entitiesB.length === 0) return 0;

    const setA = new Set(entitiesA.map(e => e.toLowerCase()));
    const setB = new Set(entitiesB.map(e => e.toLowerCase()));
    
    const intersection = new Set(Array.from(setA).filter(e => setB.has(e)));
    const union = new Set([...Array.from(setA), ...Array.from(setB)]);
    
    return intersection.size / union.size; // Jaccard similarity
  }

  private calculateClusterSimilarity(clusterA: MemoryItem[], clusterB: MemoryItem[]): number {
    // Calculate average entity similarity between clusters
    let totalSimilarity = 0;
    let comparisons = 0;

    for (const memA of clusterA.slice(0, 3)) { // Sample to avoid O(n²) complexity
      for (const memB of clusterB.slice(0, 3)) {
        totalSimilarity += this.calculateEntitySimilarity(memA.entities, memB.entities);
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  private calculateMemoryClusterSimilarity(memory: MemoryItem, cluster: MemoryItem[]): number {
    if (cluster.length === 0) return 0;

    // Calculate similarity with cluster representative (most central memory)
    const representative = this.findClusterRepresentative(cluster);
    const entitySim = this.calculateEntitySimilarity(memory.entities, representative.entities);
    
    // Content similarity (simplified - just check topic match)
    const topicSim = memory.topic === representative.topic ? 0.5 : 0;
    
    return (entitySim * this.config.entityWeight) + (topicSim * this.config.contentWeight);
  }

  private findClusterRepresentative(cluster: MemoryItem[]): MemoryItem {
    // Find memory with most common entities (most central)
    let bestMemory = cluster[0];
    let maxCommonality = 0;

    for (const memory of cluster) {
      let commonality = 0;
      
      for (const other of cluster) {
        if (memory.id !== other.id) {
          commonality += this.calculateEntitySimilarity(memory.entities, other.entities);
        }
      }
      
      if (commonality > maxCommonality) {
        maxCommonality = commonality;
        bestMemory = memory;
      }
    }

    return bestMemory;
  }

  private calculateCoherenceScore(memories: MemoryItem[]): number {
    if (memories.length < 2) return 1;

    let totalSimilarity = 0;
    let comparisons = 0;

    // Calculate pairwise similarities within cluster
    for (let i = 0; i < memories.length - 1; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        totalSimilarity += this.calculateEntitySimilarity(memories[i].entities, memories[j].entities);
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  private extractClusterEntities(memories: MemoryItem[]): string[] {
    const entityCount: Record<string, number> = {};

    for (const memory of memories) {
      for (const entity of memory.entities) {
        const key = entity.toLowerCase();
        entityCount[key] = (entityCount[key] || 0) + 1;
      }
    }

    // Return entities sorted by frequency
    return Object.entries(entityCount)
      .sort(([,a], [,b]) => b - a)
      .map(([entity]) => entity);
  }

  private findBestMatchingCluster(clusters: ClusteringResult, memory: MemoryItem): string | null {
    let bestCluster: string | null = null;
    let maxSimilarity = 0;

    for (const [topic, clusterMemories] of Object.entries(clusters)) {
      const similarity = this.calculateMemoryClusterSimilarity(memory, clusterMemories);
      
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        bestCluster = topic;
      }
    }

    return bestCluster;
  }

  private identifyMatchingReasons(memory: MemoryItem, cluster: MemoryItem[]): string[] {
    const reasons: string[] = [];

    // Check topic match
    const topicMatches = cluster.some(m => m.topic === memory.topic);
    if (topicMatches) {
      reasons.push('Topic match');
    }

    // Check entity overlap
    const memoryEntities = new Set(memory.entities.map(e => e.toLowerCase()));
    const clusterEntities = new Set();
    cluster.forEach(m => m.entities.forEach(e => clusterEntities.add(e.toLowerCase())));
    
    const overlap = Array.from(memoryEntities).filter(e => clusterEntities.has(e));
    if (overlap.length > 0) {
      reasons.push(`Entity overlap: ${overlap.slice(0, 3).join(', ')}`);
    }

    // Check temporal proximity
    const memoryTime = memory.created_at;
    const recentClusterMemory = cluster.some(m => 
      Math.abs(m.created_at - memoryTime) < (24 * 60 * 60 * 1000) // Within 24 hours
    );
    
    if (recentClusterMemory) {
      reasons.push('Temporal proximity');
    }

    return reasons;
  }

  private generateClusterId(topic: string): string {
    return `cluster_${topic.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  }

  /**
   * Health check for semantic clustering service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test with minimal data
      const testMemories: MemoryItem[] = [
        {
          id: 'test-1',
          content: 'Test memory 1',
          entities: ['test', 'memory'],
          topic: 'test',
          created_at: Date.now()
        },
        {
          id: 'test-2',
          content: 'Test memory 2', 
          entities: ['test', 'clustering'],
          topic: 'test',
          created_at: Date.now()
        }
      ];

      const result = await this.clusterMemories(testMemories);
      return Object.keys(result).length > 0;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Semantic clustering health check failed');
      return false;
    }
  }
}