import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DataSourceService } from '../services/DataSourceService.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

export default async function dataSourceRoutes(fastify: FastifyInstance) {
  const service = new DataSourceService(logger as any);

  const getUserId = (request: FastifyRequest): string => {
    const user = (request as any).user;
    return user?.userId || user?.id || '';
  };

  // GET /data-sources — list all for user
  fastify.get('/data-sources', { preHandler: authMiddleware }, async (request, reply) => {
    const sources = await service.list(getUserId(request));
    return reply.send({ sources });
  });

  // GET /data-sources/:id
  fastify.get<{ Params: { id: string } }>('/data-sources/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const ds = await service.getById(request.params.id, getUserId(request));
    if (!ds) return reply.code(404).send({ error: 'Not found' });
    return reply.send(ds);
  });

  // POST /data-sources — create
  fastify.post('/data-sources', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as any;
    try {
      const ds = await service.create(getUserId(request), {
        name: body.name,
        description: body.description,
        type: body.type,
        connection_config: body.connection_config || {},
        secret_id: body.secret_id,
        is_shared: body.is_shared,
        tags: body.tags,
      });
      return reply.code(201).send(ds);
    } catch (err: any) {
      if (err.code === 'P2002') return reply.code(409).send({ error: 'Data source with this name already exists' });
      throw err;
    }
  });

  // PUT /data-sources/:id — update
  fastify.put<{ Params: { id: string } }>('/data-sources/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const ds = await service.update(request.params.id, getUserId(request), request.body as any);
    return reply.send(ds);
  });

  // DELETE /data-sources/:id
  fastify.delete<{ Params: { id: string } }>('/data-sources/:id', { preHandler: authMiddleware }, async (request, reply) => {
    await service.delete(request.params.id, getUserId(request));
    return reply.send({ deleted: true });
  });

  // POST /data-sources/:id/probe — test connection + discover schema
  fastify.post<{ Params: { id: string } }>('/data-sources/:id/probe', { preHandler: authMiddleware }, async (request, reply) => {
    const result = await service.probeSchema(request.params.id, getUserId(request));
    return reply.send(result);
  });

  // POST /data-sources/:id/query — execute raw query
  fastify.post<{ Params: { id: string } }>('/data-sources/:id/query', { preHandler: authMiddleware }, async (request, reply) => {
    const { query } = request.body as { query: string };
    if (!query) return reply.code(400).send({ error: 'query is required' });
    const result = await service.executeQuery(request.params.id, getUserId(request), query);
    return reply.send(result);
  });

  // POST /data-sources/:id/nl-query — natural language query (progressive enhancement)
  fastify.post<{ Params: { id: string } }>('/data-sources/:id/nl-query', { preHandler: authMiddleware }, async (request, reply) => {
    const { question } = request.body as { question: string };
    if (!question) return reply.code(400).send({ error: 'question is required' });

    const ds = await service.getById(request.params.id, getUserId(request));
    if (!ds) return reply.code(404).send({ error: 'Data source not found' });

    const schemaContext = (ds.schema_cache as any)?.tables?.map((t: any) =>
      `Table: ${t.schema ? t.schema + '.' : ''}${t.name}\n  Columns: ${t.columns?.map((c: any) => `${c.name} (${c.type})`).join(', ')}`
    ).join('\n') || 'No schema available. Probe the data source first.';

    try {
      const llmResponse = await fetch('http://localhost:8000/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-From': 'internal', 'X-Internal-Secret': process.env.INTERNAL_SERVICE_SECRET || '' },
        body: JSON.stringify({
          model: 'auto',
          messages: [
            { role: 'system', content: `You are a SQL query generator. Given the database schema and a natural language question, output ONLY the SQL query. No explanation, no markdown, just raw SQL.\n\nDatabase type: ${ds.type}\n\nSchema:\n${schemaContext}` },
            { role: 'user', content: question },
          ],
          max_tokens: 500,
          temperature: 0,
        }),
      });
      const llmData = await llmResponse.json() as any;
      const generatedSQL = llmData.choices?.[0]?.message?.content?.trim();
      if (!generatedSQL) return reply.send({ success: false, error: 'LLM returned empty response', generatedQuery: null });

      const result = await service.executeQuery(request.params.id, getUserId(request), generatedSQL);
      return reply.send({ ...result, generatedQuery: generatedSQL, originalQuestion: question });
    } catch (err: any) {
      return reply.send({ success: false, error: `NL translation failed: ${err.message}`, generatedQuery: null });
    }
  });
}
