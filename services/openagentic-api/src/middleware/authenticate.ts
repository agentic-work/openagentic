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
 * Authentication Middleware for Fastify
 *
 * SIMPLIFIED - Uses unified token validator
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { validateAnyToken, extractBearerToken } from '../auth/tokenValidator.js';

/**
 * Basic authentication middleware
 * Validates JWT token and attaches user to request
 */
export const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  try {
    // SECURITY: DEV_AUTH_BYPASS removed in v0.4.0 hardening
    // All authentication must go through proper channels

    // Extract token from header
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
      return;
    }

    // Validate token using unified validator
    const result = await validateAnyToken(token, {
      logger: request.log
    });

    if (!result.isValid) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: result.error || 'Invalid authentication token'
      });
      return;
    }

    // Attach user to request
    (request as any).user = {
      id: result.user!.userId,
      email: result.user!.email,
      name: result.user!.name,
      isAdmin: result.user!.isAdmin || false,
      groups: result.user!.groups || []
    };

    return;
  } catch (error) {
    request.log.error({ error }, 'Authentication error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to authenticate'
    });
  }
};