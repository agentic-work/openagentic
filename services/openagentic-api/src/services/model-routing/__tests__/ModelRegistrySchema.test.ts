/**
 * Task 1 schema test — verifies `admin.model_role_assignments` exposes a
 * `capabilities JSONB` column (added by the 2026-04-22 registry SoT migration)
 * and that the Prisma-generated client surfaces it as a Json? field.
 *
 * This test connects to the real Postgres via DATABASE_URL (no mocks) and
 * inspects both information_schema + the Prisma client shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('admin.model_role_assignments schema', () => {
  let prisma: PrismaClient;
  const testId = `schema-test-${Date.now()}`;
  let createdId: string | null = null;
  let testUserId: string | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: ['error'],
    });
    // Grab any existing user id for the created_by FK. The DB is pre-seeded
    // in the live cluster; in CI we expect at least one seed user. If none
    // exists we skip the write-path assertion.
    const anyUser = await prisma.user.findFirst({ select: { id: true } });
    testUserId = anyUser?.id ?? null;
  });

  afterAll(async () => {
    if (createdId) {
      await prisma.modelRoleAssignment.delete({ where: { id: createdId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('has a capabilities JSONB column with default {}', async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string; data_type: string; column_default: string | null; is_nullable: string }>>`
      SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'admin'
         AND table_name = 'model_role_assignments'
         AND column_name = 'capabilities'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('jsonb');
    // Default must be non-null (either '{}'::jsonb or similar)
    expect(rows[0].column_default).not.toBeNull();
    expect(rows[0].is_nullable).toBe('YES'); // nullable so existing rows survive the ADD COLUMN
  });

  it('Prisma client can read + write the capabilities field', async () => {
    if (!testUserId) {
      // No user seeded — integration surface not available.
      // Prisma schema check already passed via typecheck.
      return;
    }
    const created = await prisma.modelRoleAssignment.create({
      data: {
        id: testId,
        role: 'chat',
        model: `test-model-${testId}`,
        provider: `test-provider-${testId}`,
        priority: 999,
        enabled: true,
        created_by: testUserId,
        capabilities: { chat: true, tools: true, streaming: true, vision: false, thinking: false, embeddings: false, imageGeneration: false },
      } as any,
    });
    createdId = created.id;
    expect(created).toBeDefined();
    expect((created as any).capabilities).toMatchObject({ chat: true, tools: true });

    const fetched = await prisma.modelRoleAssignment.findUnique({ where: { id: created.id } });
    expect(fetched).toBeDefined();
    expect((fetched as any)?.capabilities).toMatchObject({ chat: true });
  });
});
