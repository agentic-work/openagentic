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
    systemConfiguration: {
      findUnique: vi.fn(),
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
    // Default: no admin-configured chat default → fall through to the
    // priority scan (existing behaviour the tests below pin).
    (m as any).systemConfiguration.findUnique.mockReset();
    (m as any).systemConfiguration.findUnique.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  // DEFAULT-FIRST (2026-05-24): the admin-configured chat default
  // (system_configuration.default_models.chat — what the Admin UI writes)
  // must WIN over the raw priority-scan, mirroring getDefaultCodeModel.
  // Live bug it fixes: model_role_assignments had nvidia.nemotron-nano-12b-v2
  // AND claude-sonnet-4-5 both at priority=10 (tie); the scan returned the
  // vision model nemotron as the "chat default", which fast-failed every
  // unpinned chat turn. The admin had set default_models.chat=sonnet-4.5 in
  // the UI but the resolver ignored it.
  it('returns the admin-configured default_models.chat over the priority-tie winner', async () => {
    const m = prismaMock();
    (m as any).systemConfiguration.findUnique.mockResolvedValue({
      value: { chat: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' },
    });
    // Priority-tie: nemotron (vision) sorts first, sonnet second — both servable.
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { model: 'nvidia.nemotron-nano-12b-v2', provider: 'bedrock-dev' },
      { model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', provider: 'bedrock-dev' },
      { model: 'gpt-oss:20b', provider: 'hal-ollama' },
    ]);
    m.lLMProvider.findMany.mockResolvedValue([{ name: 'bedrock-dev' }, { name: 'hal-ollama' }]);

    const model = await ModelConfigurationService.getDefaultChatModel();
    // The CONFIGURED default wins — NOT the priority-first nemotron.
    expect(model).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    expect(model).not.toBe('nvidia.nemotron-nano-12b-v2');
  });

  it('falls back to the priority scan when the configured default is NOT a servable chat row', async () => {
    const m = prismaMock();
    // Admin configured a model that has no enabled chat assignment (stale).
    (m as any).systemConfiguration.findUnique.mockResolvedValue({
      value: { chat: 'gpt-image-1-not-a-chat-model' },
    });
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', provider: 'bedrock-dev' },
    ]);
    m.lLMProvider.findMany.mockResolvedValue([{ name: 'bedrock-dev' }]);

    const model = await ModelConfigurationService.getDefaultChatModel();
    // Stale config ignored → lowest-priority servable chat row.
    expect(model).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0');
  });

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
