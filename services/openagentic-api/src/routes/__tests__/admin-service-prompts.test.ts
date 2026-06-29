/**
 * W.6 — admin-service-prompts route tests.
 *
 * Verifies that:
 *   GET /api/admin/service-prompts          → lists all active prompt keys
 *   GET /api/admin/service-prompts/:key     → returns body for a key
 *   POST /api/admin/service-prompts/:key    → saves new version + publishes invalidation
 *   GET /api/admin/service-prompts/:key/versions → version history
 *
 * Sprint W — 2026-05-19
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { adminServicePromptsRoutes } from '../admin-service-prompts.js';
import { __resetServicePromptCacheForTests } from '../../services/prompt/ServicePromptService.js';

function makeFakeService(rows: Array<{ prompt_key: string; body: string; version: number; is_active: boolean }> = []) {
  const store = [...rows];
  return {
    listKeys: vi.fn(async () =>
      store
        .filter((r) => r.is_active)
        .map((r) => ({
          prompt_key: r.prompt_key,
          version: r.version,
          updated_at: new Date(),
          description: null,
          preview: r.body.slice(0, 200),
        })),
    ),
    getPrompt: vi.fn(async (key: string) => {
      const row = store.find((r) => r.prompt_key === key && r.is_active);
      if (!row) throw new Error(`No active service_prompt for key '${key}'`);
      return row.body;
    }),
    setPrompt: vi.fn(async (key: string, body: string) => {
      const existing = store.find((r) => r.prompt_key === key && r.is_active);
      if (existing) existing.is_active = false;
      const newRow = { prompt_key: key, body, version: (existing?.version ?? 0) + 1, is_active: true };
      store.push(newRow);
      return { ...newRow, id: 'uuid-1', created_at: new Date(), updated_at: new Date() };
    }),
    listVersions: vi.fn(async (key: string) =>
      store
        .filter((r) => r.prompt_key === key)
        .map((r) => ({ ...r, id: 'uuid-1', body_preview: r.body.slice(0, 200), body_chars: r.body.length, created_at: new Date(), updated_at: new Date() })),
    ),
    rollback: vi.fn(async (key: string, targetVersion: number) => {
      const target = store.find((r) => r.prompt_key === key && r.version === targetVersion);
      if (!target) throw new Error(`No service_prompt for key='${key}' version=${targetVersion}.`);
      store.forEach((r) => { if (r.prompt_key === key) r.is_active = false; });
      target.is_active = true;
      return { ...target, id: 'uuid-1', created_at: new Date(), updated_at: new Date() };
    }),
  };
}

async function buildApp(svcPromptSvc: ReturnType<typeof makeFakeService>) {
  const app = Fastify({ logger: false });
  app.decorateRequest('user', { getter() { return { id: 'u-admin', is_admin: true }; } });
  app.addHook('preHandler', async (req: any) => {
    (req.server as any).app = { servicePromptService: svcPromptSvc };
  });
  await app.register(adminServicePromptsRoutes);
  return app;
}

describe('W.6 — admin-service-prompts routes', () => {
  beforeEach(() => __resetServicePromptCacheForTests());
  afterEach(() => __resetServicePromptCacheForTests());

  it('GET / → lists active prompt keys', async () => {
    const svc = makeFakeService([
      { prompt_key: 'slack.integration_prompt', body: 'Hello from DB', version: 1, is_active: true },
      { prompt_key: 'title_gen.ai_service', body: 'Title prompt', version: 1, is_active: true },
    ]);
    const app = await buildApp(svc);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.prompts).toHaveLength(2);
    expect(json.prompts[0].prompt_key).toBe('slack.integration_prompt');
  });

  it('GET /:key → returns body for existing key', async () => {
    const svc = makeFakeService([
      { prompt_key: 'memory.context_system', body: 'Summary prompt body', version: 2, is_active: true },
    ]);
    const app = await buildApp(svc);
    const res = await app.inject({ method: 'GET', url: '/memory.context_system' });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.prompt_key).toBe('memory.context_system');
    expect(json.body).toBe('Summary prompt body');
  });

  it('GET /:key → 404 when key not found', async () => {
    const svc = makeFakeService([]);
    const app = await buildApp(svc);
    const res = await app.inject({ method: 'GET', url: '/missing.key' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /:key → saves new version + returns created row', async () => {
    const svc = makeFakeService([
      { prompt_key: 'slack.integration_prompt', body: 'v1 body', version: 1, is_active: true },
    ]);
    const app = await buildApp(svc);
    const res = await app.inject({
      method: 'POST',
      url: '/slack.integration_prompt',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ body: 'v2 body from admin', reason: 'sprint W test' }),
    });
    expect(res.statusCode).toBe(201);
    const json = JSON.parse(res.body);
    expect(json.version).toBe(2);
    expect(svc.setPrompt).toHaveBeenCalledWith('slack.integration_prompt', 'v2 body from admin', expect.any(Object));
  });

  it('POST /:key → 400 when body missing', async () => {
    const svc = makeFakeService([]);
    const app = await buildApp(svc);
    const res = await app.inject({
      method: 'POST',
      url: '/slack.integration_prompt',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'missing body' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /:key/versions → returns version history', async () => {
    const svc = makeFakeService([
      { prompt_key: 'title_gen.ai_service', body: 'v1', version: 1, is_active: false },
      { prompt_key: 'title_gen.ai_service', body: 'v2', version: 2, is_active: true },
    ]);
    const app = await buildApp(svc);
    const res = await app.inject({ method: 'GET', url: '/title_gen.ai_service/versions' });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.versions.length).toBe(2);
  });

  it('503 when servicePromptService unavailable', async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest('user', { getter() { return { id: 'u-admin', is_admin: true }; } });
    app.addHook('preHandler', async (req: any) => {
      (req.server as any).app = {}; // no servicePromptService
    });
    await app.register(adminServicePromptsRoutes);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(503);
  });

  // P2.2 — rollback route tests
  it('POST /:key/rollback/:version → calls svc.rollback + returns restored row', async () => {
    const svc = makeFakeService([
      { prompt_key: 'slack.integration_prompt', body: 'v1 body', version: 1, is_active: false },
      { prompt_key: 'slack.integration_prompt', body: 'v2 body', version: 2, is_active: true },
    ]);
    const app = await buildApp(svc);
    const res = await app.inject({
      method: 'POST',
      url: '/slack.integration_prompt/rollback/1',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'v2 was bad' }),
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.version).toBe(1);
    expect(json.is_active).toBe(true);
    expect(svc.rollback).toHaveBeenCalledWith('slack.integration_prompt', 1, expect.any(Object));
  });

  it('POST /:key/rollback/:version → 400 on non-integer version', async () => {
    const svc = makeFakeService([]);
    const app = await buildApp(svc);
    const res = await app.inject({
      method: 'POST',
      url: '/slack.integration_prompt/rollback/bad',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /:key/rollback/:version → 404 when version does not exist', async () => {
    const svc = makeFakeService([
      { prompt_key: 'title_gen.ai_service', body: 'v1', version: 1, is_active: true },
    ]);
    const app = await buildApp(svc);
    const res = await app.inject({
      method: 'POST',
      url: '/title_gen.ai_service/rollback/99',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /:key/rollback/:version → 503 when service unavailable', async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest('user', { getter() { return { id: 'u-admin', is_admin: true }; } });
    app.addHook('preHandler', async (req: any) => {
      (req.server as any).app = {};
    });
    await app.register(adminServicePromptsRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/slack.integration_prompt/rollback/1',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(503);
  });
});
