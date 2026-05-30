/**
 * F1.3 — RED test for `resolveModel({flowNodeId})`
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F1.3)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * The flowNodeId path: when a flow node row has its own
 * `model_role_assignment` FK populated, resolveModel returns that row's
 * resolved model. When the FK is null, fall through to role-based default
 * (which lands GREEN in F1.6 — for now the fall-through asserts that the
 * "F1.6 not implemented" error fires).
 *
 * NOTE: the actual `flow_nodes.modelRoleAssignment` FK column doesn't
 * land in prisma schema until F5. F1.3's tests MOCK `prisma.flowNode.findUnique`
 * to assert the resolution contract. F5 wires the real FK + F3 converts
 * call sites.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveModel, ResolveModelError } from '../resolveModel.js';

describe('resolveModel — flowNodeId path', () => {
  it('returns ResolvedModel when flow node has FK populated', async () => {
    const mockPrisma = {
      flowNode: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'node-1',
          modelRoleAssignment: {
            id: 'row-7',
            provider_id: 'p-bedrock',
            model: 'claude-sonnet-4-6',
            role: 'chat',
            enabled: true,
            capabilities: { chat: true, tools: true },
            provider: {
              id: 'p-bedrock',
              name: 'aws-bedrock-prod',
              provider_type: 'bedrock',
              enabled: true,
              deleted_at: null,
            },
          },
        }),
      },
    };

    const result = await resolveModel(
      { role: 'chat', flowNodeId: 'node-1' },
      { prisma: mockPrisma as any },
    );

    expect(result.registryRowId).toBe('row-7');
    expect(result.modelId).toBe('claude-sonnet-4-6');
    expect(result.providerName).toBe('aws-bedrock-prod');
    expect(result.providerType).toBe('bedrock');
    expect(result.role).toBe('chat');
    expect(result.qualifier).toBe('bedrock · aws-bedrock-prod · claude-sonnet-4-6');
  });

  it('throws UNKNOWN_FLOW_NODE when flowNodeId not found', async () => {
    const mockPrisma = {
      flowNode: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      resolveModel({ role: 'chat', flowNodeId: 'missing' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_FLOW_NODE' });
  });

  it('throws NO_MODEL_FOR_ROLE when flow node FK is null AND Registry has no role-default match (F1.6)', async () => {
    // After F1.6 lands, FK-null falls through to role-based default. This test
    // covers the case where the role-default itself is empty.
    const mockPrisma = {
      flowNode: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'node-1',
          modelRoleAssignment: null,
        }),
      },
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      resolveModel({ role: 'chat', flowNodeId: 'node-1' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'NO_MODEL_FOR_ROLE' });
  });

  it('rejects FK row whose role does NOT match requested role (Bug 3 cure)', async () => {
    // Live forensic evidence shows embedding rows can have capabilities.chat=true.
    // The Registry `role` column is the SoT — never trust capabilities.
    // If a flow node FK points at an embedding row but caller asks for chat,
    // resolveModel must reject — not silently return the embedding model.
    const mockPrisma = {
      flowNode: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'node-1',
          modelRoleAssignment: {
            id: 'row-99',
            provider_id: 'p-ollama',
            model: 'nomic-embed-text:latest',
            role: 'embeddings',  // ← FK row has WRONG role
            enabled: true,
            capabilities: { chat: true, embeddings: true },  // ← but capabilities.chat=true (live data has this!)
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
      resolveModel({ role: 'chat', flowNodeId: 'node-1' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'ROLE_MISMATCH' });
  });

  it('honors row + provider gates on the FK-resolved row (REGISTRY_ROW_DISABLED)', async () => {
    const mockPrisma = {
      flowNode: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'node-1',
          modelRoleAssignment: {
            id: 'row-7',
            enabled: false,  // ← row disabled
            role: 'chat',
            provider: { enabled: true, deleted_at: null, name: 'p', provider_type: 'bedrock', id: 'p' },
          },
        }),
      },
    };

    await expect(
      resolveModel({ role: 'chat', flowNodeId: 'node-1' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'REGISTRY_ROW_DISABLED' });
  });
});
