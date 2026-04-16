/**
 * 
 * Memory Decay Manager - Temporal importance decay and memory lifecycle management
 * 
 * Features:
 * - Temporal importance decay based on access patterns
 * - Memory lifecycle management (active, fading, archived)
 * - User-specific decay profiles and learning patterns
 * - Intelligent retention strategies
 */

import type { Logger } from 'pino';

export interface MemoryDecayConfig {
  baseDecayRate: number;           // Base decay rate per day (0-1)
  accessBoostFactor: number;       // How much access delays decay
  importanceThreshold: number;     // Below this, memory becomes candidate for decay
  archiveThreshold: number;        // Below this, memory gets archived
  maxRetentionDays: number;        // Maximum retention without access
  minRetentionDays: number;        // Minimum retention period
}

export interface DecayProfile {
  userId: string;
  accessFrequency: 'high' | 'medium' | 'low';
  retentionPreference: 'aggressive' | 'balanced' | 'conservative';
  topicSpecificRules: Record<string, DecayRule>;
  learningVelocity: number;        // How quickly user learns (affects decay)
  expertiseDomains: string[];      // Domains where user is expert (slower decay)
  personalityFactors: {
    detail_oriented: number;        // 0-1, affects retention of specific facts
    big_picture: number;           // 0-1, affects retention of concepts
    practical: number;             // 0-1, affects retention of actionable items
  };
}

export interface DecayRule {
  topic: string;
  customDecayRate: number;
  retentionBonus: number;
  accessPatternWeight: number;
}

export interface MemoryLifecycle {
  memoryId: string;
  currentImportance: number;
  originalImportance: number;
  decayRate: number;
  lastDecayUpdate: number;
  lifecycle_stage: 'active' | 'fading' | 'archived' | 'forgotten';
  decay_factors: {
    temporal: number;              // Pure time decay
    access_based: number;          // Access frequency modifier
    topic_relevance: number;       // Topic-specific retention
    user_profile: number;          // User-specific factors
  };
  retention_score: number;         // Composite score for retention decision
  next_decay_check: number;        // When to next evaluate decay
}

export interface DecayAnalysis {
  userId: string;
  totalMemories: number;
  memoryDistribution: {
    active: number;
    fading: number;
    archived: number;
    forgotten: number;
  };
  averageDecayRate: number;
  retentionEfficiency: number;     // How well memories are retained vs accessed
  topDecayingTopics: Array<{ topic: string; decayRate: number }>;
  recommendedActions: string[];
}

export class MemoryDecayManager {
  private logger: any;
  private config: MemoryDecayConfig;
  private userProfiles: Map<string, DecayProfile> = new Map();

  constructor(logger: any, config?: Partial<MemoryDecayConfig>) {
    this.logger = logger.child({ service: 'MemoryDecayManager' }) as Logger;
    this.config = {
      baseDecayRate: 0.05,           // 5% decay per day without access
      accessBoostFactor: 0.3,        // 30% boost per access event
      importanceThreshold: 0.3,      // Below 30% importance = fading
      archiveThreshold: 0.1,         // Below 10% importance = archived
      maxRetentionDays: 365,         // 1 year maximum without access
      minRetentionDays: 7,           // 1 week minimum retention
      ...config
    };
  }

  /**
   * Calculate temporal decay for a memory
   */
  async calculateDecay(
    memoryId: string, 
    currentImportance: number,
    lastAccessed: number,
    accessCount: number,
    topic: string,
    userId: string
  ): Promise<MemoryLifecycle> {
    try {
      this.logger.debug({ memoryId, currentImportance, topic }, 'Calculating memory decay');

      const now = Date.now();
      const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);
      
      // Get user profile for personalized decay
      const userProfile = await this.getUserDecayProfile(userId);
      
      // Calculate decay factors
      const temporalDecay = this.calculateTemporalDecay(daysSinceAccess);
      const accessModifier = this.calculateAccessModifier(accessCount, daysSinceAccess);
      const topicModifier = this.calculateTopicModifier(topic, userProfile);
      const profileModifier = this.calculateProfileModifier(userProfile);

      // Composite decay calculation
      const effectiveDecayRate = this.config.baseDecayRate * 
        temporalDecay * 
        accessModifier * 
        topicModifier * 
        profileModifier;

      // Apply decay to importance
      const decayAmount = currentImportance * effectiveDecayRate;
      const newImportance = Math.max(0, currentImportance - decayAmount);

      // Determine lifecycle stage
      const stage = this.determineLifecycleStage(newImportance);

      // Calculate retention score for decision making
      const retentionScore = this.calculateRetentionScore(
        newImportance, accessCount, daysSinceAccess, userProfile
      );

      const lifecycle: MemoryLifecycle = {
        memoryId,
        currentImportance: newImportance,
        originalImportance: currentImportance,
        decayRate: effectiveDecayRate,
        lastDecayUpdate: now,
        lifecycle_stage: stage,
        decay_factors: {
          temporal: temporalDecay,
          access_based: accessModifier,
          topic_relevance: topicModifier,
          user_profile: profileModifier
        },
        retention_score: retentionScore,
        next_decay_check: now + (24 * 60 * 60 * 1000) // Check daily
      };

      this.logger.debug({ 
        memoryId, 
        newImportance: Math.round(newImportance * 100) / 100,
        stage,
        retentionScore: Math.round(retentionScore * 100) / 100
      }, 'Memory decay calculated');

      return lifecycle;

    } catch (error) {
      this.logger.error({ memoryId, error: error.message }, 'Memory decay calculation failed');
      // Return safe fallback
      return {
        memoryId,
        currentImportance,
        originalImportance: currentImportance,
        decayRate: 0,
        lastDecayUpdate: Date.now(),
        lifecycle_stage: 'active',
        decay_factors: { temporal: 1, access_based: 1, topic_relevance: 1, user_profile: 1 },
        retention_score: currentImportance,
        next_decay_check: Date.now() + (24 * 60 * 60 * 1000)
      };
    }
  }

  /**
   * Get or create user decay profile
   */
  async getUserDecayProfile(userId: string): Promise<DecayProfile> {
    if (this.userProfiles.has(userId)) {
      return this.userProfiles.get(userId)!;
    }

    // Create default profile - in production would load from database
    const defaultProfile: DecayProfile = {
      userId,
      accessFrequency: 'medium',
      retentionPreference: 'balanced',
      topicSpecificRules: {
        'programming': { topic: 'programming', customDecayRate: 0.7, retentionBonus: 0.2, accessPatternWeight: 1.2 },
        'work': { topic: 'work', customDecayRate: 0.8, retentionBonus: 0.3, accessPatternWeight: 1.3 },
        'personal': { topic: 'personal', customDecayRate: 0.9, retentionBonus: 0.1, accessPatternWeight: 1.0 },
      },
      learningVelocity: 0.7,
      expertiseDomains: [],
      personalityFactors: {
        detail_oriented: 0.6,
        big_picture: 0.7,
        practical: 0.8
      }
    };

    this.userProfiles.set(userId, defaultProfile);
    return defaultProfile;
  }

  /**
   * Update user decay profile based on behavior
   */
  async updateUserProfile(
    userId: string, 
    updates: Partial<DecayProfile>
  ): Promise<DecayProfile> {
    const currentProfile = await this.getUserDecayProfile(userId);
    const updatedProfile = { ...currentProfile, ...updates };
    this.userProfiles.set(userId, updatedProfile);
    
    this.logger.info({ userId, updates }, 'User decay profile updated');
    return updatedProfile;
  }

  /**
   * Calculate user's overall decay rate
   */
  async calculateUserDecayRate(userId: string): Promise<number> {
    try {
      const profile = await this.getUserDecayProfile(userId);
      
      // Base rate adjusted by user preferences
      let baseRate = this.config.baseDecayRate;
      
      switch (profile.retentionPreference) {
        case 'aggressive':
          baseRate *= 1.5; // Faster decay
          break;
        case 'conservative':
          baseRate *= 0.5; // Slower decay
          break;
        case 'balanced':
        default:
          // Use base rate as-is
          break;
      }

      // Adjust by learning velocity - fast learners can afford faster decay
      baseRate *= (1 + profile.learningVelocity * 0.3);

      // Adjust by access frequency - frequent users need faster decay to avoid clutter
      switch (profile.accessFrequency) {
        case 'high':
          baseRate *= 1.2;
          break;
        case 'low':
          baseRate *= 0.8;
          break;
        case 'medium':
        default:
          // Use current rate
          break;
      }

      return Math.max(0.01, Math.min(0.2, baseRate)); // Clamp between 1% and 20%

    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'User decay rate calculation failed');
      return this.config.baseDecayRate;
    }
  }

  /**
   * Analyze decay patterns for a user
   */
  async analyzeDecayPatterns(userId: string): Promise<DecayAnalysis> {
    try {
      // Mock analysis - in production would query actual memory data
      const mockAnalysis: DecayAnalysis = {
        userId,
        totalMemories: 150,
        memoryDistribution: {
          active: 90,
          fading: 40,
          archived: 15,
          forgotten: 5
        },
        averageDecayRate: await this.calculateUserDecayRate(userId),
        retentionEfficiency: 0.78, // 78% of memories are still useful when accessed
        topDecayingTopics: [
          { topic: 'temporary_notes', decayRate: 0.15 },
          { topic: 'outdated_info', decayRate: 0.12 },
          { topic: 'one_time_tasks', decayRate: 0.10 }
        ],
        recommendedActions: [
          'Archive 15 low-value memories to improve retrieval speed',
          'Increase retention for "programming" topic based on access patterns',
          'Consider more aggressive decay for "temporary_notes" topic'
        ]
      };

      return mockAnalysis;

    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Decay pattern analysis failed');
      return {
        userId,
        totalMemories: 0,
        memoryDistribution: { active: 0, fading: 0, archived: 0, forgotten: 0 },
        averageDecayRate: 0,
        retentionEfficiency: 0,
        topDecayingTopics: [],
        recommendedActions: []
      };
    }
  }

  /**
   * Boost memory importance due to access
   */
  async boostMemoryFromAccess(
    currentImportance: number,
    accessType: 'view' | 'edit' | 'search' | 'reference'
  ): Promise<number> {
    let boostAmount = 0;

    // Different access types provide different boosts
    switch (accessType) {
      case 'edit':
        boostAmount = 0.2; // Strong signal of value
        break;
      case 'reference':
        boostAmount = 0.15; // Referenced in context
        break;
      case 'search':
        boostAmount = 0.1; // Found via search
        break;
      case 'view':
      default:
        boostAmount = 0.05; // Basic access
        break;
    }

    // Apply diminishing returns - highly important memories get smaller boosts
    const diminishingFactor = 1 - (currentImportance * 0.5);
    const adjustedBoost = boostAmount * diminishingFactor;

    const newImportance = Math.min(1.0, currentImportance + adjustedBoost);

    this.logger.debug({ 
      currentImportance, 
      accessType, 
      boostAmount: adjustedBoost,
      newImportance 
    }, 'Memory importance boosted from access');

    return newImportance;
  }

  // Private helper methods

  private calculateTemporalDecay(daysSinceAccess: number): number {
    // Exponential decay curve - more dramatic over time
    return Math.min(2.0, 1 + (daysSinceAccess / 30)); // Increases up to 2x over 30 days
  }

  private calculateAccessModifier(accessCount: number, daysSinceAccess: number): number {
    // Frequently accessed memories decay slower
    const accessDensity = accessCount / Math.max(1, daysSinceAccess);
    return Math.max(0.2, 1 - (accessDensity * this.config.accessBoostFactor));
  }

  private calculateTopicModifier(topic: string, profile: DecayProfile): number {
    const topicRule = profile.topicSpecificRules[topic];
    if (topicRule) {
      return topicRule.customDecayRate;
    }

    // Check if topic is in user's expertise domains
    if (profile.expertiseDomains.includes(topic)) {
      return 0.7; // Slower decay for expertise areas
    }

    return 1.0; // Default rate
  }

  private calculateProfileModifier(profile: DecayProfile): number {
    let modifier = 1.0;

    // Adjust based on personality factors
    modifier *= (0.8 + profile.personalityFactors.detail_oriented * 0.4); // Detail-oriented users retain more
    modifier *= (0.9 + profile.personalityFactors.practical * 0.2); // Practical users retain useful info longer

    // Adjust based on learning velocity
    modifier *= (0.7 + profile.learningVelocity * 0.6); // Fast learners can afford faster decay

    return modifier;
  }

  private determineLifecycleStage(importance: number): MemoryLifecycle['lifecycle_stage'] {
    if (importance >= this.config.importanceThreshold) {
      return 'active';
    } else if (importance >= this.config.archiveThreshold) {
      return 'fading';
    } else if (importance > 0) {
      return 'archived';
    } else {
      return 'forgotten';
    }
  }

  private calculateRetentionScore(
    importance: number,
    accessCount: number,
    daysSinceAccess: number,
    profile: DecayProfile
  ): number {
    let score = importance;

    // Boost score for frequently accessed memories
    score += Math.min(0.3, accessCount * 0.05);

    // Reduce score for long-unused memories
    score -= Math.min(0.2, daysSinceAccess * 0.01);

    // Personality adjustments
    if (profile.personalityFactors.detail_oriented > 0.7) {
      score += 0.1; // Detail-oriented users value retention
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Health check for memory decay manager
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic decay calculation
      const testResult = await this.calculateDecay(
        'test-memory-id',
        0.8,
        Date.now() - (24 * 60 * 60 * 1000), // 1 day ago
        3,
        'test',
        'test-user'
      );

      // Verify decay was calculated
      const decayApplied = testResult.currentImportance < 0.8;
      const hasValidStage = ['active', 'fading', 'archived', 'forgotten'].includes(testResult.lifecycle_stage);

      return decayApplied && hasValidStage;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Memory decay manager health check failed');
      return false;
    }
  }
}