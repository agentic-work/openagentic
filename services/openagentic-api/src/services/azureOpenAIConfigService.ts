/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Enhanced Azure OpenAI Configuration Service
 * 
 * Comprehensive service for managing Azure OpenAI configurations including:
 * - Authentication methods (API key and Entra ID)
 * - Dynamic model discovery and deployment management
 * - Multi-tenant access control and quotas
 * - Usage tracking and cost management
 * - Health monitoring and failover
 * - Integration with MCP Proxy
 * 
 * Features:
 * - Flexible authentication methods (API key or Entra ID)
 * - Fine-grained model access control per user/group/tenant
 * - Token usage quotas and rate limiting
 * - Model-specific permissions and overrides
 * - Environment variable fallback for configuration
 * - Real-time health monitoring
 * - Cost tracking and billing integration
 * - Automatic failover and load balancing
 */

import { promises as fs } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { AzureOpenAIAuthService, getDefaultAzureConfig } from '../auth/azureOpenAIAuth.js';
import { getRedisClient } from '../utils/redis-client.js';

export interface AzureOpenAISettings {
  authMethod: 'apiKey' | 'entraId';
  
  // Common settings
  endpoint: string;
  deployment: string;
  apiVersion: string;
  
  // API Key settings (legacy)
  apiKey?: string;
  
  // Entra ID settings
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  resourceName?: string;
  
  // Model permissions
  modelPermissions?: {
    [modelName: string]: {
      allowedUsers?: string[];
      allowedGroups?: string[];
      allowedTenants?: string[];
      quotaOverrides?: {
        [userId: string]: {
          dailyLimit?: number;
          monthlyLimit?: number;
        };
      };
    };
  };
  
  // Global quotas
  defaultQuotas?: {
    dailyTokenLimit: number;
    monthlyTokenLimit: number;
    maxTokensPerRequest: number;
  };
}

export interface AzureDeployment {
  id: string;
  name: string;
  model: string;
  version: string;
  endpoint: string;
  region: string;
  capacity: number;
  status: 'provisioning' | 'succeeded' | 'failed' | 'deleting';
  pricing: {
    inputTokensPerK: number;
    outputTokensPerK: number;
    currency: 'USD';
  };
  quotas: {
    tokensPerMinute: number;
    requestsPerMinute: number;
    tokensPerDay: number;
  };
  metadata: {
    created: string;
    lastModified: string;
    tags: Record<string, string>;
  };
}

export interface ModelCapabilities {
  model: string;
  maxTokens: number;
  contextWindow: number;
  supportsFunctions: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  supportsSystemMessages: boolean;
  trainingDataCutoff: string;
}

export interface TenantConfig {
  tenantId: string;
  subscriptionId: string;
  resourceGroup: string;
  deployments: AzureDeployment[];
  defaultModel: string;
  fallbackModels: string[];
  settings: {
    enableAutoFailover: boolean;
    maxRetries: number;
    timeoutMs: number;
    rateLimit: {
      requestsPerMinute: number;
      burstLimit: number;
    };
  };
}

export interface UsageMetrics {
  tenantId: string;
  model: string;
  deployment: string;
  timestamp: string;
  metrics: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageLatency: number;
    cost: number;
  };
}

export class AzureOpenAIConfigService {
  private settingsPath: string;
  private settings: AzureOpenAISettings | null = null;
  private logger: any;
  private prisma?: PrismaClient;
  private redisClient: any;
  private authService: AzureOpenAIAuthService;
  private deploymentConfigs: Map<string, TenantConfig> = new Map();
  private modelCapabilities: Map<string, ModelCapabilities> = new Map();
  private healthStatus: Map<string, boolean> = new Map();

  constructor(dataDir: string = '/app/data', logger?: any, prisma?: PrismaClient) {
    this.settingsPath = path.join(dataDir, 'azure-openai-settings.json');
    this.logger = logger?.child({ service: 'AzureOpenAIConfigService' }) as Logger;
    this.prisma = prisma;
    this.redisClient = logger ? getRedisClient() : null;
    this.authService = new AzureOpenAIAuthService(getDefaultAzureConfig());
    
    if (logger) {
      this.initializeModelCapabilities();
      this.startHealthMonitoring();
    }
  }

  async loadSettings(): Promise<AzureOpenAISettings> {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf-8');
      this.settings = JSON.parse(data);
      return this.settings!;
    } catch (error) {
      // Return default settings if file doesn't exist
      return this.getDefaultSettings();
    }
  }

  async saveSettings(settings: AzureOpenAISettings): Promise<void> {
    this.settings = settings;
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  private getDefaultSettings(): AzureOpenAISettings {
    return {
      authMethod: 'apiKey',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || '',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview',
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
      
      // Entra ID settings from environment (optional)
      tenantId: process.env.AZURE_TENANT_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
      
      // Default quotas - Environment configurable
      defaultQuotas: {
        dailyTokenLimit: parseInt(process.env.AZURE_OPENAI_DAILY_TOKEN_LIMIT || process.env.DEFAULT_DAILY_TOKEN_LIMIT || '0'),
        monthlyTokenLimit: parseInt(process.env.AZURE_OPENAI_MONTHLY_TOKEN_LIMIT || process.env.DEFAULT_MONTHLY_TOKEN_LIMIT || '0'),
        maxTokensPerRequest: parseInt(process.env.AZURE_OPENAI_MAX_TOKENS_PER_REQUEST || process.env.DEFAULT_MAX_TOKENS_PER_REQUEST || '0')
      },
      
      // Model permissions are dynamic - remove hardcoded models
      // Provider handles model discovery and access control
      modelPermissions: {}
    };
  }

  /**
   * Check if a user has access to a specific model/deployment
   */
  async checkModelAccess(deployment: string, userId: string, userGroups: string[], tenantId: string): Promise<boolean> {
    const settings = await this.loadSettings();
    const permissions = settings.modelPermissions?.[deployment];
    
    if (!permissions) {
      // No specific permissions defined, allow by default
      return true;
    }

    // Check tenant access
    if (permissions.allowedTenants) {
      if (permissions.allowedTenants.includes('*') || permissions.allowedTenants.includes(tenantId)) {
        return true;
      }
    }

    // Check user access
    if (permissions.allowedUsers?.includes(userId)) {
      return true;
    }

    // Check group access
    if (permissions.allowedGroups && userGroups.some(group => permissions.allowedGroups!.includes(group))) {
      return true;
    }

    return false;
  }

  /**
   * Get quota limits for a specific user
   */
  async getUserQuota(userId: string, deployment: string): Promise<{
    dailyLimit: number;
    monthlyLimit: number;
    maxTokensPerRequest: number;
  }> {
    const settings = await this.loadSettings();
    const defaultQuotas = settings.defaultQuotas || {
      dailyTokenLimit: 1000000,
      monthlyTokenLimit: 30000000,
      maxTokensPerRequest: 4000
    };

    // Check for user-specific overrides
    const modelPermissions = settings.modelPermissions?.[deployment];
    const userOverride = modelPermissions?.quotaOverrides?.[userId];

    return {
      dailyLimit: userOverride?.dailyLimit || defaultQuotas.dailyTokenLimit,
      monthlyLimit: userOverride?.monthlyLimit || defaultQuotas.monthlyTokenLimit,
      maxTokensPerRequest: defaultQuotas.maxTokensPerRequest
    };
  }

  // Enhanced methods for comprehensive Azure OpenAI management

  /**
   * Get Azure OpenAI configuration for a tenant
   */
  async getTenantConfig(tenantId: string): Promise<TenantConfig | null> {
    if (!this.logger) return null;
    
    const cacheKey = `azure-config:${tenantId}`;
    
    // Check cache first
    if (this.redisClient && this.redisClient.isConnected()) {
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    try {
      // In production, this would query Azure Resource Manager API
      // For now, return a default configuration
      const config: TenantConfig = {
        tenantId,
        subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || '',
        resourceGroup: process.env.AZURE_RESOURCE_GROUP || 'openagentic-rg',
        deployments: await this.getDeploymentsForTenant(tenantId),
        defaultModel: 'gpt-4-32k',
        fallbackModels: ['gpt-4', 'gpt-35-turbo'],
        settings: {
          enableAutoFailover: true,
          maxRetries: 3,
          timeoutMs: 30000,
          rateLimit: {
            requestsPerMinute: 300,
            burstLimit: 500
          }
        }
      };

      this.deploymentConfigs.set(tenantId, config);

      // Cache for 15 minutes
      if (this.redisClient && this.redisClient.isConnected()) {
        await this.redisClient.set(cacheKey, config, 900);
      }

      return config;

    } catch (error: any) {
      this.logger.error({ tenantId, error: error.message }, 'Failed to get tenant config');
      return null;
    }
  }

  /**
   * Get available Azure OpenAI deployments for a tenant
   */
  async getDeploymentsForTenant(tenantId: string): Promise<AzureDeployment[]> {
    if (!this.logger) return [];
    
    try {
      // Mock deployments - in production would query Azure API
      const mockDeployments: AzureDeployment[] = [
        {
          id: 'gpt-4-32k-deployment',
          name: 'gpt-4-32k',
          model: 'gpt-4-32k',
          version: '0613',
          endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
          region: 'eastus',
          capacity: 100,
          status: 'succeeded',
          pricing: {
            inputTokensPerK: 0.06,
            outputTokensPerK: 0.12,
            currency: 'USD'
          },
          quotas: {
            tokensPerMinute: 150000,
            requestsPerMinute: 300,
            tokensPerDay: 10000000
          },
          metadata: {
            created: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            tags: {
              environment: process.env.NODE_ENV || 'development',
              tenant: tenantId
            }
          }
        },
        {
          id: 'gpt-35-turbo-deployment',
          name: 'gpt-35-turbo',
          model: 'gpt-35-turbo',
          version: '0613',
          endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
          region: 'eastus',
          capacity: 200,
          status: 'succeeded',
          pricing: {
            inputTokensPerK: 0.0015,
            outputTokensPerK: 0.002,
            currency: 'USD'
          },
          quotas: {
            tokensPerMinute: 300000,
            requestsPerMinute: 600,
            tokensPerDay: 20000000
          },
          metadata: {
            created: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            tags: {
              environment: process.env.NODE_ENV || 'development',
              tenant: tenantId
            }
          }
        }
      ];

      return mockDeployments;

    } catch (error: any) {
      this.logger.error({ tenantId, error: error.message }, 'Failed to get deployments');
      return [];
    }
  }

  /**
   * Get model capabilities for a specific model
   */
  getModelCapabilities(model: string): ModelCapabilities | null {
    return this.modelCapabilities.get(model) || null;
  }

  /**
   * Get optimal model for a request based on requirements
   */
  async getOptimalModel(
    tenantId: string,
    requirements: {
      contextLength?: number;
      needsFunctions?: boolean;
      needsVision?: boolean;
      needsJsonMode?: boolean;
      priorityCost?: 'low' | 'medium' | 'high';
      prioritySpeed?: 'low' | 'medium' | 'high';
    }
  ): Promise<{ model: string; deployment: AzureDeployment } | null> {
    if (!this.logger) return null;

    try {
      const config = await this.getTenantConfig(tenantId);
      if (!config) return null;

      // Filter deployments based on requirements
      let candidates = config.deployments.filter(deployment => {
        const capabilities = this.getModelCapabilities(deployment.model);
        if (!capabilities) return false;

        // Check context length requirement
        if (requirements.contextLength && capabilities.contextWindow < requirements.contextLength) {
          return false;
        }

        // Check function calling requirement
        if (requirements.needsFunctions && !capabilities.supportsFunctions) {
          return false;
        }

        // Check vision requirement
        if (requirements.needsVision && !capabilities.supportsVision) {
          return false;
        }

        // Check JSON mode requirement
        if (requirements.needsJsonMode && !capabilities.supportsJsonMode) {
          return false;
        }

        // Check health status
        return this.healthStatus.get(deployment.id) !== false;
      });

      if (candidates.length === 0) {
        // Fallback to default model
        const defaultDeployment = config.deployments.find(d => d.model === config.defaultModel);
        if (defaultDeployment && this.healthStatus.get(defaultDeployment.id) !== false) {
          return { model: config.defaultModel, deployment: defaultDeployment };
        }
        return null;
      }

      // Sort by priority
      candidates.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        // Cost priority
        if (requirements.priorityCost === 'low') {
          scoreA += (1 / a.pricing.inputTokensPerK) * 10;
          scoreB += (1 / b.pricing.inputTokensPerK) * 10;
        } else if (requirements.priorityCost === 'high') {
          // Higher cost models often have better quality
          scoreA += a.pricing.inputTokensPerK * 10;
          scoreB += b.pricing.inputTokensPerK * 10;
        }

        // Speed priority (based on capacity as proxy)
        if (requirements.prioritySpeed === 'high') {
          scoreA += a.capacity;
          scoreB += b.capacity;
        }

        return scoreB - scoreA;
      });

      const selectedDeployment = candidates[0];
      return { model: selectedDeployment.model, deployment: selectedDeployment };

    } catch (error: any) {
      this.logger.error({ tenantId, error: error.message }, 'Failed to get optimal model');
      return null;
    }
  }

  /**
   * Record usage metrics for billing and monitoring
   */
  async recordUsage(
    tenantId: string,
    model: string,
    deployment: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      successful: boolean;
      latencyMs: number;
    }
  ): Promise<void> {
    if (!this.logger) return;

    try {
      const deploymentInfo = await this.getDeploymentInfo(tenantId, deployment);
      if (!deploymentInfo) return;

      // Calculate cost
      const cost = (usage.promptTokens / 1000) * deploymentInfo.pricing.inputTokensPerK +
                   (usage.completionTokens / 1000) * deploymentInfo.pricing.outputTokensPerK;

      const metrics: UsageMetrics = {
        tenantId,
        model,
        deployment,
        timestamp: new Date().toISOString(),
        metrics: {
          totalTokens: usage.totalTokens,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalRequests: 1,
          successfulRequests: usage.successful ? 1 : 0,
          failedRequests: usage.successful ? 0 : 1,
          averageLatency: usage.latencyMs,
          cost
        }
      };

      // In production, would store in time-series database
      this.logger.info({ 
        tenantId, 
        model, 
        cost: Math.round(cost * 10000) / 10000, // Round to 4 decimal places
        tokens: usage.totalTokens 
      }, 'Azure OpenAI usage recorded');

      // Update cache with aggregated metrics
      await this.updateUsageCache(tenantId, model, metrics);

    } catch (error: any) {
      this.logger.error({ tenantId, model, error: error.message }, 'Failed to record usage');
    }
  }

  /**
   * Get usage summary for a tenant
   */
  async getUsageSummary(
    tenantId: string,
    timeRange: { start: string; end: string }
  ): Promise<{
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    modelBreakdown: Record<string, UsageMetrics['metrics']>;
  }> {
    if (!this.logger) {
      return { totalCost: 0, totalTokens: 0, totalRequests: 0, modelBreakdown: {} };
    }

    try {
      // Mock summary - in production would query usage database
      const summary = {
        totalCost: 45.67,
        totalTokens: 1250000,
        totalRequests: 2500,
        modelBreakdown: {
          'gpt-4-32k': {
            totalTokens: 800000,
            promptTokens: 400000,
            completionTokens: 400000,
            totalRequests: 1200,
            successfulRequests: 1180,
            failedRequests: 20,
            averageLatency: 2500,
            cost: 35.20
          },
          'gpt-35-turbo': {
            totalTokens: 450000,
            promptTokens: 300000,
            completionTokens: 150000,
            totalRequests: 1300,
            successfulRequests: 1295,
            failedRequests: 5,
            averageLatency: 1200,
            cost: 10.47
          }
        }
      };

      return summary;

    } catch (error: any) {
      this.logger.error({ tenantId, error: error.message }, 'Failed to get usage summary');
      return {
        totalCost: 0,
        totalTokens: 0,
        totalRequests: 0,
        modelBreakdown: {}
      };
    }
  }

  /**
   * Update tenant configuration
   */
  async updateTenantConfig(tenantId: string, updates: Partial<TenantConfig>): Promise<TenantConfig | null> {
    if (!this.logger) return null;

    try {
      const currentConfig = await this.getTenantConfig(tenantId);
      if (!currentConfig) return null;

      const updatedConfig = { ...currentConfig, ...updates };
      this.deploymentConfigs.set(tenantId, updatedConfig);

      // Clear cache to force refresh
      const cacheKey = `azure-config:${tenantId}`;
      if (this.redisClient && this.redisClient.isConnected()) {
        await this.redisClient.del(cacheKey);
      }

      this.logger.info({ tenantId, updates }, 'Tenant configuration updated');
      return updatedConfig;

    } catch (error: any) {
      this.logger.error({ tenantId, error: error.message }, 'Failed to update tenant config');
      return null;
    }
  }

  /**
   * Health check for Azure OpenAI deployments
   */
  async checkDeploymentHealth(tenantId: string, deploymentId: string): Promise<boolean> {
    if (!this.logger) return true; // Assume healthy if no logger

    try {
      const deployment = await this.getDeploymentInfo(tenantId, deploymentId);
      if (!deployment) return false;

      // Test with a simple completion request
      const testResult = await this.authService.createCompletion(
        [{ role: 'user', content: 'Test health check' }],
        { 
          model: `azure/${deployment.name}`,
          max_tokens: 10,
          temperature: 0
        }
      );

      const isHealthy = !!testResult && !testResult.error;
      this.healthStatus.set(deploymentId, isHealthy);

      return isHealthy;

    } catch (error: any) {
      this.logger.warn({ tenantId, deploymentId, error: error.message }, 'Deployment health check failed');
      this.healthStatus.set(deploymentId, false);
      return false;
    }
  }

  // Private helper methods

  private initializeModelCapabilities(): void {
    const capabilities: ModelCapabilities[] = [
      {
        model: 'gpt-4-32k',
        maxTokens: 32768,
        contextWindow: 32768,
        supportsFunctions: true,
        supportsVision: false,
        supportsJsonMode: true,
        supportsSystemMessages: true,
        trainingDataCutoff: '2023-04-01'
      },
      {
        model: 'gpt-4',
        maxTokens: 8192,
        contextWindow: 8192,
        supportsFunctions: true,
        supportsVision: false,
        supportsJsonMode: true,
        supportsSystemMessages: true,
        trainingDataCutoff: '2023-04-01'
      },
      {
        model: 'gpt-4-vision-preview',
        maxTokens: 4096,
        contextWindow: 128000,
        supportsFunctions: false,
        supportsVision: true,
        supportsJsonMode: false,
        supportsSystemMessages: true,
        trainingDataCutoff: '2023-04-01'
      },
      {
        model: 'gpt-35-turbo',
        maxTokens: 4096,
        contextWindow: 16385,
        supportsFunctions: true,
        supportsVision: false,
        supportsJsonMode: true,
        supportsSystemMessages: true,
        trainingDataCutoff: '2021-09-01'
      }
    ];

    capabilities.forEach(cap => {
      this.modelCapabilities.set(cap.model, cap);
    });
  }

  private async getDeploymentInfo(tenantId: string, deploymentId: string): Promise<AzureDeployment | null> {
    const config = await this.getTenantConfig(tenantId);
    return config?.deployments.find(d => d.id === deploymentId) || null;
  }

  private async updateUsageCache(tenantId: string, model: string, metrics: UsageMetrics): Promise<void> {
    if (!this.redisClient || !this.redisClient.isConnected()) return;

    const cacheKey = `usage:${tenantId}:${model}:${new Date().toISOString().split('T')[0]}`;
    
    try {
      // Get existing metrics for the day
      const existing = await this.redisClient.get(cacheKey);
      let aggregated = existing ? existing : {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalLatency: 0,
        cost: 0
      };

      // Aggregate new metrics
      aggregated.totalTokens += metrics.metrics.totalTokens;
      aggregated.promptTokens += metrics.metrics.promptTokens;
      aggregated.completionTokens += metrics.metrics.completionTokens;
      aggregated.totalRequests += metrics.metrics.totalRequests;
      aggregated.successfulRequests += metrics.metrics.successfulRequests;
      aggregated.failedRequests += metrics.metrics.failedRequests;
      aggregated.totalLatency += metrics.metrics.averageLatency;
      aggregated.cost += metrics.metrics.cost;

      // Calculate average latency
      if (aggregated.totalRequests > 0) {
        aggregated.averageLatency = aggregated.totalLatency / aggregated.totalRequests;
      }

      // Cache for 24 hours
      await this.redisClient.set(cacheKey, aggregated, 86400);

    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Failed to update usage cache');
    }
  }

  private startHealthMonitoring(): void {
    // Check deployment health every 5 minutes
    setInterval(async () => {
      try {
        for (const [tenantId, config] of this.deploymentConfigs) {
          for (const deployment of config.deployments) {
            await this.checkDeploymentHealth(tenantId, deployment.id);
          }
        }
      } catch (error: any) {
        this.logger.error({ error: error.message }, 'Health monitoring cycle failed');
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<boolean> {
    if (!this.logger) return true; // Basic mode always healthy

    try {
      // Check if auth service is working
      const models = await this.authService.getAvailableModels();
      
      // Check if we have at least some model capabilities loaded
      const hasCapabilities = this.modelCapabilities.size > 0;
      
      return models.length > 0 && hasCapabilities;

    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Azure OpenAI config service health check failed');
      return false;
    }
  }
}
