/**
 * F1.1 — RED test for `resolveModel({explicitRowId})`
 *
 * the design notes
 * the design notes
 *
 * Universal accessor for model resolution. Every consumer (Smart Router,
 * agents, flow nodes, embeddings, MCP indexer, codemode, synth, memory
 * compaction, DocsRAG, default-model lookups) reads through this function.
 *
 * F1.1 covers ONLY the explicitRowId path (caller passes a Registry row id
 * directly). flowNodeId, agentId, taskComplexity, role-based default paths
 * land in F1.3-F1.6.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveModel, ResolveModelError } from '../resolveModel.js';

describe('resolveModel — explicitRowId path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ResolvedModel when row exists, enabled, provider enabled', async () => {
    const mockPrisma = {
      modelRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-1',
          provider_id: 'p-1',
          model: 'gpt-oss:20b',
          role: 'chat',
          enabled: true,
          capabilities: { chat: true },
          provider: {
            id: 'p-1',
            name: 'ollama-prod-hal',
            provider_type: 'ollama',
            enabled: true,
            deleted_at: null,
          },
        }),
      },
    };

    const result = await resolveModel(
      { role: 'chat', explicitRowId: 'row-1' },
      { prisma: mockPrisma as any },
    );

    expect(result.registryRowId).toBe('row-1');
    expect(result.modelId).toBe('gpt-oss:20b');
    expect(result.providerName).toBe('ollama-prod-hal');
    expect(result.providerType).toBe('ollama');
    expect(result.role).toBe('chat');
    expect(result.qualifier).toBe('ollama · ollama-prod-hal · gpt-oss:20b');
  });

  it('throws UNKNOWN_REGISTRY_ROW when id not found', async () => {
    const mockPrisma = {
      modelRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      resolveModel({ role: 'chat', explicitRowId: 'missing' }, { prisma: mockPrisma as any }),
    ).rejects.toThrow(ResolveModelError);

    await expect(
      resolveModel({ role: 'chat', explicitRowId: 'missing' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_REGISTRY_ROW' });
  });

  it('throws REGISTRY_ROW_DISABLED when row enabled=false', async () => {
    const mockPrisma = {
      modelRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-1',
          provider_id: 'p-1',
          model: 'gpt-oss:20b',
          role: 'chat',
          enabled: false,
          provider: {
            id: 'p-1',
            name: 'ollama-prod-hal',
            provider_type: 'ollama',
            enabled: true,
            deleted_at: null,
          },
        }),
      },
    };

    await expect(
      resolveModel({ role: 'chat', explicitRowId: 'row-1' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'REGISTRY_ROW_DISABLED' });
  });

  it('throws PROVIDER_DISABLED when provider enabled=false', async () => {
    const mockPrisma = {
      modelRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-1',
          provider_id: 'p-1',
          model: 'gpt-oss:20b',
          role: 'chat',
          enabled: true,
          provider: {
            id: 'p-1',
            name: 'ollama-prod-hal',
            provider_type: 'ollama',
            enabled: false,
            deleted_at: null,
          },
        }),
      },
    };

    await expect(
      resolveModel({ role: 'chat', explicitRowId: 'row-1' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('throws PROVIDER_DELETED when provider has deleted_at', async () => {
    const mockPrisma = {
      modelRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-1',
          provider_id: 'p-1',
          model: 'gpt-oss:20b',
          role: 'chat',
          enabled: true,
          provider: {
            id: 'p-1',
            name: 'ollama-prod-hal',
            provider_type: 'ollama',
            enabled: true,
            deleted_at: new Date('2026-04-30T00:00:00Z'),
          },
        }),
      },
    };

    await expect(
      resolveModel({ role: 'chat', explicitRowId: 'row-1' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'PROVIDER_DELETED' });
  });
});
