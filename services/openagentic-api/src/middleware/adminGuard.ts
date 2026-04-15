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
 * Admin Guard Middleware
 *
 * SIMPLIFIED - Uses unified token validator
 *
 * @see {@link https://docs.openagentics.io/api/authentication}
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { validateAnyToken, extractBearerToken } from '../auth/tokenValidator.js';

/**
 * Admin Guard Middleware
 * Ensures only admin users can access protected routes
 */
export async function adminGuard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Extract token from header
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
      return;
    }

    // Validate token using unified validator with admin requirement
    const result = await validateAnyToken(token, {
      requireAdmin: true,
      logger: request.log
    });

    if (!result.isValid) {
      const statusCode = result.error?.includes('Administrator') ? 403 : 401;
      reply.code(statusCode).send({
        error: statusCode === 403 ? 'Forbidden' : 'Unauthorized',
        message: result.error || 'Invalid authentication token'
      });
      return;
    }

    // Attach user to request
    (request as any).user = result.user;
    return;
  } catch (error) {
    request.log.error({ error }, 'Admin guard error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to verify admin access'
    });
  }
}

/**
 * Fastify admin authentication middleware (alias for compatibility)
 */
export const requireAdminFastify = adminGuard;

/**
 * Helper function to check if a user context has admin privileges
 */
export function isUserAdmin(user: any): boolean {
  if (!user) return false;

  // Check isAdmin flag
  if (user.isAdmin) return true;

  // Check if user has admin role
  if (user.roles?.includes('admin') || user.roles?.includes('administrator')) return true;

  // Check if user is in admin group
  if (user.groups?.includes('OpenAgentic-Admins') ||
      user.groups?.includes('openagentic-admins')) return true;

  return false;
}