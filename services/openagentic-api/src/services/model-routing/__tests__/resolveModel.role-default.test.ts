/**
 * F1.6 — RED test for `resolveModel({role})` role-based default path
 *
 * the design notes
 *
 * When the caller has no explicit/flow/agent/scoring hint, resolveModel
 * picks the highest-priority enabled Registry row for the requested role.
 *
 * THIS IS THE BUG-3 CURE AT THE RESOLVER LAYER. Production data shows all
 * Registry rows carry capabilities.chat=true regardless of the role column.
 * Filtering by `role='chat'` (the SoT column) instead of `capabilities.chat`
 * means embedding-row leakage into chat slots is impossible by construction.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveModel } from '../resolveModel.js';

describe('resolveModel — role-based default path', () => {
  it('returns highest-priority enabled row for the requested role', async () => {
    // Note: production order is `priority DESC` — higher priority wins.
    const expectedRow = {
      id: 'row-default-chat',
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
    };

    const mockPrisma = {
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue(expectedRow),
      },
    };

    const result = await resolveModel(
      { role: 'chat' },
      { prisma: mockPrisma as any },
    );

    expect(mockPrisma.modelRoleAssignment.findFirst).toHaveBeenCalledWith({
      where: { role: 'chat', enabled: true },
      orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
      include: { provider: true },
    });
    expect(result.registryRowId).toBe('row-default-chat');
    expect(result.modelId).toBe('claude-sonnet-4-6');
    expect(result.role).toBe('chat');
    expect(result.qualifier).toBe('bedrock · aws-bedrock-prod · claude-sonnet-4-6');
  });

  it('throws NO_MODEL_FOR_ROLE when no enabled rows for the role', async () => {
    const mockPrisma = {
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      resolveModel({ role: 'embedding' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'NO_MODEL_FOR_ROLE' });
  });

  it('honors provider gates on role-default row (PROVIDER_DISABLED)', async () => {
    const mockPrisma = {
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'row-x',
          model: 'm',
          role: 'chat',
          enabled: true,
          provider: {
            id: 'p',
            name: 'disabled-provider',
            provider_type: 'ollama',
            enabled: false,  // ← provider disabled
            deleted_at: null,
          },
        }),
      },
    };

    await expect(
      resolveModel({ role: 'chat' }, { prisma: mockPrisma as any }),
    ).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('flow node FK null → falls through to role-based default (closes F1.3 placeholder)', async () => {
    const fallbackRow = {
      id: 'row-fallback',
      model: 'gpt-oss:20b',
      role: 'chat',
      enabled: true,
      capabilities: { chat: true },
      provider: {
        id: 'p',
        name: 'ollama',
        provider_type: 'ollama',
        enabled: true,
        deleted_at: null,
      },
    };

    const mockPrisma = {
      flowNode: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'node-1',
          modelRoleAssignment: null,
        }),
      },
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue(fallbackRow),
      },
    };

    const result = await resolveModel(
      { role: 'chat', flowNodeId: 'node-1' },
      { prisma: mockPrisma as any },
    );

    expect(result.registryRowId).toBe('row-fallback');
    expect(result.modelId).toBe('gpt-oss:20b');
  });

  it('agent FK null → falls through to role-based default (closes F1.4 placeholder)', async () => {
    const fallbackRow = {
      id: 'row-fallback',
      model: 'claude-sonnet-4-6',
      role: 'chat',
      enabled: true,
      capabilities: { chat: true },
      provider: {
        id: 'p',
        name: 'aws-bedrock-prod',
        provider_type: 'bedrock',
        enabled: true,
        deleted_at: null,
      },
    };

    const mockPrisma = {
      agent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'agent-no-override',
          modelRoleAssignment: null,
        }),
      },
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue(fallbackRow),
      },
    };

    const result = await resolveModel(
      { role: 'chat', agentId: 'agent-no-override' },
      { prisma: mockPrisma as any },
    );

    expect(result.registryRowId).toBe('row-fallback');
  });

  it('Bug 3 cure: role-default query filters by Registry role column, NOT capabilities.chat', async () => {
    // Even if every row in Registry carried capabilities.chat=true, the role-based
    // default query filters by `role: 'chat'` directly, so embedding rows can NEVER
    // be returned for a chat resolution.
    const chatRow = {
      id: 'row-chat',
      model: 'gpt-oss:20b',
      role: 'chat',
      enabled: true,
      capabilities: { chat: true },
      provider: {
        id: 'p',
        name: 'ollama',
        provider_type: 'ollama',
        enabled: true,
        deleted_at: null,
      },
    };

    const mockPrisma = {
      modelRoleAssignment: {
        findFirst: vi.fn().mockResolvedValue(chatRow),
      },
    };

    await resolveModel({ role: 'chat' }, { prisma: mockPrisma as any });

    // The where clause MUST filter on role column (SoT), not on capabilities.
    const callArgs = mockPrisma.modelRoleAssignment.findFirst.mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ role: 'chat', enabled: true });
    expect(JSON.stringify(callArgs.where)).not.toContain('capabilit');
  });
});
