import { MetricsUtils } from '../../metrics/metricsMiddleware.js';
import { 
  ContextAssemblyResult, 
  ContextBudget,
  ContextTiers 
} from '../types/Context.js';
import { MemorySearchResult } from '../types/Memory.js';
import { CacheStats } from '../types/Cache.js';

/**
 * Integration layer between memory system and Prometheus metrics
 */
export class MemoryMetricsIntegration {
  /**
   * Track context assembly metrics
   */
  static trackContextAssembly(
    result: ContextAssemblyResult,
    model: string,
    userId: string
  ): void {
    // Track assembly duration
    MetricsUtils.trackMemoryOperation('assembly', {
      model,
      tokens: result.context.totalTokens,
      cacheHit: result.context.cacheHit
    });

    // Track cache hit/miss
    if (result.context.cacheHit) {
      MetricsUtils.trackMemoryOperation('cache_hit', { cacheType: 'context' });
    } else {
      MetricsUtils.trackMemoryOperation('cache_miss', { cacheType: 'context' });
    }

    // Track tier utilization
    if (result.context.tiers) {
      const tierStats = this.calculateTierUtilization(result.context.tiers);
      MetricsUtils.updateTierUtilization(tierStats);
    }
  }

  /**
   * Track memory retrieval metrics
   */
  static trackMemoryRetrieval(
    result: MemorySearchResult,
    userId: string
  ): void {
    if (result.cacheHit) {
      MetricsUtils.trackMemoryOperation('cache_hit', { cacheType: 'memory_index' });
    } else {
      MetricsUtils.trackMemoryOperation('cache_miss', { cacheType: 'memory_index' });
    }
  }

  /**
   * Track cache operation metrics
   */
  static trackCacheOperation(
    operation: 'get' | 'set' | 'delete',
    cacheType: string,
    success: boolean,
    duration: number
  ): void {
    if (operation === 'get' && success) {
      MetricsUtils.trackMemoryOperation('cache_hit', { cacheType });
    } else if (operation === 'get' && !success) {
      MetricsUtils.trackMemoryOperation('cache_miss', { cacheType });
    }
  }

  /**
   * Track session cache metrics
   */
  static trackSessionUpdate(
    userId: string,
    sessionId: string,
    messageCount: number,
    contextTokens: number
  ): void {
    // Session updates are tracked through chat message metrics
    // This is for additional session-specific metrics if needed
  }

  /**
   * Calculate tier utilization percentages
   */
  private static calculateTierUtilization(tiers: ContextTiers): Record<string, number> {
    const result: Record<string, number> = {};

    // Calculate utilization for each tier
    ['tier1', 'tier2', 'tier3'].forEach(tierName => {
      const tier = tiers[tierName as keyof ContextTiers];
      if (tier && tier.maxTokens > 0) {
        result[tierName] = tier.usedTokens / tier.maxTokens;
      } else {
        result[tierName] = 0;
      }
    });

    return result;
  }

  /**
   * Track budget optimization metrics
   */
  static trackBudgetOptimization(
    budget: ContextBudget,
    actualUsage: number,
    optimizationTime: number
  ): void {
    const efficiency = actualUsage / budget.available;
    
    // Track if budget was well-utilized (between 80% and 100%)
    const wellUtilized = efficiency >= 0.8 && efficiency <= 1.0;
    
    // Could add custom metrics here for budget optimization performance
  }

  /**
   * Track cache statistics
   */
  static trackCacheStats(stats: CacheStats): void {
    // These stats are already tracked through individual operations
    // This method is for periodic stat dumps if needed
  }

  /**
   * Helper to create metric-aware wrappers
   */
  static createMetricWrapper<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    metricName: string,
    extractLabels?: (args: any[]) => Record<string, string>
  ): T {
    return (async (...args: any[]) => {
      const startTime = Date.now();
      let success = true;

      try {
        const result = await fn(...args);
        return result;
      } catch (error) {
        success = false;
        throw error;
      } finally {
        const duration = Date.now() - startTime;
        const labels = extractLabels ? extractLabels(args) : {};
        
        // Log metric with duration and success status
        console.log(`[Metric] ${metricName}`, {
          duration,
          success,
          ...labels
        });
      }
    }) as T;
  }
}

/**
 * Decorator for automatic metric tracking
 */
export function TrackMetrics(metricName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      let success = true;

      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } catch (error) {
        success = false;
        throw error;
      } finally {
        const duration = Date.now() - startTime;
        
        // Log metric
        console.log(`[Metric] ${metricName}.${propertyKey}`, {
          duration,
          success
        });
      }
    };

    return descriptor;
  };
}