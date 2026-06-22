/**
 * Pins that ModelConfigurationService.refresh() sets config.defaultModel to
 * the Registry-blessed role='chat' pick, not the LLMProvider-priority-sorted
 * models[0]. This closes the same defect getDefaultChatModel() already fixes
 * at its own entry point, so /api/chat/models.defaultModel reports the same
 * model the stage-2 summarizer will actually use.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/prisma.js', () => {
  const mock = {
    lLMProvider: { findMany: vi.fn() },
    modelRoleAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
    lLMProvider: { findMany: ReturnType<typeof vi.fn> };
    modelRoleAssignment: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
}

describe('ModelConfigurationService.refresh — config.defaultModel aligns with Registry chat pick', () => {
  beforeEach(() => {
    const m = prismaMock();
    m.lLMProvider.findMany.mockReset();
    m.modelRoleAssignment.findFirst.mockReset();
    m.modelRoleAssignment.findMany.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it('config.defaultModel.modelId equals the Registry role="chat" priority=1 model, not models[0] by LLMProvider.priority', async () => {
    const m = prismaMock();

    // Registry: claude-sonnet-4-6 is priority=1 (blessed chat default);
    // gpt-oss:20b is enabled but priority=100 (deprecated fallback).
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { model: 'us.anthropic.claude-sonnet-4-6', provider: 'aws-bedrock', role: 'chat', priority: 1, enabled: true, capabilities: { chat: true, tools: true } },
      { model: 'gpt-oss:20b', provider: 'ollama-hal', role: 'chat', priority: 100, enabled: true, capabilities: { chat: true } },
    ]);
    m.modelRoleAssignment.findFirst.mockResolvedValue({
      model: 'us.anthropic.claude-sonnet-4-6',
      provider: 'aws-bedrock',
    });

    // LLMProvider table: Ollama appears first in the loop (bug reproducer —
    // pre-fix this tie-breaks Ollama's gpt-oss:20b into models[0]).
    m.lLMProvider.findMany.mockResolvedValue([
      {
        id: 'prov-ollama', name: 'ollama-hal', priority: 1, enabled: true, deleted_at: null,
        provider_type: 'ollama', model_config: {}, provider_config: { models: [{ id: 'gpt-oss:20b' }] },
      },
      {
        id: 'prov-bedrock', name: 'aws-bedrock', priority: 1, enabled: true, deleted_at: null,
        provider_type: 'aws-bedrock', model_config: {},
        provider_config: { models: [{ id: 'us.anthropic.claude-sonnet-4-6' }] },
      },
    ]);

    const cfg = await ModelConfigurationService.refresh();

    expect(cfg.defaultModel.modelId).toBe('us.anthropic.claude-sonnet-4-6');
    expect(cfg.defaultModel.modelId).not.toBe('gpt-oss:20b');
  });

  it('falls back to LLMProvider-priority sort only if Registry chat findFirst returns null', async () => {
    const m = prismaMock();

    m.modelRoleAssignment.findMany.mockResolvedValue([
      { model: 'us.anthropic.claude-sonnet-4-6', provider: 'aws-bedrock', role: 'chat', priority: 100, enabled: true, capabilities: { chat: true } },
    ]);
    m.modelRoleAssignment.findFirst.mockResolvedValue(null); // simulates totally empty chat role

    m.lLMProvider.findMany.mockResolvedValue([
      {
        id: 'prov-bedrock', name: 'aws-bedrock', priority: 1, enabled: true, deleted_at: null,
        provider_type: 'aws-bedrock', model_config: {},
        provider_config: { models: [{ id: 'us.anthropic.claude-sonnet-4-6' }] },
      },
    ]);

    const cfg = await ModelConfigurationService.refresh();

    expect(cfg.defaultModel.modelId).toBe('us.anthropic.claude-sonnet-4-6');
  });
});
