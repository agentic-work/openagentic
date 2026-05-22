/**
 * Red test for SoT violation #3: ProviderConfigService.loadProviderConfig
 * used `process.env.DEFAULT_LLM_PROVIDER || providers[0]?.name` as the
 * defaultProvider, which let the env var override the DB-priority ordering.
 *
 * Contract: when the DB has enabled providers sorted by priority, the
 * default MUST be providers[0].name regardless of any DEFAULT_LLM_PROVIDER
 * env var.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';

vi.mock('../../../utils/prisma.js', () => {
  const mock = {
    lLMProvider: {
      findMany: vi.fn(),
    },
  };
  (globalThis as any).__prismaMock2 = mock;
  return { prisma: mock };
});

// Force mock registration (service imports prisma dynamically)
import '../../../utils/prisma.js';

import { ProviderConfigService } from '../ProviderConfigService.js';

function prismaMock() {
  return (globalThis as any).__prismaMock2 as {
    lLMProvider: { findMany: ReturnType<typeof vi.fn> };
  };
}

const silentLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as Logger;

describe('ProviderConfigService — DB is SoT for defaultProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    prismaMock().lLMProvider.findMany.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('picks providers[0].name (DB priority) even when DEFAULT_LLM_PROVIDER env points elsewhere', async () => {
    prismaMock().lLMProvider.findMany.mockResolvedValue([
      {
        id: 'p-azure',
        name: 'azure-db',
        provider_type: 'azure-openai',
        display_name: 'Azure (DB)',
        priority: 0,
        enabled: true,
        deleted_at: null,
        auth_config: {},
        provider_config: { endpoint: 'https://x.openai.azure.com' },
        model_config: {},
      },
      {
        id: 'p-ollama',
        name: 'ollama-db',
        provider_type: 'ollama',
        display_name: 'Ollama (DB)',
        priority: 10,
        enabled: true,
        deleted_at: null,
        auth_config: {},
        provider_config: { endpoint: 'http://localhost:11434' },
        model_config: {},
      },
    ]);
    process.env.DEFAULT_LLM_PROVIDER = 'ollama-db'; // env tries to override DB priority

    const svc = new ProviderConfigService(silentLogger);
    const cfg = await svc.loadProviderConfig();

    expect(cfg.defaultProvider).toBe('azure-db');
  });

  it('picks providers[0].name when DEFAULT_LLM_PROVIDER env is absent', async () => {
    prismaMock().lLMProvider.findMany.mockResolvedValue([
      {
        id: 'p-a',
        name: 'first-by-priority',
        provider_type: 'azure-openai',
        display_name: 'First',
        priority: 0,
        enabled: true,
        deleted_at: null,
        auth_config: {},
        provider_config: { endpoint: 'https://x' },
        model_config: {},
      },
    ]);
    delete process.env.DEFAULT_LLM_PROVIDER;

    const svc = new ProviderConfigService(silentLogger);
    const cfg = await svc.loadProviderConfig();

    expect(cfg.defaultProvider).toBe('first-by-priority');
  });
});
