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
 * Azure On-Behalf-Of (OBO) Service
 * 
 * Handles Azure AD On-Behalf-Of token flow to allow the API to access Azure
 * resources on behalf of authenticated users. Manages token exchange, scope
 * validation, and secure credential handling using MSAL.
 * 
 * Features:
 * - Secure On-Behalf-Of token exchange using MSAL
 * - Multi-scope token acquisition for different Azure services
 * - Token caching and automatic renewal
 * - Test mode support for development environments
 * - Comprehensive error handling and logging
 * - Support for Azure Management API and other resource scopes
 */

// Import @azure/msal-node — the API package is ESM ("type":"module") so the
// previous `require('@azure/msal-node')` pattern always threw ReferenceError
// (require is undefined in ESM) and silently disabled OBO platform-wide.
// Use static ESM import instead.
import * as msalModule from '@azure/msal-node';
import type { FastifyBaseLogger } from 'fastify';

export interface OBOTokenRequest {
  userAccessToken: string;
  scopes: string[];
}

export interface OBOTokenResponse {
  accessToken: string;
  expiresOn: Date;
  tokenType: string;
  scopes: string[];
}

/**
 * Service for handling Azure AD On-Behalf-Of (OBO) token flow
 * This allows the API to act on behalf of a user to access Azure resources
 */
export class AzureOBOService {
  private msalClient: any = null;
  private logger: FastifyBaseLogger;
  private isTestMode: boolean;
  
  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
    // SECURITY: AUTH_MODE=test bypass removed in v0.5.0 FedRAMP hardening (Bolt 01)
    // OBO service always requires real MSAL initialization.
    this.isTestMode = false;

    if (msalModule) {
      // Initialize MSAL for OBO flow using app registration credentials
      // This uses the app's credentials to exchange user tokens, not to directly access resources
      try {
        const msalConfig = {
          auth: {
            clientId: process.env.AAD_CLIENT_ID || process.env.AZURE_CLIENT_ID,
            clientSecret: process.env.AZURE_CLIENT_SECRET,
            authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
          }
        };

        this.msalClient = new msalModule.ConfidentialClientApplication(msalConfig);
        this.logger.info('AzureOBOService initialized for On-Behalf-Of token exchange');
      } catch (error) {
        this.logger.error({ error }, 'Failed to initialize MSAL client for OBO');
        this.msalClient = null;
      }
    } else {
      this.logger.warn('AzureOBOService: @azure/msal-node not available');
    }
  }
  
  /**
   * Exchange a user's access token for a new token with different scopes
   * using the On-Behalf-Of flow
   */
  async acquireTokenOnBehalfOf(request: OBOTokenRequest): Promise<OBOTokenResponse | null> {
    try {
      // SECURITY: Test mode fake token generation removed in v0.5.0 FedRAMP hardening (Bolt 01)
      // All OBO token exchange must go through real MSAL client.

      if (!this.msalClient) {
        throw new Error('MSAL client not initialized');
      }
      
      this.logger.info({ scopes: request.scopes }, 'Acquiring OBO token');
      
      const oboRequest = {
        oboAssertion: request.userAccessToken,
        scopes: request.scopes
      };
      
      const response = await this.msalClient.acquireTokenOnBehalfOf(oboRequest);
      
      if (!response) {
        this.logger.error('No response from OBO token request');
        return null;
      }
      
      this.logger.info({ 
        scopes: response.scopes,
        expiresOn: response.expiresOn
      }, 'OBO token acquired successfully');
      
      return {
        accessToken: response.accessToken,
        expiresOn: response.expiresOn!,
        tokenType: response.tokenType,
        scopes: response.scopes
      };
    } catch (error: any) {
      this.logger.error({
        errorMessage: error?.message,
        errorCode: error?.errorCode,
        subError: error?.subError,
        correlationId: error?.correlationId,
        stack: error?.stack?.split('\n')[0]
      }, 'Failed to acquire OBO token');
      return null;
    }
  }
  
  /**
   * Get an OBO token for Azure Resource Manager (ARM) API
   */
  async getAzureManagementToken(userAccessToken: string): Promise<string | null> {
    const response = await this.acquireTokenOnBehalfOf({
      userAccessToken,
      scopes: ['https://management.azure.com/.default']
    });
    
    return response?.accessToken || null;
  }
  
  /**
   * Get an OBO token for Microsoft Graph API
   */
  async getGraphToken(userAccessToken: string): Promise<string | null> {
    const response = await this.acquireTokenOnBehalfOf({
      userAccessToken,
      scopes: ['https://graph.microsoft.com/.default']
    });
    
    return response?.accessToken || null;
  }
  
  /**
   * Get an OBO token for Azure Key Vault
   */
  async getKeyVaultToken(userAccessToken: string): Promise<string | null> {
    const response = await this.acquireTokenOnBehalfOf({
      userAccessToken,
      scopes: ['https://vault.azure.net/.default']
    });
    
    return response?.accessToken || null;
  }
  
  /**
   * Validate that a token has the required scopes for Azure operations
   */
  validateTokenScopes(token: string, requiredScopes: string[]): boolean {
    try {
      // Decode the token to check scopes
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) return false;
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const tokenScopes = payload.scp?.split(' ') || [];
      
      return requiredScopes.every(scope => tokenScopes.includes(scope));
    } catch (error) {
      this.logger.error({ error }, 'Failed to validate token scopes');
      return false;
    }
  }
}