/**
 * Internal Prompt Compose API
 *
 * Used by openagentic-proxy and workflow engine to compose system prompts
 * via the PromptComposer without going through the full chat pipeline.
 * No external auth — internal network only.
 */

import { FastifyInstance } from 'fastify';
import type { ComposeContext } from '../../services/prompt/types.js';

export async function registerPromptComposeRoutes(fastify: FastifyInstance) {
  // POST /api/internal/prompt/compose
  fastify.post<{ Body: ComposeContext }>('/compose', async (request, reply) => {
    try {
      const { PromptComposer } = await import('../../services/prompt/PromptComposer.js');
      const composer = PromptComposer.getInstance();
      const result = await composer.compose(request.body);
      return reply.send(result);
    } catch (err: any) {
      fastify.log.error({ error: err.message }, '[internal/prompt-compose] compose failed');
      return reply.code(500).send({ error: err.message || 'Compose failed' });
    }
  });
}
