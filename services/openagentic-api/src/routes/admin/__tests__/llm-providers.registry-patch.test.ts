/**
 * Task 5 backend — PATCH /api/admin/llm-providers/registry/:id lets the
 * admin Models page toggle enabled/edit priority directly on a Registry row.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import llmProviderRoutes from '../llm-providers.js';

describe('PATCH /api/admin/llm-providers/registry/:id (task #5)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let testUserId: string;
  const providerName = `registry-patch-test-${Date.now()}`;
  let seededId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: ['error'],
    });
    const anyUser = await prisma.user.findFirst({ select: { id: true } });
    if (!anyUser) throw new Error('No seed user');
    testUserId = anyUser.id;

    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
      request.user = { id: testUserId };
    });
    await app.register(llmProviderRoutes as any, { prefix: '/api/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    const created = await prisma.modelRoleAssignment.create({
      data: {
        role: 'chat',
        model: `patch-target-${Date.now()}`,
        provider: providerName,
        priority: 100,
        enabled: true,
        temperature: 0.7,
        options: { auto: true },
        capabilities: { chat: true },
        description: 'patch target',
        created_by: testUserId,
      } as any,
    });
    seededId = created.id;
  });

  it('PATCH with { enabled: false } flips the row', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/llm-providers/registry/${seededId}`,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.modelRoleAssignment.findUnique({ where: { id: seededId } });
    expect(row?.enabled).toBe(false);
  });

  it('PATCH with { priority: 5 } updates priority', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/llm-providers/registry/${seededId}`,
      payload: { priority: 5 },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.modelRoleAssignment.findUnique({ where: { id: seededId } });
    expect(row?.priority).toBe(5);
  });

  it('PATCH with { role: "reasoning" } updates role AND flips options.auto to false', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/llm-providers/registry/${seededId}`,
      payload: { role: 'reasoning' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.modelRoleAssignment.findUnique({ where: { id: seededId } });
    expect(row?.role).toBe('reasoning');
    // Admin edit → options.auto=false so subsequent syncs don't clobber
    expect((row?.options as any)?.auto).toBe(false);
  });

  it('PATCH on nonexistent id → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/llm-providers/registry/nonexistent-id-x',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });
});
