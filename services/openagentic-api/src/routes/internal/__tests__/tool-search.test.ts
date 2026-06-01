/**
 * 2026-05-02 — Internal tool-search route used by mcp-proxy to power the
 * Milvus-backed `tool_search` synthetic MCP tool. Wraps
 * ToolSemanticCacheService.searchToolsAsOpenAIFunctions.
 *
 * Auth: x-internal-secret header (env INTERNAL_SERVICE_SECRET). 401 on
 * missing/wrong secret — fail-closed when env is empty.
 *
 * Spec: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerInternalToolSearchRoute } from '../tool-search.js';

const SECRET = 'unit-test-tool-search-secret';

interface FakeOpenAIFunction {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const FAKE_TOOLS: FakeOpenAIFunction[] = [
  {
    type: 'function',
    function: {
      name: 'azure_list_resource_groups',
      description: 'List Azure resource groups in a subscription.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'azure_list_deployments',
      description: 'List Azure Cognitive Services model deployments.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aws_list_buckets',
      description: 'List S3 buckets.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

async function buildApp(opts: {
  internalSecret?: string;
  searchService: { searchToolsAsOpenAIFunctions: ReturnType<typeof vi.fn> } | null;
  getConnectedServers?: () => Promise<string[]> | string[];
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerInternalToolSearchRoute(app, {
    internalSecret: opts.internalSecret ?? SECRET,
    getSearchService: () => opts.searchService as any,
    ...(opts.getConnectedServers ? { getConnectedServers: opts.getConnectedServers } : {}),
  });
  await app.ready();
  return app;
}

describe('POST /api/internal/tool-search', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when x-internal-secret header is missing', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_TOOLS);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 3 },
    });
    expect(res.statusCode).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('401 when x-internal-secret value is wrong', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_TOOLS);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 3 },
      headers: { 'x-internal-secret': 'wrong-secret' },
    });
    expect(res.statusCode).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('401 when server-side internal secret is empty (fail-closed)', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_TOOLS);
    app = await buildApp({
      internalSecret: '',
      searchService: { searchToolsAsOpenAIFunctions: search },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 3 },
      headers: { 'x-internal-secret': 'anything' },
    });
    expect(res.statusCode).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('200 + tools array on happy path', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_TOOLS);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure cognitive services', k: 5 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: FakeOpenAIFunction[] };
    expect(body.tools).toEqual(FAKE_TOOLS);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('503 when ToolSemanticCacheService is null/uninitialized', async () => {
    app = await buildApp({ searchService: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 3 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error?: string };
    expect(body.error).toMatch(/not initialized/i);
  });

  it('400 when body is missing the required `query` field', async () => {
    const search = vi.fn().mockResolvedValue([]);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { k: 3 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('passes query, k, and serverFilter through to the service', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_TOOLS.slice(0, 2));
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure deployments', k: 5, serverFilter: 'azure' },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    // Q1-fix-2 (2026-05-12) — search service signature gained an optional
    // 4th `userPromptHint` arg. Omitted-by-caller bodies pass undefined.
    expect(search).toHaveBeenCalledWith('azure deployments', 5, 'azure', undefined);
  });

  it('uses default k=8 when omitted', async () => {
    const search = vi.fn().mockResolvedValue([]);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'aws s3' },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith('aws s3', 8, undefined, undefined);
  });

  it('forwards userPromptHint to the service when present in body', async () => {
    const search = vi.fn().mockResolvedValue([]);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const userPromptHint =
      'Our cloud bill is up 40% MoM. Find top cost spikes across Azure/AWS/GCP.';
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'Azure cost query tool', k: 8, userPromptHint },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith(
      'Azure cost query tool',
      8,
      undefined,
      userPromptHint,
    );
  });

  // #51 (2026-06-01) — connectedServers in the 200 body.
  it('includes connectedServers in the 200 body when getConnectedServers is wired (empty match)', async () => {
    const search = vi.fn().mockResolvedValue([]);
    app = await buildApp({
      searchService: { searchToolsAsOpenAIFunctions: search },
      getConnectedServers: () => ['openagentic_web', 'aws_knowledge'],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 5 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: unknown[]; connectedServers?: string[] };
    expect(body.tools).toEqual([]);
    expect(body.connectedServers).toEqual(['openagentic_web', 'aws_knowledge']);
  });

  it('resolves an async getConnectedServers and still returns real tools (no regression to shape)', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_TOOLS);
    app = await buildApp({
      searchService: { searchToolsAsOpenAIFunctions: search },
      getConnectedServers: async () => ['openagentic_web'],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 5 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: unknown[]; connectedServers?: string[] };
    expect(body.tools).toEqual(FAKE_TOOLS);
    expect(body.connectedServers).toEqual(['openagentic_web']);
  });

  it('omits connectedServers field when getConnectedServers is not wired (legacy shape)', async () => {
    const search = vi.fn().mockResolvedValue(FAKE_TOOLS);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 5 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: unknown[]; connectedServers?: string[] };
    expect(body.tools).toEqual(FAKE_TOOLS);
    expect(body).not.toHaveProperty('connectedServers');
  });

  it('omits connectedServers when getConnectedServers throws (best-effort, never 500s)', async () => {
    const search = vi.fn().mockResolvedValue([]);
    app = await buildApp({
      searchService: { searchToolsAsOpenAIFunctions: search },
      getConnectedServers: () => {
        throw new Error('proxy unreachable');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 5 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: unknown[]; connectedServers?: string[] };
    expect(body.tools).toEqual([]);
    expect(body).not.toHaveProperty('connectedServers');
  });

  it('500 with scrubbed error when service throws — no Prisma/stack leakage', async () => {
    const boom = new Error('Milvus collection mcp_tools_cache not loaded — Prisma stacktrace at /app/src/services/ToolSemanticCacheService.ts:1571');
    const search = vi.fn().mockRejectedValue(boom);
    app = await buildApp({ searchService: { searchToolsAsOpenAIFunctions: search } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/tool-search',
      payload: { query: 'azure', k: 3 },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(500);
    const raw = res.body;
    expect(raw).not.toContain('Prisma');
    expect(raw).not.toContain('ToolSemanticCacheService.ts');
    const body = res.json() as { error: string };
    expect(body.error).toBe('tool_search_failed');
  });
});
