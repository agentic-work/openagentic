/**
 * Task 6 tests — RegistryModelGuard (enforces body.model ∈ Registry).
 *
 * The chat handler (stream.handler.ts + openai-compatible.ts) used to
 * accept any body.model string and pass it through, which let stale UI
 * references or deleted-but-still-cached model IDs reach the provider
 * (and fail mid-stream). Post-0.6.6 contract:
 *
 *   - body.model is 'smart-router' / 'auto' / 'model-router' / '' / null
 *     → sentinel; route through Smart Router with Registry candidate pool
 *   - body.model is a real model id
 *       → lookup in Registry (enabled=true rows). Match? resolve to
 *         (provider, model). Miss? reject with 400 ModelNotInRegistry.
 *
 * This helper lives outside the handler so the guard logic is unit-testable
 * without spinning up Fastify.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  isSmartRouterSentinel,
  resolveRequestedModel,
  type RegistryGuardPrismaLike,
} from '../RegistryModelGuard.js';

describe('isSmartRouterSentinel (pure)', () => {
  it('returns true for null / undefined / empty string', () => {
    expect(isSmartRouterSentinel(null)).toBe(true);
    expect(isSmartRouterSentinel(undefined)).toBe(true);
    expect(isSmartRouterSentinel('')).toBe(true);
  });

  it('returns true for "smart-router" / "auto" / "model-router" / "default" (case-insensitive)', () => {
    expect(isSmartRouterSentinel('smart-router')).toBe(true);
    expect(isSmartRouterSentinel('Smart-Router')).toBe(true);
    expect(isSmartRouterSentinel('auto')).toBe(true);
    expect(isSmartRouterSentinel('AUTO')).toBe(true);
    expect(isSmartRouterSentinel('model-router')).toBe(true);
    expect(isSmartRouterSentinel('default')).toBe(true);
  });

  it('returns false for concrete model ids', () => {
    expect(isSmartRouterSentinel('us.anthropic.claude-sonnet-4-6')).toBe(false);
    expect(isSmartRouterSentinel('gpt-5')).toBe(false);
    expect(isSmartRouterSentinel('gpt-oss:20b')).toBe(false);
  });
});

describe('resolveRequestedModel (integration — real Prisma)', () => {
  let prisma: PrismaClient;
  let testUserId: string;
  const providerName = `registry-guard-test-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: ['error'],
    });
    const anyUser = await prisma.user.findFirst({ select: { id: true } });
    if (!anyUser) throw new Error('No seed user — integration test requires user table populated');
    testUserId = anyUser.id;

    // Seed: one enabled row, one disabled row
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.modelRoleAssignment.createMany({
      data: [
        {
          role: 'chat',
          model: 'guard-enabled-model',
          provider: providerName,
          priority: 100,
          enabled: true,
          temperature: 0.7,
          options: { auto: true },
          capabilities: { chat: true },
          description: 'guard-enabled-model',
          created_by: testUserId,
        } as any,
        {
          role: 'chat',
          model: 'guard-disabled-model',
          provider: providerName,
          priority: 100,
          enabled: false,
          temperature: 0.7,
          options: { auto: true },
          capabilities: { chat: true },
          description: 'guard-disabled-model',
          created_by: testUserId,
        } as any,
      ],
    });
  });

  afterAll(async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.$disconnect();
  });

  it('returns {kind:"smart-router"} for sentinel inputs', async () => {
    const r = await resolveRequestedModel(undefined, prisma as unknown as RegistryGuardPrismaLike);
    expect(r.kind).toBe('smart-router');
    const r2 = await resolveRequestedModel('auto', prisma as unknown as RegistryGuardPrismaLike);
    expect(r2.kind).toBe('smart-router');
    const r3 = await resolveRequestedModel('smart-router', prisma as unknown as RegistryGuardPrismaLike);
    expect(r3.kind).toBe('smart-router');
  });

  it('resolves an enabled Registry row to {kind:"registry", model, provider}', async () => {
    const r = await resolveRequestedModel('guard-enabled-model', prisma as unknown as RegistryGuardPrismaLike);
    expect(r.kind).toBe('registry');
    if (r.kind !== 'registry') throw new Error('unreachable');
    expect(r.model).toBe('guard-enabled-model');
    expect(r.provider).toBe(providerName);
  });

  it('rejects a disabled Registry row with {kind:"not-in-registry"}', async () => {
    const r = await resolveRequestedModel('guard-disabled-model', prisma as unknown as RegistryGuardPrismaLike);
    expect(r.kind).toBe('not-in-registry');
    if (r.kind !== 'not-in-registry') throw new Error('unreachable');
    expect(r.requested).toBe('guard-disabled-model');
    expect(typeof r.availableCount).toBe('number');
    expect(r.availableCount).toBeGreaterThanOrEqual(1); // the enabled row counts
  });

  it('rejects an unknown model with {kind:"not-in-registry"} + the requested id echoed back', async () => {
    const r = await resolveRequestedModel('nonexistent-model', prisma as unknown as RegistryGuardPrismaLike);
    expect(r.kind).toBe('not-in-registry');
    if (r.kind !== 'not-in-registry') throw new Error('unreachable');
    expect(r.requested).toBe('nonexistent-model');
  });

  it('returns the lowest-priority enabled row when multiple providers host the same model id', async () => {
    const second = `registry-guard-test-2-${Date.now()}`;
    await prisma.modelRoleAssignment.create({
      data: {
        role: 'chat',
        model: 'guard-enabled-model',
        provider: second,
        priority: 1, // higher priority (lower number)
        enabled: true,
        temperature: 0.7,
        options: { auto: true },
        capabilities: { chat: true },
        description: 'guard-enabled-model from second provider',
        created_by: testUserId,
      } as any,
    });
    try {
      const r = await resolveRequestedModel('guard-enabled-model', prisma as unknown as RegistryGuardPrismaLike);
      expect(r.kind).toBe('registry');
      if (r.kind !== 'registry') throw new Error('unreachable');
      expect(r.provider).toBe(second); // priority=1 wins over priority=100
    } finally {
      await prisma.modelRoleAssignment.deleteMany({ where: { provider: second } });
    }
  });
});
