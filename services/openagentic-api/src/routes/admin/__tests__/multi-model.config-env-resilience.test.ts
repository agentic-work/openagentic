/**
 * Regression for #368: GET /api/admin/multi-model/config returned 500 with
 * "Missing required environment variable: MULTI_MODEL_REASONING_PRIMARY" when
 * the helm chart didn't wire those env vars (they were removed alongside the
 * slider rip / Smart-Router-always-on policy).
 *
 * The GET endpoint serves a config *snapshot* — it must not throw when env
 * vars are unset. Instead, return the config with empty primaryModel strings
 * so the UI can reflect "multi-model is not configured" cleanly. Runtime
 * orchestrator can still validate at-use time.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: { findFirst: async () => null },
  },
}));

import multiModelRoutes from '../multi-model.js';

const SAVED: Record<string, string | undefined> = {};
const KEYS = [
  'MULTI_MODEL_REASONING_PRIMARY',
  'MULTI_MODEL_TOOL_PRIMARY',
  'MULTI_MODEL_SYNTHESIS_PRIMARY',
  'MULTI_MODEL_FALLBACK_PRIMARY',
  'ENABLE_MULTI_MODEL',
];

describe('GET /api/admin/multi-model/config — env-var resilience', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    for (const k of KEYS) SAVED[k] = process.env[k];
  });

  afterAll(() => {
    for (const k of KEYS) {
      if (SAVED[k] === undefined) delete process.env[k];
      else process.env[k] = SAVED[k];
    }
  });

  beforeEach(async () => {
    for (const k of KEYS) delete process.env[k];
    app = Fastify({ logger: false });
    await app.register(multiModelRoutes as any, { prefix: '/api/admin' });
    await app.ready();
  });

  it('returns 200 (not 500) when MULTI_MODEL_*_PRIMARY env vars are unset', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/multi-model/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config).toBeDefined();
    expect(body.config.enabled).toBe(false);
    expect(body.config.roles.reasoning.primaryModel).toBe('');
    expect(body.config.roles.tool_execution.primaryModel).toBe('');
    expect(body.config.roles.synthesis.primaryModel).toBe('');
    expect(body.config.roles.fallback.primaryModel).toBe('');
    await app.close();
  });

  it('honors MULTI_MODEL_*_PRIMARY env vars when set', async () => {
    process.env.MULTI_MODEL_REASONING_PRIMARY = 'us.anthropic.claude-sonnet-4-6';
    process.env.MULTI_MODEL_TOOL_PRIMARY = 'gpt-oss:20b';
    process.env.MULTI_MODEL_SYNTHESIS_PRIMARY = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    process.env.MULTI_MODEL_FALLBACK_PRIMARY = 'gpt-oss:20b';
    // Re-create app so route reads new env at request time (env is read per-request via getDefaultMultiModelConfig).
    const res = await app.inject({ method: 'GET', url: '/api/admin/multi-model/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config.roles.reasoning.primaryModel).toBe('us.anthropic.claude-sonnet-4-6');
    expect(body.config.roles.tool_execution.primaryModel).toBe('gpt-oss:20b');
    expect(body.config.roles.fallback.primaryModel).toBe('gpt-oss:20b');
    await app.close();
  });
});
