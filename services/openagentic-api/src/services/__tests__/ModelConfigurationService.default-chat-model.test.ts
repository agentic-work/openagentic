/**
 * Pins the fix for the ENG-001 bench blocker observed 2026-04-23: the chat
 * pipeline's stage-2 summarizer picked Ollama gpt-oss:20b (which emits only
 * thinking blocks, zero visible text) because getDefaultChatModel() returned
 * config.defaultModel.modelId — a value derived from LLMProvider-priority
 * tie-break, not the Registry's role='chat' priority.
 *
 * Contract this test enforces: getDefaultChatModel() must query
 * admin.model_role_assignments directly for the enabled role='chat' row
 * with the lowest priority, and throw if none exists (no env-var fallback).
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

// Match the pattern in ModelConfigurationService.registry-sot.test.ts: the
// service imports prisma dynamically inside the method under test, so we
// trigger the mock factory at module-load time via an eager import.
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
    modelRoleAssignment: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    lLMProvider: { findFirst: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
  };
}

describe('ModelConfigurationService.getDefaultChatModel — Registry-role SoT', () => {
  beforeEach(() => {
    const m = prismaMock();
    m.modelRoleAssignment.findFirst.mockReset();
    m.modelRoleAssignment.findMany.mockReset();
    m.lLMProvider.findFirst.mockReset();
    m.lLMProvider.findMany.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it('returns the enabled role="chat" row with the lowest priority', async () => {
    prismaMock().modelRoleAssignment.findMany.mockResolvedValueOnce([{
      model: 'us.anthropic.claude-sonnet-4-6',
      provider: 'aws-bedrock',
    }]);
    prismaMock().lLMProvider.findMany.mockResolvedValueOnce([{ name: 'aws-bedrock' }]);

    const model = await ModelConfigurationService.getDefaultChatModel();

    expect(model).toBe('us.anthropic.claude-sonnet-4-6');
    expect(prismaMock().modelRoleAssignment.findMany).toHaveBeenCalledWith({
      where: { role: 'chat', enabled: true },
      orderBy: { priority: 'asc' },
      select: { model: true, provider: true },
    });
  });

  it('never returns gpt-oss:20b when a higher-priority chat row exists', async () => {
    // Simulates the live defect: registry has both claude-sonnet-4-6 (priority=1)
    // and gpt-oss:20b (priority=100). The query's orderBy must bring sonnet first.
    prismaMock().modelRoleAssignment.findMany.mockImplementation(async (args: any) => {
      expect(args.orderBy).toEqual({ priority: 'asc' });
      return [
        { model: 'us.anthropic.claude-sonnet-4-6', provider: 'aws-bedrock' },
        { model: 'gpt-oss:20b', provider: 'ollama-hal' },
      ];
    });
    prismaMock().lLMProvider.findMany.mockResolvedValue([
      { name: 'aws-bedrock' }, { name: 'ollama-hal' },
    ]);

    const model = await ModelConfigurationService.getDefaultChatModel();
    expect(model).toBe('us.anthropic.claude-sonnet-4-6');
    expect(model).not.toBe('gpt-oss:20b');
  });

  it('throws when BOTH Registry and llm_providers candidate are absent (no silent env-var fallback)', async () => {
    prismaMock().modelRoleAssignment.findMany.mockResolvedValueOnce([]);
    prismaMock().lLMProvider.findMany.mockResolvedValueOnce([]);

    await expect(ModelConfigurationService.getDefaultChatModel()).rejects.toThrow(
      /No chat model configured/,
    );
  });
});
