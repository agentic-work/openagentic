/**
 * #508 Phase 2 — getDefaultChatModel must NOT self-heal.
 *
 * The #504 self-heal anti-pattern (write-inside-read fallback to
 * llm_providers.model_config.chatModel + auto-INSERT a registry row) is
 * RIPPED. Per FedRAMP overhaul §5.3:
 *
 *   "NO fallback to llm_providers.model_config — that was the #504
 *    anti-pattern. The Phase 1 cascade trigger guarantees the registry
 *    can never go empty while a provider exists. RegistryEmptyError is
 *    the actionable signal."
 *
 * After Phase 1 (live since commit 4fea5e42), provider soft-deletes
 * cascade registry rows to deprecated state at the DB layer. Discovery
 * resurrection is blocked by the #509 tombstone gate. The only way the
 * registry goes empty is admin removing every row by hand — that IS the
 * actionable state, and the existing throw signals it.
 *
 * Contract:
 *   - Registry has chat row     → return registry row's model.
 *   - Registry empty            → throw the actionable error.
 *                                  NO fallback to llm_providers.
 *                                  NO auto-INSERT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/prisma.js', () => {
  const mock = {
    modelRoleAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    lLMProvider: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  };
  (globalThis as any).__prismaMock = mock;
  return { prisma: mock };
});

import '../../utils/prisma.js';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';

function prismaMock() {
  return (globalThis as any).__prismaMock as {
    modelRoleAssignment: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    lLMProvider: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    user: { findUnique: ReturnType<typeof vi.fn> };
  };
}

describe('ModelConfigurationService.getDefaultChatModel — #508 Phase 2 (no self-heal)', () => {
  beforeEach(() => {
    const m = prismaMock();
    m.modelRoleAssignment.findFirst.mockReset();
    m.modelRoleAssignment.findMany.mockReset();
    m.modelRoleAssignment.create.mockReset();
    m.lLMProvider.findFirst.mockReset();
    m.lLMProvider.findMany.mockReset();
    m.user.findUnique.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it('returns the registry row model when registry has a chat entry', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValueOnce([{
      model: 'gpt-oss:20b',
      provider: 'ollama-hal',
    }]);
    m.lLMProvider.findMany.mockResolvedValueOnce([{ name: 'ollama-hal' }]);

    const model = await ModelConfigurationService.getDefaultChatModel();
    expect(model).toBe('gpt-oss:20b');
  });

  it('throws the actionable error when registry is empty (no model_config fallback)', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValueOnce([]);
    m.lLMProvider.findMany.mockResolvedValueOnce([]);

    await expect(ModelConfigurationService.getDefaultChatModel()).rejects.toThrow(
      /No chat model configured/,
    );
  });

  it('does NOT call llm_providers.findFirst when registry is empty (no fallback path)', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValueOnce([]);
    m.lLMProvider.findMany.mockResolvedValueOnce([]);

    await expect(ModelConfigurationService.getDefaultChatModel()).rejects.toThrow();
    expect(m.lLMProvider.findFirst).not.toHaveBeenCalled();
  });

  it('does NOT auto-INSERT a registry row when registry is empty (no write-inside-read)', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValueOnce([]);
    m.lLMProvider.findMany.mockResolvedValueOnce([]);

    await expect(ModelConfigurationService.getDefaultChatModel()).rejects.toThrow();
    expect(m.modelRoleAssignment.create).not.toHaveBeenCalled();
  });

  it('does NOT call user.findUnique when registry is empty (no admin-resolution side effect)', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValueOnce([]);
    m.lLMProvider.findMany.mockResolvedValueOnce([]);

    await expect(ModelConfigurationService.getDefaultChatModel()).rejects.toThrow();
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not throw when registry has a row even if provider has no model_config (registry is SoT)', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValueOnce([{
      model: 'us.anthropic.claude-sonnet-4-6',
      provider: 'aws-bedrock',
    }]);
    m.lLMProvider.findMany.mockResolvedValueOnce([{ name: 'aws-bedrock' }]);

    const model = await ModelConfigurationService.getDefaultChatModel();
    expect(model).toBe('us.anthropic.claude-sonnet-4-6');
    expect(m.lLMProvider.findFirst).not.toHaveBeenCalled();
  });
});
