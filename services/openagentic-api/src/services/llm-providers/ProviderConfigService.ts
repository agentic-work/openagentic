/**
 * Provider Configuration Service
 *
 * Centralized service for loading and managing LLM provider configurations
 * from environment variables and providing them to the ProviderManager
 */

import type { Logger } from 'pino';
import { ProviderConfig, ProviderManagerConfig } from './ProviderManager.js';
import { decryptAuthConfig } from './CredentialEncryptionService.js';

export class ProviderConfigService {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Load provider configurations from database ONLY
   *
   * ARCHITECTURE: Database is the SINGLE SOURCE OF TRUTH for all providers.
   * Environment variables are only used by LLMProviderSeeder at startup to
   * seed initial configuration into the database. After that, all provider
   * management happens through the database/admin UI.
   *
   * This ensures:
   * - Providers can be added/removed via admin UI
   * - Changes persist across restarts
   * - No "phantom" providers from env vars appearing at runtime
   */
  async loadProviderConfig(): Promise<ProviderManagerConfig> {
    // Load providers from database ONLY - database is the single source of truth
    const providers = await this.loadDatabaseProviders();

    if (providers.length === 0) {
      this.logger.warn('No LLM providers configured in database. Use admin UI to add providers or ensure LLMProviderSeeder ran at startup.');
    }

    // Sort by priority (lower number = higher priority)
    providers.sort((a, b) => a.priority - b.priority);

    // Load global settings
    const config: ProviderManagerConfig = {
      providers,
      defaultProvider: process.env.DEFAULT_LLM_PROVIDER || providers[0]?.name,
      enableFailover: process.env.LLM_ENABLE_FAILOVER !== 'false', // Default true
      failoverTimeout: parseInt(process.env.LLM_FAILOVER_TIMEOUT || '30000'), // 30s default
      enableLoadBalancing: process.env.LLM_ENABLE_LOAD_BALANCING === 'true', // Default false
      loadBalancingStrategy: (process.env.LLM_LOAD_BALANCING_STRATEGY || 'priority') as 'round-robin' | 'least-latency' | 'priority'
    };

    this.logger.info({
      providerCount: providers.length,
      providers: providers.map(p => ({ name: p.name, type: p.type, enabled: p.enabled, priority: p.priority })),
      defaultProvider: config.defaultProvider,
      enableFailover: config.enableFailover,
      loadBalancingStrategy: config.loadBalancingStrategy
    }, 'Loaded provider configuration from database (single source of truth)');

    return config;
  }

  /**
   * Load providers from database
   */
  private async loadDatabaseProviders(): Promise<ProviderConfig[]> {
    try {
      const { prisma } = await import('../../utils/prisma.js');

      const dbProviders = await prisma.lLMProvider.findMany({
        where: {
          enabled: true,
          deleted_at: null
        },
        orderBy: {
          priority: 'asc'
        }
      });

      return dbProviders.map(dbProvider => this.convertDatabaseProvider(dbProvider));
    } catch (error) {
      this.logger.warn({ error }, 'Failed to load database providers, falling back to environment only');
      return [];
    }
  }

  /**
   * Convert database LLMProvider to ProviderConfig
   */
  private convertDatabaseProvider(dbProvider: any): ProviderConfig {
    // SECURITY: Decrypt encrypted credential fields from auth_config
    const authConfig = decryptAuthConfig(dbProvider.auth_config as any);
    const providerConfig = dbProvider.provider_config as any;
    const modelConfig = dbProvider.model_config as any || {};

    // Normalize provider type - handle 'bedrock' as alias for 'aws-bedrock'
    let providerType = dbProvider.provider_type;
    if (providerType === 'bedrock') {
      providerType = 'aws-bedrock';
      this.logger.warn({ originalType: 'bedrock', normalizedType: 'aws-bedrock', provider: dbProvider.name },
        'Provider has legacy type "bedrock", normalizing to "aws-bedrock"');
    }

    // Infer auth type if not explicitly set (UI may not send it)
    const authType = authConfig.type || this.inferAuthType(providerType, authConfig);

    // Build config based on provider type and auth method
    let config: any = {
      ...providerConfig,
      ...modelConfig
    };

    // Add auth credentials based on type
    // NOTE: Accept BOTH canonical names (accessKeyId) and UI names (awsAccessKeyId)
    if (providerType === 'azure-openai') {
      if (authType === 'entra-id') {
        config.tenantId = authConfig.tenantId;
        config.clientId = authConfig.clientId;
        config.clientSecret = authConfig.clientSecret;
      } else {
        // api-key auth (default for Azure OpenAI from UI)
        config.apiKey = authConfig.apiKey || authConfig.key || '';
        if (authConfig.endpoint) config.endpoint = authConfig.endpoint;
        if (authConfig.deploymentName) config.deploymentName = authConfig.deploymentName;
        if (authConfig.apiVersion) config.apiVersion = authConfig.apiVersion;
      }
    } else if (providerType === 'vertex-ai') {
      if (authType === 'service-account') {
        // Accept both "credentials" (canonical) and "serviceAccountCredentials" (UI name)
        config.serviceAccountJson = authConfig.credentials || authConfig.serviceAccountCredentials || '';
      } else if (authType === 'api-key') {
        config.apiKey = authConfig.key || authConfig.apiKey || '';
      }
      // Pass through project/region from auth config
      if (authConfig.projectId) config.projectId = authConfig.projectId;
      if (authConfig.region) config.region = authConfig.region;
    } else if (providerType === 'aws-bedrock') {
      // Accept both "accessKeyId" (canonical) and "awsAccessKeyId" (UI name)
      config.accessKeyId = authConfig.accessKeyId || authConfig.awsAccessKeyId || '';
      config.secretAccessKey = authConfig.secretAccessKey || authConfig.awsSecretAccessKey || '';
      config.region = authConfig.region || '';
    } else if (providerType === 'anthropic') {
      config.apiKey = authConfig.apiKey || authConfig.key || '';
      if (authConfig.baseUrl) config.baseUrl = authConfig.baseUrl;
    } else if (providerType === 'openai') {
      config.apiKey = authConfig.apiKey || authConfig.key || '';
      if (authConfig.baseUrl) config.baseUrl = authConfig.baseUrl;
    } else if (providerType === 'ollama') {
      if (authConfig.baseUrl || authConfig.endpoint) config.baseUrl = authConfig.baseUrl || authConfig.endpoint;
      if (authConfig.apiKey) config.apiKey = authConfig.apiKey;
    } else if (providerType === 'azure-ai-foundry') {
      // Entra ID auth (service principal) — preferred
      // Falls back through: auth_config → platform app reg (AZURE_AD_*) → AIF-specific env vars (AIF_*)
      config.tenantId = authConfig.tenantId || process.env.AZURE_AD_TENANT_ID || process.env.AIF_TENANT_ID || '';
      config.clientId = authConfig.clientId || process.env.AAD_CLIENT_ID || process.env.AIF_CLIENT_ID || '';
      config.clientSecret = authConfig.clientSecret || process.env.AZURE_AD_CLIENT_SECRET || process.env.AIF_CLIENT_SECRET || '';
      // API key fallback (only if no Entra creds available)
      if (!config.tenantId && !config.clientId) {
        if (authConfig.apiKey || authConfig.key) config.apiKey = authConfig.apiKey || authConfig.key || '';
      }
      // Stash full authConfig for constructor passthrough
      config.authConfig = authConfig;
    }

    return {
      name: dbProvider.name,
      type: providerType,
      enabled: dbProvider.enabled,
      priority: dbProvider.priority,
      config
    };
  }

  /**
   * Infer auth type from provider type and available fields when `type` is not explicitly set.
   * This handles the case where the UI saves auth config without a type discriminator.
   */
  private inferAuthType(providerType: string, authConfig: any): string {
    if (providerType === 'azure-openai') {
      if (authConfig.clientSecret || authConfig.clientId) return 'entra-id';
      return 'api-key';
    }
    if (providerType === 'vertex-ai') {
      if (authConfig.credentials || authConfig.serviceAccountCredentials) return 'service-account';
      return 'api-key';
    }
    if (providerType === 'aws-bedrock') {
      return 'iam-keys';
    }
    return 'api-key';
  }

  /**
   * Load provider configurations from environment variables only
   */
  private loadEnvironmentProviders(): ProviderConfig[] {
    const providers: ProviderConfig[] = [];

    // Azure OpenAI Provider
    const azureConfig = this.loadAzureOpenAIConfig();
    if (azureConfig) {
      providers.push(azureConfig);
    }

    // AWS Bedrock Provider
    const bedrockConfig = this.loadBedrockConfig();
    if (bedrockConfig) {
      providers.push(bedrockConfig);
    }

    // Google Vertex AI Provider
    const vertexConfig = this.loadVertexAIConfig();
    if (vertexConfig) {
      providers.push(vertexConfig);
    }

    // Ollama Provider
    const ollamaConfig = this.loadOllamaConfig();
    if (ollamaConfig) {
      providers.push(ollamaConfig);
    }

    // Azure AI Foundry Provider
    const aifConfig = this.loadAzureAIFoundryConfig();
    if (aifConfig) {
      providers.push(aifConfig);
    }

    return providers;
  }

  /**
   * Load Azure OpenAI provider configuration
   */
  private loadAzureOpenAIConfig(): ProviderConfig | null {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

    // Check if Azure OpenAI is configured
    if (!endpoint || !tenantId || !clientId || !clientSecret || !deployment) {
      this.logger.debug('Azure OpenAI provider not fully configured');
      return null;
    }

    // Require explicit enable - database providers should be primary
    const enabled = process.env.AZURE_OPENAI_ENABLED === 'true'; // Must explicitly enable

    return {
      name: 'azure-openai',
      type: 'azure-openai',
      enabled,
      priority: parseInt(process.env.AZURE_OPENAI_PRIORITY || '1'), // Highest priority by default
      config: {
        endpoint,
        tenantId,
        clientId,
        clientSecret,
        deployment,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
        maxTokens: parseInt(process.env.AZURE_OPENAI_MAX_TOKENS || '16000'),
        temperature: parseFloat(process.env.AZURE_OPENAI_TEMPERATURE || '1.0')
      }
    };
  }

  /**
   * Load AWS Bedrock provider configuration
   * Supports standardized model config: AWS_BEDROCK_CHAT_MODEL, AWS_BEDROCK_EMBEDDING_MODEL, etc.
   *
   * CRITICAL: Supports IRSA (IAM Roles for Service Accounts) in Kubernetes
   * When running in K8s with IRSA, explicit credentials (accessKeyId/secretAccessKey) are NOT needed.
   * The AWS SDK will automatically use the projected service account token for authentication.
   */
  private loadBedrockConfig(): ProviderConfig | null {
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const enabled = process.env.AWS_BEDROCK_ENABLED === 'true';

    // Region is always required
    if (!region) {
      this.logger.debug('AWS Bedrock provider not configured: AWS_REGION not set');
      return null;
    }

    // IRSA Support: If AWS_BEDROCK_ENABLED=true, allow initialization even without explicit credentials
    // The AWS SDK will use IRSA/instance profile/ECS task role for authentication
    const hasExplicitCredentials = !!(accessKeyId && secretAccessKey);

    if (!enabled && !hasExplicitCredentials) {
      this.logger.debug('AWS Bedrock provider not fully configured (no credentials and not explicitly enabled)');
      return null;
    }

    if (enabled && !hasExplicitCredentials) {
      this.logger.info('AWS Bedrock enabled without explicit credentials - using IRSA/IAM role authentication');
    }

    // Standardized model configuration
    const chatModel = process.env.AWS_BEDROCK_CHAT_MODEL || process.env.AWS_BEDROCK_MODEL_ID;
    const embeddingModel = process.env.AWS_BEDROCK_EMBEDDING_MODEL;
    const visionModel = process.env.AWS_BEDROCK_VISION_MODEL;
    const imageModel = process.env.AWS_BEDROCK_IMAGE_MODEL;
    const compactionModel = process.env.AWS_BEDROCK_COMPACTION_MODEL;

    // Custom endpoint (optional) - for VPC endpoints or proxies like CDC (bedrock-dev.cdc.gov)
    const endpoint = process.env.AWS_BEDROCK_ENDPOINT;

    this.logger.info({
      chatModel,
      embeddingModel,
      visionModel,
      imageModel,
      compactionModel,
      region,
      endpoint: endpoint || 'default',
      authType: hasExplicitCredentials ? 'explicit-credentials' : 'IRSA/IAM-role',
      enabled
    }, 'AWS Bedrock provider configuration loaded');

    return {
      name: 'aws-bedrock',
      type: 'aws-bedrock',
      enabled,
      priority: parseInt(process.env.AWS_BEDROCK_PRIORITY || '2'), // Second priority by default
      config: {
        region,
        // Only include credentials if explicitly provided (IRSA doesn't need them)
        ...(hasExplicitCredentials && { accessKeyId, secretAccessKey }),
        // Custom endpoint for VPC endpoints or proxies (e.g., https://bedrock-dev.cdc.gov)
        ...(endpoint && { endpoint }),
        // Standardized model config
        chatModel,
        embeddingModel,
        visionModel,
        imageModel,
        compactionModel,
        // Legacy compat
        modelId: chatModel,
        maxTokens: parseInt(process.env.AWS_BEDROCK_MAX_TOKENS || '16000'),
        temperature: parseFloat(process.env.AWS_BEDROCK_TEMPERATURE || '1.0')
      }
    };
  }

  /**
   * Load Google Vertex AI provider configuration
   * Supports standardized model config: VERTEX_AI_CHAT_MODEL, VERTEX_AI_EMBEDDING_MODEL, etc.
   */
  private loadVertexAIConfig(): ProviderConfig | null {
    const projectId = process.env.VERTEX_AI_PROJECT || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.VERTEX_AI_LOCATION || process.env.GCP_LOCATION || process.env.GOOGLE_CLOUD_LOCATION;
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GCP_SERVICE_ACCOUNT_JSON;

    // Check if Vertex AI is configured
    if (!projectId || !location) {
      this.logger.debug('Google Vertex AI provider not fully configured (missing projectId or location)');
      return null;
    }

    // Standardized model configuration
    const chatModel = process.env.VERTEX_AI_CHAT_MODEL || process.env.VERTEX_DEFAULT_MODEL || process.env.DEFAULT_MODEL;
    const embeddingModel = process.env.VERTEX_AI_EMBEDDING_MODEL;
    const visionModel = process.env.VERTEX_AI_VISION_MODEL;
    const imageModel = process.env.VERTEX_AI_IMAGE_MODEL;
    const compactionModel = process.env.VERTEX_AI_COMPACTION_MODEL;

    // Require explicit enable - database providers should be primary
    const enabled = process.env.VERTEX_AI_ENABLED === 'true'; // Must explicitly enable

    this.logger.info({
      chatModel,
      embeddingModel,
      visionModel,
      imageModel,
      compactionModel,
      projectId,
      location
    }, 'Google Vertex AI provider configuration loaded');

    return {
      name: 'vertex-ai',
      type: 'google-vertex',
      enabled,
      priority: parseInt(process.env.VERTEX_AI_PRIORITY || '3'), // Third priority by default
      config: {
        projectId,
        location,
        serviceAccountJson,
        // Standardized model config
        chatModel,
        embeddingModel,
        visionModel,
        imageModel,
        compactionModel,
        // Legacy compat
        modelId: chatModel,
        maxTokens: parseInt(process.env.VERTEX_AI_MAX_TOKENS || '8192'),
        temperature: parseFloat(process.env.VERTEX_AI_TEMPERATURE || '1.0')
      }
    };
  }

  /**
   * Validate provider configuration
   */
  validateConfig(config: ProviderManagerConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.providers.length === 0) {
      errors.push('No providers configured');
    }

    // Check if default provider exists
    if (config.defaultProvider) {
      const hasDefault = config.providers.some(p => p.name === config.defaultProvider);
      if (!hasDefault) {
        errors.push(`Default provider '${config.defaultProvider}' not found in configured providers`);
      }
    }

    // Check for duplicate provider names
    const names = config.providers.map(p => p.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate provider names: ${duplicates.join(', ')}`);
    }

    // Check for duplicate priorities
    const enabledProviders = config.providers.filter(p => p.enabled);
    const priorities = enabledProviders.map(p => p.priority);
    const duplicatePriorities = priorities.filter((pri, index) => priorities.indexOf(pri) !== index);
    if (duplicatePriorities.length > 0) {
      this.logger.warn({
        duplicatePriorities
      }, 'Multiple providers have the same priority - this may cause unpredictable routing behavior');
    }

    // Validate failover timeout
    if (config.failoverTimeout <= 0) {
      errors.push('Failover timeout must be greater than 0');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Load Ollama provider configuration
   * Supports standardized model config: OLLAMA_CHAT_MODEL, OLLAMA_EMBEDDING_MODEL, etc.
   */
  private loadOllamaConfig(): ProviderConfig | null {
    // Check if explicitly enabled first (OLLAMA_ENABLED must be 'true')
    if (process.env.OLLAMA_ENABLED !== 'true') {
      this.logger.debug('Ollama provider disabled (OLLAMA_ENABLED is not true)');
      return null;
    }

    const baseUrl = process.env.OLLAMA_BASE_URL;

    // Standardized model configuration
    const chatModel = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL;
    const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL;
    const visionModel = process.env.OLLAMA_VISION_MODEL;

    // Check if Ollama is configured
    if (!baseUrl || !chatModel) {
      this.logger.debug('Ollama provider not fully configured (missing baseUrl or chatModel)');
      return null;
    }

    const enabled = true; // Already checked above

    this.logger.info({
      chatModel,
      embeddingModel,
      visionModel,
      baseUrl
    }, 'Ollama provider configuration loaded');

    return {
      name: 'ollama',
      type: 'ollama',
      enabled,
      priority: parseInt(process.env.OLLAMA_PRIORITY || '10'), // Low priority by default (local fallback)
      config: {
        baseUrl,
        // Standardized model config
        chatModel,
        embeddingModel,
        visionModel,
        // Legacy compat
        healthCheckModel: chatModel
      }
    };
  }

  /**
   * Load Azure AI Foundry provider configuration
   * Supports standardized model config: AIF_CHAT_MODEL, AIF_EMBEDDING_MODEL, etc.
   */
  private loadAzureAIFoundryConfig(): ProviderConfig | null {
    const endpointUrl = process.env.AIF_ENDPOINT_URL;
    const apiKey = process.env.AIF_API_KEY;

    // Standardized model configuration (matching other providers)
    const chatModel = process.env.AIF_CHAT_MODEL || process.env.AIF_MODEL;
    const embeddingModel = process.env.AIF_EMBEDDING_MODEL;
    const visionModel = process.env.AIF_VISION_MODEL;
    const imageModel = process.env.AIF_IMAGE_MODEL;
    const compactionModel = process.env.AIF_COMPACTION_MODEL;

    // Smart model selection configuration
    const functionCallingModel = process.env.AIF_FUNCTION_CALLING_MODEL;
    const preferSpecificModel = process.env.AIF_PREFER_SPECIFIC_MODEL === 'true';

    // Check for Entra ID credentials (optional)
    const tenantId = process.env.AIF_TENANT_ID;
    const clientId = process.env.AIF_CLIENT_ID;
    const clientSecret = process.env.AIF_CLIENT_SECRET;

    // Check if AIF is configured (either with API key OR Entra ID)
    const hasAuth = apiKey || (tenantId && clientId && clientSecret);
    if (!endpointUrl || !hasAuth) {
      this.logger.debug('Azure AI Foundry provider not fully configured (missing endpoint or auth)');
      return null;
    }

    // Check if explicitly disabled
    const enabled = process.env.AIF_ENABLED !== 'false'; // Default enabled

    this.logger.info({
      chatModel,
      embeddingModel,
      visionModel,
      imageModel,
      compactionModel,
      functionCallingModel,
      preferSpecificModel,
      hasEntraAuth: !!(tenantId && clientId && clientSecret)
    }, 'Azure AI Foundry provider configuration loaded');

    return {
      name: 'azure-ai-foundry',
      type: 'azure-ai-foundry',
      enabled,
      priority: parseInt(process.env.AIF_PRIORITY || '5'), // Medium priority by default
      config: {
        endpointUrl,
        apiKey,
        // Standardized model config
        chatModel,
        embeddingModel,
        visionModel,
        imageModel,
        compactionModel,
        // Legacy compat
        model: chatModel,
        functionCallingModel,
        preferSpecificModel,
        tenantId,
        clientId,
        clientSecret
      }
    };
  }

  /**
   * Get human-readable configuration summary
   */
  getConfigSummary(config: ProviderManagerConfig): string {
    const lines: string[] = [];

    lines.push('LLM Provider Configuration:');
    lines.push(`  Providers: ${config.providers.length} total, ${config.providers.filter(p => p.enabled).length} enabled`);
    lines.push(`  Default: ${config.defaultProvider || 'none'}`);
    lines.push(`  Failover: ${config.enableFailover ? 'enabled' : 'disabled'} (timeout: ${config.failoverTimeout}ms)`);
    lines.push(`  Load Balancing: ${config.enableLoadBalancing ? 'enabled' : 'disabled'} (strategy: ${config.loadBalancingStrategy})`);
    lines.push('');

    for (const provider of config.providers) {
      const status = provider.enabled ? '✓' : '✗';
      lines.push(`  ${status} ${provider.name} (${provider.type}) - Priority: ${provider.priority}`);
    }

    return lines.join('\n');
  }
}
