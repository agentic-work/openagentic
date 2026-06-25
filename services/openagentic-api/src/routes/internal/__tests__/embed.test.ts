/**
 * 2026-05-22 — #1060: Internal embed route used by mcp-proxy to power the
 * mcp_tools indexer. Wraps UniversalEmbeddingService.generateBatchEmbeddings
 * so the proxy stays provider-agnostic (Bedrock/AIF/Vertex/Ollama — whatever
 * has the embedding role assigned in the registry).
 *
 * Auth: x-internal-secret header (env INTERNAL_SERVICE_SECRET). 401 on
 * missing/wrong secret — fail-closed when env is empty.
 *
 * Spec: see #1059 architectural rip + embedding-via-api decision 2026-05-22.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerInternalEmbedRoute } from '../embed.js';

const SECRET = 'unit-test-embed-secret';

interface FakeBatchResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  provider: string;
}

const FAKE_RESULT: FakeBatchResult = {
  embeddings: [
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
  ],
  model: 'nomic-embed-text',
  dimensions: 768,
  provider: 'ollama',
};

async function buildApp(opts: {
  internalSecret?: string;
  embedService: { generateBatchEmbeddings: ReturnType<typeof vi.fn> } | null;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerInternalEmbedRoute(app, {
    internalSecret: opts.internalSecret ?? SECRET,
    getEmbedService: () => opts.embedService as any,
  });
  await app.ready();
  return app;
}

describe('POST /api/internal/embed', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when x-internal-secret header is missing', async () => {
    const embed = vi.fn().mockResolvedValue(FAKE_RESULT);
    app = await buildApp({ embedService: { generateBatchEmbeddings: embed } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: { texts: ['hello', 'world'] },
    });
    expect(res.statusCode).toBe(401);
    expect(embed).not.toHaveBeenCalled();
  });

  it('401 when x-internal-secret value is wrong', async () => {
    const embed = vi.fn().mockResolvedValue(FAKE_RESULT);
    app = await buildApp({ embedService: { generateBatchEmbeddings: embed } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: { texts: ['hello'] },
      headers: { 'x-internal-secret': 'wrong-secret' },
    });
    expect(res.statusCode).toBe(401);
    expect(embed).not.toHaveBeenCalled();
  });

  it('401 when server-side internal secret is empty (fail-closed)', async () => {
    const embed = vi.fn().mockResolvedValue(FAKE_RESULT);
    app = await buildApp({
      internalSecret: '',
      embedService: { generateBatchEmbeddings: embed },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: { texts: ['hello'] },
      headers: { 'x-internal-secret': 'anything' },
    });
    expect(res.statusCode).toBe(401);
    expect(embed).not.toHaveBeenCalled();
  });

  it('200 + {embeddings, model, dimensions, provider} on happy path', async () => {
    const embed = vi.fn().mockResolvedValue(FAKE_RESULT);
    app = await buildApp({ embedService: { generateBatchEmbeddings: embed } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: { texts: ['hello', 'world'] },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FakeBatchResult;
    expect(body.embeddings).toEqual(FAKE_RESULT.embeddings);
    expect(body.model).toBe(FAKE_RESULT.model);
    expect(body.dimensions).toBe(FAKE_RESULT.dimensions);
    expect(body.provider).toBe(FAKE_RESULT.provider);
    expect(embed).toHaveBeenCalledWith(['hello', 'world']);
  });

  it('503 when UniversalEmbeddingService is null/uninitialized', async () => {
    app = await buildApp({ embedService: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: { texts: ['hello'] },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error?: string };
    expect(body.error).toMatch(/not initialized/i);
  });

  it('400 when body is missing the required `texts` field', async () => {
    const embed = vi.fn().mockResolvedValue(FAKE_RESULT);
    app = await buildApp({ embedService: { generateBatchEmbeddings: embed } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: {},
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(400);
    expect(embed).not.toHaveBeenCalled();
  });

  it('400 when texts is empty array', async () => {
    const embed = vi.fn().mockResolvedValue(FAKE_RESULT);
    app = await buildApp({ embedService: { generateBatchEmbeddings: embed } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: { texts: [] },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(400);
    expect(embed).not.toHaveBeenCalled();
  });

  it('500 with scrubbed error when service throws — no provider/stack leakage', async () => {
    const boom = new Error('Bedrock InvokeModel failed at /app/src/services/UniversalEmbeddingService.ts:789 — credentials expired');
    const embed = vi.fn().mockRejectedValue(boom);
    app = await buildApp({ embedService: { generateBatchEmbeddings: embed } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/embed',
      payload: { texts: ['hello'] },
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(500);
    const raw = res.body;
    expect(raw).not.toContain('credentials expired');
    expect(raw).not.toContain('UniversalEmbeddingService.ts');
    const body = res.json() as { error: string };
    expect(body.error).toBe('embed_failed');
  });
});
