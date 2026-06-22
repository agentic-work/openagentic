/**
 * listAgentsFromSOT — single canonical agent list across the platform.
 *
 * Both /api/admin/agents and /api/workflows/agents call this. It merges:
 *   1. openagentic-proxy /api/agents/definitions (runtime "knowable" agents)
 *   2. prisma.agent table (configured SOT — created/edited via Admin console)
 *
 * The DB is authoritative: where openagentic-proxy and prisma overlap, DB fields
 * win. DB-only agents are appended as definitions.
 *
 * The `redactSensitive` flag strips fields that should not leak to non-admin
 * callers (system_prompt, prompt_modules, tools_whitelist, skills, delegation,
 * background). Set true for /api/workflows/agents (logged-in users), false for
 * /api/admin/agents (admins).
 */

import type { Agent } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes || loggers;

export interface ListAgentsOptions {
  /** Strip prompt/tool fields not safe for non-admin builders. */
  redactSensitive?: boolean;
}

const SENSITIVE_FIELDS = [
  'system_prompt',
  'prompt_modules',
  'prompt_strategy',
  'prompt_mode',
  'tools_whitelist',
  'skills',
  'delegation',
  'background',
] as const;

function redact(agent: any): any {
  const out: any = { ...agent };
  for (const f of SENSITIVE_FIELDS) {
    if (f in out) delete out[f];
  }
  return out;
}

async function fetchProxyAgents(): Promise<any[]> {
  const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
  const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY || '';
  try {
    const res = await fetch(`${openagenticProxyUrl}/api/agents/definitions`, {
      headers: {
        Authorization: `Bearer ${internalKey}`,
        'X-Agent-Proxy': 'true',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as { agents?: any[] };
      return data.agents ?? [];
    }
    logger.warn({ status: res.status }, '[listAgentsFromSOT] openagentic-proxy non-OK');
    return [];
  } catch (err: any) {
    logger.warn({ error: err.message }, '[listAgentsFromSOT] openagentic-proxy unreachable');
    return [];
  }
}

async function fetchDbAgents(): Promise<Agent[]> {
  try {
    return await prisma.agent.findMany({
      include: { _count: { select: { executions: true } } } as any,
      orderBy: { created_at: 'asc' },
    });
  } catch (err: any) {
    logger.warn({ error: err.message }, '[listAgentsFromSOT] prisma.agent query failed');
    return [];
  }
}

/**
 * Merge openagentic-proxy + prisma.agent into a single agent list.
 * DB is authoritative on overlapping fields; DB-only agents are appended.
 */
export async function listAgentsFromSOT(opts: ListAgentsOptions = {}): Promise<any[]> {
  const [proxyAgents, dbAgents] = await Promise.all([
    fetchProxyAgents(),
    fetchDbAgents(),
  ]);

  const dbByName = new Map(dbAgents.map(a => [a.name, a]));
  const dbByType = new Map(dbAgents.map(a => [a.agent_type, a]));

  const merged: any[] = proxyAgents.map(pa => {
    const dbMatch =
      dbByName.get(pa.role) ||
      dbByName.get(pa.agent_type) ||
      dbByType.get(pa.role) ||
      dbByType.get(pa.agent_type) ||
      dbByName.get(pa.id);
    if (dbMatch) {
      return {
        ...pa,
        id: dbMatch.id,
        db_id: dbMatch.id,
        prompt_strategy: (dbMatch as any).prompt_strategy ?? pa.prompt_strategy,
        prompt_modules: (dbMatch as any).prompt_modules ?? pa.prompt_modules,
        prompt_mode: (dbMatch as any).prompt_mode ?? pa.prompt_mode,
        max_spawn_depth: (dbMatch as any).max_spawn_depth ?? pa.max_spawn_depth,
        max_children: (dbMatch as any).max_children ?? pa.max_children,
        _count: (dbMatch as any)._count,
      };
    }
    return pa;
  });

  const proxyKeys = new Set(proxyAgents.map((pa: any) => pa.agent_type || pa.id || pa.name));
  for (const dba of dbAgents) {
    if (!proxyKeys.has(dba.name) && !proxyKeys.has(dba.agent_type)) {
      merged.push({
        id: dba.id,
        db_id: dba.id,
        name: dba.name,
        display_name: dba.display_name,
        description: dba.description,
        agent_type: dba.agent_type,
        model_config: dba.model_config,
        system_prompt: dba.system_prompt,
        tools_whitelist: dba.tools_whitelist,
        skills: dba.skills,
        delegation: dba.delegation,
        background: dba.background,
        category: dba.category,
        tags: dba.tags,
        enabled: dba.enabled,
        created_at: dba.created_at,
        prompt_strategy: (dba as any).prompt_strategy,
        prompt_modules: (dba as any).prompt_modules,
        prompt_mode: (dba as any).prompt_mode,
        max_spawn_depth: (dba as any).max_spawn_depth,
        max_children: (dba as any).max_children,
        _count: (dba as any)._count,
      });
    }
  }

  if (opts.redactSensitive) {
    return merged.map(redact);
  }
  return merged;
}
