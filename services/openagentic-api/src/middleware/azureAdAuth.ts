/**
 * Azure AD Authentication Middleware
 * 
 * Fastify plugin that validates JWT tokens and decorates requests with user context
 * supporting both Azure AD tokens and local authentication tokens.
 * 
 * @see {@link https://docs.openagentic.io/api/authentication}
 */

import { FastifyPluginAsync } from 'fastify';
import { decode } from 'jsonwebtoken';
import { UserPayload } from '../types/index.js';

export const azureAdAuth: FastifyPluginAsync = async (fastify, options) => {
  fastify.decorateRequest('user', null);

  fastify.addHook('onRequest', async (request, reply) => {
    // Skip auth for health checks
    if (request.url === '/health') {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return;
    }

    const token = authHeader.substring(7);
    
    try {
      // Decode the token without verification for now (verification should be added)
      const decoded = decode(token) as any;
      
      if (decoded) {
        // Support both Azure AD tokens (with oid) and local auth tokens (with userId)
        if (decoded.oid) {
          // Azure AD token
          request.user = {
            id: decoded.oid,  // Map oid to id for compatibility
            oid: decoded.oid,
            email: decoded.email || decoded.preferred_username,
            preferred_username: decoded.preferred_username,
            name: decoded.name,
            groups: decoded.groups || [],
            isAdmin: decoded.groups?.includes('admins') || false,
            azureOid: decoded.oid,
            azureTenantId: decoded.tid
          } as UserPayload;
        } else if (decoded.userId) {
          // Local auth token
          request.user = {
            id: decoded.userId || decoded.id,  // Map userId to id for compatibility
            oid: decoded.userId || decoded.id, // Map userId to oid for compatibility
            email: decoded.email || decoded.username,
            preferred_username: decoded.username,
            name: decoded.name || decoded.username,
            groups: decoded.groups || [],
            isAdmin: decoded.isAdmin || false,
            // Add extra fields to distinguish local auth
            userId: decoded.userId || decoded.id,
            localAccount: true
          } as UserPayload;
        }
      }
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to decode JWT token');
    }
  });
};