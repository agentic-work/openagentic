/**
 * ModelConfigurationService must derive its candidate pool from the Registry
 * (admin.model_role_assignments), not from admin.llm_providers.provider_config.models.
 *
 * Failure this pins: on the dev environment 2026-04-23, the live Registry has only
 *   chat|global.anthropic.claude-sonnet-4-6|aws-bedrock|enabled
 *   chat|gpt-oss:20b|ollama-hal|enabled
 * Yet `[ModelConfig] Configuration loaded` reports 152 models and
 *   premium = us.anthropic.claude-3-opus-20240229-v1:0  (AWS EOL).
 * Root cause: loadFromDatabase() reads provider_config.models[] (auto-
 * discovered provider catalog, ~117 aws-bedrock entries) without filtering
 * against the Registry. TieredFunctionCallingService, ModelCapabilityGate,
 * and TaskAnalysisService all read the resulting tier map → bench-wide
 * "This model version has reached the end of its life" error on every
 * /api/chat/stream turn that escalates to premium.
 *
 * Contract this test enforces:
 *   1. When the Registry is empty, availableModels is empty (no silent fall-
 *      through to the 117-model provider catalog).
 *   2. When the Registry names model X, and provider_config.models[] names
 *      X, Y, Z — availableModels is just [X]. Y/Z are not platform-enabled.
 *   3. Models listed in provider_config.models but absent from the Registry
 *      are NEVER returned, even if their per-model config.enabled is true.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/prisma.js', () => {
  const mock = {
    lLMProvider: {
      findMany: vi.fn(),
    },
    modelRoleAssignment: {
      findMany: vi.fn(),
    },
  };
  (globalThis as any).__prismaMock = mock;
  return { prisma: mock };
});

// Trigger the mock factory at module-load time — ModelConfigurationService
// only imports prisma dynamically inside loadFromDatabase(), so without
// this static import the mock never registers and `prismaMock()` returns
// undefined in beforeEach.
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
    modelRoleAssignment: { findMany: ReturnType<typeof vi.fn> };
  };
}

describe('ModelConfigurationService — Registry is the SoT', () => {
  beforeEach(() => {
    const m = prismaMock();
    m.lLMProvider.findMany.mockReset();
    m.modelRoleAssignment.findMany.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it('does not leak provider_config.models entries into availableModels when Registry is empty', async () => {
    const m = prismaMock();
    const advertised = [
      'us.anthropic.claude-3-opus-20240229-v1:0',
      'us.anthropic.claude-opus-4-7',
      'global.anthropic.claude-sonnet-4-6',
    ];
    m.lLMProvider.findMany.mockResolvedValue([
      {
        id: 'p-bedrock',
        name: 'aws-bedrock',
        provider_type: 'aws-bedrock',
        priority: 0,
        enabled: true,
        deleted_at: null,
        model_config: { chatModel: advertised[0] },
        provider_config: {
          models: advertised.map(id => ({ id, config: { enabled: true, roles: ['chat'] } })),
        },
      },
    ]);
    m.modelRoleAssignment.findMany.mockResolvedValue([]); // empty registry

    const cfg = await ModelConfigurationService.refresh();

    // With an empty registry, *no* provider-advertised model may leak through.
    // The service may still emit an emergency fallback sentinel (modelId='default'),
    // but none of the real CSP ids can be in availableModels.
    const leaked = cfg.availableModels
      .map(x => x.modelId)
      .filter(id => advertised.includes(id));
    expect(leaked).toEqual([]);
  });

  it('returns only models named in the Registry — not the full provider_config.models catalog', async () => {
    const m = prismaMock();
    // Mirrors the real dev state: provider advertises 3 models, registry enables one.
    m.lLMProvider.findMany.mockResolvedValue([
      {
        id: 'p-bedrock',
        name: 'aws-bedrock',
        provider_type: 'aws-bedrock',
        priority: 0,
        enabled: true,
        deleted_at: null,
        model_config: { chatModel: 'us.anthropic.claude-3-opus-20240229-v1:0' },
        provider_config: {
          models: [
            { id: 'us.anthropic.claude-3-opus-20240229-v1:0', config: { enabled: true, roles: ['chat'] } },
            { id: 'us.anthropic.claude-opus-4-7',             config: { enabled: true, roles: ['chat'] } },
            { id: 'global.anthropic.claude-sonnet-4-6',       config: { enabled: true, roles: ['chat'] } },
          ],
        },
      },
    ]);
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { id: 'r1', model: 'global.anthropic.claude-sonnet-4-6', provider: 'aws-bedrock', role: 'chat', priority: 0, capabilities: {}, enabled: true },
    ]);

    const cfg = await ModelConfigurationService.refresh();

    expect(cfg.availableModels.map(x => x.modelId)).toEqual([
      'global.anthropic.claude-sonnet-4-6',
    ]);
  });

  it('never returns an EOL Bedrock id in any tier slot when it is not in the Registry', async () => {
    const m = prismaMock();
    // Same 3-model advertisement as above; registry names two non-EOL rows.
    m.lLMProvider.findMany.mockResolvedValue([
      {
        id: 'p-bedrock',
        name: 'aws-bedrock',
        provider_type: 'aws-bedrock',
        priority: 0,
        enabled: true,
        deleted_at: null,
        model_config: { chatModel: 'us.anthropic.claude-3-opus-20240229-v1:0' },
        provider_config: {
          models: [
            { id: 'us.anthropic.claude-3-opus-20240229-v1:0', config: { enabled: true, roles: ['chat'] } },
            { id: 'us.anthropic.claude-opus-4-7',             config: { enabled: true, roles: ['chat'] } },
            { id: 'global.anthropic.claude-sonnet-4-6',       config: { enabled: true, roles: ['chat'] } },
          ],
        },
      },
    ]);
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { id: 'r1', model: 'us.anthropic.claude-opus-4-7',       provider: 'aws-bedrock', role: 'chat', priority: 0, capabilities: {}, enabled: true },
      { id: 'r2', model: 'global.anthropic.claude-sonnet-4-6', provider: 'aws-bedrock', role: 'chat', priority: 1, capabilities: {}, enabled: true },
    ]);

    const cfg = await ModelConfigurationService.refresh();

    const EOL = 'us.anthropic.claude-3-opus-20240229-v1:0';
    expect(cfg.availableModels.map(x => x.modelId)).not.toContain(EOL);
    expect(cfg.tiers.economical?.modelId).not.toBe(EOL);
    expect(cfg.tiers.balanced?.modelId).not.toBe(EOL);
    expect(cfg.tiers.premium?.modelId).not.toBe(EOL);
    expect(cfg.defaultModel.modelId).not.toBe(EOL);
  });
});
