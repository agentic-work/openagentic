/**
 * Agent Routes (Non-Admin)
 *
 * Accessible to all authenticated users:
 * - GET /api/agents - List platform agents (visible to all)
 * - POST /api/agents/:id/execute - Execute an agent task
 * - GET /api/agents/stream/:executionId - SSE stream for live execution
 */

import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { ndjsonHeaders, createSSEToNDJSONTranslator } from '../infra/ndjson.js';

export const agentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes || loggers;

  fastify.addHook('preHandler', authMiddleware);

  const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
  const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY || '';

  /**
   * GET /api/agents - List all platform agents (non-admin view)
   * Returns agent definitions without sensitive config
   */
  fastify.get('/', async (request, reply) => {
    try {
      // Fetch from openagentic-proxy
      let proxyAgents: any[] = [];
      try {
        const res = await fetch(`${openagenticProxyUrl}/api/agents/definitions`, {
          headers: {
            'Authorization': `Bearer ${internalKey}`,
            'X-Agent-Proxy': 'true',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json() as { agents: any[] };
          proxyAgents = data.agents || [];
        }
      } catch { /* openagentic-proxy unreachable, fall through to DB */ }

      // Fetch from DB to get UUIDs
      let dbAgents: any[] = [];
      try {
        dbAgents = await prisma.agent.findMany({
          where: { enabled: true },
          select: { id: true, name: true, agent_type: true, display_name: true, description: true, model_config: true, tools_whitelist: true, skills: true, category: true, icon: true, enabled: true },
        });
      } catch { /* table may not exist yet */ }

      const dbByName = new Map(dbAgents.map((a: any) => [a.name, a]));
      const dbByType = new Map(dbAgents.map((a: any) => [a.agent_type, a]));

      // Merge: proxy agents enriched with DB UUIDs
      // Proxy: { id: 'research', role: 'reasoning' }, DB: { name: 'reasoning', agent_type: 'reasoning' }
      const safeAgents = proxyAgents.map((a: any) => {
        const dbMatch = dbByName.get(a.role) || dbByName.get(a.agent_type) || dbByType.get(a.role) || dbByType.get(a.agent_type) || dbByName.get(a.id);
        return {
          id: dbMatch?.id || a.id, // Prefer DB UUID
          name: a.name || a.display_name,
          display_name: a.display_name || a.name,
          role: a.role || a.agent_type,
          agent_type: a.agent_type || a.role,
          description: a.description || '',
          icon: a.icon,
          category: a.category || 'platform',
          enabled: a.enabled !== false,
          model: a.model || a.model_config?.primaryModel || 'auto',
          tools: a.tools || a.tools_whitelist || [],
          skills: a.skills || [],
          maxTurns: a.maxTurns || a.max_turns,
          maxToolCalls: a.maxToolCalls || a.max_tool_calls,
        };
      });

      return reply.send({ agents: safeAgents });
    } catch (error: any) {
      logger.warn({ error: error.message }, '[Agents] Failed to list agents');
      return reply.send({ agents: [] });
    }
  });

  /**
   * POST /api/agents/:id/execute - Execute an agent with a task
   * Proxies to openagentic-proxy and returns executionId for SSE streaming
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/execute',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { id: agentId } = request.params;
        const body = request.body as { task: string; context?: Record<string, any>; flowContext?: any };

        if (!body?.task) {
          return reply.code(400).send({ error: 'Task description is required' });
        }

        const res = await fetch(`${openagenticProxyUrl}/api/agents/execute`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${internalKey}`,
            'X-Agent-Proxy': 'true',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agentId,
            task: body.task,
            context: {
              ...body.context,
              userId,
              source: 'agent-playground',
            },
            flowContext: body.flowContext,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Agent execution failed' }));
          return reply.code(res.status).send(err);
        }

        const data = await res.json() as { executionId: string };
        return reply.send(data);
      } catch (error: any) {
        logger.error({ error: error.message }, '[Agents] Execute failed');
        return reply.code(500).send({ error: 'Failed to execute agent' });
      }
    }
  );

  /**
   * GET /api/agents/stream/:executionId - SSE stream for agent execution
   * Proxies SSE events from openagentic-proxy
   */
  fastify.get<{ Params: { executionId: string } }>(
    '/stream/:executionId',
    async (request, reply): Promise<void> => {
      try {
        const { executionId } = request.params;

        const res = await fetch(`${openagenticProxyUrl}/api/agents/stream/${executionId}`, {
          headers: {
            'Authorization': `Bearer ${internalKey}`,
            'X-Agent-Proxy': 'true',
          },
          signal: AbortSignal.timeout(300000), // 5 min timeout for long executions
        });

        if (!res.ok || !res.body) {
          reply.code(res.status || 502).send({ error: 'Failed to connect to agent stream' });
          return;
        }

        reply.raw.writeHead(200, ndjsonHeaders());

        // Agent-proxy still emits SSE upstream. Bridge at this boundary
        // so the UI only ever sees NDJSON. When openagentic-proxy migrates
        // natively, drop the bridge and pipe chunks verbatim.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const bridge = createSSEToNDJSONTranslator();

        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              const ndjson = bridge.translate(chunk);
              if (ndjson) reply.raw.write(ndjson);
            }
          } catch {
            // Client disconnected or stream ended
          } finally {
            const tail = bridge.flush();
            if (tail) reply.raw.write(tail);
            reply.raw.end();
          }
        };

        request.raw.on('close', () => {
          reader.cancel().catch(() => {});
        });

        await pump();
      } catch (error: any) {
        logger.error({ error: error.message }, '[Agents] Stream failed');
        reply.code(500).send({ error: 'Failed to stream agent execution' });
      }
    }
  );

  /**
   * GET /api/agents/resolve
   * Resolve agent config with composed prompt from DB + PromptComposer.
   * Used by openagentic-proxy to get the full agent config including composed system prompt.
   * Query: ?role=reasoning OR ?id=uuid
   * Optional: ?mode=chat|code|flow (for mode-specific module selection)
   */
  fastify.get('/resolve', async (request, reply) => {
    try {
      const { role, id, mode = 'chat' } = request.query as { role?: string; id?: string; mode?: string };

      if (!role && !id) {
        return reply.code(400).send({ error: 'Provide role or id query param' });
      }

      // Import prisma and PromptComposer
      const { prisma } = await import('../utils/prisma.js');

      const where = id ? { id } : { agent_type: role, is_default: true, enabled: true };
      const agent = await prisma.agent.findFirst({ where: where as any });

      if (!agent) {
        return reply.code(404).send({ error: `Agent not found: ${role || id}` });
      }

      const modelConfig = (agent.model_config as any) || {};
      let systemPrompt = agent.system_prompt || '';

      // If agent uses composable prompt strategy, compose from modules
      if (agent.prompt_strategy === 'composite' && agent.prompt_modules?.length > 0) {
        try {
          const { PromptComposer } = await import('../services/prompt/PromptComposer.js');
          const composer = new PromptComposer();
          // Role-derived intent hints: the artifact_creation agent is
          // dispatched ONLY to render visualizations. Declare that intent
          // explicitly so intent-gated modules (artifact-creation, and any
          // other future requiresUserIntent:['visualization'] module) make
          // it into the composed prompt — otherwise they'd be filtered out
          // because the resolve endpoint doesn't receive the user's original
          // message to re-evaluate via ArtifactIntentGate. See openagentic-omhs#327.
          const derivedUserIntent =
            agent.agent_type === 'artifact_creation' ? 'visualization' : undefined;
          const composed = await composer.compose({
            message: '',
            mode: (mode || 'chat') as any,
            model: 'auto',
            availableTools: [],
            userId: '',
            sessionId: '',
            agentRole: agent.agent_type,
            agentModules: agent.prompt_modules,
            sliderPosition: 0.6,
            userIntent: derivedUserIntent,
          });
          if (composed?.systemPrompt) {
            systemPrompt = composed.systemPrompt;
          }
        } catch (composeErr: any) {
          logger.warn({ error: composeErr.message, agent: agent.name }, 'Failed to compose prompt, using raw system_prompt');
        }
      }

      return reply.send({
        id: agent.id,
        name: agent.name,
        display_name: agent.display_name,
        agent_type: agent.agent_type,
        systemPrompt,
        model: modelConfig.primaryModel || 'auto',
        fallbackModel: modelConfig.fallbackModel,
        maxTokens: modelConfig.maxTokens || 8192,
        temperature: modelConfig.temperature || 0.5,
        maxTurns: modelConfig.maxTurns || 5,
        tools: agent.tools_whitelist || [],
        toolsDenyList: agent.tools_deny_list || [],
        skills: agent.skills || [],
        prompt_strategy: agent.prompt_strategy,
        prompt_modules: agent.prompt_modules,
        prompt_mode: agent.prompt_mode || 'full',
        category: agent.category,
        // Spawn safety limits
        max_spawn_depth: agent.max_spawn_depth ?? 1,
        max_children: agent.max_children ?? 5,
        // Reliability + chaining
        retry_strategy: agent.retry_strategy || {},
        handoff_schema: agent.handoff_schema || {},
        output_schema: agent.output_schema || {},
        // Execution config
        isolation: agent.isolation || 'none',
        memory_scope: agent.memory_scope || 'session',
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to resolve agent');
      return reply.code(500).send({ error: error.message });
    }
  });

  logger.info('Agent routes (non-admin) registered');
};

export default agentRoutes;
