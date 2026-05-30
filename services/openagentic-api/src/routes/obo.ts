/**
 * Azure On-Behalf-Of Authentication Routes
 * 
 * Manages Azure AD On-Behalf-Of (OBO) token flow for authenticated users,
 * enabling secure access to Azure resources using delegated permissions.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AzureTokenService } from '../services/AzureTokenService.js';

interface OBORequest {
  userAccessToken: string;
  scopes: string[];
}

interface OBOResponse {
  accessToken: string;
  tokenType: string;
  expiresOn: string;
  scopes: string[];
}

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for OBO auth');
}

export const oboRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;
  
  // Using Prisma instead of Pool
  const tokenService = new AzureTokenService(logger);
  
  // POST /api/auth/obo route moved to auth.ts to use proper Azure OBO service
  
  /**
   * GET /api/auth/obo
   * Get the current Azure token for the authenticated user
   * This is a convenience endpoint for testing and token retrieval
   */
  fastify.get('/api/auth/obo', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: 'No authorization header' });
    }
    
    const apiToken = authHeader.replace('Bearer ', '');
    let userId: string;
    
    try {
      const decoded = jwt.verify(apiToken, JWT_SECRET) as any;
      userId = decoded.userId;
    } catch (error) {
      logger.error({ error }, 'Invalid API token in OBO GET request');
      return reply.code(401).send({ error: 'Invalid authorization token' });
    }
    
    // Get the user's Azure token from database
    const tokenInfo = await tokenService.getUserAzureToken(userId);
    
    if (!tokenInfo) {
      logger.warn({ userId }, 'No Azure token found for user');
      return reply.code(404).send({ error: 'No Azure token found for user' });
    }
    
    // Return the token info
    const expiresAt = new Date(tokenInfo.expires_at);
    
    logger.info({
      userId,
      expiresAt,
      isExpired: tokenInfo.is_expired,
      timeUntilExpiry: Math.floor((expiresAt.getTime() - Date.now()) / 1000 / 60) + ' minutes'
    }, 'Returning Azure token info for user');
    
    return reply.send({
      access_token: tokenInfo.access_token,
      token_type: 'Bearer',
      expires_at: expiresAt.toISOString(),
      is_expired: tokenInfo.is_expired
    });
  });
  
  /**
   * POST /api/auth/obo/refresh
   * Force refresh an Azure token for a user
   * This would typically use the refresh token to get a new access token
   */
  fastify.post('/api/auth/obo/refresh', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: 'No authorization header' });
    }
    
    const apiToken = authHeader.replace('Bearer ', '');
    let userId: string;
    
    try {
      const decoded = jwt.verify(apiToken, JWT_SECRET) as any;
      userId = decoded.userId;
    } catch (error) {
      return reply.code(401).send({ error: 'Invalid authorization token' });
    }
    
    logger.info({ userId }, 'Force refresh requested for user');
    
    // In a real implementation, this would:
    // 1. Get the refresh token from database
    // 2. Call Azure AD to exchange refresh token for new access token
    // 3. Store the new tokens in database
    // 4. Return the new access token
    
    // For now, return a message indicating manual intervention needed
    return reply.code(501).send({
      error: 'Token refresh not implemented',
      message: 'Please login again through the UI to refresh your Azure token'
    });
  });
};