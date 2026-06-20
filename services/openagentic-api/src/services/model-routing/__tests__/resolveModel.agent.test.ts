/**
 * F1.4 — RED test for `resolveModel({agentId})`
 *
 * the design notes
 * the design notes
 *
 * Per-agent override resolution. When a built-in or user-defined Agent row
 * has its own `model_role_assignment` FK populated, that row wins. Otherwise
 * fall through to role-based default (F1.6).
 *
 * Like flowNodeId, the actual `agents.modelRoleAssignment` FK column lands
 * at F5. F1.4 mocks `prisma.agent.findUnique`. F5 wires the schema.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveModel } from '../resolveModel.js';

describe('resolveModel — agentId path', () => {
  it('returns ResolvedModel when agent has FK populated', async () => {
    const mockPrisma = {
      agent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'agent-cloud-ops',
          modelRoleAssignment: {
            id: 'row-99',
            provider_id: 'p-aif',
            model: 'gpt-5.2',
            role: 'chat',
            enabled: true,
            capabilities: { chat: true, tools: true },
            provider: {
              id: 'p-aif',
              name: 'azure-aif-prod',
              provider_type: 'aif',
              enabled: true,
              deleted_at: null,
            },
          },
        }),
      },
    };

    const result = await resolveModel(
      { role: 'chat', agentId: 'agent-cloud-ops' },
      { prisma: mockPrisma as any },
    );

    expect(result.registryRowId).toBe('row-99');
    expect(result.modelId).toBe('gpt-5.2');
    expect(result.providerName).toBe('azure-aif-prod');
    expect(result.providerType).toBe('aif');
    expect(result.role).toBe('chat');
    expect(result.qualifier).toBe('aif · azure-aif-prod · gpt-5.2');
  });

  it('throws UNKNOWN_AGENT when agentId not found', async () => {
    const mockPrisma = {
      agent: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      resolveModel({ role: 'chat', agentId: 'missing-agent' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_AGENT' });
  });

  it('throws NO_MODEL_FOR_ROLE when agent FK is null AND Registry has no role-default match (F1.6)', async () => {
    // After F1.6 lands, FK-null falls through to role-based default. This test
    // covers the case where the role-default itself is empty.
    const mockPrisma = {
      agent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'agent-no-override',
          modelRoleAssignment: null,
        }),
      },
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      resolveModel({ role: 'chat', agentId: 'agent-no-override' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'NO_MODEL_FOR_ROLE' });
  });

  it('rejects FK row whose role does NOT match requested role (Bug 3 cure)', async () => {
    // Same Bug-3 protection as flowNodeId path — Registry role column is SoT.
    const mockPrisma = {
      agent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'agent-bug3-victim',
          modelRoleAssignment: {
            id: 'row-bug',
            provider_id: 'p-ollama',
            model: 'nomic-embed-text:latest',
            role: 'embeddings',  // ← FK row has WRONG role
            enabled: true,
            capabilities: { chat: true, embeddings: true },  // ← but capabilities.chat=true
            provider: {
              id: 'p-ollama',
              name: 'ollama-hal',
              provider_type: 'ollama',
              enabled: true,
              deleted_at: null,
            },
          },
        }),
      },
    };

    await expect(
      resolveModel({ role: 'chat', agentId: 'agent-bug3-victim' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'ROLE_MISMATCH' });
  });

  it('honors row + provider gates on the FK-resolved agent row (PROVIDER_DELETED)', async () => {
    const mockPrisma = {
      agent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'agent-stale-provider',
          modelRoleAssignment: {
            id: 'row-x',
            enabled: true,
            role: 'chat',
            provider: {
              enabled: true,
              deleted_at: new Date('2026-04-15T00:00:00Z'),  // ← provider soft-deleted
              name: 'p-old',
              provider_type: 'bedrock',
              id: 'p-old',
            },
          },
        }),
      },
    };

    await expect(
      resolveModel({ role: 'chat', agentId: 'agent-stale-provider' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'PROVIDER_DELETED' });
  });
});
