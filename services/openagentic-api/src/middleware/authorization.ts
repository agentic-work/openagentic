/**
 * Authorization Middleware for Fastify
 *
 * Provides role-based authorization middleware
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { UserContext } from '../auth/azureADAuth.js';

/**
 * Role-based authorization middleware
 * Checks if user has required roles or permissions
 */
export const authorize = (requiredRoles: string[] = []) => {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const user = (request as any).user as UserContext;

      if (!user) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'User not authenticated'
        });
        return;
      }

      // Check if user has any of the required roles
      if (requiredRoles.length > 0) {
        const userRoles = user.roles || [];
        const hasRequiredRole = requiredRoles.some(role =>
          userRoles.includes(role) || userRoles.includes(role.toLowerCase())
        );

        if (!hasRequiredRole) {
          reply.code(403).send({
            error: 'Forbidden',
            message: 'Insufficient permissions'
          });
          return;
        }
      }

      return;
    } catch (error) {
      request.log.error({ error }, 'Authorization error');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to authorize'
      });
    }
  };
};