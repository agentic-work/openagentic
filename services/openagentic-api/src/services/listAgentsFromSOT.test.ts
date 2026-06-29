/**
 * listAgentsFromSOT — unit tests for the shared agent-list helper.
 *
 * Verifies:
 *   - DB-only agents are appended when not present in openagentic-proxy
 *   - DB fields override on overlap (DB is authoritative)
 *   - redactSensitive strips prompt/tool fields for non-admin callers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock prisma + fetch BEFORE importing the module under test
vi.mock('../utils/prisma.js', () => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  loggers: {
    routes: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { prisma } from '../utils/prisma.js';

describe('listAgentsFromSOT', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [] }),
    }));
    (prisma.agent.findMany as any).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends DB-only agents when proxy returns nothing', async () => {
    (prisma.agent.findMany as any).mockResolvedValueOnce([
      {
        id: 'db-1',
        name: 'researcher',
        display_name: 'Researcher',
        description: 'researches',
        agent_type: 'reasoning',
        model_config: { primaryModel: 'auto' },
        system_prompt: 'You are…',
        tools_whitelist: ['web_search'],
        skills: [],
        delegation: null,
        background: null,
        category: 'platform',
        tags: [],
        enabled: true,
        created_at: new Date('2026-01-01'),
      },
    ]);

    const { listAgentsFromSOT } = await import('./listAgentsFromSOT');
    const agents = await listAgentsFromSOT();

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('db-1');
    expect(agents[0].display_name).toBe('Researcher');
    expect(agents[0].system_prompt).toBe('You are…');
  });

  it('redactSensitive=true strips prompt/tool fields', async () => {
    (prisma.agent.findMany as any).mockResolvedValueOnce([
      {
        id: 'db-1',
        name: 'researcher',
        display_name: 'Researcher',
        agent_type: 'reasoning',
        model_config: { primaryModel: 'auto' },
        system_prompt: 'SECRET PROMPT',
        tools_whitelist: ['web_search'],
        skills: ['rag'],
        delegation: { mode: 'auto' },
        background: 'long brief',
        prompt_strategy: 'modular',
        prompt_modules: ['intro', 'rules'],
        prompt_mode: 'strict',
        category: 'platform',
        tags: [],
        enabled: true,
        created_at: new Date('2026-01-01'),
      },
    ]);

    const { listAgentsFromSOT } = await import('./listAgentsFromSOT');
    const agents = await listAgentsFromSOT({ redactSensitive: true });

    expect(agents[0]).not.toHaveProperty('system_prompt');
    expect(agents[0]).not.toHaveProperty('tools_whitelist');
    expect(agents[0]).not.toHaveProperty('skills');
    expect(agents[0]).not.toHaveProperty('delegation');
    expect(agents[0]).not.toHaveProperty('background');
    expect(agents[0]).not.toHaveProperty('prompt_modules');
    expect(agents[0]).not.toHaveProperty('prompt_strategy');
    expect(agents[0]).not.toHaveProperty('prompt_mode');
    // Public fields preserved
    expect(agents[0].id).toBe('db-1');
    expect(agents[0].display_name).toBe('Researcher');
    expect(agents[0].agent_type).toBe('reasoning');
    expect(agents[0].model_config).toEqual({ primaryModel: 'auto' });
  });

  it('DB fields override proxy on overlap (DB is authoritative)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agents: [
          {
            id: 'proxy-key',
            role: 'reasoning',
            agent_type: 'reasoning',
            name: 'Proxy Reasoning',
            prompt_strategy: 'old',
          },
        ],
      }),
    }));
    (prisma.agent.findMany as any).mockResolvedValueOnce([
      {
        id: 'db-uuid-42',
        name: 'reasoning',
        agent_type: 'reasoning',
        display_name: 'DB Reasoning',
        prompt_strategy: 'new',
        max_spawn_depth: 5,
        max_children: 3,
      },
    ]);

    const { listAgentsFromSOT } = await import('./listAgentsFromSOT');
    const agents = await listAgentsFromSOT();

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('db-uuid-42');
    expect(agents[0].db_id).toBe('db-uuid-42');
    expect(agents[0].prompt_strategy).toBe('new');
    expect(agents[0].max_spawn_depth).toBe(5);
  });

  it('returns empty array when both sources fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('proxy down')));
    (prisma.agent.findMany as any).mockRejectedValueOnce(new Error('db down'));

    const { listAgentsFromSOT } = await import('./listAgentsFromSOT');
    const agents = await listAgentsFromSOT();

    expect(agents).toEqual([]);
  });
});
