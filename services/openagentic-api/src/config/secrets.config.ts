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
 * Validates that a required secret is present and strong.
 *
 * Posture (B2 / NIST IA-5, CM-6, SI-10):
 *  - NODE_ENV=production: FAIL CLOSED. A missing or weak/placeholder secret
 *    THROWS, aborting boot. A High system must never sign tokens with a
 *    world-readable default (the documented `docker compose up` shipped
 *    `openagentic-dev-jwt-secret-change-me`, which the old exact-only blocklist
 *    let through).
 *  - Any other env (development/test): for convenience, a missing/weak secret
 *    is replaced by an ephemeral generated value with a CRITICAL log — never in
 *    production.
 */
function validateSecret(name: string, value: string | undefined, allowEmpty = false): string {
  const isProduction = process.env.NODE_ENV === 'production';

  const failOrGenerate = (reason: string): string => {
    if (isProduction) {
      // Fail closed — do not boot with a missing/weak secret in production.
      throw new Error(
        `[FATAL] Secret ${name} ${reason}. Refusing to start in production. ` +
        `Set a strong value via .env / Helm values / Vault ESO.`,
      );
    }
    const generated = generateSecureSecret();
    runtimeGeneratedSecrets.push(name);
    console.error(`[CRITICAL] Secret ${name} ${reason} — generated ephemeral runtime value (non-production). Configure it properly via Helm values or Vault ESO.`);
    return generated;
  };

  if (!value || value.trim() === '') {
    if (allowEmpty) {
      return '';
    }
    return failOrGenerate('is missing');
  }

  // Exact-match placeholder values that should never be a real secret.
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

  // Substring placeholders that should never appear ANYWHERE in a secret.
  // Includes the literal suffixes shipped in docker-compose.yml defaults
  // (`...-change-me`) and the `dev-`/`dev_` weak-secret convention.
  const substringPlaceholders = [
    'your_secret_here',
    'replace_me',
    'placeholder',
    'change-me',
    'change_me',
    'changeme',
    'change-in-prod',
    'dev-',
    'dev_',
  ];

  const lowerValue = value.toLowerCase();
  const isExactPlaceholder = exactPlaceholders.includes(lowerValue);
  const isSubstringPlaceholder = substringPlaceholders.some(p => lowerValue.includes(p));

  if (isExactPlaceholder || isSubstringPlaceholder) {
    return failOrGenerate('contains a weak/placeholder value');
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
    
    // OSS local-auth-only REQUIRED set (must be present + strong in production):
    //   DATABASE_URL — the app cannot run without its database.
    //   JWT_SECRET   — the trust root for local + inter-service auth.
    // EVERYTHING ELSE is allowEmpty (optional): absent ⇒ that feature is
    // disabled or uses the service's own default. This matches what the OSS
    // docker-compose actually provides (DATABASE_URL, REDIS_URL, JWT_SECRET) so
    // a default `docker compose up` boots. The AZURE_* vars are ONLY for the
    // optional Azure-OpenAI LLM provider (AAD identity was excised) — never
    // required for a local-auth install.
    const secrets: SecretsConfig = {
      database: {
        url: validateSecret('DATABASE_URL', process.env.DATABASE_URL),
        password: validateSecret('DB_PASSWORD', process.env.DB_PASSWORD ||
          (isDevelopment ? 'dev_password_only' : undefined), true),
        poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10)
      },

      redis: {
        url: validateSecret('REDIS_URL', process.env.REDIS_URL ||
          (isDevelopment ? 'redis://localhost:6379' : undefined), true),
        password: validateSecret('REDIS_PASSWORD', process.env.REDIS_PASSWORD, true)
      },

      auth: {
        jwtSecret: validateSecret('JWT_SECRET', process.env.JWT_SECRET ||
          (isDevelopment ? generateDevSecret('jwt') : undefined)),
        // Optional — only the Azure-OpenAI LLM provider uses these.
        azureClientId: validateSecret('AZURE_CLIENT_ID', process.env.AZURE_CLIENT_ID, true),
        azureClientSecret: validateSecret('AZURE_CLIENT_SECRET', process.env.AZURE_CLIENT_SECRET, true),
        azureTenantId: validateSecret('AZURE_TENANT_ID', process.env.AZURE_TENANT_ID, true),
        apiKey: validateSecret('API_KEY', process.env.API_KEY ||
          (isDevelopment ? generateDevSecret('api') : undefined), true)
      },
      
      services: {
        // MCP Proxy configuration
        mcpProxyUrl: process.env.MCP_PROXY_URL || 'http://mcp-proxy:3100',

        vaultToken: validateSecret('VAULT_TOKEN', process.env.VAULT_TOKEN ||
          (isDevelopment ? 'dev-vault-token' : undefined), true),  // Optional: Vault may be disabled
        vaultAddress: process.env.VAULT_ADDRESS || 'http://vault:8200',
        // Optional — Milvus/Minio use their own service-level credentials in
        // the compose/helm stack; absent here ⇒ the service default is used.
        milvusPassword: validateSecret('MILVUS_PASSWORD', process.env.MILVUS_PASSWORD ||
          (isDevelopment ? 'milvus_dev_password' : undefined), true),
        minioAccessKey: validateSecret('MINIO_ACCESS_KEY', process.env.MINIO_ACCESS_KEY ||
          (isDevelopment ? 'minioadmin' : undefined), true),
        minioSecretKey: validateSecret('MINIO_SECRET_KEY', process.env.MINIO_SECRET_KEY ||
          (isDevelopment ? 'minioadmin' : undefined), true)
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

// ---------------------------------------------------------------------------
// Singleton accessor (Phase 4 — replaces (global as any).appSecrets)
// ---------------------------------------------------------------------------

let _appSecrets: SecretsConfig | null = null;

export function setAppSecrets(secrets: SecretsConfig): void {
  _appSecrets = secrets;
}

export function getAppSecrets(): SecretsConfig | null {
  return _appSecrets;
}