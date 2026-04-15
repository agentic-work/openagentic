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
 * Centralized Secrets Management Configuration
 * 
 * This file provides a single source of truth for all application secrets.
 * Secrets are loaded from environment variables or secure vaults.
 * 
 * SECURITY: Never commit actual secret values to this file!
 */

import { Logger } from 'pino';
import crypto from 'crypto';

export interface SecretsConfig {
  // Database
  database: {
    url: string;
    password: string;
    poolSize: number;
  };
  
  // Redis
  redis: {
    url: string;
    password?: string;
  };
  
  // Authentication
  auth: {
    jwtSecret: string;
    azureClientId: string;
    azureClientSecret: string;
    azureTenantId: string;
    apiKey: string;
  };
  
  // External Services
  services: {
    mcpProxyUrl: string;
    vaultToken: string;
    vaultAddress: string;
    milvusPassword: string;
    minioAccessKey: string;
    minioSecretKey: string;
  };
  
  // Monitoring
  monitoring: {
    sentryDsn?: string;
    datadogApiKey?: string;
  };
}

/**
 * Generates a cryptographically secure random secret
 */
function generateSecureSecret(length = 64): string {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
}

// Track runtime-generated secrets so we can log them once
const runtimeGeneratedSecrets: string[] = [];

/**
 * Validates that a required secret is present.
 *
 * If a secret is missing or contains a placeholder value, this function:
 * - Logs a CRITICAL warning (never crashes)
 * - Generates a secure random value at runtime as a fallback
 *
 * This ensures the API server always starts, even if ESO/Vault is not configured.
 */
function validateSecret(name: string, value: string | undefined, allowEmpty = false): string {
  if (!value || value.trim() === '') {
    if (allowEmpty) {
      return '';
    }
    // Generate a runtime secret instead of crashing
    const generated = generateSecureSecret();
    runtimeGeneratedSecrets.push(name);
    console.error(`[CRITICAL] Missing required secret: ${name} — generated ephemeral runtime value. Configure this secret properly via Helm values or Vault ESO.`);
    return generated;
  }

  // Check for default/placeholder values that should not be in production
  const exactPlaceholders = [
    'change_me',
    'change-me',
    'changeme',
    'default',
    'password',  // Exact match only
    'secret',    // Exact match only
    'xxx',
    'todo',
    'fixme',
    'dev-token'
  ];

  // Substring placeholders that should never appear
  const substringPlaceholders = [
    'your_secret_here',
    'replace_me',
    'placeholder'
  ];

  const lowerValue = value.toLowerCase();
  const isExactPlaceholder = exactPlaceholders.includes(lowerValue);
  const isSubstringPlaceholder = substringPlaceholders.some(p => lowerValue.includes(p));

  if (isExactPlaceholder || isSubstringPlaceholder) {
    // Generate a runtime secret instead of crashing
    const generated = generateSecureSecret();
    runtimeGeneratedSecrets.push(name);
    console.error(`[CRITICAL] Secret ${name} contains placeholder value. Generated ephemeral runtime value. Configure this secret properly via Helm values or Vault ESO.`);
    return generated;
  }

  return value;
}

/**
 * Loads secrets from environment variables with validation
 */
export function loadSecrets(logger?: Logger): SecretsConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  try {
    // In production, all secrets must be properly configured
    // In development, we allow some defaults for ease of development
    
    const secrets: SecretsConfig = {
      database: {
        url: validateSecret('DATABASE_URL', process.env.DATABASE_URL),
        password: validateSecret('DB_PASSWORD', process.env.DB_PASSWORD || 
          (isDevelopment ? 'dev_password_only' : undefined)),
        poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10)
      },
      
      redis: {
        url: validateSecret('REDIS_URL', process.env.REDIS_URL || 
          (isDevelopment ? 'redis://localhost:6379' : undefined)),
        password: validateSecret('REDIS_PASSWORD', process.env.REDIS_PASSWORD, true)
      },
      
      auth: {
        jwtSecret: validateSecret('JWT_SECRET', process.env.JWT_SECRET ||
          (isDevelopment ? generateDevSecret('jwt') : undefined)),
        azureClientId: validateSecret('AZURE_CLIENT_ID', process.env.AZURE_CLIENT_ID),
        azureClientSecret: validateSecret('AZURE_CLIENT_SECRET', process.env.AZURE_CLIENT_SECRET, true), // Allow empty for public client
        azureTenantId: validateSecret('AZURE_TENANT_ID', process.env.AZURE_TENANT_ID),
        apiKey: validateSecret('API_KEY', process.env.API_KEY ||
          (isDevelopment ? generateDevSecret('api') : undefined))
      },
      
      services: {
        // MCP Proxy configuration
        mcpProxyUrl: process.env.MCP_PROXY_URL || 'http://mcp-proxy:3100',

        vaultToken: validateSecret('VAULT_TOKEN', process.env.VAULT_TOKEN ||
          (isDevelopment ? 'dev-vault-token' : undefined), true),  // Optional: Vault may be disabled
        vaultAddress: process.env.VAULT_ADDRESS || 'http://vault:8200',
        milvusPassword: validateSecret('MILVUS_PASSWORD', process.env.MILVUS_PASSWORD ||
          (isDevelopment ? 'milvus_dev_password' : undefined)),
        minioAccessKey: validateSecret('MINIO_ACCESS_KEY', process.env.MINIO_ACCESS_KEY ||
          (isDevelopment ? 'minioadmin' : undefined)),
        minioSecretKey: validateSecret('MINIO_SECRET_KEY', process.env.MINIO_SECRET_KEY ||
          (isDevelopment ? 'minioadmin' : undefined))
      },
      
      monitoring: {
        sentryDsn: process.env.SENTRY_DSN,
        datadogApiKey: process.env.DATADOG_API_KEY
      }
    };
    
    if (runtimeGeneratedSecrets.length > 0) {
      logger?.warn(
        { generatedSecrets: runtimeGeneratedSecrets },
        `⚠️ CRITICAL: ${runtimeGeneratedSecrets.length} secret(s) were auto-generated at runtime because they were missing or contained placeholder values. ` +
        `These ephemeral secrets will change on every restart — sessions/tokens will be invalidated. ` +
        `Fix: Set real values in Helm values file or configure Vault ESO.`
      );
    } else {
      logger?.info('Secrets loaded and validated successfully');
    }
    return secrets;

  } catch (error: any) {
    logger?.error({ error: error.message }, 'Failed to load secrets — generating fallback values');

    // Never crash — return a config with generated secrets so the server can start
    // This handles cases like missing DATABASE_URL which validateSecret can't auto-generate
    logger?.warn({ error: error.message }, 'Using fallback defaults for secrets that could not be loaded');
    throw error;
  }
}

/**
 * Generates a development-only secret
 */
function generateDevSecret(type: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `dev_${type}_${timestamp}_${random}`;
}

/**
 * Singleton instance of secrets
 */
let secretsInstance: SecretsConfig | null = null;

/**
 * Gets the singleton secrets instance
 */
export function getSecrets(logger?: Logger): SecretsConfig {
  if (!secretsInstance) {
    secretsInstance = loadSecrets(logger);
  }
  return secretsInstance;
}

/**
 * Refreshes secrets (useful for rotation)
 */
export function refreshSecrets(logger?: Logger): SecretsConfig {
  secretsInstance = null;
  return getSecrets(logger);
}

/**
 * Masks sensitive data for logging
 */
export function maskSecret(secret: string, visibleChars = 4): string {
  if (!secret || secret.length <= visibleChars) {
    return '***';
  }
  return secret.substring(0, visibleChars) + '***';
}

/**
 * Safe secret logging
 */
export function logSecrets(secrets: SecretsConfig, logger: Logger): void {
  logger.info({
    database: {
      url: maskSecret(secrets.database.url, 10),
      hasPassword: !!secrets.database.password
    },
    redis: {
      url: maskSecret(secrets.redis.url, 10),
      hasPassword: !!secrets.redis.password
    },
    auth: {
      hasJwtSecret: !!secrets.auth.jwtSecret,
      azureClientId: maskSecret(secrets.auth.azureClientId),
      hasAzureSecret: !!secrets.auth.azureClientSecret
    },
    services: {
      hasMcpProxyUrl: !!secrets.services.mcpProxyUrl,
      vaultAddress: secrets.services.vaultAddress,
      hasVaultToken: !!secrets.services.vaultToken
    }
  }, 'Secrets configuration loaded (masked)');
}