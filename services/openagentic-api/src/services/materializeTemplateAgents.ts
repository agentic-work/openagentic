/**
 * materializeTemplateAgents — turns inline ghost agents in seed templates
 * into registered prisma.agent rows + agentId references.
 *
 * Run during template seeding. For each multi_agent / agent_pool /
 * agent_supervisor / agent_single node in the template's definition, walks
 * the inline agent specs and:
 *   1. Computes a deterministic name `Template__<slug>__<role>`
 *   2. Upserts a prisma.agent row with category='template'
 *   3. Sets node.data.agents[i].agentId (or node.data.agentId for agent_single)
 *
 * Specs that already carry an agentId are left untouched. The original
 * inline fields (role, systemPrompt, taskDescription, tools) are preserved
 * alongside the new agentId — the engine prefers agentId at run time and
 * the inline fields remain as informative metadata.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes || loggers;

const AGENT_HOLDER_TYPES = new Set([
  'multi_agent',
  'agent_pool',
  'agent_supervisor',
]);

const SINGLE_AGENT_TYPES = new Set(['agent_single']);

interface TemplateLike {
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  tags?: string[];
  definition: { nodes: any[]; edges: any[] };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_');
}

function deterministicName(templateName: string, role: string): string {
  return `Template__${slugify(templateName)}__${slugify(role)}`;
}

// Default tool grants for materialized template agents. These are the tools
// any research-style agent needs to actually do its job — without them the
// agent can only respond from parametric knowledge and produces meta-text
// like "please provide the topic so I can research it" (caught 2026-04-26
// running Multi-Agent Research Team without web access).
const DEFAULT_TEMPLATE_TOOLS = ['web_search', 'web_fetch', 'sequential_thinking'];

async function upsertTemplateAgent(
  templateName: string,
  spec: any,
): Promise<string> {
  const role = spec.role || spec.agent_type || 'agent';
  const name = deterministicName(templateName, role);
  const display_name = spec.display_name
    || `${templateName} — ${role.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}`;
  // Merge any tools the template explicitly listed with the default set
  // every materialized agent gets. De-dupe.
  const explicitTools = Array.isArray(spec.tools) ? spec.tools : [];
  const tools_whitelist = Array.from(new Set([...DEFAULT_TEMPLATE_TOOLS, ...explicitTools]));
  const system_prompt = spec.systemPrompt || spec.system_prompt || null;
  const description = spec.taskDescription || spec.description || `Auto-generated from "${templateName}" template (role: ${role}).`;

  const created = await prisma.agent.upsert({
    where: { name } as any,
    create: {
      name,
      display_name,
      description,
      agent_type: role,
      category: 'template',
      tags: ['seeded', 'template-agent'],
      enabled: true,
      // is_default:true makes template agents reachable via chatmode's
      // listAgentsFromDbSync AND /api/agents/resolve?role= — matching the
      // canonical 8-agent surface. The id-based resolve path always worked;
      // role-based + chatmode-picker parity is what this flag unlocks.
      // UPDATE branch intentionally omits is_default so an admin's manual
      // un-default via the admin UI survives template re-seed on api boot.
      is_default: true,
      system_prompt,
      tools_whitelist,
      model_config: { primaryModel: 'auto' } as any,
    } as any,
    update: {
      display_name,
      description,
      agent_type: role,
      category: 'template',
      system_prompt,
      tools_whitelist,
    } as any,
  });

  return (created as any).id;
}

/**
 * Walk a SeedTemplate definition; for every agent-holder node, materialize
 * inline specs into prisma.agent rows + populate agentId references.
 *
 * Returns a copy of the template with mutated node.data — the input is not
 * mutated in place.
 */
export async function materializeTemplateAgents<T extends TemplateLike>(
  template: T,
): Promise<T> {
  const cloned: T = JSON.parse(JSON.stringify(template));

  for (const node of cloned.definition.nodes) {
    try {
      if (AGENT_HOLDER_TYPES.has(node.type)) {
        const agents = Array.isArray(node.data?.agents) ? node.data.agents : [];
        for (let i = 0; i < agents.length; i++) {
          const spec = agents[i];
          if (spec?.agentId) continue;
          const id = await upsertTemplateAgent(cloned.name, spec);
          spec.agentId = id;
        }
      } else if (SINGLE_AGENT_TYPES.has(node.type)) {
        if (!node.data?.agentId && node.data?.role) {
          const id = await upsertTemplateAgent(cloned.name, node.data);
          node.data.agentId = id;
        }
      }
    } catch (err: any) {
      logger.warn(
        { templateName: cloned.name, nodeId: node.id, error: err?.message },
        '[materializeTemplateAgents] failed to materialize agent — leaving inline',
      );
    }
  }

  return cloned;
}
