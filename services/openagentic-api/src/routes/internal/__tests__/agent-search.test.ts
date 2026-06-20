/**
 * 2026-05-02 — Internal agent-search route used by openagentic-proxy to power
 * the Milvus-backed `agent_search` synthetic meta-tool. Wraps
 * AgentSemanticSearchService.search().
 *
 * Auth: x-internal-secret header (env INTERNAL_SERVICE_SECRET). 401 on
 * missing/wrong secret — fail-closed when env is empty (matches the
 * sibling tool-search route).
 *
 * the design notes
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerInternalAgentSearchRoute } from '../agent-search.js';

const SECRET = 'unit-test-agent-search-secret';

interface FakeAgentDef {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  role: string;
  tools: string[];
}

const FAKE_AGENTS: FakeAgentDef[] = [
  {
    id: 'code-reviewer',
    agent_id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reviews source code for bugs and style issues.',
    role: 'reviewer',
    tools: ['Read', 'Grep'],
  },
  {
    id: 'security-auditor',
    agent_id: 'security-auditor',
    name: 'Security Auditor',
    description: 'Static analysis for known CVE patterns.',
    role: 'auditor',
    tools: ['Read', 'Grep', 'Glob'],
  },
];

async function buildApp(opts: {
  internalSecret?: string;
  searchService: { search: ReturnType<typeof vi.fn> } | null;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerInternalAgentSearchRoute(app, {
    internalSecret: opts.internalSecret ?? SECRET,
    getSearchService: () => opts.searchService as any,
  });
  await app.ready();
  return app;
}

describe('POST /api/internal/agent-search', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when x-internal-secret header is missing', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_AGENTS);
    app = await buildApp({ searchService: { search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { query: 'reviewer', k: 3 },
    });
    expect(res.statusCode).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('401 when x-internal-secret value is wrong', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_AGENTS);
    app = await buildApp({ searchService: { search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { query: 'reviewer', k: 3 },
      headers: { 'x-internal-secret': 'wrong-secret' },
    });
    expect(res.statusCode).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('401 when server-side secret is empty (fail-closed)', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_AGENTS);
    app = await buildApp({
      internalSecret: '',
      searchService: { search },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { query: 'reviewer', k: 3 },
      headers: { 'x-internal-secret': 'anything' },
    });
    expect(res.statusCode).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('200 + agents array on happy path with default k', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_AGENTS);
    app = await buildApp({ searchService: { search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { query: 'code reviewer' },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agents: FakeAgentDef[]; count: number };
    expect(body.agents).toEqual(FAKE_AGENTS);
    expect(body.count).toBe(FAKE_AGENTS.length);
    expect(search).toHaveBeenCalledTimes(1);
    // Default k=5 when not specified.
    expect(search).toHaveBeenCalledWith('code reviewer', 5);
  });

  it('passes query and k through to the service', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_AGENTS.slice(0, 1));
    app = await buildApp({ searchService: { search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { query: 'security audit', k: 3 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith('security audit', 3);
  });

  it('400 when body is missing the required `query` field', async () => {
    const search = vi.fn().mockResolvedValue([]);
    app = await buildApp({ searchService: { search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { k: 3 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('503 when the service singleton is null (uninitialized)', async () => {
    app = await buildApp({ searchService: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { query: 'reviewer', k: 3 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error?: string };
    expect(body.error).toMatch(/not initialized/i);
  });

  it('500 with scrubbed error when service throws — no Milvus/Prisma leakage', async () => {
    const boom = new Error(
      'Milvus collection mcp_agents_cache not loaded — Prisma stacktrace at /app/src/services/AgentSemanticSearchService.ts:218',
    );
    const search = vi.fn().mockRejectedValue(boom);
    app = await buildApp({ searchService: { search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/agent-search',
      payload: { query: 'reviewer', k: 3 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(500);
    const raw = res.body;
    expect(raw).not.toContain('Prisma');
    expect(raw).not.toContain('AgentSemanticSearchService.ts');
    const body = res.json() as { error: string };
    expect(body.error).toBe('agent_search_failed');
  });
});
