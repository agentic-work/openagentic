/**
 * Intelligent Model Router
 * Routes requests to optimal models based on capabilities and requirements
 */

import type { 
  ExtendedCapabilitiesService,
  ExtendedTaskRequirements,
  ExtendedModel,
  MCPToolCapability,
  CapabilityRecommendation,
  OptimizedWorkflow
} from './ModelCapabilitiesService.js';
import type { DynamicModelSelector } from './DynamicModelSelector.js';
import type { Logger } from 'pino';

export interface RouteDecision {
  model: ExtendedModel;
  tools: MCPToolCapability[];
  workflow?: OptimizedWorkflow;
  reason: string;
  fallback?: boolean;
}

export class IntelligentModelRouter {
  private logger?: Logger;
  private fallbackAttempts = 3;

  constructor(
    private capabilitiesService: ExtendedCapabilitiesService,
    private dynamicSelector: DynamicModelSelector,
    logger?: Logger
  ) {
    this.logger = logger;
  }

  /**
   * Route a request to the optimal model based on requirements
   */
  async routeRequest(requirements: ExtendedTaskRequirements): Promise<RouteDecision> {
    try {
      // Get initial recommendation from capabilities service
      let recommendation = await this.capabilitiesService.recommendCapabilities(requirements);
      
      // Check if we have a valid primary model
      if (!recommendation.primary) {
        // Try to get any available model as fallback
        const fallbackModel = await this.dynamicSelector.getBestModel();
        if (!fallbackModel) {
          throw new Error('No suitable model available for requirements');
        }
        
        // Get model info from capabilities service or create minimal model
        const models = await this.capabilitiesService.getVisionModels([], 0); // Get all models
        const model = models.find(m => m.id === fallbackModel);
        
        if (!model) {
          throw new Error('No suitable model available for requirements');
        }
        
        return {
          model,
          tools: [],
          workflow: undefined,
          reason: 'Using best available model',
          fallback: true
        };
      }

      // Determine routing reason based on requirements
      const reason = this.determineRoutingReason(requirements, recommendation);

      // Check if we need to optimize based on preferences
      if (requirements.preferences) {
        recommendation = await this.optimizeForPreferences(
          requirements,
          recommendation
        );
      }

      // Verify model availability
      const isAvailable = await this.verifyModelAvailability(
        recommendation.primary.id
      );

      if (!isAvailable) {
        // Try fallback
        return await this.getFallbackRoute(requirements);
      }

      // Check constraints
      if (requirements.constraints) {
        const meetsConstraints = this.checkConstraints(
          recommendation,
          requirements.constraints
        );

        if (!meetsConstraints) {
          // Try to find alternative that meets constraints
          return await this.findConstraintCompliantRoute(requirements);
        }
      }

      return {
        model: recommendation.primary,
        tools: recommendation.tools || [],
        workflow: recommendation.workflow,
        reason
      };

    } catch (error) {
      this.logger?.error({ error, requirements }, 'Failed to route request');
      throw error;
    }
  }

  /**
   * Determine routing reason based on requirements
   */
  private determineRoutingReason(
    requirements: ExtendedTaskRequirements,
    recommendation: CapabilityRecommendation
  ): string {
    // Check for workflow
    if (requirements.workflow && recommendation.workflow) {
      return 'Complex multi-step task - using multimodal model with workflow';
    }

    // Check for specific tool requirements
    const toolRequirement = requirements.capabilities.find(
      c => c.category === 'tool_use'
    );
    if (toolRequirement) {
      // Check if capability hints are provided (dynamic, not hardcoded)
      if ((toolRequirement as any).capabilityHint) {
        const hint = (toolRequirement as any).capabilityHint;
        return `Task requires ${hint} capabilities - using tool-capable model`;
      }
      return 'Task requires tools - using tool-capable model';
    }

    // Check for vision requirements
    const visionRequirement = requirements.capabilities.find(
      c => c.category === 'vision'
    );
    if (visionRequirement) {
      const subcategory = visionRequirement.subcategory || 'vision';
      return `Vision task requiring ${subcategory.toUpperCase()} - using vision-capable model`;
    }

    // Check for optimization preference
    if (requirements.preferences?.optimizeFor === 'speed') {
      return 'Optimizing for speed - using fastest available model';
    }

    if (requirements.preferences?.optimizeFor === 'cost') {
      return 'Optimizing for cost - using most economical model';
    }

    // Default reason
    return 'Task routed to optimal model based on capabilities';
  }

  /**
   * Optimize recommendation based on user preferences
   */
  private async optimizeForPreferences(
    requirements: ExtendedTaskRequirements,
    recommendation: CapabilityRecommendation
  ): Promise<CapabilityRecommendation> {
    const { optimizeFor } = requirements.preferences || {};

    switch (optimizeFor) {
      case 'cost':
        // Check if current recommendation exceeds cost constraints
        if (requirements.constraints?.maxCost && 
            recommendation.estimatedCost > requirements.constraints.maxCost) {
          // Request cheaper alternative
          const costOptimizedReq = {
            ...requirements,
            constraints: {
              ...requirements.constraints,
              maxCost: requirements.constraints.maxCost * 0.5 // Try half the cost
            }
          };
          return await this.capabilitiesService.recommendCapabilities(costOptimizedReq);
        }
        break;

      case 'speed':
        // Check if current recommendation exceeds latency constraints
        if (requirements.constraints?.maxLatency && 
            recommendation.estimatedLatency > requirements.constraints.maxLatency) {
          // Request faster alternative
          const speedOptimizedReq = {
            ...requirements,
            constraints: {
              ...requirements.constraints,
              maxLatency: requirements.constraints.maxLatency * 0.5
            }
          };
          return await this.capabilitiesService.recommendCapabilities(speedOptimizedReq);
        }
        break;

      case 'quality':
        // Already optimized for quality by default
        break;
    }

    return recommendation;
  }

  /**
   * Verify if a model is actually available
   */
  private async verifyModelAvailability(modelId: string): Promise<boolean> {
    try {
      const [supportsTools, responseTime] = await this.dynamicSelector.testToolCapability(modelId);
      
      // Consider model available if it responds (even without tool support)
      // Response time of 0 indicates failure
      return responseTime > 0;
    } catch (error) {
      this.logger?.warn({ modelId, error }, 'Model availability check failed');
      return false;
    }
  }

  /**
   * Check if recommendation meets constraints
   */
  private checkConstraints(
    recommendation: CapabilityRecommendation,
    constraints: ExtendedTaskRequirements['constraints']
  ): boolean {
    if (!constraints) return true;

    if (constraints.maxCost && recommendation.estimatedCost > constraints.maxCost) {
      return false;
    }

    if (constraints.maxLatency && recommendation.estimatedLatency > constraints.maxLatency) {
      return false;
    }

    if (constraints.minReliability && 
        recommendation.primary.performance.reliability < constraints.minReliability) {
      return false;
    }

    return true;
  }

  /**
   * Get fallback route when primary model is unavailable
   */
  private async getFallbackRoute(
    requirements: ExtendedTaskRequirements
  ): Promise<RouteDecision> {
    this.logger?.info('Primary model unavailable, attempting fallback');

    // Try to get alternative recommendation
    const fallbackReq = {
      ...requirements,
      constraints: {
        ...requirements.constraints,
        excludeProviders: ['primary'] // Exclude failed provider
      }
    };

    const fallbackRecommendation = await this.capabilitiesService.recommendCapabilities(fallbackReq);

    if (!fallbackRecommendation.primary) {
      // Last resort - get any available model
      const anyModel = await this.dynamicSelector.getBestModel();
      if (!anyModel) {
        throw new Error('No suitable model available for requirements');
      }

      // Create minimal model object
      const minimalModel: ExtendedModel = {
        id: anyModel,
        name: anyModel,
        provider: 'azure-openai',
        version: 'unknown',
        type: 'language',
        capabilities: {},
        cost: { currency: 'USD' },
        performance: { 
          reliability: 0.98,
          latency: { text: { p50: 1000, p95: 2000, p99: 3000 } },
          throughput: { tokensPerSecond: 50 }
        },
        constraints: {},
        metadata: { 
          family: 'gpt', 
          size: 'medium', 
          tags: [],
          specializations: []
        },
        status: 'active'
      };

      return {
        model: minimalModel,
        tools: [],
        workflow: undefined,
        reason: 'Primary model unavailable - using fallback model',
        fallback: true
      };
    }

    return {
      model: fallbackRecommendation.primary,
      tools: fallbackRecommendation.tools || [],
      workflow: fallbackRecommendation.workflow,
      reason: 'Primary model unavailable - using fallback model',
      fallback: true
    };
  }

  /**
   * Find route that meets constraints
   */
  private async findConstraintCompliantRoute(
    requirements: ExtendedTaskRequirements
  ): Promise<RouteDecision> {
    this.logger?.info('Finding constraint-compliant route');

    // Adjust requirements to be more lenient
    const adjustedReq = {
      ...requirements,
      capabilities: requirements.capabilities.map(cap => ({
        ...cap,
        minScore: cap.minScore ? cap.minScore * 0.8 : undefined // Lower score requirements
      }))
    };

    const recommendation = await this.capabilitiesService.recommendCapabilities(adjustedReq);

    if (!recommendation.primary) {
      throw new Error('No model meets the specified constraints');
    }

    const reason = requirements.preferences?.optimizeFor === 'cost' 
      ? 'Optimizing for cost - using most economical model'
      : requirements.preferences?.optimizeFor === 'speed'
      ? 'Optimizing for speed - using fastest model'
      : 'Using best available model within constraints';

    return {
      model: recommendation.primary,
      tools: recommendation.tools || [],
      workflow: recommendation.workflow,
      reason
    };
  }

  /**
   * Get status of routing capabilities
   */
  async getRoutingStatus(): Promise<{
    availableModels: number;
    availableTools: number;
    routingHealth: 'healthy' | 'degraded' | 'unhealthy';
  }> {
    try {
      const models = await this.capabilitiesService.getVisionModels([], 0);
      const tools = await this.capabilitiesService.getMCPTools([], 0);

      const routingHealth = models.length > 0 
        ? 'healthy' 
        : tools.length > 0 
        ? 'degraded' 
        : 'unhealthy';

      return {
        availableModels: models.length,
        availableTools: tools.length,
        routingHealth
      };
    } catch (error) {
      this.logger?.error({ error }, 'Failed to get routing status');
      return {
        availableModels: 0,
        availableTools: 0,
        routingHealth: 'unhealthy'
      };
    }
  }
}