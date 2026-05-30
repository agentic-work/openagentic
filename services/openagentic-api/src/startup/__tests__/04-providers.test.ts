/**
 * Step 04 — providers-init
 * RED-first: step file does not exist yet.
 *
 * Phase 2 quality cleanup (FLAGGED-7): CLAUDE.md violation — hardcoded 'gpt-oss'
 * model ID replaced with OLLAMA_WARMUP_MODEL env var. Warm-up skipped if unset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppContext } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

const mockProviderManagerInit = vi.fn().mockResolvedValue(undefined);
const mockLoadProviderConfig = vi.fn().mockResolvedValue({ providers: [] });
const mockCreateCompletion = vi.fn().mockResolvedValue({});
const MockProviderManager = vi.fn().mockImplementation(() => ({
  initialize: mockProviderManagerInit,
  getAllModels: vi.fn().mockReturnValue([]),
  createCompletion: mockCreateCompletion,
  updateFromFeedback: vi.fn().mockResolvedValue(undefined),
  getProvider: vi.fn().mockReturnValue(null),
}));
const MockProviderConfigService = vi.fn().mockImplementation(() => ({
  loadProviderConfig: mockLoadProviderConfig,
}));

vi.mock('../../services/llm-providers/ProviderManager.js', () => ({
  ProviderManager: MockProviderManager,
  setProviderManager: vi.fn(),
  subscribeProviderReload: vi.fn().mockReturnValue(Promise.resolve()),
}));

vi.mock('../../services/llm-providers/ProviderConfigService.js', () => ({
  ProviderConfigService: MockProviderConfigService,
}));

vi.mock('../../services/ModelCapabilityRegistry.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllModels: vi.fn().mockReturnValue([]),
  })),
  setModelCapabilityRegistry: vi.fn(),
}));

vi.mock('../../services/ModelHealthCheck.js', () => ({
  ModelHealthCheckService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../services/SmartModelRouter.js', () => ({
  SmartModelRouter: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllModels: vi.fn().mockReturnValue([]),
    updateFromFeedback: vi.fn().mockResolvedValue(undefined),
  })),
  setSmartModelRouter: vi.fn(),
  getSmartModelRouter: vi.fn(),
}));

vi.mock('../../services/model-routing/index.js', () => ({
  initializeModelRouter: vi.fn(),
}));

vi.mock('../../services/model-routing/RegistrySyncJob.js', () => ({
  RegistrySyncJob: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    syncAll: vi.fn().mockResolvedValue({ perProvider: {} }),
  })),
  setRegistrySyncJob: vi.fn(),
  getRegistrySyncJob: vi.fn().mockReturnValue(null),
}));

vi.mock('../../services/AgentRegistry.js', () => ({
  AgentRegistry: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../routes/workflows.js', () => ({
  autoSeedWorkflowTemplates: vi.fn().mockResolvedValue({ created: 0, updated: 0, skipped: 0 }),
}));

vi.mock('../../services/DLPScannerService.js', () => ({
  initializeDLPScanner: vi.fn().mockResolvedValue({
    getRules: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    lLMProvider: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { INIT_PROVIDERS } from '../04-providers.js';
import type { BootstrapDeps } from '../types.js';

function makeCtx() {
  const ctx = new AppContext({ prisma: {} as any, logger: {} as any });
  return ctx;
}

const stubDeps = (ctx = makeCtx()): BootstrapDeps => ({
  server: {} as any,
  ctx,
});

describe('INIT_PROVIDERS step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OLLAMA_WARMUP_MODEL;
  });

  afterEach(() => {
    delete process.env.OLLAMA_WARMUP_MODEL;
  });

  it('has correct name and critical=false', () => {
    expect(INIT_PROVIDERS.name).toBe('providers-init');
    expect(INIT_PROVIDERS.critical).toBe(false);
  });

  it('sets ctx.providerManager after run', async () => {
    const ctx = makeCtx();
    await INIT_PROVIDERS.run(stubDeps(ctx));
    expect(ctx.providerManager).toBeDefined();
  });

  it('does NOT throw when ProviderManager.initialize() throws (non-critical)', async () => {
    mockProviderManagerInit.mockRejectedValueOnce(new Error('provider unavailable'));
    const ctx = makeCtx();
    await expect(INIT_PROVIDERS.run(stubDeps(ctx))).resolves.toBeUndefined();
  });

  describe('FLAGGED-7: Ollama warm-up env-driven (no hardcoded model ID)', () => {
    it('does NOT call createCompletion when OLLAMA_WARMUP_MODEL is unset', async () => {
      delete process.env.OLLAMA_WARMUP_MODEL;
      const ctx = makeCtx();
      await INIT_PROVIDERS.run(stubDeps(ctx));
      // createCompletion must not have been called at all (warm-up skipped)
      expect(mockCreateCompletion).not.toHaveBeenCalled();
    });

    it('calls createCompletion with OLLAMA_WARMUP_MODEL value when env var is set', async () => {
      process.env.OLLAMA_WARMUP_MODEL = 'my-custom-model:latest';
      const ctx = makeCtx();
      await INIT_PROVIDERS.run(stubDeps(ctx));
      expect(mockCreateCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'my-custom-model:latest' })
      );
    });
  });
});
