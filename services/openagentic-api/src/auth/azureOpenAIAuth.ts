/**
 * Azure OpenAI Authentication Service
 *
 * Manages authentication for Azure OpenAI using direct SDK integration.
 * Previously routed through MCP Proxy - now uses Azure OpenAI SDK directly.
 *
 * @deprecated This service may be redundant now that we use Azure OpenAI SDK directly.
 * Consider removing this abstraction layer and using AzureOpenAI client directly.
 */

import { FastifyRequest } from 'fastify';
import { loggers } from '../utils/logger.js';

const logger = loggers.auth;

export interface AzureOpenAIConfig {
  endpoint: string;
  deployment: string;
  apiVersion?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  resourceName?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
}

export interface UserContext {
  userId: string;
  tenantId: string;
  email?: string;
  roles?: string[];
}

/**
 * @deprecated Use AzureOpenAI from 'openai' package directly
 */
export interface LLMClient {
  endpoint: string;
  headers: Record<string, string>;
  model: string;
}

/**
 * Azure OpenAI Authentication Service
 *
 * @deprecated This service is deprecated. Use AzureOpenAI SDK directly.
 * Kept for backwards compatibility only.
 */
export class AzureOpenAIAuthService {
  private config: AzureOpenAIConfig;

  constructor(config: AzureOpenAIConfig) {
    this.config = {
      ...config,
      apiVersion: config.apiVersion || process.env.AZURE_OPENAI_API_VERSION || ''
    };

    logger.warn('[AZURE-AUTH] AzureOpenAIAuthService is DEPRECATED - use AzureOpenAI SDK directly');
  }

  /**
   * @deprecated Use AzureOpenAI SDK directly instead
   * Returns a deprecated client configuration
   */
  async createClient(userContext?: UserContext): Promise<LLMClient> {
    logger.warn('[AZURE-AUTH] createClient is deprecated - use AzureOpenAI SDK directly');

    return {
      endpoint: this.config.endpoint,
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.clientSecret || ''
      },
      model: this.config.deployment
    };
  }

  /**
   * @deprecated Use AzureOpenAI SDK directly instead
   */
  async createClientWithUserToken(userAccessToken: string, userContext: UserContext): Promise<LLMClient> {
    logger.warn('[AZURE-AUTH] createClientWithUserToken is deprecated - use AzureOpenAI SDK directly');

    return {
      endpoint: this.config.endpoint,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAccessToken}`
      },
      model: this.config.deployment
    };
  }

  /**
   * Extract user context from a Fastify request
   */
  getUserContext(request: FastifyRequest): UserContext | undefined {
    const user = (request as any).user;
    if (!user) return undefined;

    return {
      userId: user.id || user.sub || user.oid,
      tenantId: user.tid || user.tenantId || this.config.tenantId || '',
      email: user.email || user.preferred_username,
      roles: user.roles || []
    };
  }

  /**
   * @deprecated Use Azure OpenAI SDK's models.list() instead
   */
  async getAvailableModels(): Promise<string[]> {
    logger.warn('[AZURE-AUTH] getAvailableModels is deprecated - use AzureOpenAI SDK directly');
    return [this.config.deployment];
  }

  /**
   * @deprecated Use AzureOpenAI SDK's chat.completions.create() instead
   */
  async createCompletion(
    messages: any[],
    options: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
      stream?: boolean;
      user?: UserContext;
    } = {}
  ): Promise<any> {
    logger.error('[AZURE-AUTH] createCompletion is deprecated and will not work - use AzureOpenAI SDK directly');
    throw new Error('createCompletion is deprecated - use AzureOpenAI SDK directly');
  }
}

/**
 * Default Azure OpenAI configuration from environment
 */
export function getDefaultAzureConfig(): AzureOpenAIConfig {
  return {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || '',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '',
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    resourceGroup: process.env.AZURE_RESOURCE_GROUP,
    resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME,
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    tenantId: process.env.AZURE_TENANT_ID
  };
}

// Export a default instance
export const azureOpenAIAuth = new AzureOpenAIAuthService(getDefaultAzureConfig());