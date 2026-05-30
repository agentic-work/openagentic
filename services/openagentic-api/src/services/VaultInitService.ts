/**
 * Vault Initialization Service
 * 
 * Populates HashiCorp Vault with secrets from environment variables on first startup.
 * Provides centralized secret management for all services.
 */

import { Logger } from 'pino';

interface VaultSecret {
  path: string;
  data: Record<string, any>;
}

export class VaultInitService {
  private vaultAddr: string;
  private vaultToken: string;
  private logger: Logger;
  private initialized = false;
  private vaultEnabled: boolean;

  constructor(logger: Logger) {
    this.logger = logger;
    this.vaultAddr = process.env.VAULT_ADDR || 'http://vault:8200';
    this.vaultToken = process.env.VAULT_TOKEN || 'vault-dev-token-change-me';
    this.vaultEnabled = process.env.VAULT_ENABLED === 'true';
  }

  /**
   * Initialize Vault with secrets from environment variables
   */
  async initialize(): Promise<void> {
    try {
      if (!this.vaultEnabled) {
        this.logger.info('🔐 Vault is disabled (VAULT_ENABLED=false), skipping Vault initialization');
        return;
      }

      this.logger.info('🔐 Initializing Vault connection...');

      // Check Vault health
      const healthCheck = await this.checkVaultHealth();
      if (!healthCheck) {
        this.logger.warn('⚠️ Vault is not healthy, skipping secret initialization');
        return;
      }

      // Check if secrets already exist
      const secretsExist = await this.checkSecretsExist();
      if (!secretsExist) {
        this.logger.info('📝 Populating initial secrets to Vault from environment...');
        // First-time setup: populate secrets from environment
        await this.populateSecrets();
      }
      
      // ALWAYS load secrets from Vault (single source of truth)
      this.logger.info('🔑 Loading secrets from Vault...');
      await this.loadSecretsFromVault();
      
      this.initialized = true;
      this.logger.info('✅ Vault initialization complete - secrets loaded');
    } catch (error) {
      this.logger.error({ err: error }, '❌ Failed to initialize Vault');
      throw error;
    }
  }

  /**
   * Check if Vault is healthy and accessible
   */
  private async checkVaultHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.vaultAddr}/v1/sys/health`, {
        method: 'GET',
        headers: {
          'X-Vault-Token': this.vaultToken
        }
      });

      if (response.ok) {
        const health = await response.json() as any;
        this.logger.info({ 
          initialized: health.initialized,
          sealed: health.sealed,
          version: health.version 
        }, 'Vault health check passed');
        return health.initialized && !health.sealed;
      }

      return false;
    } catch (error) {
      this.logger.error({ err: error }, 'Vault health check failed');
      return false;
    }
  }

  /**
   * Check if secrets already exist in Vault
   */
  private async checkSecretsExist(): Promise<boolean> {
    try {
      const response = await fetch(`${this.vaultAddr}/v1/secret/data/openagentic/api`, {
        method: 'GET',
        headers: {
          'X-Vault-Token': this.vaultToken
        }
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Populate Vault with secrets from environment variables
   */
  private async populateSecrets(): Promise<void> {
    const secrets: VaultSecret[] = [
      {
        path: 'secret/data/openagentic/database',
        data: {
          data: {
            host: process.env.POSTGRES_HOST,
            port: process.env.POSTGRES_PORT,
            database: process.env.POSTGRES_DB,
            username: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            url: process.env.DATABASE_URL,
            encryption_key: process.env.DATABASE_ENCRYPTION_KEY
          }
        }
      },
      {
        path: 'secret/data/openagentic/azure',
        data: {
          data: {
            tenant_id: process.env.AZURE_TENANT_ID,
            client_id: process.env.AZURE_CLIENT_ID,
            client_secret: process.env.AZURE_CLIENT_SECRET,
            subscription_id: process.env.AZURE_SUBSCRIPTION_ID,
            resource_group: process.env.AZURE_RESOURCE_GROUP,
            openai_endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            openai_deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
            openai_api_version: process.env.AZURE_OPENAI_API_VERSION,
            ad_admin_group: process.env.AZURE_AD_ADMIN_GROUP
          }
        }
      },
      {
        path: 'secret/data/openagentic/api',
        data: {
          data: {
            api_secret_key: process.env.API_SECRET_KEY,
            frontend_secret: process.env.FRONTEND_SECRET,
            signing_secret: process.env.SIGNING_SECRET,
            jwt_secret: process.env.JWT_SECRET,
            session_secret: process.env.SESSION_SECRET,
            internal_mcp_api_key: process.env.INTERNAL_MCP_API_KEY
          }
        }
      },
      {
        path: 'secret/data/openagentic/redis',
        data: {
          data: {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
            password: process.env.REDIS_PASSWORD,
            url: process.env.REDIS_URL
          }
        }
      },
      {
        path: 'secret/data/openagentic/milvus',
        data: {
          data: {
            host: process.env.MILVUS_HOST,
            port: process.env.MILVUS_PORT,
            address: process.env.MILVUS_ADDRESS,
            username: process.env.MILVUS_USERNAME,
            password: process.env.MILVUS_PASSWORD
          }
        }
      },
      {
        path: 'secret/data/openagentic/admin',
        data: {
          data: {
            email: process.env.ADMIN_USER_EMAIL,
            password: process.env.ADMIN_USER_PASSWORD
          }
        }
      }
    ];

    for (const secret of secrets) {
      await this.writeSecret(secret);
    }
  }

  /**
   * Write a secret to Vault
   */
  private async writeSecret(secret: VaultSecret): Promise<void> {
    try {
      const response = await fetch(`${this.vaultAddr}/v1/${secret.path}`, {
        method: 'POST',
        headers: {
          'X-Vault-Token': this.vaultToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(secret.data)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to write secret to ${secret.path}: ${error}`);
      }

      this.logger.info(`✅ Secret written to ${secret.path}`);
    } catch (error) {
      this.logger.error({ err: error, path: secret.path }, 'Failed to write secret');
      throw error;
    }
  }

  /**
   * Get a secret from Vault (returns null if not found)
   */
  async getSecret(path: string): Promise<any> {
    try {
      const response = await fetch(`${this.vaultAddr}/v1/secret/data/${path}`, {
        method: 'GET',
        headers: {
          'X-Vault-Token': this.vaultToken
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.debug(`Secret ${path} not found in Vault, using environment variables`);
          return null;
        }
        throw new Error(`Failed to get secret from ${path}`);
      }

      const result = await response.json() as any;
      return result.data?.data || {};
    } catch (error) {
      this.logger.error({ err: error, path }, 'Failed to get secret');
      throw error;
    }
  }

  /**
   * Load all secrets from Vault and set them as environment variables
   */
  async loadSecretsFromVault(): Promise<void> {
    try {
      // Load database secrets
      const dbSecrets = await this.getSecret('openagentic/database');
      if (dbSecrets) {
        process.env.POSTGRES_HOST = dbSecrets.host || process.env.POSTGRES_HOST;
        process.env.POSTGRES_PORT = dbSecrets.port || process.env.POSTGRES_PORT;
        process.env.POSTGRES_DB = dbSecrets.database || process.env.POSTGRES_DB;
        process.env.POSTGRES_USER = dbSecrets.username || process.env.POSTGRES_USER;
        process.env.POSTGRES_PASSWORD = dbSecrets.password || process.env.POSTGRES_PASSWORD;
        process.env.DATABASE_URL = dbSecrets.url || process.env.DATABASE_URL;
        process.env.DATABASE_ENCRYPTION_KEY = dbSecrets.encryption_key || process.env.DATABASE_ENCRYPTION_KEY;
        this.logger.info('✅ Database secrets loaded from Vault');
      }

      // Load Azure secrets
      const azureSecrets = await this.getSecret('openagentic/azure');
      if (azureSecrets) {
        process.env.AZURE_TENANT_ID = azureSecrets.tenant_id || process.env.AZURE_TENANT_ID;
        process.env.AZURE_CLIENT_ID = azureSecrets.client_id || process.env.AZURE_CLIENT_ID;
        process.env.AZURE_CLIENT_SECRET = azureSecrets.client_secret || process.env.AZURE_CLIENT_SECRET;
        process.env.AZURE_SUBSCRIPTION_ID = azureSecrets.subscription_id || process.env.AZURE_SUBSCRIPTION_ID;
        process.env.AZURE_RESOURCE_GROUP = azureSecrets.resource_group || process.env.AZURE_RESOURCE_GROUP;
        process.env.AZURE_OPENAI_ENDPOINT = azureSecrets.openai_endpoint || process.env.AZURE_OPENAI_ENDPOINT;
        process.env.AZURE_OPENAI_DEPLOYMENT = azureSecrets.openai_deployment || process.env.AZURE_OPENAI_DEPLOYMENT;
        process.env.AZURE_OPENAI_API_VERSION = azureSecrets.openai_api_version || process.env.AZURE_OPENAI_API_VERSION;
        process.env.AZURE_AD_ADMIN_GROUP = azureSecrets.ad_admin_group || process.env.AZURE_AD_ADMIN_GROUP;
        this.logger.info('✅ Azure secrets loaded from Vault');
      }

      // Load API secrets
      const apiSecrets = await this.getSecret('openagentic/api');
      if (apiSecrets) {
        process.env.API_SECRET_KEY = apiSecrets.api_secret_key || process.env.API_SECRET_KEY;
        process.env.FRONTEND_SECRET = apiSecrets.frontend_secret || process.env.FRONTEND_SECRET;
        process.env.SIGNING_SECRET = apiSecrets.signing_secret || process.env.SIGNING_SECRET;
        process.env.JWT_SECRET = apiSecrets.jwt_secret || process.env.JWT_SECRET;
        process.env.SESSION_SECRET = apiSecrets.session_secret || process.env.SESSION_SECRET;
        process.env.INTERNAL_MCP_API_KEY = apiSecrets.internal_mcp_api_key || process.env.INTERNAL_MCP_API_KEY;
        this.logger.info('✅ API secrets loaded from Vault');
      }

      // Load admin credentials
      const adminSecrets = await this.getSecret('openagentic/admin');
      if (adminSecrets) {
        process.env.ADMIN_USER_EMAIL = adminSecrets.email || process.env.ADMIN_USER_EMAIL;
        process.env.ADMIN_USER_PASSWORD = adminSecrets.password || process.env.ADMIN_USER_PASSWORD;
        this.logger.info('✅ Admin credentials loaded from Vault');
      }

      // Load Redis secrets
      const redisSecrets = await this.getSecret('openagentic/redis');
      if (redisSecrets) {
        process.env.REDIS_HOST = redisSecrets.host || process.env.REDIS_HOST;
        process.env.REDIS_PORT = redisSecrets.port || process.env.REDIS_PORT;
        process.env.REDIS_PASSWORD = redisSecrets.password || process.env.REDIS_PASSWORD;
        process.env.REDIS_URL = redisSecrets.url || process.env.REDIS_URL;
        this.logger.info('✅ Redis secrets loaded from Vault');
      }

      this.logger.info('🔐 All secrets loaded from Vault successfully');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to load secrets from Vault');
      throw error;
    }
  }

  /**
   * Get database credentials from Vault
   */
  async getDatabaseCredentials(): Promise<{
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    url: string;
  }> {
    const secrets = await this.getSecret('openagentic/database');
    return {
      host: secrets.host || process.env.POSTGRES_HOST!,
      port: parseInt(secrets.port || process.env.POSTGRES_PORT || '5432'),
      database: secrets.database || process.env.POSTGRES_DB!,
      username: secrets.username || process.env.POSTGRES_USER!,
      password: secrets.password || process.env.POSTGRES_PASSWORD!,
      url: secrets.url || process.env.DATABASE_URL!
    };
  }

  /**
   * Get Azure credentials from Vault
   */
  async getAzureCredentials(): Promise<{
    tenantId: string;
    clientId: string;
    clientSecret: string;
    subscriptionId: string;
  }> {
    const secrets = await this.getSecret('openagentic/azure');
    return {
      tenantId: secrets.tenant_id || process.env.AZURE_TENANT_ID!,
      clientId: secrets.client_id || process.env.AZURE_CLIENT_ID!,
      clientSecret: secrets.client_secret || process.env.AZURE_CLIENT_SECRET!,
      subscriptionId: secrets.subscription_id || process.env.AZURE_SUBSCRIPTION_ID!
    };
  }

  /**
   * Get API secrets from Vault
   */
  async getAPISecrets(): Promise<{
    apiSecretKey: string;
    frontendSecret: string;
    signingSecret: string;
    jwtSecret: string;
    sessionSecret: string;
  }> {
    const secrets = await this.getSecret('openagentic/api');
    return {
      apiSecretKey: secrets.api_secret_key || process.env.API_SECRET_KEY!,
      frontendSecret: secrets.frontend_secret || process.env.FRONTEND_SECRET!,
      signingSecret: secrets.signing_secret || process.env.SIGNING_SECRET!,
      jwtSecret: secrets.jwt_secret || process.env.JWT_SECRET!,
      sessionSecret: secrets.session_secret || process.env.SESSION_SECRET!
    };
  }

  /**
   * Check if Vault is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _vaultInstance: VaultInitService | null = null;

export function setVaultService(svc: VaultInitService): void {
  _vaultInstance = svc;
}

export function getVaultService(): VaultInitService | null {
  return _vaultInstance;
}