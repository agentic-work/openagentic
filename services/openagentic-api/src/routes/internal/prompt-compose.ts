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
