import { 
  ContextBudget, 
  ContextTier, 
  ModelCapabilities,
  AugmentedContext
} from '../types/Context.js';
import { Message, RankedMemory } from '../types/Memory.js';

export interface BudgetConfig {
  responseReserve: number; // Percentage of context reserved for response
  systemPromptRatio: number; // Percentage for system prompt
  tier1Ratio: number; // Percentage for recent conversation
  tier2Ratio: number; // Percentage for conversation summaries
  tier3Ratio: number; // Percentage for long-term knowledge
  minResponseTokens: number; // Minimum tokens reserved for response
  maxSystemTokens: number; // Maximum tokens for system prompt
}

export interface BudgetMetrics {
  utilization: {
    tier1: number;
    tier2: number;
    tier3: number;
    overall: number;
  };
  efficiency: {
    compressionRatio: number;
    wastedTokens: number;
    optimalAllocation: boolean;
  };
  performance: {
    allocationTime: number;
    tierBuildTime: number;
  };
}

export interface ContextTiers {
  tier1: ContextTier;
  tier2: ContextTier;
  tier3: ContextTier;
}

export class ContextBudgetManager {
  private config: BudgetConfig;
  private performanceMetrics: {
    allocationTimes: number[];
    tierBuildTimes: number[];
  };

  constructor(config: BudgetConfig) {
    this.config = config;
    this.performanceMetrics = {
      allocationTimes: [],
      tierBuildTimes: []
    };
  }

  /**
   * Calculate context budget allocation for a given model
   */
  calculateBudget(model: ModelCapabilities, systemPromptTokens: number): ContextBudget {
    const startTime = Date.now();

    if (model.contextWindow <= 0) {
      throw new Error('Invalid model configuration: contextWindow must be positive');
    }

    const total = model.contextWindow;
    
    // Calculate reserved tokens for response (minimum enforced)
    const calculatedReserve = Math.floor(total * this.config.responseReserve);
    const reserved = Math.max(calculatedReserve, this.config.minResponseTokens);
    
    const available = total - reserved;
    
    // Cap system prompt at maximum allowed
    const systemTokens = Math.min(systemPromptTokens, this.config.maxSystemTokens);
    
    // Calculate remaining tokens for content tiers
    const remainingForTiers = available - systemTokens;
    
    if (remainingForTiers < 0) {
      throw new Error('System prompt exceeds available context budget');
    }

    const allocation = {
      tier1: Math.floor(remainingForTiers * this.config.tier1Ratio),
      tier2: Math.floor(remainingForTiers * this.config.tier2Ratio),
      tier3: Math.floor(remainingForTiers * this.config.tier3Ratio),
      system: systemTokens
    };

    const budget: ContextBudget = {
      total,
      reserved,
      available,
      allocation
    };

    const allocationTime = Date.now() - startTime;
    this.trackAllocationTime(allocationTime);

    return budget;
  }

  /**
   * Estimate token count for messages using heuristics
   */
  estimateMessageTokens(messages: Message[]): number {
    if (!messages || messages.length === 0) return 0;

    let totalTokens = 0;

    for (const message of messages) {
      if (!message || typeof message.content !== 'string') {
        continue; // Skip malformed messages
      }

      // Basic estimation: ~4 characters per token
      const contentTokens = Math.ceil(message.content.length / 4);
      
      // Add role tokens (user: ~1 token, assistant: ~1 token, system: ~1 token)
      const roleTokens = 1;
      
      // Add formatting tokens for message structure (~3 tokens per message)
      const formatTokens = 3;
      
      totalTokens += contentTokens + roleTokens + formatTokens;
    }

    return totalTokens;
  }

  /**
   * Estimate token count for memories
   */
  estimateMemoryTokens(memories: RankedMemory[]): number {
    if (!memories || memories.length === 0) return 0;

    return memories.reduce((total, memory) => {
      // Use provided token count if available, otherwise estimate
      if (memory.tokenCount) {
        return total + memory.tokenCount;
      }
      
      // Estimate based on content length
      const contentTokens = Math.ceil(memory.content.length / 4);
      const summaryTokens = Math.ceil(memory.summary.length / 4);
      const entityTokens = memory.entities.length * 2; // ~2 tokens per entity
      const formatTokens = 5; // Memory formatting
      
      return total + contentTokens + summaryTokens + entityTokens + formatTokens;
    }, 0);
  }

  /**
   * Build context tiers with content allocation
   */
  buildContextTiers(
    budget: ContextBudget, 
    messages: Message[], 
    memories: RankedMemory[]
  ): ContextTiers {
    const startTime = Date.now();

    const tiers: ContextTiers = {
      tier1: this.createTier1(budget.allocation.tier1, messages),
      tier2: this.createTier2(budget.allocation.tier2, memories.filter(m => 
        m.type === 'conversation_summary'
      )),
      tier3: this.createTier3(budget.allocation.tier3, memories.filter(m => 
        m.type === 'domain_knowledge' || m.type === 'entity_fact'
      ))
    };

    const tierBuildTime = Date.now() - startTime;
    this.trackTierBuildTime(tierBuildTime);

    return tiers;
  }

  /**
   * Create Tier 1: Recent conversation
   */
  private createTier1(maxTokens: number, messages: Message[]): ContextTier {
    const tier: ContextTier = {
      name: 'Recent Conversation',
      priority: 1,
      maxTokens,
      usedTokens: 0,
      content: [],
      metadata: {
        messageCount: 0,
        oldestMessage: null,
        newestMessage: null
      }
    };

    if (!messages || messages.length === 0) {
      console.warn('[ContextBudgetManager] No messages provided for Tier 1');
      return tier;
    }
    
    console.log(`[ContextBudgetManager] Building Tier 1 with ${messages.length} messages, max tokens: ${maxTokens}`);

    // Sort messages by timestamp (newest first)
    const sortedMessages = [...messages].sort((a, b) => b.timestamp - a.timestamp);
    
    let usedTokens = 0;
    const content: string[] = [];
    let messageCount = 0;

    for (const message of sortedMessages) {
      if (!message || typeof message.content !== 'string') continue;

      const messageTokens = this.estimateMessageTokens([message]);
      
      if (usedTokens + messageTokens > maxTokens && content.length > 0) {
        break; // Stop adding messages if budget exceeded
      }

      const formattedMessage = `${message.role}: ${message.content}`;
      content.unshift(formattedMessage); // Add to beginning to maintain chronological order
      usedTokens += messageTokens;
      messageCount++;
    }

    tier.content = content;
    tier.usedTokens = usedTokens;
    tier.metadata.messageCount = messageCount;
    
    if (messageCount > 0) {
      tier.metadata.oldestMessage = sortedMessages[messageCount - 1]?.timestamp;
      tier.metadata.newestMessage = sortedMessages[0]?.timestamp;
    }

    return tier;
  }

  /**
   * Create Tier 2: Conversation summaries
   */
  private createTier2(maxTokens: number, summaryMemories: RankedMemory[]): ContextTier {
    const tier: ContextTier = {
      name: 'Conversation Summaries',
      priority: 2,
      maxTokens,
      usedTokens: 0,
      content: [],
      metadata: {
        memoryCount: 0,
        averageRelevance: 0,
        topEntities: []
      }
    };

    if (!summaryMemories || summaryMemories.length === 0) return tier;

    // Sort by relevance score (highest first)
    const sortedMemories = [...summaryMemories].sort((a, b) => 
      (b.relevanceScore || 0) - (a.relevanceScore || 0)
    );

    let usedTokens = 0;
    const content: string[] = [];
    let totalRelevance = 0;
    const entitySet = new Set<string>();

    for (const memory of sortedMemories) {
      const memoryTokens = memory.tokenCount || this.estimateMemoryTokens([memory]);
      
      if (usedTokens + memoryTokens > maxTokens && content.length > 0) {
        break;
      }

      content.push(`Summary: ${memory.content}`);
      usedTokens += memoryTokens;
      totalRelevance += memory.relevanceScore || 0;
      
      // Collect entities
      memory.entities.forEach(entity => entitySet.add(entity));
    }

    tier.content = content;
    tier.usedTokens = usedTokens;
    tier.metadata.memoryCount = content.length;
    tier.metadata.averageRelevance = content.length > 0 ? totalRelevance / content.length : 0;
    tier.metadata.topEntities = Array.from(entitySet).slice(0, 10);

    return tier;
  }

  /**
   * Create Tier 3: Long-term knowledge
   */
  private createTier3(maxTokens: number, knowledgeMemories: RankedMemory[]): ContextTier {
    const tier: ContextTier = {
      name: 'Long-term Knowledge',
      priority: 3,
      maxTokens,
      usedTokens: 0,
      content: [],
      metadata: {
        memoryCount: 0,
        knowledgeAreas: [],
        factCount: 0
      }
    };

    if (!knowledgeMemories || knowledgeMemories.length === 0) return tier;

    // Sort by importance and relevance
    const sortedMemories = [...knowledgeMemories].sort((a, b) => {
      const scoreA = (a.importance || 0) * 0.7 + (a.relevanceScore || 0) * 0.3;
      const scoreB = (b.importance || 0) * 0.7 + (b.relevanceScore || 0) * 0.3;
      return scoreB - scoreA;
    });

    let usedTokens = 0;
    const content: string[] = [];
    const knowledgeAreas = new Set<string>();

    for (const memory of sortedMemories) {
      const memoryTokens = memory.tokenCount || this.estimateMemoryTokens([memory]);
      
      if (usedTokens + memoryTokens > maxTokens && content.length > 0) {
        break;
      }

      if (memory.type === 'entity_fact') {
        content.push(`Fact: ${memory.content}`);
      } else {
        content.push(`Knowledge: ${memory.content}`);
      }
      
      usedTokens += memoryTokens;
      
      // Track knowledge areas based on entities
      memory.entities.forEach(entity => knowledgeAreas.add(entity));
    }

    tier.content = content;
    tier.usedTokens = usedTokens;
    tier.metadata.memoryCount = content.length;
    tier.metadata.knowledgeAreas = Array.from(knowledgeAreas);
    tier.metadata.factCount = sortedMemories.filter(m => m.type === 'entity_fact').length;

    return tier;
  }

  /**
   * Optimize budget allocation based on actual content
   */
  optimizeBudget(
    model: ModelCapabilities, 
    messages: Message[], 
    memories: RankedMemory[]
  ): ContextBudget {
    // Start with default allocation
    const systemPromptTokens = 200; // Estimated
    let budget = this.calculateBudget(model, systemPromptTokens);

    // Analyze content needs
    const messageTokens = this.estimateMessageTokens(messages);
    const memoryTokens = this.estimateMemoryTokens(memories);

    // Adjust allocation if content doesn't fit well
    const availableForContent = budget.available - budget.allocation.system;
    
    // If messages exceed tier1 allocation significantly, adjust ratios
    if (messageTokens > budget.allocation.tier1 * 1.5) {
      const messageRatio = Math.min(0.6, messageTokens / availableForContent);
      const remainingRatio = 1 - messageRatio;
      
      budget.allocation.tier1 = Math.floor(availableForContent * messageRatio);
      budget.allocation.tier2 = Math.floor(availableForContent * remainingRatio * 0.6);
      budget.allocation.tier3 = Math.floor(availableForContent * remainingRatio * 0.4);
    }

    return budget;
  }

  /**
   * Get budget utilization metrics
   */
  getBudgetMetrics(budget: ContextBudget, tiers: ContextTiers): BudgetMetrics {
    const tier1Utilization = tiers.tier1.maxTokens > 0 ? 
      tiers.tier1.usedTokens / tiers.tier1.maxTokens : 0;
    const tier2Utilization = tiers.tier2.maxTokens > 0 ? 
      tiers.tier2.usedTokens / tiers.tier2.maxTokens : 0;
    const tier3Utilization = tiers.tier3.maxTokens > 0 ? 
      tiers.tier3.usedTokens / tiers.tier3.maxTokens : 0;

    const totalUsed = tiers.tier1.usedTokens + tiers.tier2.usedTokens + 
                     tiers.tier3.usedTokens + budget.allocation.system;
    const overallUtilization = budget.available > 0 ? totalUsed / budget.available : 0;

    const wastedTokens = budget.allocation.tier1 - tiers.tier1.usedTokens +
                        budget.allocation.tier2 - tiers.tier2.usedTokens +
                        budget.allocation.tier3 - tiers.tier3.usedTokens;

    const optimalAllocation = wastedTokens < budget.available * 0.1; // Less than 10% waste

    const compressionRatio = totalUsed > 0 ? 
      (tiers.tier1.content.join('').length + 
       tiers.tier2.content.join('').length + 
       tiers.tier3.content.join('').length) / (totalUsed * 4) : 0;

    return {
      utilization: {
        tier1: tier1Utilization,
        tier2: tier2Utilization,
        tier3: tier3Utilization,
        overall: overallUtilization
      },
      efficiency: {
        compressionRatio,
        wastedTokens,
        optimalAllocation
      },
      performance: {
        allocationTime: this.getAverageAllocationTime(),
        tierBuildTime: this.getAverageTierBuildTime()
      }
    };
  }

  private trackAllocationTime(time: number): void {
    this.performanceMetrics.allocationTimes.push(time);
    if (this.performanceMetrics.allocationTimes.length > 100) {
      this.performanceMetrics.allocationTimes = this.performanceMetrics.allocationTimes.slice(-100);
    }
  }

  private trackTierBuildTime(time: number): void {
    this.performanceMetrics.tierBuildTimes.push(time);
    if (this.performanceMetrics.tierBuildTimes.length > 100) {
      this.performanceMetrics.tierBuildTimes = this.performanceMetrics.tierBuildTimes.slice(-100);
    }
  }

  private getAverageAllocationTime(): number {
    const times = this.performanceMetrics.allocationTimes;
    return times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
  }

  private getAverageTierBuildTime(): number {
    const times = this.performanceMetrics.tierBuildTimes;
    return times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.performanceMetrics.allocationTimes = [];
    this.performanceMetrics.tierBuildTimes = [];
  }
}