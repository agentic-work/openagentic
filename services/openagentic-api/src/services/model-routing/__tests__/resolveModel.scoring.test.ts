/**
 * F1.5 — RED test for `resolveModel({taskComplexity})` SmartRouter scoring path
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F1.5)
 *
 * When the caller supplies a taskComplexity hint (no explicitRowId/flowNodeId/
 * agentId), resolveModel asks RegistryCandidatePool for all rows of the
 * requested role, then asks the SmartRouter to score-and-pick one.
 *
 * The scoring callback is injected via deps so the unit test mocks it.
 * F3 later wires the existing SmartRouter as the production scoring callback.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveModel } from '../resolveModel.js';

describe('resolveModel — taskComplexity scoring path', () => {
  it('returns ResolvedModel from SmartRouter pick when taskComplexity hint provided', async () => {
    // Two candidates — different priority + tier characteristics
    const candidates = [
      {
        id: 'row-cheap',
        provider_id: 'p-ollama',
        model: 'gpt-oss:20b',
        role: 'chat',
        priority: 100,
        capabilities: { chat: true, tools: true },
      },
      {
        id: 'row-premium',
        provider_id: 'p-bedrock',
        model: 'claude-sonnet-4-6',
        role: 'chat',
        priority: 200,
        capabilities: { chat: true, tools: true, thinking: true },
      },
    ];

    // SmartRouter picks the premium candidate for complex tasks
    const pickedCandidate = {
      id: 'row-premium',
      model: 'claude-sonnet-4-6',
      role: 'chat',
      enabled: true,
      capabilities: { chat: true, tools: true, thinking: true },
      provider: {
        id: 'p-bedrock',
        name: 'aws-bedrock-prod',
        provider_type: 'bedrock',
        enabled: true,
        deleted_at: null,
      },
    };

    const mockRegistryCandidatePool = {
      listForRole: vi.fn().mockResolvedValue(candidates),
    };
    const mockSmartRouter = {
      scoreAndPick: vi.fn().mockResolvedValue(pickedCandidate),
    };
    const mockPrisma = {} as any;

    const result = await resolveModel(
      { role: 'chat', taskComplexity: 'complex' },
      {
        prisma: mockPrisma,
        registryCandidatePool: mockRegistryCandidatePool as any,
        smartRouter: mockSmartRouter as any,
      },
    );

    expect(mockRegistryCandidatePool.listForRole).toHaveBeenCalledWith({ role: 'chat' });
    expect(mockSmartRouter.scoreAndPick).toHaveBeenCalledWith(candidates, {
      taskComplexity: 'complex',
      preferredTier: undefined,
    });
    expect(result.registryRowId).toBe('row-premium');
    expect(result.modelId).toBe('claude-sonnet-4-6');
    expect(result.providerType).toBe('bedrock');
    expect(result.qualifier).toBe('bedrock · aws-bedrock-prod · claude-sonnet-4-6');
  });

  it('throws NO_MODEL_FOR_ROLE when candidate pool is empty', async () => {
    const mockRegistryCandidatePool = {
      listForRole: vi.fn().mockResolvedValue([]),
    };
    const mockSmartRouter = {
      scoreAndPick: vi.fn(),
    };
    const mockPrisma = {} as any;

    await expect(
      resolveModel(
        { role: 'chat', taskComplexity: 'complex' },
        {
          prisma: mockPrisma,
          registryCandidatePool: mockRegistryCandidatePool as any,
          smartRouter: mockSmartRouter as any,
        },
      ),
    ).rejects.toMatchObject({ code: 'NO_MODEL_FOR_ROLE' });

    expect(mockSmartRouter.scoreAndPick).not.toHaveBeenCalled();
  });

  it('passes preferredTier hint through to scoreAndPick', async () => {
    const candidates = [
      {
        id: 'row-1',
        provider_id: 'p-1',
        model: 'm-1',
        role: 'chat',
        priority: 100,
        capabilities: { chat: true },
      },
    ];
    const picked = {
      id: 'row-1',
      model: 'm-1',
      role: 'chat',
      enabled: true,
      provider: { id: 'p-1', name: 'p1', provider_type: 'aif', enabled: true, deleted_at: null },
    };

    const mockRegistryCandidatePool = {
      listForRole: vi.fn().mockResolvedValue(candidates),
    };
    const mockSmartRouter = {
      scoreAndPick: vi.fn().mockResolvedValue(picked),
    };

    await resolveModel(
      { role: 'chat', taskComplexity: 'medium', preferredTier: 't2' },
      {
        prisma: {} as any,
        registryCandidatePool: mockRegistryCandidatePool as any,
        smartRouter: mockSmartRouter as any,
      },
    );

    expect(mockSmartRouter.scoreAndPick).toHaveBeenCalledWith(candidates, {
      taskComplexity: 'medium',
      preferredTier: 't2',
    });
  });

  it('rejects picked candidate whose role does NOT match (Bug 3 cure on scoring path too)', async () => {
    // Defense-in-depth: even if scorer returns a wrong-role row, reject it.
    const candidates = [
      { id: 'row-bug', model: 'nomic-embed-text:latest', role: 'embeddings', priority: 100, capabilities: { chat: true } },
    ];
    const wrongRolePick = {
      id: 'row-bug',
      model: 'nomic-embed-text:latest',
      role: 'embeddings',  // ← scorer should never return this for role='chat', but defend anyway
      enabled: true,
      capabilities: { chat: true, embeddings: true },
      provider: { id: 'p', name: 'p', provider_type: 'ollama', enabled: true, deleted_at: null },
    };

    const mockRegistryCandidatePool = {
      listForRole: vi.fn().mockResolvedValue(candidates),
    };
    const mockSmartRouter = {
      scoreAndPick: vi.fn().mockResolvedValue(wrongRolePick),
    };

    await expect(
      resolveModel(
        { role: 'chat', taskComplexity: 'complex' },
        {
          prisma: {} as any,
          registryCandidatePool: mockRegistryCandidatePool as any,
          smartRouter: mockSmartRouter as any,
        },
      ),
    ).rejects.toMatchObject({ code: 'ROLE_MISMATCH' });
  });
});
