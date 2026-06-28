/**
 * Workflow catalog / read-only listing routes.
 *
 *   GET /templates
 *   GET /cost-rates
 *   GET /agents
 *   GET /:id/snippets
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { getReqUser, transformWorkflow } from './shared.js';
import type { FlowDefinition, WorkflowIdParams } from './types.js';

export const catalogRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * GET /api/workflows/templates
   * List all workflow templates (public templates accessible to any authenticated user)
   */
  fastify.get(
    '/templates',
    async (request, reply) => {
      try {
        const templates = await prisma.workflow.findMany({
          where: {
            is_template: true,
            is_public: true,
            deleted_at: null,
          },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            name: true,
            description: true,
            definition: true,
            settings: true,
            is_active: true,
            is_template: true,
            is_public: true,
            tags: true,
            category: true,
            icon: true,
            color: true,
            total_executions: true,
            created_by: true,
            created_at: true,
            updated_at: true,
          },
        });

        return reply.send({
          templates: templates.map(transformWorkflow),
          total: templates.length,
        });
      } catch (error) {
        if (error.code === 'P2021' || error.code === 'P2010' || error.message?.includes('does not exist')) {
          return reply.send({ templates: [], total: 0 });
        }
        logger.error({ error }, '[Workflows] Failed to list templates');
        return reply.code(500).send({
          error: 'Failed to list templates',
          message: error.message,
        });
      }
    }
  );

  /**
   * GET /api/workflows/cost-rates
   * Active per-million-token rates for the cost-preview feature in the
   * Flows toolbar. Returns the LLMCostRate rows that are currently in
   * effect (effective_from <= now < effective_to OR effective_to NULL).
   * Cached client-side; cheap server query (single SELECT, no joins).
   */
  fastify.get(
    '/cost-rates',
    async (_request, reply) => {
      try {
        const now = new Date();
        const costRateModel = (prisma as unknown as {
          lLMCostRate: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
        }).lLMCostRate;
        const rows = await costRateModel.findMany({
          where: {
            effective_from: { lte: now },
            OR: [{ effective_to: null }, { effective_to: { gte: now } }],
          },
          select: {
            provider_type: true,
            model: true,
            model_variant: true,
            input_cost_per_1m: true,
            output_cost_per_1m: true,
            cached_input_cost_per_1m: true,
          },
          orderBy: [{ provider_type: 'asc' }, { model: 'asc' }],
        });
        // Decimal columns serialise as strings in JSON; coerce to number
        // so the client doesn't have to parse.
        const rates = rows.map((r) => ({
          providerType: r.provider_type,
          model: r.model,
          modelVariant: r.model_variant ?? null,
          inputCostPer1m: Number(r.input_cost_per_1m),
          outputCostPer1m: Number(r.output_cost_per_1m),
          cachedInputCostPer1m:
            r.cached_input_cost_per_1m == null ? null : Number(r.cached_input_cost_per_1m),
        }));
        return reply.send({ rates, fetchedAt: now.toISOString() });
      } catch (error) {
        logger.warn({ error: error.message }, '[Workflows] cost-rates query failed, returning empty');
        return reply.send({ rates: [], fetchedAt: new Date().toISOString() });
      }
    }
  );

  /**
   * GET /api/workflows/agents — DEPRECATED 2026-04-26.
   *
   * Originally hit openagentic-proxy only and skipped prisma.agent (the SOT).
   * Now collapsed onto listAgentsFromSOT — same merge as /api/admin/agents
   * but with sensitive prompt/tool fields redacted. Kept as a pass-through
   * so any external caller still works; UI no longer calls it.
   */
  fastify.get(
    '/agents',
    async (request, reply) => {
      try {
        logger.info(
          { ua: request.headers['user-agent'] },
          '[Workflows] DEPRECATED /api/workflows/agents — use /api/admin/agents'
        );
        const { listAgentsFromSOT } = await import('../../services/listAgentsFromSOT.js');
        const agents = await listAgentsFromSOT({ redactSensitive: true });
        return reply.send({ agents });
      } catch (error) {
        logger.warn({ error: error.message }, '[Workflows] /agents failed, returning empty');
        return reply.send({ agents: [] });
      }
    }
  );

  /**
   * GET /api/workflows/:id/snippets
   * Generate auto-generated API client code snippets for calling this workflow.
   * Returns curl, Python, JavaScript, and MCP tool call examples.
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/snippets',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [{ created_by: userId }, { is_public: true }],
          },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found' });
        }

        const apiUrl = process.env.PUBLIC_URL || 'https://chat.example.com';
        const workflowName = workflow.name;
        const definition: FlowDefinition = (workflow.definition as unknown as FlowDefinition) || {};
        const triggerNode = (definition.nodes || []).find((n) => (n.type || n.data?.type) === 'trigger');
        const inputSchema = triggerNode?.data?.inputSchema || triggerNode?.data?.config?.inputSchema;
        const inputExample = inputSchema
          ? JSON.stringify(Object.fromEntries(Object.entries(inputSchema as Record<string, unknown>).map(([k, v]) => [k, `your_${k}_here`])), null, 2)
          : '{"message": "your input here"}';
        const inputExampleInline = inputSchema
          ? JSON.stringify(Object.fromEntries(Object.entries(inputSchema as Record<string, unknown>).map(([k, v]) => [k, `your_${k}_here`])))
          : '{"message": "your input here"}';

        const snippets = {
          curl: `curl -X POST "${apiUrl}/api/workflows/${id}/execute" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": ${inputExampleInline}}'`,

          python: `import requests

response = requests.post(
    "${apiUrl}/api/workflows/${id}/execute",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json",
    },
    json={"input": ${inputExample}},
    stream=True,
)

for line in response.iter_lines():
    if line:
        print(line.decode())`,

          javascript: `const response = await fetch("${apiUrl}/api/workflows/${id}/execute", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ input: ${inputExample} }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`,

          typescript: `import axios from "axios";

const { data } = await axios.post(
  "${apiUrl}/api/workflows/${id}/execute",
  { input: ${inputExample} },
  {
    headers: {
      Authorization: "Bearer YOUR_API_KEY",
      "Content-Type": "application/json",
    },
    responseType: "stream",
  }
);

data.on("data", (chunk: Buffer) => {
  console.log(chunk.toString());
});`,

          mcp_tool: `// Use via MCP: workflow_execute tool
{
  "tool": "workflow_execute",
  "arguments": {
    "workflow_id": "${id}"${inputSchema ? `,\n    "input_data": ${inputExample}` : ''}
  }
}

// Or use by name: workflow_execute_by_name tool
{
  "tool": "workflow_execute_by_name",
  "arguments": {
    "workflow_name": "${workflowName}"${inputSchema ? `,\n    "input_data": ${inputExample}` : ''}
  }
}`,
        };

        return reply.send({
          workflowId: id,
          workflowName,
          inputSchema: inputSchema || null,
          snippets,
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to generate snippets');
        return reply.code(500).send({ error: 'Failed to generate snippets', message: error.message });
      }
    }
  );
};

export default catalogRoutes;
