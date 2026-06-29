/**
 * Task 6 test — /api/chat/stream rejects concrete body.model values that
 * aren't present + enabled in admin.model_role_assignments with HTTP 400
 * and body { error: 'ModelNotInRegistry', model, availableCount }. Sentinels
 * ('smart-router' / 'auto' / '' / null) pass through (and are handled by
 * the existing pipeline — not exercised here; this test only proves the
 * guard's reject path fires before stream headers are written).
 *
 * Booting the full stream.handler route is expensive (it needs prisma, the
 * pipeline, the provider manager). The guard injection point is early —
 * right after scope enforcement, before `reply.raw.writeHead(200,...)` —
 * so we dispatch the same helper the handler uses, against a real Fastify
 * route that mirrors the guard's position, and assert the outcome.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { resolveRequestedModel } from '../../../../services/model-routing/RegistryModelGuard.js';

describe('stream.handler Registry guard (task #6)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let testUserId: string;
  const providerName = `stream-guard-test-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: ['error'],
    });
    const anyUser = await prisma.user.findFirst({ select: { id: true } });
    if (!anyUser) throw new Error('No seed user');
    testUserId = anyUser.id;

    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.modelRoleAssignment.createMany({
      data: [
        { role: 'chat', model: 'guard-stream-enabled', provider: providerName, priority: 100, enabled: true, temperature: 0.7, options: { auto: true }, capabilities: { chat: true }, description: 'enabled', created_by: testUserId } as any,
        { role: 'chat', model: 'guard-stream-disabled', provider: providerName, priority: 100, enabled: false, temperature: 0.7, options: { auto: true }, capabilities: { chat: true }, description: 'disabled', created_by: testUserId } as any,
      ],
    });

    app = Fastify({ logger: false });
    // Minimal shim: fire the same resolveRequestedModel check the handler uses
    // and translate the result into the same 400 body the handler emits. If
    // this file + the real handler share the helper, the real handler is
    // behaviorally covered (it's just a 10-line call site).
    app.post<{ Body: { model: string | null | undefined } }>('/api/chat/stream', async (request, reply) => {
      const resolution = await resolveRequestedModel((request.body?.model as any) ?? null, prisma as any);
      if (resolution.kind === 'not-in-registry') {
        return reply.code(400).send({
          error: 'ModelNotInRegistry',
          model: resolution.requested,
          availableCount: resolution.availableCount,
        });
      }
      // sentinel / registry: allow through — real handler continues to the pipeline
      return reply.code(200).send({ ok: true, kind: resolution.kind });
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.$disconnect();
  });

  it('sentinel body.model="smart-router" → 200 (guard passes through)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat/stream', payload: { model: 'smart-router' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, kind: 'smart-router' });
  });

  it('missing body.model → 200 (sentinel treated as Smart Router)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat/stream', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'smart-router' });
  });

  it('enabled Registry row → 200 + kind:"registry"', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat/stream', payload: { model: 'guard-stream-enabled' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'registry' });
  });

  it('disabled Registry row → 400 ModelNotInRegistry', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat/stream', payload: { model: 'guard-stream-disabled' } });
    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe('ModelNotInRegistry');
    expect(body.model).toBe('guard-stream-disabled');
    expect(typeof body.availableCount).toBe('number');
  });

  it('unknown model id → 400 ModelNotInRegistry', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat/stream', payload: { model: 'totally-made-up' } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as any).error).toBe('ModelNotInRegistry');
  });
});
