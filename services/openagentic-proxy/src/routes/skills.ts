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
