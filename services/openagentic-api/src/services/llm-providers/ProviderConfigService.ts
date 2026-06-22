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

    // Load global settings.
    //
    // defaultProvider reads ONLY from DB priority ordering — env vars must
    // not override admin-configured state. Global failover/load-balancing
    // flags are still env-tunable because they are deploy-level knobs, not
    // registry state (see CLAUDE.md "database is SoT" rule).
    const imageGenTimeout = Number.parseInt(process.env.LLM_IMAGE_GEN_TIMEOUT || '180000'); // 3 min default
    if (!Number.isFinite(imageGenTimeout) || imageGenTimeout <= 0) {
      throw new Error(
        `LLM_IMAGE_GEN_TIMEOUT must be a positive integer (ms); got "${process.env.LLM_IMAGE_GEN_TIMEOUT}". ` +
        `Image generation needs its own budget — DALL-E / Imagen inference reliably exceeds the 30s chat timeout.`
      );
    }

    const config: ProviderManagerConfig = {
      providers,
      defaultProvider: providers[0]?.name,
      enableFailover: process.env.LLM_ENABLE_FAILOVER !== 'false', // Default true
      failoverTimeout: Number.parseInt(process.env.LLM_FAILOVER_TIMEOUT || '30000'), // 30s default (stream TTFB)
      nonStreamFailoverTimeout: Number.parseInt(process.env.LLM_NONSTREAM_TIMEOUT_MS || '0') || undefined, // env override; ProviderManager defaults to 10x failoverTimeout
      imageGenTimeout, // 180s default (image gen — separate budget)
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
   * Convert database LLMProvider to ProviderConfig.
   *
   * Public so callers that want to validate inline form-data (without
   * persisting) can build a synthetic dbProvider-shaped object and run
   * it through the same auth-config decryption + auth-type inference +
   * UI-name → canonical-name remap pipeline as a saved row. The "Test
   * Connection" endpoint for unsaved providers (#287) is the use case.
   */
  convertDatabaseProvider(dbProvider: any): ProviderConfig {
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

    if (!Number.isFinite(config.imageGenTimeout) || config.imageGenTimeout <= 0) {
      errors.push('Image gen timeout must be a positive integer (ms)');
    }

    return {
      valid: errors.length === 0,
      errors
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
    lines.push(`  Image gen timeout: ${config.imageGenTimeout}ms`);
    lines.push(`  Load Balancing: ${config.enableLoadBalancing ? 'enabled' : 'disabled'} (strategy: ${config.loadBalancingStrategy})`);
    lines.push('');

    for (const provider of config.providers) {
      const status = provider.enabled ? '✓' : '✗';
      lines.push(`  ${status} ${provider.name} (${provider.type}) - Priority: ${provider.priority}`);
    }

    return lines.join('\n');
  }
}
