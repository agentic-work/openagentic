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
 * Vault Service for secure secrets management
 * Integrates with HashiCorp Vault and cloud provider secret stores
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

interface VaultConfig {
  address: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  namespace?: string;
  tlsConfig?: {
    ca?: string;
    cert?: string;
    key?: string;
  };
}

interface SecretData {
  [key: string]: any;
}

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
  scope?: string;
}

export class VaultService {
  private client: AxiosInstance;
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private config: VaultConfig;
  private encryptionKey: Buffer;

  constructor(config?: VaultConfig) {
    this.config = config || {
      address: process.env.VAULT_ADDR || 'http://vault:8200',
      token: process.env.VAULT_TOKEN,
      roleId: process.env.VAULT_ROLE_ID,
      secretId: process.env.VAULT_SECRET_ID,
      namespace: process.env.VAULT_NAMESPACE
    };

    this.client = axios.create({
      baseURL: this.config.address,
      timeout: 10000,
      headers: {
        'X-Vault-Namespace': this.config.namespace || ''
      }
    });

    // Initialize local encryption key for additional security layer
    const key = process.env.LOCAL_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    this.encryptionKey = Buffer.from(key, 'hex');

    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Try token auth first
      if (this.config.token) {
        this.token = this.config.token;
        this.client.defaults.headers['X-Vault-Token'] = this.token;
        logger.info('Vault initialized with token auth');
        return;
      }

      // Try AppRole auth
      if (this.config.roleId && this.config.secretId) {
        await this.authenticateWithAppRole();
        return;
      }

      logger.warn('Vault service initialized without authentication - using fallback encryption only');
    } catch (error) {
      logger.error('Failed to initialize Vault service:', error);
      // Continue with local encryption only
    }
  }

  private async authenticateWithAppRole(): Promise<void> {
    try {
      const response = await this.client.post('/v1/auth/approle/login', {
        role_id: this.config.roleId,
        secret_id: this.config.secretId
      });

      this.token = response.data.auth.client_token;
      this.tokenExpiry = new Date(Date.now() + response.data.auth.lease_duration * 1000);
      this.client.defaults.headers['X-Vault-Token'] = this.token;

      // Set up token renewal
      this.scheduleTokenRenewal(response.data.auth.lease_duration);

      logger.info('Successfully authenticated with Vault using AppRole');
    } catch (error) {
      logger.error('Failed to authenticate with Vault:', error);
      throw error;
    }
  }

  private scheduleTokenRenewal(leaseDuration: number): void {
    // Renew token at 75% of lease duration
    const renewalTime = leaseDuration * 0.75 * 1000;
    
    setTimeout(async () => {
      try {
        await this.renewToken();
      } catch (error) {
        logger.error('Failed to renew Vault token:', error);
        // Re-authenticate
        await this.authenticateWithAppRole();
      }
    }, renewalTime);
  }

  private async renewToken(): Promise<void> {
    const response = await this.client.post('/v1/auth/token/renew-self');
    this.tokenExpiry = new Date(Date.now() + response.data.auth.lease_duration * 1000);
    this.scheduleTokenRenewal(response.data.auth.lease_duration);
    logger.debug('Vault token renewed successfully');
  }

  /**
   * Store user authentication tokens securely
   */
  async storeUserToken(userId: string, tokenData: TokenData): Promise<void> {
    try {
      // Encrypt sensitive data locally first
      const encryptedToken = this.encryptLocal(tokenData.access_token);
      const encryptedRefresh = tokenData.refresh_token ? 
        this.encryptLocal(tokenData.refresh_token) : null;

      // Store in Vault
      if (this.token) {
        await this.client.post(`/v1/secret/data/tokens/users/${userId}`, {
          data: {
            access_token: encryptedToken,
            refresh_token: encryptedRefresh,
            expires_at: tokenData.expires_at,
            token_type: tokenData.token_type,
            scope: tokenData.scope,
            encrypted: true,
            updated_at: new Date().toISOString()
          }
        });
      } else {
        // Fallback to database with encryption
        await this.storeInDatabase(userId, {
          access_token: encryptedToken,
          refresh_token: encryptedRefresh,
          expires_at: tokenData.expires_at,
          token_type: tokenData.token_type,
          scope: tokenData.scope
        });
      }
    } catch (error) {
      logger.error(`Failed to store token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve user authentication tokens
   */
  async getUserToken(userId: string): Promise<TokenData | null> {
    try {
      let data: any;

      if (this.token) {
        const response = await this.client.get(`/v1/secret/data/tokens/users/${userId}`);
        data = response.data.data.data;
      } else {
        // Fallback to database
        data = await this.getFromDatabase(userId);
      }

      if (!data) return null;

      // Check token expiry
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        await this.deleteUserToken(userId);
        return null;
      }

      // Decrypt tokens
      return {
        access_token: data.encrypted ? 
          this.decryptLocal(data.access_token) : data.access_token,
        refresh_token: data.refresh_token && data.encrypted ? 
          this.decryptLocal(data.refresh_token) : data.refresh_token,
        expires_at: data.expires_at,
        token_type: data.token_type,
        scope: data.scope
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      logger.error(`Failed to retrieve token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Delete user tokens
   */
  async deleteUserToken(userId: string): Promise<void> {
    try {
      if (this.token) {
        await this.client.delete(`/v1/secret/metadata/tokens/users/${userId}`);
      } else {
        await this.deleteFromDatabase(userId);
      }
    } catch (error) {
      logger.error(`Failed to delete token for user ${userId}:`, error);
      // Don't throw - token deletion failures shouldn't break logout
    }
  }

  /**
   * Store API keys and secrets
   */
  async storeSecret(path: string, data: SecretData): Promise<void> {
    try {
      // Encrypt sensitive fields
      const encryptedData: SecretData = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && this.isSensitiveField(key)) {
          encryptedData[key] = this.encryptLocal(value);
          encryptedData[`${key}_encrypted`] = true;
        } else {
          encryptedData[key] = value;
        }
      }

      if (this.token) {
        await this.client.post(`/v1/secret/data/${path}`, {
          data: encryptedData
        });
      } else {
        await this.storeInDatabase(path, encryptedData);
      }
    } catch (error) {
      logger.error(`Failed to store secret at ${path}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve secrets
   */
  async getSecret(path: string): Promise<SecretData | null> {
    try {
      let data: any;

      if (this.token) {
        const response = await this.client.get(`/v1/secret/data/${path}`);
        data = response.data.data.data;
      } else {
        data = await this.getFromDatabase(path);
      }

      if (!data) return null;

      // Decrypt sensitive fields
      const decryptedData: SecretData = {};
      for (const [key, value] of Object.entries(data)) {
        if (key.endsWith('_encrypted')) continue;
        
        if (data[`${key}_encrypted`]) {
          decryptedData[key] = this.decryptLocal(value as string);
        } else {
          decryptedData[key] = value;
        }
      }

      return decryptedData;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      logger.error(`Failed to retrieve secret at ${path}:`, error);
      throw error;
    }
  }

  /**
   * Get database credentials with automatic rotation
   */
  async getDatabaseCredentials(role: string = 'readwrite'): Promise<any> {
    try {
      if (!this.token) {
        // Return static credentials if Vault is not available
        return {
          username: process.env.POSTGRES_USER,
          password: process.env.POSTGRES_PASSWORD
        };
      }

      const response = await this.client.get(`/v1/database/creds/openagentic-${role}`);
      return {
        username: response.data.data.username,
        password: response.data.data.password,
        lease_duration: response.data.lease_duration
      };
    } catch (error) {
      logger.error('Failed to get database credentials from Vault:', error);
      // Fallback to environment variables
      return {
        username: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD
      };
    }
  }

  /**
   * Encrypt data using Transit engine
   */
  async encryptTransit(plaintext: string): Promise<string> {
    try {
      if (!this.token) {
        return this.encryptLocal(plaintext);
      }

      const response = await this.client.post('/v1/transit/encrypt/openagentic', {
        plaintext: Buffer.from(plaintext).toString('base64')
      });
      
      return response.data.data.ciphertext;
    } catch (error) {
      logger.error('Failed to encrypt with Transit:', error);
      // Fallback to local encryption
      return this.encryptLocal(plaintext);
    }
  }

  /**
   * Decrypt data using Transit engine
   */
  async decryptTransit(ciphertext: string): Promise<string> {
    try {
      if (!this.token || !ciphertext.startsWith('vault:v')) {
        return this.decryptLocal(ciphertext);
      }

      const response = await this.client.post('/v1/transit/decrypt/openagentic', {
        ciphertext
      });
      
      return Buffer.from(response.data.data.plaintext, 'base64').toString();
    } catch (error) {
      logger.error('Failed to decrypt with Transit:', error);
      // Fallback to local decryption
      return this.decryptLocal(ciphertext);
    }
  }

  /**
   * Get Azure Key Vault secret
   */
  async getAzureSecret(vaultName: string, secretName: string): Promise<string | null> {
    try {
      if (!this.token) {
        return null;
      }

      const response = await this.client.get(
        `/v1/azure-kv/secrets/${vaultName}/${secretName}`
      );
      
      return response.data.data.value;
    } catch (error) {
      logger.error(`Failed to get Azure secret ${secretName}:`, error);
      return null;
    }
  }

  /**
   * Local encryption (AES-256-CBC)
   * Used by CredentialEncryptionService for auth_config field encryption
   */
  encryptLocal(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `local:${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Local decryption (AES-256-CBC)
   * Used by CredentialEncryptionService for auth_config field decryption
   */
  decryptLocal(text: string): string {
    if (!text.startsWith('local:')) {
      return text; // Not encrypted locally
    }

    const parts = text.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }

    const iv = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Check if field name indicates sensitive data
   */
  private isSensitiveField(fieldName: string): boolean {
    const sensitivePatterns = [
      'password', 'secret', 'key', 'token', 'credential',
      'private', 'cert', 'pem', 'jwt', 'api_key', 'access_token',
      'refresh_token', 'client_secret'
    ];
    
    const lower = fieldName.toLowerCase();
    return sensitivePatterns.some(pattern => lower.includes(pattern));
  }

  /**
   * Database fallback methods (using existing database)
   */
  private async storeInDatabase(key: string, data: any): Promise<void> {
    // This would use your existing Prisma client
    // Store encrypted data in a dedicated secrets table
    const { prisma } = await import('../utils/prisma.js');
    
    await prisma.secureStorage.upsert({
      where: { key },
      create: {
        key,
        value: JSON.stringify(data),
        encrypted: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      update: {
        value: JSON.stringify(data),
        updated_at: new Date()
      }
    });
  }

  private async getFromDatabase(key: string): Promise<any> {
    const { prisma } = await import('../utils/prisma.js');
    
    const record = await prisma.secureStorage.findUnique({
      where: { key }
    });
    
    return record ? JSON.parse(record.value) : null;
  }

  private async deleteFromDatabase(key: string): Promise<void> {
    const { prisma } = await import('../utils/prisma.js');
    
    await prisma.secureStorage.delete({
      where: { key }
    }).catch(() => {
      // Ignore if doesn't exist
    });
  }

  /**
   * Health check for Vault connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.token) {
        return false;
      }
      
      await this.client.get('/v1/sys/health');
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
export const vaultService = new VaultService();