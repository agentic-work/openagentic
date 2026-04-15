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

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SkillsRegistry } from '../services/SkillsRegistry';
import { authMiddleware } from '../middleware/auth';

export async function skillsRoutes(app: FastifyInstance, registry: SkillsRegistry): Promise<void> {
  app.get('/api/agents/skills', {
    preHandler: authMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as any;
    const skills = query.q
      ? registry.search(query.q)
      : registry.list({ type: query.type, source: query.source });
    return reply.send({ skills });
  });

  app.post('/api/agents/skills/import', {
    preHandler: authMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const skill = await registry.register({
      id: body.id || `skill_${Date.now()}`,
      name: body.name,
      displayName: body.displayName || body.name,
      description: body.description,
      type: body.type || 'prompt_injection',
      definition: body.definition,
      source: body.source || 'custom',
      requiredTools: body.requiredTools || [],
      tags: body.tags || [],
    });
    return reply.status(201).send(skill);
  });

  app.delete<{ Params: { id: string } }>('/api/agents/skills/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const deleted = await registry.delete(request.params.id);
    return reply.send({ deleted });
  });
}
