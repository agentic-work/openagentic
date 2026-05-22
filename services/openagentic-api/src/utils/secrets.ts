/**
 * Secret Management Utilities
 * 
 * Provides a unified interface to get secrets from Vault or environment variables.
 * Falls back to environment variables if Vault is not available.
 */

import { VaultInitService, getVaultService } from '../services/VaultInitService.js';
import { loggers } from './logger.js';

const logger = loggers.utils;

/**
 * Get the Vault service instance
 */
function getVaultServiceInstance(): VaultInitService | null {
  const vault = getVaultServiceInstance();
  if (vault && vault.isInitialized()) {
    return vault;
  }
  return null;
}

/**
 * Get database connection string
 */
export async function getDatabaseUrl(): Promise<string> {
  const vault = getVaultServiceInstance();
  
  if (vault) {
    try {
      const creds = await vault.getDatabaseCredentials();
      return creds.url;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get database URL from Vault, using environment');
    }
  }
  
  return process.env.DATABASE_URL!;
}

/**
 * Get database credentials
 */
export async function getDatabaseCredentials(): Promise<{
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}> {
  const vault = getVaultServiceInstance();
  
  if (vault) {
    try {
      return await vault.getDatabaseCredentials();
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get database credentials from Vault, using environment');
    }
  }
  
  return {
    host: process.env.POSTGRES_HOST || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'openagentic',
    username: process.env.POSTGRES_USER || 'openagentic',
    password: process.env.POSTGRES_PASSWORD || ''
  };
}

/**
 * Get Azure credentials
 */
export async function getAzureCredentials(): Promise<{
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
}> {
  const vault = getVaultServiceInstance();
  
  if (vault) {
    try {
      return await vault.getAzureCredentials();
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get Azure credentials from Vault, using environment');
    }
  }
  
  return {
    tenantId: process.env.AZURE_TENANT_ID || '',
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || ''
  };
}

/**
 * Get API secret key
 */
export async function getAPISecretKey(): Promise<string> {
  const vault = getVaultServiceInstance();
  
  if (vault) {
    try {
      const secrets = await vault.getAPISecrets();
      return secrets.apiSecretKey;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get API secret from Vault, using environment');
    }
  }
  
  return process.env.API_SECRET_KEY || '';
}

/**
 * Get JWT secret
 * SECURITY: No hardcoded fallback. JWT_SECRET or SIGNING_SECRET must be configured.
 */
export async function getJWTSecret(): Promise<string> {
  const vault = getVaultServiceInstance();

  if (vault) {
    try {
      const secrets = await vault.getAPISecrets();
      return secrets.jwtSecret;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get JWT secret from Vault, using environment');
    }
  }

  const secret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
  if (!secret) {
    logger.error('CRITICAL: JWT_SECRET or SIGNING_SECRET not configured. Authentication will fail.');
    throw new Error('JWT_SECRET or SIGNING_SECRET must be set');
  }
  return secret;
}

/**
 * Get signing secret
 * SECURITY: No hardcoded fallback. SIGNING_SECRET or JWT_SECRET must be configured.
 */
export async function getSigningSecret(): Promise<string> {
  const vault = getVaultServiceInstance();

  if (vault) {
    try {
      const secrets = await vault.getAPISecrets();
      return secrets.signingSecret;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get signing secret from Vault, using environment');
    }
  }

  const secret = process.env.SIGNING_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    logger.error('CRITICAL: SIGNING_SECRET or JWT_SECRET not configured. Authentication will fail.');
    throw new Error('SIGNING_SECRET or JWT_SECRET must be set');
  }
  return secret;
}

/**
 * Get Redis connection details
 */
export async function getRedisConfig(): Promise<{
  host: string;
  port: number;
  password?: string;
  url: string;
}> {
  const vault = getVaultServiceInstance();
  
  if (vault) {
    try {
      const secrets = await vault.getSecret('openagentic/redis');
      return {
        host: secrets.host || 'redis',
        port: parseInt(secrets.port || '6379'),
        password: secrets.password,
        url: secrets.url || `redis://${secrets.host}:${secrets.port}`
      };
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get Redis config from Vault, using environment');
    }
  }
  
  return {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    url: process.env.REDIS_URL || 'redis://redis:6379'
  };
}

/**
 * Get Milvus connection details
 */
export async function getMilvusConfig(): Promise<{
  host: string;
  port: number;
  address: string;
  username?: string;
  password?: string;
}> {
  const vault = getVaultServiceInstance();
  
  if (vault) {
    try {
      const secrets = await vault.getSecret('openagentic/milvus');
      return {
        host: secrets.host || 'milvus-standalone',
        port: parseInt(secrets.port || '19530'),
        address: secrets.address || `${secrets.host}:${secrets.port}`,
        username: secrets.username,
        password: secrets.password
      };
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get Milvus config from Vault, using environment');
    }
  }
  
  return {
    host: process.env.MILVUS_HOST || 'milvus-standalone',
    port: parseInt(process.env.MILVUS_PORT || '19530'),
    address: process.env.MILVUS_ADDRESS || 'milvus-standalone:19530',
    username: process.env.MILVUS_USERNAME,
    password: process.env.MILVUS_PASSWORD
  };
}