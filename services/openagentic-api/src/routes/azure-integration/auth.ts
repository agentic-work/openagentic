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
 * Azure Authentication and OAuth Routes
 * 
 * Handles Azure AD authentication, On-Behalf-Of token flows, account linking,
 * token validation, and Azure resource permission management.
 * 
 * @see {@link https://docs.openagentics.io/api/azure-integration/auth}
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import * as jwt from 'jsonwebtoken';
// Define ConfidentialClientApplication type locally if @azure/msal-node is not available
let msalModule: any;
try {
  msalModule = require('@azure/msal-node');
} catch (e) {
  // @azure/msal-node not available
}

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for Azure auth');
}
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.AAD_CLIENT_ID || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || process.env.AAD_CLIENT_SECRET || '';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || process.env.AAD_TENANT_ID || '';

export const azureAuthRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Initialize MSAL client for OBO flow
  const msalClient = msalModule ? new msalModule.ConfidentialClientApplication({
    auth: {
      clientId: AZURE_CLIENT_ID,
      clientSecret: AZURE_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`
    }
  }) : null;

  // Helper to get user from token
  const getUserFromToken = (request: any): string | null => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return decoded.userId || decoded.id || decoded.oid;
    } catch (error) {
      logger.warn({ error }, 'Failed to decode user token');
      return null;
    }
  };

  /**
   * Link Azure account with OBO token
   * POST /api/azure/auth/link
   */
  fastify.post('/link', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        accessToken,
        refreshToken,
        expiresIn = 3600,
        scope = 'https://management.azure.com/.default',
        azureOid,
        tenantId
      } = request.body as {
        accessToken: string;
        refreshToken?: string;
        expiresIn?: number;
        scope?: string;
        azureOid?: string;
        tenantId?: string;
      };

      if (!accessToken) {
        return reply.code(400).send({ error: 'Access token is required' });
      }

      // Validate the Azure token by making a test call
      let userProfile: any = null;
      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          userProfile = await response.json();
        } else {
          return reply.code(400).send({ error: 'Invalid Azure token' });
        }
      } catch (error) {
        return reply.code(400).send({ error: 'Failed to validate Azure token' });
      }

      const expiresAt = new Date(Date.now() + (expiresIn * 1000));

      // Store or update Azure token for user
      const azureToken = await prisma.userAuthToken.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          scope: scope,
          azure_oid: azureOid || userProfile?.id,
          tenant_id: tenantId || AZURE_TENANT_ID
        },
        update: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          scope: scope,
          azure_oid: azureOid || userProfile?.id,
          tenant_id: tenantId || AZURE_TENANT_ID,
          updated_at: new Date()
        }
      });

      // Update user record with Azure info
      await prisma.user.update({
        where: { id: userId },
        data: {
          azure_oid: azureOid || userProfile?.id,
          azure_tenant_id: tenantId || AZURE_TENANT_ID
        }
      });

      return reply.send({
        success: true,
        message: 'Azure account linked successfully',
        linkedAt: azureToken.created_at,
        expiresAt: azureToken.expires_at,
        userProfile: {
          displayName: userProfile?.displayName,
          mail: userProfile?.mail,
          userPrincipalName: userProfile?.userPrincipalName
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to link Azure account');
      return reply.code(500).send({ error: 'Azure account linking failed' });
    }
  });

  /**
   * Check Azure authentication status
   * GET /api/azure/auth/status
   */
  fastify.get('/status', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const azureToken = await prisma.userAuthToken.findUnique({
        where: { user_id: userId }
      });

      if (!azureToken) {
        return reply.send({
          linked: false,
          status: 'not_linked',
          message: 'No Azure account linked'
        });
      }

      const now = new Date();
      const isExpired = azureToken.expires_at < now;
      const isExpiringSoon = azureToken.expires_at.getTime() - now.getTime() < 300000; // 5 minutes

      let tokenStatus = 'valid';
      if (isExpired) {
        tokenStatus = 'expired';
      } else if (isExpiringSoon) {
        tokenStatus = 'expiring_soon';
      }

      // Test token validity with a simple Graph API call
      let isTokenValid = false;
      if (!isExpired) {
        try {
          const response = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: {
              'Authorization': `Bearer ${azureToken.access_token}`,
              'Content-Type': 'application/json'
            }
          });
          isTokenValid = response.ok;
        } catch (error) {
          logger.warn({ error }, 'Failed to validate Azure token');
        }
      }

      return reply.send({
        linked: true,
        status: tokenStatus,
        isValid: isTokenValid,
        expiresAt: azureToken.expires_at,
        linkedAt: azureToken.created_at,
        lastUpdated: azureToken.updated_at,
        scope: azureToken.scope,
        azureOid: azureToken.azure_oid,
        tenantId: azureToken.tenant_id,
        needsRefresh: isExpired || isExpiringSoon
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get Azure auth status');
      return reply.code(500).send({ error: 'Failed to retrieve Azure authentication status' });
    }
  });

  /**
   * Refresh Azure OBO token
   * POST /api/azure/auth/refresh
   */
  fastify.post('/refresh', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const azureToken = await prisma.userAuthToken.findUnique({
        where: { user_id: userId }
      });

      if (!azureToken || !azureToken.refresh_token) {
        return reply.code(404).send({ 
          error: 'No refresh token available',
          message: 'Please re-link your Azure account'
        });
      }

      // Use MSAL to refresh the token
      try {
        const refreshTokenRequest = {
          refreshToken: azureToken.refresh_token,
          scopes: [azureToken.scope || 'https://management.azure.com/.default']
        };

        const response = await msalClient.acquireTokenByRefreshToken(refreshTokenRequest);
        
        if (!response) {
          throw new Error('No response from token refresh');
        }

        const expiresAt = new Date(response.expiresOn?.getTime() || Date.now() + 3600000);

        // Update stored token
        const updatedToken = await prisma.userAuthToken.update({
          where: { user_id: userId },
          data: {
            access_token: response.accessToken,
            refresh_token: azureToken.refresh_token, // Azure SDK doesn't provide refresh token in acquireTokenSilent
            expires_at: expiresAt,
            updated_at: new Date()
          }
        });

        return reply.send({
          success: true,
          message: 'Azure token refreshed successfully',
          expiresAt: updatedToken.expires_at,
          refreshedAt: updatedToken.updated_at
        });
      } catch (msalError) {
        logger.error({ error: msalError }, 'MSAL token refresh failed');
        return reply.code(400).send({ 
          error: 'Token refresh failed',
          message: 'Please re-authenticate with Azure'
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to refresh Azure token');
      return reply.code(500).send({ error: 'Azure token refresh failed' });
    }
  });

  /**
   * Unlink Azure account
   * DELETE /api/azure/auth/unlink
   */
  fastify.delete('/unlink', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const azureToken = await prisma.userAuthToken.findUnique({
        where: { user_id: userId }
      });

      if (!azureToken) {
        return reply.code(404).send({ error: 'No Azure account linked' });
      }

      // Remove Azure token
      await prisma.userAuthToken.delete({
        where: { user_id: userId }
      });

      // Clear Azure info from user record
      await prisma.user.update({
        where: { id: userId },
        data: {
          azure_oid: null,
          azure_tenant_id: null
        }
      });

      return reply.send({
        success: true,
        message: 'Azure account unlinked successfully',
        unlinkedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to unlink Azure account');
      return reply.code(500).send({ error: 'Azure account unlinking failed' });
    }
  });

  /**
   * Get user Azure permissions
   * GET /api/azure/auth/permissions
   */
  fastify.get('/permissions', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const azureToken = await prisma.userAuthToken.findUnique({
        where: { user_id: userId }
      });

      if (!azureToken) {
        return reply.code(404).send({ error: 'No Azure account linked' });
      }

      // Check if token is expired
      if (azureToken.expires_at < new Date()) {
        return reply.code(401).send({ 
          error: 'Azure token expired',
          message: 'Please refresh your Azure token'
        });
      }

      // Get user's Azure permissions
      let permissions: any = {};
      let subscriptions: any[] = [];
      let roleAssignments: any[] = [];

      try {
        // Get subscriptions
        const subsResponse = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
          headers: {
            'Authorization': `Bearer ${azureToken.access_token}`,
            'Content-Type': 'application/json'
          }
        });

        if (subsResponse.ok) {
          const subsData = await subsResponse.json() as any;
          subscriptions = subsData.value || [];
        }

        // Get role assignments (for first subscription if available)
        if (subscriptions.length > 0) {
          const firstSubId = subscriptions[0].subscriptionId;
          const rolesResponse = await fetch(
            `https://management.azure.com/subscriptions/${firstSubId}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=principalId eq '${azureToken.azure_oid}'`,
            {
              headers: {
                'Authorization': `Bearer ${azureToken.access_token}`,
                'Content-Type': 'application/json'
              }
            }
          );

          if (rolesResponse.ok) {
            const rolesData = await rolesResponse.json() as any;
            roleAssignments = rolesData.value || [];
          }
        }

        permissions = {
          subscriptions: subscriptions.length,
          subscriptionAccess: subscriptions.map(sub => ({
            subscriptionId: sub.subscriptionId,
            displayName: sub.displayName,
            state: sub.state
          })),
          roleAssignments: roleAssignments.length,
          roles: roleAssignments.map(role => role.properties.roleDefinitionId).slice(0, 10), // Limit to 10
          hasManagementAccess: roleAssignments.some(role => 
            role.properties.roleDefinitionId.includes('Owner') || 
            role.properties.roleDefinitionId.includes('Contributor')
          )
        };
      } catch (permError) {
        logger.warn({ error: permError }, 'Failed to retrieve Azure permissions');
        permissions = {
          error: 'Failed to retrieve permissions',
          message: 'Token may have insufficient scope'
        };
      }

      return reply.send({
        azureOid: azureToken.azure_oid,
        tenantId: azureToken.tenant_id,
        scope: azureToken.scope,
        permissions,
        retrievedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get Azure permissions');
      return reply.code(500).send({ error: 'Failed to retrieve Azure permissions' });
    }
  });

  /**
   * Validate Azure token
   * POST /api/azure/auth/validate
   */
  fastify.post('/validate', async (request, reply) => {
    try {
      const { token, scope } = request.body as {
        token: string;
        scope?: string;
      };

      if (!token) {
        return reply.code(400).send({ error: 'Token is required' });
      }

      // Test token with Microsoft Graph
      let graphValid = false;
      let graphError = null;
      let userInfo = null;

      try {
        const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        graphValid = graphResponse.ok;
        if (graphValid) {
          userInfo = await graphResponse.json();
        } else {
          graphError = `HTTP ${graphResponse.status}`;
        }
      } catch (error) {
        graphError = 'Network error';
      }

      // Test token with Azure Management API if scope includes it
      let managementValid = false;
      let managementError = null;

      if (scope && scope.includes('management.azure.com')) {
        try {
          const mgmtResponse = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          managementValid = mgmtResponse.ok;
          if (!managementValid) {
            managementError = `HTTP ${mgmtResponse.status}`;
          }
        } catch (error) {
          managementError = 'Network error';
        }
      }

      const validation = {
        valid: graphValid,
        graph: {
          valid: graphValid,
          error: graphError,
          userInfo: graphValid ? {
            displayName: userInfo?.displayName,
            mail: userInfo?.mail,
            userPrincipalName: userInfo?.userPrincipalName,
            id: userInfo?.id
          } : null
        },
        management: scope && scope.includes('management.azure.com') ? {
          valid: managementValid,
          error: managementError
        } : null,
        validatedAt: new Date().toISOString()
      };

      return reply.send(validation);
    } catch (error) {
      logger.error({ error }, 'Failed to validate Azure token');
      return reply.code(500).send({ error: 'Azure token validation failed' });
    }
  });
};