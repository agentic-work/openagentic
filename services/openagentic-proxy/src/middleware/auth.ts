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

import type { FastifyRequest, FastifyReply } from 'fastify';
import axios from 'axios';
import { logger } from '../utils/logger';

const API_URL = process.env.API_URL || 'http://openagentic-api:8000';
const tokenCache = new Map<string, { user: any; expiresAt: number }>();

// Clean expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of tokenCache) {
    if (val.expiresAt < now) tokenCache.delete(key);
  }
}, 5 * 60 * 1000);

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers['authorization'];
  const openagenticProxyHeader = request.headers['x-openagentic-proxy'];
  const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY;

  // Allow internal calls from API service (service-to-service with shared key)
  if (openagenticProxyHeader === 'true' && internalKey && authHeader === `Bearer ${internalKey}`) {
    (request as any).user = { id: 'system', email: 'system@internal', groups: [], isAdmin: true, authMethod: 'internal' };
    return;
  }

  if (!authHeader?.startsWith('Bearer ')) {
    logger.warn({ path: request.url }, 'Unauthorized request to openagentic-proxy: missing Bearer token');
    reply.status(401).send({ error: 'Unauthorized: missing Bearer token' });
    return;
  }

  const token = authHeader.substring(7);
  if (!token || token.length < 10) {
    logger.warn({ path: request.url }, 'Unauthorized request to openagentic-proxy: token too short');
    reply.status(401).send({ error: 'Unauthorized: invalid token' });
    return;
  }

  // Check cache first (60s TTL)
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    (request as any).user = cached.user;
    return;
  }

  // Validate token against the API
  try {
    const resp = await axios.post(
      `${API_URL}/api/auth/validate-token`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      }
    );

    if (!resp.data?.userId) {
      logger.warn({ path: request.url }, 'Token validation returned no userId');
      reply.status(401).send({ error: 'Unauthorized: invalid token' });
      return;
    }

    const user = {
      id: resp.data.userId,
      email: resp.data.email || '',
      groups: resp.data.groups || [],
      isAdmin: resp.data.isAdmin || false,
      authMethod: resp.data.authMethod || 'local',
    };

    tokenCache.set(token, { user, expiresAt: Date.now() + 60000 });
    (request as any).user = user;
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      logger.warn({ path: request.url, status }, 'Token validation rejected by API');
      reply.status(401).send({ error: 'Unauthorized: token rejected' });
    } else {
      logger.error({ path: request.url, error: error.message }, 'Token validation failed');
      reply.status(503).send({ error: 'Auth service unavailable' });
    }
  }
}
