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