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
 * MCP Authentication Middleware
 * 
 * Injects Azure AD user context for MCP operations and ensures authenticated
 * users have proper permissions for MCP tool execution.
 * 
 * @see {@link https://docs.openagentics.io/api/authentication}
 */

import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Extract user context from the authenticated request
 */
function extractUserContext(request: FastifyRequest): any {
  // Check if user is already set by auth middleware
  const user = (request as any).user;
  if (user) {
    return {
      userId: user.id || user.oid,
      email: user.email,
      tenantId: user.tenantId || process.env.AZURE_TENANT_ID,
      groups: user.groups || []
    };
  }
  
  // Fallback to headers if set by proxy/gateway
  const userId = request.headers['x-user-id'] as string;
  const email = request.headers['x-user-email'] as string;
  const tenantId = request.headers['x-tenant-id'] as string;
  
  if (userId) {
    return {
      userId,
      email,
      tenantId: tenantId || process.env.AZURE_TENANT_ID,
      groups: []
    };
  }
  
  return null;
}

/**
 * Middleware to inject Azure AD user context for MCP operations
 * This ensures that MCP tools use the authenticated user's permissions
 * 
 * Note: With the orchestrator architecture, user context is passed
 * with each request rather than being stored in a manager instance
 */
export function injectUserContextToMCP() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Extract user context from the request
      const userContext = extractUserContext(request);
      
      if (userContext) {
        // Get the access token from the Authorization header
        const authHeader = request.headers.authorization;
        const accessToken = authHeader?.substring(7); // Remove 'Bearer ' prefix
        
        // Attach context to request for use in routes
        (request as any).mcpContext = {
          userId: userContext.userId,
          aadToken: accessToken,
          tenantId: userContext.tenantId
        };
        
        request.log.info({
          userId: userContext.userId,
          email: userContext.email,
          tenantId: userContext.tenantId,
          hasToken: !!accessToken
        }, 'User context prepared for MCP operations');
      }
    } catch (error) {
      request.log.error({ error }, 'Failed to prepare user context for MCP');
      // Don't fail the request, just log the error
    }
  };
}

/**
 * Decorator to ensure MCP has user context before executing
 * Use this on routes that call MCP tools
 */
export function requireMCPAuth() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<any> => {
    const userContext = extractUserContext(request);
    
    if (!userContext) {
      return reply.status(401).send({
        error: 'Authentication required for MCP operations'
      });
    }
    
    // User context is valid, continue
    // Return undefined to let Fastify continue to the next handler
    return undefined;
  };
}
