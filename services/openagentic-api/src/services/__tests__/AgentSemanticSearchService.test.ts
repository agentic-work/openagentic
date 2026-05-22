/**
 * AgentSemanticSearchService — TDD spec.
 *
 * Mirrors `ToolSemanticCacheService` shape but for the agent catalog.
 * Backed by a dedicated Milvus collection `mcp_agents_cache`. Reuses
 * `UniversalEmbeddingService` so embedding dim/model is consistent
 * across the platform.
 *
 * Contract:
 *  1. `init()` creates the collection if missing (with the agent
 *     schema), and loads it. If it already exists with the wrong
 *     embedding dimension, drop and recreate (matches the
 *     ToolSemanticCacheService recovery path).
 *  2. `upsertAgent(def)` embeds `name + description + role` and
 *     inserts/upserts the row keyed by id.
 *  3. `search(query, k=5)` embeds the query, COSINE-searches the
 *     collection, and returns the top-k AgentDefinition[] ordered by
 *     similarity.
 *  4. `search()` degrades gracefully: when not initialized OR Milvus
 *     throws, return [] instead of propagating.
 *
 * Plan: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSemanticSearchService, type AgentDefinition } from '../AgentSemanticSearchService.js';
import pino from 'pino';

// ---------------------------------------------------------------------------
// Test doubles — minimal Milvus client + embedding service
// ---------------------------------------------------------------------------

interface FakeMilvusOpts {
  /** does the collection exist already? */
  hasCollection?: boolean;
  /** existing embedding dim (string from Milvus describeCollection) */
  existingDim?: string | number;
  /** rows to return from search() ordered desc by similarity */
  searchHits?: Array<{
    id: string;
    agent_id: string;
    name: string;
    description: string;
    role: string;
    tools: string;
    score: number;
  }>;
  /** force search() to throw */
  searchThrows?: boolean;
}

function makeFakeMilvus(opts: FakeMilvusOpts = {}) {
  const calls: { name: string; args: any }[] = [];
  const record = (name: string, ret: any | (() => any)) =>
    vi.fn(async (args: any) => {
      calls.push({ name, args });
      if (typeof ret === 'function') return (ret as () => any)();
      return ret;
    });

  return {
    calls,
    checkHealth: record('checkHealth', { isHealthy: true }),
    hasCollection: record('hasCollection', { value: !!opts.hasCollection }),
    describeCollection: record('describeCollection', {
      schema: { fields: [{ name: 'embedding', dim: opts.existingDim ?? 768 }] },
    }),
    createCollection: record('createCollection', {}),
    dropCollection: record('dropCollection', {}),
    createIndex: record('createIndex', {}),
    loadCollection: record('loadCollection', {}),
    getLoadState: record('getLoadState', { state: 'LoadStateLoaded' }),
    flush: record('flush', { status: { error_code: 'Success' } }),
    insert: record('insert', { insert_cnt: 1 }),
    upsert: record('upsert', { upsert_cnt: 1 }),
    delete: record('delete', {}),
    search: vi.fn(async (args: any) => {
      calls.push({ name: 'search', args });
      if (opts.searchThrows) throw new Error('milvus search exploded');
      const hits = (opts.searchHits ?? []).map(h => ({ ...h }));
      return { results: hits };
    }),
  };
}

function makeFakeEmbedding(dim = 768) {
  return {
    isConfigured: vi.fn(async () => true),
    getInfo: () => ({ dimensions: dim, model: 'fake-embed-v1' }),
    generateEmbedding: vi.fn(async (text: string) => ({
      embedding: new Array(dim).fill(0).map((_, i) => (text.length + i) % 7),
      tokens: text.split(/\s+/).length,
    })),
  };
}

const sampleAgent: AgentDefinition = {
  id: 'code-reviewer',
  agent_id: 'code-reviewer',
  name: 'Code Reviewer',
  description: 'Reviews source code for bugs, security, and style issues.',
  role: 'reviewer',
  tools: ['Read', 'Grep', 'Glob'],
};

const silentLogger = pino({ level: 'silent' }) as any;

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('AgentSemanticSearchService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('init() creates mcp_agents_cache collection when missing', async () => {
    const milvus = makeFakeMilvus({ hasCollection: false });
    const embed = makeFakeEmbedding(768);
    const svc = new AgentSemanticSearchService({
      milvusClient: milvus as any,
      embeddingService: embed as any,
      logger: silentLogger,
    });

    await svc.init();

    expect(milvus.hasCollection).toHaveBeenCalledWith({
      collection_name: 'mcp_agents_cache',
    });
    expect(milvus.createCollection).toHaveBeenCalled();
    const createArgs = milvus.createCollection.mock.calls[0][0];
    expect(createArgs.collection_name).toBe('mcp_agents_cache');
    // schema must include core fields
    const fieldNames = createArgs.fields.map((f: any) => f.name);
    for (const required of ['id', 'agent_id', 'name', 'description', 'role', 'tools', 'embedding']) {
      expect(fieldNames).toContain(required);
    }
    expect(svc.isInitialized).toBe(true);
  });

  it('init() loads collection when it already exists with matching dim', async () => {
    const milvus = makeFakeMilvus({ hasCollection: true, existingDim: 768 });
    const embed = makeFakeEmbedding(768);
    const svc = new AgentSemanticSearchService({
      milvusClient: milvus as any,
      embeddingService: embed as any,
      logger: silentLogger,
    });

    await svc.init();

    expect(milvus.createCollection).not.toHaveBeenCalled();
    expect(milvus.loadCollection).toHaveBeenCalledWith({
      collection_name: 'mcp_agents_cache',
    });
    expect(svc.isInitialized).toBe(true);
  });

  it('init() drops + recreates collection when dimensions mismatch', async () => {
    const milvus = makeFakeMilvus({ hasCollection: true, existingDim: '512' });
    const embed = makeFakeEmbedding(768); // we want 768 → mismatch
    const svc = new AgentSemanticSearchService({
      milvusClient: milvus as any,
      embeddingService: embed as any,
      logger: silentLogger,
    });

    await svc.init();

    expect(milvus.dropCollection).toHaveBeenCalledWith({
      collection_name: 'mcp_agents_cache',
    });
    expect(milvus.createCollection).toHaveBeenCalled();
  });

  it('upsertAgent embeds description + name + role and writes a row', async () => {
    const milvus = makeFakeMilvus({ hasCollection: true, existingDim: 768 });
    const embed = makeFakeEmbedding(768);
    const svc = new AgentSemanticSearchService({
      milvusClient: milvus as any,
      embeddingService: embed as any,
      logger: silentLogger,
    });
    await svc.init();

    await svc.upsertAgent(sampleAgent);

    // Embedding must have been generated from a payload that contains
    // name + description + role (so search recall is decent).
    expect(embed.generateEmbedding).toHaveBeenCalled();
    const embedInput: string = embed.generateEmbedding.mock.calls[0][0];
    expect(embedInput).toContain(sampleAgent.name);
    expect(embedInput).toContain(sampleAgent.description);
    expect(embedInput).toContain(sampleAgent.role);

    // Either `upsert` or `insert` is acceptable as long as the row was written.
    const writeCalled =
      milvus.upsert.mock.calls.length > 0 || milvus.insert.mock.calls.length > 0;
    expect(writeCalled).toBe(true);
  });

  it('search() returns AgentDefinition[] ordered by similarity', async () => {
    const milvus = makeFakeMilvus({
      hasCollection: true,
      existingDim: 768,
      searchHits: [
        {
          id: 'reviewer-1', agent_id: 'code-reviewer',
          name: 'Code Reviewer', description: 'Bug + style review',
          role: 'reviewer', tools: 'Read,Grep,Glob', score: 0.92,
        },
        {
          id: 'security-1', agent_id: 'security-auditor',
          name: 'Security Auditor', description: 'Static analysis for CVEs',
          role: 'auditor', tools: 'Read,Grep', score: 0.71,
        },
      ],
    });
    const embed = makeFakeEmbedding(768);
    const svc = new AgentSemanticSearchService({
      milvusClient: milvus as any,
      embeddingService: embed as any,
      logger: silentLogger,
    });
    await svc.init();

    const hits = await svc.search('looking for a code reviewer', 5);

    expect(hits.length).toBe(2);
    expect(hits[0].id).toBe('reviewer-1');
    expect(hits[0].agent_id).toBe('code-reviewer');
    expect(hits[0].name).toBe('Code Reviewer');
    expect(Array.isArray(hits[0].tools)).toBe(true);
    expect(hits[0].tools).toContain('Read');
    expect(hits[1].id).toBe('security-1');
  });

  it('search() degrades to [] when not initialized', async () => {
    const milvus = makeFakeMilvus();
    const embed = makeFakeEmbedding(768);
    const svc = new AgentSemanticSearchService({
      milvusClient: milvus as any,
      embeddingService: embed as any,
      logger: silentLogger,
    });
    // NO init()
    const hits = await svc.search('anything', 5);
    expect(hits).toEqual([]);
  });

  it('search() degrades to [] when Milvus throws', async () => {
    const milvus = makeFakeMilvus({
      hasCollection: true,
      existingDim: 768,
      searchThrows: true,
    });
    const embed = makeFakeEmbedding(768);
    const svc = new AgentSemanticSearchService({
      milvusClient: milvus as any,
      embeddingService: embed as any,
      logger: silentLogger,
    });
    await svc.init();

    const hits = await svc.search('hard query', 3);
    expect(hits).toEqual([]);
  });
});
