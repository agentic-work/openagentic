/**
 * agentRegistryApi — TDD-driven SOT-only agent fetcher.
 *
 * The Admin console agent registry (prisma.agent via /api/admin/agents) is
 * the single source of truth for agents in Flows. /api/workflows/agents was
 * a parallel registry that hit openagentic-proxy and skipped the DB — we are
 * collapsing on the SOT path only.
 *
 * Iron-law TDD: RED tests first, watched fail, minimal impl, watch pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('agentRegistryApi — SOT-only', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('RED 1: hits /api/admin/agents (the SOT) and never /api/workflows/agents', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agents: [
          { id: 'agent_1', display_name: 'Researcher', agent_type: 'specialist', model_config: { primaryModel: 'claude-3-7-sonnet' } },
        ],
      }),
    });

    const { fetchAgents } = await import('../agentRegistryApi');
    await fetchAgents();

    const calledUrls = fetchMock.mock.calls.map(c => c[0]);
    expect(calledUrls).toContain('/api/admin/agents');
    expect(calledUrls).not.toContain('/api/workflows/agents');
  });

  it('RED 2: maps agent shape to {id, display_name, agent_type, model}', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agents: [
          { id: 'a1', display_name: 'Alpha', agent_type: 'core', model_config: { primaryModel: 'opus-4' } },
          { id: 'a2', name: 'Beta', role: 'analyst', model: 'sonnet-4' },
        ],
      }),
    });

    const { fetchAgents } = await import('../agentRegistryApi');
    const agents = await fetchAgents();

    expect(agents).toEqual([
      { id: 'a1', display_name: 'Alpha', agent_type: 'core', model: 'opus-4' },
      { id: 'a2', display_name: 'Beta', agent_type: 'analyst', model: 'sonnet-4' },
    ]);
  });

  it('RED 3: returns empty array if fetch fails (network)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));

    const { fetchAgents } = await import('../agentRegistryApi');
    const agents = await fetchAgents();

    expect(agents).toEqual([]);
  });

  it('RED 4: returns empty array if response is non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const { fetchAgents } = await import('../agentRegistryApi');
    const agents = await fetchAgents();

    expect(agents).toEqual([]);
  });

  it('RED 5: forwards Authorization header when provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ agents: [] }) });

    const { fetchAgents } = await import('../agentRegistryApi');
    await fetchAgents({ Authorization: 'Bearer token-xyz' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-xyz' });
  });

  it('RED 6: caches result for 60s — second call within window does not re-fetch', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: [{ id: 'a1', display_name: 'A', agent_type: 'core' }] }),
    });

    const mod = await import('../agentRegistryApi');
    await mod.fetchAgents();
    await mod.fetchAgents();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
