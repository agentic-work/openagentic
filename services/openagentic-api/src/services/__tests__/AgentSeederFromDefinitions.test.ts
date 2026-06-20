/**
 * AgentSeederFromDefinitions — TDD spec.
 *
 * On boot the api-side service pulls the canonical agent catalog from
 * openagentic-proxy (`GET /api/agents/definitions`) — built-ins + DB-backed
 * agents merged via the existing definitions route. Each row is
 * upserted into the Milvus `mcp_agents_cache` collection so the
 * synthetic `agent_search` meta-tool can find them.
 *
 * Contract:
 *  1. `seedFromOpenAgenticProxy()` fetches the catalog + upserts every agent.
 *     Returns {seeded, skipped, errors}.
 *  2. Idempotent — re-runs upsert the same rows without error.
 *  3. Network failures degrade to {seeded: 0, errors: [...]} — never throws.
 *  4. The seeder calls `AgentSemanticSearchService.upsertAgent` for each
 *     definition that has a non-empty description (the embedding requires
 *     content; agents with no description are skipped).
 *
 * the design notes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSeederFromDefinitions } from '../AgentSeederFromDefinitions.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' }) as any;

const FAKE_DEFINITIONS = [
  {
    id: 'research',
    name: 'Research Agent',
    description: 'Performs literature reviews and citation lookup.',
    role: 'reasoning',
    tools: ['web_search', 'web_fetch'],
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    description: 'Runs SQL queries against Postgres.',
    role: 'data_query',
    tools: ['admin_postgres_raw_query'],
  },
  {
    id: 'no-description-agent',
    name: 'Empty Agent',
    description: '', // skip — embedding payload would be useless
    role: 'custom',
    tools: [],
  },
];

function makeFakeFetch(responder: () => Response | Promise<Response>) {
  return vi.fn(async (_url: any, _init?: any) => responder());
}

function makeFakeSearchService() {
  return {
    upsertAgent: vi.fn(async (_def: any) => {}),
  };
}

describe('AgentSeederFromDefinitions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('seedFromOpenAgenticProxy upserts every definition with a non-empty description', async () => {
    const fetchImpl = makeFakeFetch(() =>
      new Response(JSON.stringify({ agents: FAKE_DEFINITIONS }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const search = makeFakeSearchService();

    const seeder = new AgentSeederFromDefinitions({
      openagenticProxyUrl: 'http://openagentic-proxy:3300',
      internalKey: 'k',
      searchService: search as any,
      fetchImpl: fetchImpl as any,
      logger: silentLogger,
    });

    const result = await seeder.seedFromOpenAgenticProxy();

    // Two of three should be upserted (third has empty description).
    expect(result.seeded).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
    expect(search.upsertAgent).toHaveBeenCalledTimes(2);

    // First call shape sanity: agent_id derived from id, tools array preserved.
    const firstCall = search.upsertAgent.mock.calls[0][0];
    expect(firstCall.agent_id).toBe('research');
    expect(firstCall.id).toBe('research');
    expect(firstCall.tools).toEqual(['web_search', 'web_fetch']);
  });

  it('is idempotent — running twice produces the same upserts (the search service handles dedup)', async () => {
    const fetchImpl = makeFakeFetch(() =>
      new Response(JSON.stringify({ agents: FAKE_DEFINITIONS }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const search = makeFakeSearchService();

    const seeder = new AgentSeederFromDefinitions({
      openagenticProxyUrl: 'http://openagentic-proxy:3300',
      internalKey: 'k',
      searchService: search as any,
      fetchImpl: fetchImpl as any,
      logger: silentLogger,
    });

    const r1 = await seeder.seedFromOpenAgenticProxy();
    const r2 = await seeder.seedFromOpenAgenticProxy();

    expect(r1.seeded).toBe(2);
    expect(r2.seeded).toBe(2);
    // Second run also calls upsert — service-side it's a no-op (delete+insert by id).
    expect(search.upsertAgent).toHaveBeenCalledTimes(4);
  });

  it('degrades gracefully on openagentic-proxy network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const search = makeFakeSearchService();

    const seeder = new AgentSeederFromDefinitions({
      openagenticProxyUrl: 'http://openagentic-proxy:3300',
      internalKey: 'k',
      searchService: search as any,
      fetchImpl: fetchImpl as any,
      logger: silentLogger,
    });

    const result = await seeder.seedFromOpenAgenticProxy();
    expect(result.seeded).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(search.upsertAgent).not.toHaveBeenCalled();
  });

  it('degrades gracefully on openagentic-proxy 5xx', async () => {
    const fetchImpl = makeFakeFetch(() =>
      new Response('upstream broken', { status: 503 }),
    );
    const search = makeFakeSearchService();

    const seeder = new AgentSeederFromDefinitions({
      openagenticProxyUrl: 'http://openagentic-proxy:3300',
      internalKey: 'k',
      searchService: search as any,
      fetchImpl: fetchImpl as any,
      logger: silentLogger,
    });

    const result = await seeder.seedFromOpenAgenticProxy();
    expect(result.seeded).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('continues seeding when one upsert throws — collects errors', async () => {
    const fetchImpl = makeFakeFetch(() =>
      new Response(JSON.stringify({ agents: FAKE_DEFINITIONS }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const search = {
      upsertAgent: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('milvus exploded')),
    };

    const seeder = new AgentSeederFromDefinitions({
      openagenticProxyUrl: 'http://openagentic-proxy:3300',
      internalKey: 'k',
      searchService: search as any,
      fetchImpl: fetchImpl as any,
      logger: silentLogger,
    });

    const result = await seeder.seedFromOpenAgenticProxy();
    expect(result.seeded).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/milvus exploded|data-analyst/);
  });
});
