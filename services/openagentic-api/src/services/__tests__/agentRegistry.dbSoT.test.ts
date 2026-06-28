/**
 * Option B — `prisma.agent` is the single source of truth for chatmode +
 * Flows + admin agent registry.
 *
 * Audit (2026-05-13) proved divergence: chatmode read 8 markdown files in
 * `src/agents/built-in/*.md`; Flows + Admin Console read from
 * `prisma.agent` (33 rows in the dev environment). A custom agent created via the
 * Admin UI was invisible to the chatmode Task tool.
 *
 * This TDD slice unifies the path:
 *   1. boot-time seeder upserts the 8 markdown built-ins into prisma.agent
 *   2. listAgentsFromDb() returns ALL prisma.agent rows so chatmode Task
 *      can see admin-created custom agents
 *   3. chatmode's `makeListAgents` factory in buildChatV2Deps uses the
 *      DB-backed list (not the markdown-only `getBuiltInAgents`).
 *
 * The naming convention reconcile: DB uses underscores (`cloud_operations`);
 * markdown filenames use hyphens (`cloud-operations.md`). The seeder maps
 * one to the other via `agentSlugToType` (hyphen → underscore).
 *
 * Pinned by [[feedback_db_is_sot_for_providers]] extended to agents.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma BEFORE importing the helper. The helper imports
// `../../utils/prisma.js` and we want the same mock to satisfy both the
// listAgentsFromDb helper AND any seeder code path the test triggers.
const mockAgentFindMany = vi.fn();
const mockAgentUpsert = vi.fn();

vi.mock('../../utils/prisma.js', () => {
  const prismaMock = {
    agent: {
      findMany: (...args: any[]) => mockAgentFindMany(...args),
      upsert: (...args: any[]) => mockAgentUpsert(...args),
    },
  };
  return {
    prisma: prismaMock,
    prismaBase: { $on: vi.fn(), $connect: vi.fn() },
  };
});

import { listAgentsFromDb } from '../listAgentsFromDb.js';
import { agentSlugToType, agentTypeToSlug } from '../agentSlugToType.js';
import { seedBuiltInAgentsToDb } from '../../startup/14-agent-md-to-db-seeder.js';
import { loadBuiltInAgents } from '../BuiltInAgentRegistry.js';
import * as path from 'node:path';

const BUILTIN_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'agents',
  'built-in',
);

const EIGHT_BUILT_IN_TYPES = [
  'planning',
  'synthesis',
  'validation',
  'reasoning',
  'cloud_operations',
  'artifact_creation',
  'data_query',
  'code_execution',
] as const;

describe('agentSlugToType / agentTypeToSlug (naming reconcile)', () => {
  it('converts hyphenated markdown slug to underscored DB type', () => {
    expect(agentSlugToType('cloud-operations')).toBe('cloud_operations');
    expect(agentSlugToType('artifact-creation')).toBe('artifact_creation');
    expect(agentSlugToType('planning')).toBe('planning');
  });

  it('round-trips type → slug → type', () => {
    for (const t of EIGHT_BUILT_IN_TYPES) {
      expect(agentSlugToType(agentTypeToSlug(t))).toBe(t);
    }
  });
});

describe('listAgentsFromDb (chatmode DB-backed registry)', () => {
  beforeEach(() => {
    mockAgentFindMany.mockReset();
    mockAgentUpsert.mockReset();
  });

  it('returns all is_default=true & enabled=true rows shaped for TaskTool', async () => {
    mockAgentFindMany.mockResolvedValueOnce([
      {
        id: 'a1',
        name: 'cloud_operations',
        display_name: 'Cloud Operations',
        description: 'Multi-step cloud audits across Azure/AWS/GCP/k8s.',
        agent_type: 'cloud_operations',
        system_prompt: 'You are a cloud-operations sub-agent...',
        tools_whitelist: ['azure_*', 'aws_*', 'gcp_*', 'k8s_*'],
        enabled: true,
        is_default: true,
      },
      {
        id: 'a2',
        name: 'planning',
        display_name: 'Planning',
        description: 'Decompose multi-step tasks into ordered plans.',
        agent_type: 'planning',
        system_prompt: 'You are a planning sub-agent...',
        tools_whitelist: [],
        enabled: true,
        is_default: true,
      },
    ]);
    const agents = await listAgentsFromDb();
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      agent_type: 'cloud_operations',
      display_name: 'Cloud Operations',
      tools: ['azure_*', 'aws_*', 'gcp_*', 'k8s_*'],
    });
    // body field is preserved (legacy field name used by makeRunSubagentViaRecursor)
    expect(typeof agents[0].body).toBe('string');
    expect(agents[0].body).toContain('cloud-operations sub-agent');
  });

  it('admin-created custom agent appears in the DB-backed list', async () => {
    mockAgentFindMany.mockResolvedValueOnce([
      {
        id: 'custom-1',
        name: 'test_finance_agent',
        display_name: 'Test Finance Agent',
        description: 'Custom admin-created finance specialist.',
        agent_type: 'test_finance_agent',
        system_prompt: 'You are a finance analyst sub-agent.',
        tools_whitelist: ['tool_search', 'aws_cost_by_service'],
        enabled: true,
        is_default: true,
      },
    ]);
    const agents = await listAgentsFromDb();
    expect(agents.map(a => a.agent_type)).toContain('test_finance_agent');
  });

  it('fails soft to empty array when prisma throws', async () => {
    mockAgentFindMany.mockRejectedValueOnce(new Error('connection refused'));
    const agents = await listAgentsFromDb();
    expect(agents).toEqual([]);
  });
});

describe('seedBuiltInAgentsToDb (boot seeder upserts 8 markdown agents)', () => {
  beforeEach(() => {
    mockAgentFindMany.mockReset();
    mockAgentUpsert.mockReset();
  });

  it('upserts one row per markdown file with agent_type underscored', async () => {
    mockAgentUpsert.mockResolvedValue({ id: 'x', name: 'x' });
    await seedBuiltInAgentsToDb({ dir: BUILTIN_DIR });
    expect(mockAgentUpsert).toHaveBeenCalledTimes(8);
    // Each call should have where:{name} + create:{agent_type underscored}
    const calls = mockAgentUpsert.mock.calls;
    const typesUpserted = calls
      .map((c: any[]) => c[0].create.agent_type)
      .sort();
    expect(typesUpserted).toEqual(
      [...EIGHT_BUILT_IN_TYPES].sort(),
    );
  });

  it('upsert payload carries system_prompt + tools_whitelist + is_default=true', async () => {
    mockAgentUpsert.mockResolvedValue({ id: 'x', name: 'x' });
    await seedBuiltInAgentsToDb({ dir: BUILTIN_DIR });
    // Validate a representative call (cloud_operations)
    const cloudCall = mockAgentUpsert.mock.calls.find(
      (c: any[]) => c[0].create.agent_type === 'cloud_operations',
    );
    expect(cloudCall).toBeDefined();
    const data = cloudCall![0];
    expect(data.where.name).toBe('cloud_operations');
    expect(data.create.is_default).toBe(true);
    expect(data.create.enabled).toBe(true);
    expect(typeof data.create.system_prompt).toBe('string');
    expect(data.create.system_prompt.length).toBeGreaterThan(400);
    expect(Array.isArray(data.create.tools_whitelist)).toBe(true);
    expect(data.create.tools_whitelist).toContain('azure_*');
    // update path preserves the same canonical fields
    expect(data.update.system_prompt).toBe(data.create.system_prompt);
    expect(data.update.tools_whitelist).toEqual(data.create.tools_whitelist);
  });

  it('seeder is idempotent — calling twice runs same upserts', async () => {
    mockAgentUpsert.mockResolvedValue({ id: 'x', name: 'x' });
    await seedBuiltInAgentsToDb({ dir: BUILTIN_DIR });
    const firstCount = mockAgentUpsert.mock.calls.length;
    await seedBuiltInAgentsToDb({ dir: BUILTIN_DIR });
    expect(mockAgentUpsert.mock.calls.length).toBe(firstCount * 2);
  });
});

describe('seeder source — markdown loader honours the 8 canonical built-ins', () => {
  it('loadBuiltInAgents returns the 8 expected hyphenated slugs', async () => {
    const entries = await loadBuiltInAgents(BUILTIN_DIR);
    const slugs = entries.map(e => e.agent_type).sort();
    expect(slugs).toEqual([
      'artifact-creation',
      'cloud-operations',
      'code-execution',
      'data-query',
      'planning',
      'reasoning',
      'synthesis',
      'validation',
    ]);
  });

  it('converting all 8 slugs via agentSlugToType produces the 8 canonical DB types', async () => {
    const entries = await loadBuiltInAgents(BUILTIN_DIR);
    const types = entries.map(e => agentSlugToType(e.agent_type)).sort();
    expect(types).toEqual([...EIGHT_BUILT_IN_TYPES].sort());
  });
});
