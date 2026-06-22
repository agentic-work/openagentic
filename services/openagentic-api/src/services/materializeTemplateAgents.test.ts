/**
 * materializeTemplateAgents — TDD tests.
 *
 * For each multi_agent / agent_pool / agent_supervisor / agent_single node
 * in a SEED_WORKFLOW_TEMPLATES template, ensure a matching prisma.agent row
 * exists in the SOT and the node references it by agentId.
 *
 * Behaviour required:
 *   1. Inline agent specs in multi_agent.agents[] become registered prisma.agent
 *      rows with deterministic names like Template__<slug>__<role>.
 *   2. The returned definition has agentId fields populated for every spec.
 *   3. category='template' is set on the registered agent (filterable in admin).
 *   4. Re-running the same template upserts (no duplicates).
 *   5. agent_single (top-level node.data with role/systemPrompt) also materializes.
 *   6. If a spec already has an agentId, it's left untouched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/prisma.js', () => ({
  prisma: {
    agent: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  loggers: {
    routes: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

import { prisma } from '../utils/prisma.js';

beforeEach(() => {
  vi.resetAllMocks();
  // Default: upsert returns a row with a synthetic UUID derived from name
  (prisma.agent.upsert as any).mockImplementation(async (args: any) => ({
    id: `agent-uuid-${args.where.name}`,
    name: args.where.name,
    ...args.create,
  }));
});

describe('materializeTemplateAgents', () => {
  it('multi_agent inline specs → agentId references after materialization', async () => {
    const tpl = {
      name: 'Test Template',
      description: 'desc',
      icon: 'icon',
      category: 'cat',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'multi-1',
            type: 'multi_agent',
            data: {
              agents: [
                { role: 'researcher', taskDescription: 'find X', tools: ['web'] },
                { role: 'analyst', taskDescription: 'analyze X' },
              ],
            },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    const out = await materializeTemplateAgents(tpl as any);

    const node = out.definition.nodes[0];
    expect(node.data.agents[0].agentId).toBeDefined();
    expect(node.data.agents[1].agentId).toBeDefined();
    expect(node.data.agents[0].agentId).not.toBe(node.data.agents[1].agentId);
  });

  it('uses deterministic name Template__<slug>__<role>', async () => {
    const tpl = {
      name: 'PagerDuty Auto-Triage',
      description: 'd',
      icon: 'i',
      category: 'c',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'multi-1',
            type: 'multi_agent',
            data: {
              agents: [{ role: 'aws_diagnostician', taskDescription: 't' }],
            },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    await materializeTemplateAgents(tpl as any);

    const upsertCall = (prisma.agent.upsert as any).mock.calls[0][0];
    expect(upsertCall.where.name).toBe('Template__pagerduty_auto_triage__aws_diagnostician');
  });

  it('marks registered agent with category=template', async () => {
    const tpl = {
      name: 'T',
      description: 'd',
      icon: 'i',
      category: 'c',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'multi-1',
            type: 'multi_agent',
            data: { agents: [{ role: 'a', taskDescription: 't' }] },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    await materializeTemplateAgents(tpl as any);

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    expect(call.create.category).toBe('template');
  });

  it('agent_single top-level node materializes too', async () => {
    const tpl = {
      name: 'Solo',
      description: 'd',
      icon: 'i',
      category: 'c',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'single-1',
            type: 'agent_single',
            data: { role: 'planner', systemPrompt: 'plan stuff', taskDescription: 't' },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    const out = await materializeTemplateAgents(tpl as any);

    expect(out.definition.nodes[0].data.agentId).toBeDefined();
    expect((prisma.agent.upsert as any).mock.calls[0][0].where.name).toBe(
      'Template__solo__planner',
    );
  });

  it('preserves existing agentId — does not overwrite', async () => {
    const tpl = {
      name: 'T',
      description: 'd',
      icon: 'i',
      category: 'c',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'multi-1',
            type: 'multi_agent',
            data: {
              agents: [
                { agentId: 'pre-existing-id', role: 'r', taskDescription: 't' },
              ],
            },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    const out = await materializeTemplateAgents(tpl as any);

    expect(out.definition.nodes[0].data.agents[0].agentId).toBe('pre-existing-id');
    expect((prisma.agent.upsert as any)).not.toHaveBeenCalled();
  });

  it('sets is_default:true on newly-materialized template agents (chatmode + role-based resolve parity)', async () => {
    // Before this fix template-introduced agents landed as is_default:false
    // (the Prisma column default), making them invisible to chatmode's
    // listAgentsFromDbSync (filters is_default:true) AND to the /api/agents/resolve?role=
    // path. They WERE resolvable by id, which is how flows reached them — but the
    // asymmetry meant chatmode users could not see a template-introduced agent
    // in their picker even though flows already had it materialized. Pin parity here.
    const tpl = {
      name: 'Parity',
      description: 'd',
      icon: 'i',
      category: 'c',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'multi-1',
            type: 'multi_agent',
            data: { agents: [{ role: 'new_role', taskDescription: 't' }] },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    await materializeTemplateAgents(tpl as any);

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    expect(call.create.is_default).toBe(true);
  });

  it('update branch does NOT include is_default — admin overrides preserved across template re-seed', async () => {
    // The template seeder runs on every api boot. If we set is_default:true
    // in the update block, an admin who intentionally un-defaulted a template
    // agent via the admin UI would see their change reverted on the next boot.
    // The contract: CREATE sets is_default:true; UPDATE never touches is_default.
    const tpl = {
      name: 'Idempotent',
      description: 'd',
      icon: 'i',
      category: 'c',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'multi-1',
            type: 'multi_agent',
            data: { agents: [{ role: 'r', taskDescription: 't' }] },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    await materializeTemplateAgents(tpl as any);

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    expect(call.update).toBeDefined();
    expect('is_default' in call.update).toBe(false);
  });

  it('agent_pool and agent_supervisor also materialize', async () => {
    const tpl = {
      name: 'Pool',
      description: 'd',
      icon: 'i',
      category: 'c',
      tags: [],
      definition: {
        nodes: [
          {
            id: 'pool-1',
            type: 'agent_pool',
            data: {
              agents: [{ role: 'p1', taskDescription: 't' }],
            },
          },
          {
            id: 'sup-1',
            type: 'agent_supervisor',
            data: {
              agents: [{ role: 's1', taskDescription: 't' }],
            },
          },
        ],
        edges: [],
      },
    };

    const { materializeTemplateAgents } = await import('./materializeTemplateAgents');
    await materializeTemplateAgents(tpl as any);

    const names = (prisma.agent.upsert as any).mock.calls.map((c: any) => c[0].where.name);
    expect(names).toContain('Template__pool__p1');
    expect(names).toContain('Template__pool__s1');
  });
});
