/**
 * Regression for #367: GET /llm-providers/health returned HTTP 503 whenever
 * ANY downstream provider was unhealthy. The UI's `if (response.ok)` then
 * dropped the body on the floor, leaving healthMap empty, leaving the header
 * to lie "0 healthy" even when 3/4 cards were green.
 *
 * The handler IS servicing the request — the body is intact and the `overall`
 * field already conveys degraded/healthy/down. 503 should be reserved for the
 * catch block (handler genuinely failed). Successful body assembly = 200.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Stub prisma so the DB augmentation block in the handler is a no-op.
vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    lLMProvider: { findMany: async () => [] },
  },
}));

import llmProviderRoutes from '../llm-providers.js';

function makeFakeProviderManager(entries: Array<[string, { status: 'healthy' | 'unhealthy'; endpoint?: string; error?: string; lastChecked?: string }]>) {
  return {
    providers: new Map(),
    getHealthStatus: async () => new Map(entries.map(([k, v]) => [k, { ...v, lastChecked: v.lastChecked ?? new Date().toISOString() }])),
    getMetrics: () => new Map(),
  } as any;
}

async function buildApp(pm: any): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request: any) => {
    request.user = { id: 'health-test-user', email: 'health@test' };
  });
  await app.register(llmProviderRoutes as any, { providerManager: pm, prefix: '/api/admin' });
  await app.ready();
  return app;
}

describe('GET /api/admin/llm-providers/health — status code semantics', () => {
  it('returns 200 with overall=healthy when every provider is healthy', async () => {
    const app = await buildApp(makeFakeProviderManager([
      ['ollama-hal', { status: 'healthy', endpoint: 'http://10.2.10.142:11434' }],
      ['aws-bedrock', { status: 'healthy' }],
    ]));
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.overall).toBe('healthy');
      expect(body.providers).toHaveLength(2);
      expect(body.providers.every((p: any) => p.healthy)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns 200 (NOT 503) with overall=degraded when some providers are unhealthy', async () => {
    const app = await buildApp(makeFakeProviderManager([
      ['ollama-hal', { status: 'healthy' }],
      ['vertex-ai', { status: 'unhealthy', error: 'Could not load default credentials' }],
      ['azure-ai-foundry-prod', { status: 'unhealthy', error: "Cannot read properties of undefined (reading 'includes')" }],
      ['aws-bedrock', { status: 'healthy' }],
    ]));
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.overall).toBe('degraded');
      const healthy = body.providers.filter((p: any) => p.healthy);
      const unhealthy = body.providers.filter((p: any) => !p.healthy);
      expect(healthy).toHaveLength(2);
      expect(unhealthy).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with overall=degraded even when all providers are unhealthy', async () => {
    const app = await buildApp(makeFakeProviderManager([
      ['ollama-hal', { status: 'unhealthy', error: 'connect ECONNREFUSED' }],
      ['aws-bedrock', { status: 'unhealthy', error: 'no creds' }],
    ]));
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.overall).toBe('degraded');
    } finally {
      await app.close();
    }
  });
});
