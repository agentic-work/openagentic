/**
 * Fastify Authentication Middleware
 * 
 * Provides authentication hooks for Fastify routes
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { UserPayload } from '../types/index.js';
import { validateAzureADToken, isUserAuthorized, getAuthorizedGroups } from '../utils/auth-validator.js';

interface AuthenticatedUser {
  oid: string;
  email: string;
  groups: string[];
  userId?: string;
}

/**
 * Fastify authentication preHandler
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'No authorization token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  
  if (!token) {
    return reply.status(401).send({ error: 'No authorization token provided' });
  }
  
  // Validate Azure AD JWT token
  try {
    const payload = await validateAzureADToken(token);
    
    // Check if user is in authorized groups
    const { userGroups, adminGroups } = getAuthorizedGroups();
    const allAuthorizedGroups = [...new Set([...userGroups, ...adminGroups])];
    
    if (allAuthorizedGroups.length > 0) {
      const userGroupsList = payload.groups || [];
      if (!isUserAuthorized(userGroupsList, allAuthorizedGroups)) {
        return reply.status(403).send({ 
          error: 'Access denied',
          message: `You must be a member of one of these groups: ${allAuthorizedGroups.join(', ')}`
        });
      }
    }
    
    // Determine if user is admin
    const isAdmin = adminGroups.length > 0 
      ? isUserAuthorized(payload.groups || [], adminGroups)
      : false;
    
    request.user = {
      id: payload.oid,
      oid: payload.oid,
      userId: payload.oid,
      email: payload.email || payload.preferred_username || '',
      groups: payload.groups || [],
      isAdmin,
      localAccount: false,
      accessToken: token
    };
    
    return;
  } catch (error) {
    console.error('Authentication error:', error);
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

// Export both names for compatibility
export const requireAuth = authenticate;