/**
 * AppContext tests — Phase 1 of server.ts decomposition.
 *
 * Verifies that:
 *  - AppContext can be constructed with stub deps.
 *  - Optional fields can be set before decoration.
 *  - decorateApp() wires the ctx onto a Fastify instance as server.app.
 *  - Route handlers can read ctx properties through request.server.app.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { AppContext, decorateApp } from '../AppContext.js';

// Minimal stub deps — we only need prisma + logger shapes that satisfy the type.
const stubPrisma = { _stub: true } as any;
const stubLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => stubLogger,
} as any;

const stubDeps = { prisma: stubPrisma, logger: stubLogger };

// A sentinel value that is distinguishable from undefined.
const stubProviderManager = { _isFakeProviderManager: true } as any;

describe('AppContext construction', () => {
  it('constructs without error', () => {
    const ctx = new AppContext(stubDeps);
    expect(ctx).toBeInstanceOf(AppContext);
  });

  it('exposes deps on ctx.deps', () => {
    const ctx = new AppContext(stubDeps);
    expect(ctx.deps.prisma).toBe(stubPrisma);
    expect(ctx.deps.logger).toBe(stubLogger);
  });

  it('has toolSemanticCacheInitialized = false by default', () => {
    const ctx = new AppContext(stubDeps);
    expect(ctx.toolSemanticCacheInitialized).toBe(false);
  });

  it('optional fields default to undefined', () => {
    const ctx = new AppContext(stubDeps);
    expect(ctx.providerManager).toBeUndefined();
    expect(ctx.smartModelRouter).toBeUndefined();
    expect(ctx.milvusClient).toBeUndefined();
    expect(ctx.chatStorage).toBeUndefined();
    expect(ctx.ragService).toBeUndefined();
    expect(ctx.jobCompletionWatcher).toBeUndefined();
    expect(ctx.promptService).toBeUndefined();
  });

  it('optional fields can be set after construction', () => {
    const ctx = new AppContext(stubDeps);
    ctx.providerManager = stubProviderManager;
    expect(ctx.providerManager).toBe(stubProviderManager);
  });
});

describe('decorateApp()', () => {
  it('makes server.app equal to the ctx instance', async () => {
    const server = Fastify();
    const ctx = new AppContext(stubDeps);
    decorateApp(server, ctx);
    await server.ready();
    expect((server as any).app).toBe(ctx);
    await server.close();
  });

  it('route handler can read ctx.providerManager through request.server.app', async () => {
    const server = Fastify();
    const ctx = new AppContext(stubDeps);
    ctx.providerManager = stubProviderManager;
    decorateApp(server, ctx);

    server.get('/test-app-context', async (request) => {
      return {
        providerManagerSet: !!request.server.app.providerManager,
        prismaSet: request.server.app.deps.prisma === stubPrisma,
      };
    });

    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-app-context' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.providerManagerSet).toBe(true);
    expect(body.prismaSet).toBe(true);

    await server.close();
  });

  it('calling decorateApp twice on different servers does not throw', async () => {
    const s1 = Fastify();
    const s2 = Fastify();
    const ctx1 = new AppContext(stubDeps);
    const ctx2 = new AppContext(stubDeps);
    decorateApp(s1, ctx1);
    decorateApp(s2, ctx2);
    await s1.ready();
    await s2.ready();
    expect((s1 as any).app).toBe(ctx1);
    expect((s2 as any).app).toBe(ctx2);
    await s1.close();
    await s2.close();
  });
});
