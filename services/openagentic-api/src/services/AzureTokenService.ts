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



import type { FastifyBaseLogger } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { validateAzureToken, logTokenValidation } from '../utils/validateAzureToken.js';
import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

// MSAL for token refresh - will be loaded dynamically
let msalModule: any = null;
let msalLoadAttempted = false;

async function getMsalModule(): Promise<any> {
  if (msalLoadAttempted) return msalModule;
  msalLoadAttempted = true;

  try {
    msalModule = await import('@azure/msal-node');
    console.log('[AzureTokenService] ✅ @azure/msal-node loaded successfully');
    return msalModule;
  } catch (e) {
    console.warn('[AzureTokenService] ⚠️ @azure/msal-node not available:', (e as Error).message);
    return null;
  }
}

const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.AAD_CLIENT_ID || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || process.env.AAD_CLIENT_SECRET || '';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || process.env.AAD_TENANT_ID || '';

export interface AzureTokenInfo {
  access_token: string;
  id_token?: string;  // ID token for AWS Identity Center OBO (has app's client ID as audience)
  expires_at: Date;
  is_expired: boolean;
}

/**
 * Service for retrieving Azure OBO tokens from the database
 * This service retrieves tokens that were previously stored during Azure AD authentication
 */
export class AzureTokenService {
  private logger: FastifyBaseLogger;
  
  constructor(logger: FastifyBaseLogger) {
    this.logger = logger.child({ service: 'AzureTokenService' }) as Logger;
  }
  
  /**
   * Get the Azure OBO token for a user from the database
   */
  async getUserAzureToken(userId: string): Promise<AzureTokenInfo | null> {
    try {
      this.logger.debug({ userId }, 'Retrieving Azure token for user');
      
      const tokenData = await prisma.userAuthToken.findUnique({
        where: { user_id: userId },
        select: {
          access_token: true,
          id_token: true,  // ID token for AWS Identity Center OBO
          refresh_token: true,
          expires_at: true
        }
      });
      
      if (!tokenData) {
        this.logger.warn({ userId }, 'No Azure token found for user');
        return null;
      }
      
      // Check if this is a Service Principal auth (admin user)
      const isServicePrincipal = tokenData.refresh_token === 'service_principal';
      
      const isExpired = tokenData.expires_at < new Date();
      const tokenInfo = {
        access_token: tokenData.access_token,
        expires_at: tokenData.expires_at,
        is_expired: isExpired
      };
      
      if (tokenInfo.is_expired) {
        this.logger.warn({ userId, expiresAt: tokenInfo.expires_at }, 'Azure token is expired');
        return {
          access_token: tokenInfo.access_token,
          id_token: tokenData.id_token || undefined,
          expires_at: tokenInfo.expires_at,
          is_expired: true
        };
      }

      // Skip JWT validation for Service Principal auth
      if (isServicePrincipal) {
        this.logger.info({ userId }, 'Service Principal authentication detected - skipping JWT validation');
        return {
          access_token: tokenInfo.access_token,
          id_token: tokenData.id_token || undefined,
          expires_at: tokenInfo.expires_at,
          is_expired: false
        };
      }
      
      // Validate the token structure and claims for regular OBO tokens
      const isTokenValid = logTokenValidation(this.logger, userId, tokenInfo.access_token);
      
      if (!isTokenValid) {
        this.logger.error({ userId }, 'Azure token failed validation checks');
        return {
          access_token: tokenInfo.access_token,
          id_token: tokenData.id_token || undefined,
          expires_at: tokenInfo.expires_at,
          is_expired: true // Treat invalid tokens as expired
        };
      }

      this.logger.info({
        userId,
        expiresAt: tokenInfo.expires_at,
        hasIdToken: !!tokenData.id_token,
        timeUntilExpiry: Math.floor((new Date(tokenInfo.expires_at).getTime() - Date.now()) / 1000 / 60)
      }, 'Retrieved valid Azure OBO token for user');

      return {
        access_token: tokenInfo.access_token,
        id_token: tokenData.id_token || undefined,
        expires_at: tokenInfo.expires_at,
        is_expired: false
      };
      
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to retrieve Azure OBO token');
      throw error;
    }
  }
  
  /**
   * Check if a user has a valid Azure OBO token
   */
  async hasValidAzureToken(userId: string): Promise<boolean> {
    try {
      const tokenInfo = await this.getUserAzureToken(userId);
      return tokenInfo !== null && !tokenInfo.is_expired;
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to check Azure token validity');
      return false;
    }
  }
  
  /**
   * Get the Azure OBO token string for a user, or null if not available/expired
   */
  async getValidAzureTokenString(userId: string): Promise<string | null> {
    try {
      const tokenInfo = await this.getUserAzureToken(userId);
      
      if (!tokenInfo || tokenInfo.is_expired) {
        return null;
      }
      
      return tokenInfo.access_token;
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to get valid Azure token string');
      return null;
    }
  }
  
  /**
   * Store an Azure OBO token for a user (typically called during authentication)
   */
  async storeUserAzureToken(userId: string, token: string): Promise<void> {
    try {
      // Validate token before storing
      const validation = validateAzureToken(token);
      if (!validation.isValid) {
        this.logger.error({ 
          userId, 
          issues: validation.issues 
        }, 'Cannot store invalid Azure token');
        throw new Error(`Invalid Azure token: ${validation.issues.join(', ')}`);
      }
      
      // Log successful validation
      logTokenValidation(this.logger, userId, token);
      
      // Decode token to get expiration info
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid JWT token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const expiresAt = new Date(payload.exp * 1000);
      
      await prisma.userAuthToken.upsert({
        where: { user_id: userId },
        update: {
          access_token: token,
          expires_at: expiresAt,
          updated_at: new Date()
        },
        create: {
          user_id: userId,
          access_token: token,
          expires_at: expiresAt
        }
      });
      
      this.logger.info({ userId, expiresAt }, 'Stored Azure OBO token for user');
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to store Azure OBO token');
      throw error;
    }
  }
  
  /**
   * Clean up expired tokens from the database
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = await prisma.userAuthToken.deleteMany({
        where: {
          expires_at: {
            lt: oneDayAgo
          }
        }
      });

      const deletedCount = result.count || 0;

      if (deletedCount > 0) {
        this.logger.info({ deletedCount }, 'Cleaned up expired Azure OBO tokens');
      }

      return deletedCount;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to cleanup expired Azure tokens');
      throw error;
    }
  }

  /**
   * Refresh an expired Azure OBO token using the stored refresh token
   * This is called automatically when a token is found to be expired
   */
  async refreshToken(userId: string): Promise<AzureTokenInfo | null> {
    try {
      // Get existing token data including refresh token and id_token
      const tokenData = await prisma.userAuthToken.findUnique({
        where: { user_id: userId },
        select: {
          access_token: true,
          id_token: true,
          refresh_token: true,
          expires_at: true,
          scope: true
        }
      });

      if (!tokenData || !tokenData.refresh_token) {
        this.logger.warn({ userId }, 'No refresh token available for user');
        return null;
      }

      // Service principal tokens don't need refresh
      if (tokenData.refresh_token === 'service_principal') {
        this.logger.debug({ userId }, 'Service principal token - skipping refresh');
        return null;
      }

      // Dynamically load MSAL
      const msal = await getMsalModule();
      if (!msal) {
        this.logger.error({ userId }, 'MSAL module not available for token refresh');
        return null;
      }

      this.logger.info({ userId }, 'Attempting to refresh Azure OBO token');

      // Initialize MSAL client
      const msalClient = new msal.ConfidentialClientApplication({
        auth: {
          clientId: AZURE_CLIENT_ID,
          clientSecret: AZURE_CLIENT_SECRET,
          authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`
        }
      });

      // Use MSAL to refresh the token
      const refreshTokenRequest = {
        refreshToken: tokenData.refresh_token,
        scopes: [tokenData.scope || 'https://management.azure.com/.default']
      };

      const response = await msalClient.acquireTokenByRefreshToken(refreshTokenRequest);

      if (!response || !response.accessToken) {
        this.logger.error({ userId }, 'Token refresh returned no access token');
        return null;
      }

      const expiresAt = new Date(response.expiresOn?.getTime() || Date.now() + 3600000);
      const newIdToken = (response as any).idToken || undefined;

      // Update token in database
      await prisma.userAuthToken.update({
        where: { user_id: userId },
        data: {
          access_token: response.accessToken,
          // MSAL may return new ID token on refresh
          ...(newIdToken && { id_token: newIdToken }),
          // Azure SDK might provide new refresh token, use it if available
          refresh_token: response.refreshToken || tokenData.refresh_token,
          expires_at: expiresAt,
          updated_at: new Date()
        }
      });

      this.logger.info({
        userId,
        expiresAt,
        hasNewIdToken: !!newIdToken,
        tokenPreview: response.accessToken.substring(0, 20) + '...'
      }, 'Successfully refreshed Azure OBO token');

      // If MSAL didn't return new ID token, fetch current one from database
      const currentIdToken = newIdToken || tokenData.id_token;

      return {
        access_token: response.accessToken,
        id_token: currentIdToken || undefined,
        expires_at: expiresAt,
        is_expired: false
      };

    } catch (error: any) {
      this.logger.error({
        userId,
        error: error.message,
        errorCode: error.errorCode
      }, 'Failed to refresh Azure OBO token - user may need to re-authenticate');
      return null;
    }
  }

  /**
   * Get a valid Azure OBO token, refreshing if necessary
   * This is the primary method to use when you need a valid token
   */
  async getOrRefreshToken(userId: string): Promise<AzureTokenInfo | null> {
    try {
      // First try to get existing token
      const tokenInfo = await this.getUserAzureToken(userId);

      if (!tokenInfo) {
        this.logger.debug({ userId }, 'No Azure token found for user');
        return null;
      }

      // If token is valid, return it
      if (!tokenInfo.is_expired) {
        return tokenInfo;
      }

      // Token is expired, try to refresh
      this.logger.info({ userId }, 'Azure token expired, attempting refresh');
      const refreshedToken = await this.refreshToken(userId);

      if (refreshedToken) {
        return refreshedToken;
      }

      // Refresh failed, return the expired token info (caller should handle)
      this.logger.warn({ userId }, 'Token refresh failed - returning expired token info');
      return tokenInfo;

    } catch (error: any) {
      this.logger.error({ userId, error: error.message }, 'Failed to get or refresh Azure token');
      return null;
    }
  }
}