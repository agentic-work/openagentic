/**
 * Capability Integration Module
 * Integrates Extended Capabilities with existing services
 */

import { ExtendedCapabilitiesService } from './ModelCapabilitiesService.js';
import { DynamicModelSelector } from './DynamicModelSelector.js';
import { IntelligentModelRouter } from './IntelligentModelRouter.js';
import { AzureOpenAIProvider } from '../providers/AzureOpenAIProvider.js';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { ExtendedTaskRequirements } from './ModelCapabilitiesService.js';
import { prisma } from '../utils/prisma.js';

export class CapabilityIntegration {
  private static instance: CapabilityIntegration;
  private capabilitiesService: ExtendedCapabilitiesService;
  private modelRouter: IntelligentModelRouter;
  private dynamicSelector: DynamicModelSelector;
  private initialized = false;

  private constructor(
    private azureClient: any,
    private orchestratorClient: any,
    private logger: Logger
  ) {
    // Initialize Dynamic Model Selector
    this.dynamicSelector = new DynamicModelSelector(
      azureClient,
      {
        cacheTtlMinutes: 60,
        concurrencyLimit: 3,
        testTimeout: 10000,
        retryAttempts: 2,
        fallbackModel: process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL
      },
      logger
    );

    // Create Azure OpenAI Provider
    const azureProvider = new AzureOpenAIProvider(
      this.dynamicSelector,
      orchestratorClient,
      logger
    );

    // Initialize Extended Capabilities Service
    this.capabilitiesService = new ExtendedCapabilitiesService({
      autoDiscovery: false, // We'll trigger this manually
      benchmarkOnDiscovery: false,
      testToolsOnDiscovery: false,
      cacheCapabilities: true,
      providers: [azureProvider]
    });

    // Initialize Intelligent Model Router
    this.modelRouter = new IntelligentModelRouter(
      this.capabilitiesService,
      this.dynamicSelector,
      logger
    );
  }

  /**
   * Get singleton instance
   */
  static getInstance(
    azureClient: any, // OpenAI client
    orchestratorClient: any,
    logger: Logger
  ): CapabilityIntegration {
    if (!CapabilityIntegration.instance) {
      CapabilityIntegration.instance = new CapabilityIntegration(
        azureClient,
        orchestratorClient,
        logger
      );
    }
    return CapabilityIntegration.instance;
  }

  /**
   * Initialize and discover capabilities
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing capability integration...');

      // Refresh model capabilities first
      await this.dynamicSelector.refreshModelCapabilities();
      
      // Discover all capabilities
      const { models, tools } = await this.capabilitiesService.discoverAllCapabilities();
      
      this.logger.info({
        modelsDiscovered: models.length,
        toolsDiscovered: tools.length
      }, 'Capability discovery completed');

      // Store capabilities in database
      await this.persistCapabilities(models, tools);

      this.initialized = true;
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize capabilities');
      // Don't throw - allow system to work with limited capabilities
    }
  }

  /**
   * Analyze message to determine requirements
   */
  async analyzeMessageRequirements(
    message: string,
    attachments?: any[]
  ): Promise<ExtendedTaskRequirements> {
    const requirements: ExtendedTaskRequirements = {
      capabilities: [],
      inputs: {},
      outputs: { type: 'text' },
      preferences: { optimizeFor: 'balanced' }
    };

    // Check for image attachments
    if (attachments?.some(a => a.type?.startsWith('image/'))) {
      requirements.capabilities.push({
        category: 'vision',
        required: true
      });
      requirements.inputs.images = { 
        required: true, 
        count: attachments.filter(a => a.type?.startsWith('image/')).length 
      };
    }

    // Check for cloud-related keywords - use capability categories, NOT hardcoded MCP names
    // Cloud provider tools are discovered dynamically based on server name patterns
    const cloudKeywords = ['azure', 'aws', 'gcp', 'subscription', 'resource', 'deployment', 'vm', 'storage', 'ec2', 's3', 'iam'];
    if (cloudKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
      requirements.capabilities.push({
        category: 'tool_use',
        // Use capability hint instead of hardcoded MCP name - tools matched by server name pattern
        capabilityHint: 'cloud',
        required: true
      });
    }

    // Check for memory-related keywords - use capability hint, NOT hardcoded MCP name
    const memoryKeywords = ['remember', 'recall', 'store', 'memory', 'entity'];
    if (memoryKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
      requirements.capabilities.push({
        category: 'tool_use',
        capabilityHint: 'memory',
        required: true
      });
    }

    // Check for image generation keywords
    const imageGenKeywords = ['generate image', 'create image', 'draw', 'design', 'illustrate'];
    if (imageGenKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
      requirements.capabilities.push({
        category: 'image_generation',
        required: true
      });
      requirements.outputs = { type: 'image' };
    }

    // Check for complex reasoning tasks
    const reasoningKeywords = ['analyze', 'compare', 'evaluate', 'explain why', 'how does'];
    if (reasoningKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
      requirements.capabilities.push({
        category: 'reasoning',
        required: true
      });
    }

    // Default to language capability if nothing specific detected
    if (requirements.capabilities.length === 0) {
      requirements.capabilities.push({
        category: 'language',
        required: true
      });
      requirements.inputs.text = { required: true };
    } else {
      // Always add text input
      requirements.inputs.text = { required: true };
    }

    return requirements;
  }

  /**
   * Select model for a message
   */
  async selectModelForMessage(
    message: string,
    attachments?: any[],
    userPreferences?: any
  ): Promise<{
    model: string;
    tools: string[];
    reason: string;
  }> {
    try {
      // Analyze requirements
      const requirements = await this.analyzeMessageRequirements(message, attachments);

      // Apply user preferences
      if (userPreferences?.optimizeFor) {
        requirements.preferences = {
          optimizeFor: userPreferences.optimizeFor
        };
      }

      // Get routing decision
      const decision = await this.modelRouter.routeRequest(requirements);

      return {
        model: decision.model.id,
        tools: decision.tools.map(t => t.toolId),
        reason: decision.reason
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to select model, using fallback');
      
      // Fallback to default model
      const fallbackModel = await this.dynamicSelector.getBestModel() || 
                           process.env.AZURE_OPENAI_DEPLOYMENT || 
                           process.env.DEFAULT_MODEL;
      
      return {
        model: fallbackModel,
        tools: [],
        reason: 'Using fallback model due to routing error'
      };
    }
  }

  /**
   * Update capability scores based on usage
   */
  async updateCapabilityPerformance(
    capabilityId: string,
    performance: {
      success: boolean;
      quality?: number;
      latency: number;
      cost: number;
    }
  ): Promise<void> {
    try {
      // Update in service
      await this.capabilitiesService.updateCapabilityScores(capabilityId, performance);

      // Store in database - use create with ignore on conflict since no unique constraint exists
      try {
        await prisma.modelCapability.create({
          data: {
            model_id: capabilityId.split('_')[0] || 'unknown',
            capability: capabilityId,
            enabled: performance.success
          }
        });
      } catch (error) {
        // Ignore if already exists, just log
        this.logger.debug({ capabilityId }, 'Model capability already exists, skipping');
      }
    } catch (error) {
      this.logger.error({ error, capabilityId }, 'Failed to update capability performance');
    }
  }

  /**
   * Persist capabilities to database
   */
  private async persistCapabilities(models: any[], tools: any[]): Promise<void> {
    try {
      // Store model capabilities
      for (const model of models) {
        for (const [capType, capabilities] of Object.entries(model.capabilities || {})) {
          if (!capabilities) continue;
          
          for (const cap of capabilities as any[]) {
            try {
              await prisma.modelCapability.create({
                data: {
                  model_id: model.id,
                  capability: capType,
                  config: cap,
                  enabled: true
                }
              });
            } catch (error) {
              // Log but continue if capability already exists
              this.logger.debug({ modelId: model.id, capability: capType }, 'Model capability already exists, skipping');
            }
          }
        }
      }

      // Store tool capabilities
      for (const tool of tools) {
        try {
          await prisma.mCPToolCapabilities.create({
            data: {
              server_id: tool.serverId || 'unknown',
              tool_name: tool.toolId || tool.name,
              description: tool.description,
              input_schema: tool.operations || {},
              capabilities: [tool.provider || 'unknown']
            }
          });
        } catch (error) {
          // Log but continue if tool capability already exists
          this.logger.debug({ toolId: tool.toolId }, 'Tool capability already exists, skipping');
        }
      }

      this.logger.info({
        modelsStored: models.length,
        toolsStored: tools.length
      }, 'Capabilities persisted to database');
    } catch (error) {
      this.logger.error({ error }, 'Failed to persist capabilities');
    }
  }

  /**
   * Get service instances for direct access
   */
  getServices() {
    return {
      capabilitiesService: this.capabilitiesService,
      modelRouter: this.modelRouter,
      dynamicSelector: this.dynamicSelector
    };
  }

  /**
   * Export capability catalog
   */
  async exportCatalog(format: 'json' | 'yaml' | 'markdown' = 'json'): Promise<string> {
    return this.capabilitiesService.exportCapabilityCatalog(format, {
      includeModels: true,
      includeTools: true,
      includeBenchmarks: false,
      includeExamples: true
    });
  }
}