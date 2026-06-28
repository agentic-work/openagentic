/**
 * Red-green lock for SoT fix in RAGHealthCheck (plan task 6a, File 2).
 *
 * Pre-fix (line 35):
 *   const embeddingModel = process.env.EMBEDDING_MODEL ||
 *                          process.env.DEFAULT_EMBEDDING_MODEL ||
 *                          process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
 *                          'text-embedding-3-small';  ← hardcoded model literal violation
 *
 * Fix:
 *   const embeddingAssignment = await ModelConfigurationService.getServiceModel('embedding');
 *   const embeddingModel = embeddingAssignment?.modelId ?? '';
 *
 * Scenarios:
 *   1. DB embedding model wins over poisoned env vars
 *   2. DB fails → empty string fallback (not env value, not hardcoded literal)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
    getServiceModel: vi.fn(),
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { RAGHealthCheckService } from '../RAGHealthCheck.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('RAGHealthCheckService — DB is SoT for embedding model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getServiceModel as any).mockReset();
    // Ensure MCP proxy is unconfigured so the check fails fast after model resolution
    delete process.env.MCP_PROXY_ENDPOINT;
    delete process.env.MCP_PROXY_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('DB embedding model wins over poisoned env vars', async () => {
    process.env.EMBEDDING_MODEL = 'env-poisoned-embed';
    process.env.DEFAULT_EMBEDDING_MODEL = 'env-poisoned-default-embed';
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = 'env-poisoned-azure-embed';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue({ modelId: 'db-embed' });

    const svc = new RAGHealthCheckService(makeLogger() as any);
    const result = await svc.checkRAGHealth();

    // The health check will fail (no MCP proxy configured) but the embeddingModel
    // field on the result should reflect the DB value, not the env values.
    expect(result.embeddingModel).toBe('db-embed');
    expect(result.embeddingModel).not.toBe('env-poisoned-embed');
    expect(result.embeddingModel).not.toBe('env-poisoned-default-embed');
    expect(result.embeddingModel).not.toBe('env-poisoned-azure-embed');
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('embedding');
  });

  it('DB fails → empty string fallback (not env value, not hardcoded literal)', async () => {
    process.env.EMBEDDING_MODEL = 'env-poisoned-embed';
    process.env.DEFAULT_EMBEDDING_MODEL = 'env-poisoned-default-embed';

    (ModelConfigurationService.getServiceModel as any).mockRejectedValue(new Error('DB down'));

    const svc = new RAGHealthCheckService(makeLogger() as any);
    const result = await svc.checkRAGHealth();

    // DB fails → embeddingAssignment is undefined-ish, ?? '' → ''
    expect(result.embeddingModel).toBe('');
    expect(result.embeddingModel).not.toBe('env-poisoned-embed');
    expect(result.embeddingModel).not.toBe('env-poisoned-default-embed');
    // Critically: the pre-fix hardcoded literal must NOT appear
    expect(result.embeddingModel).not.toBe('text-embedding-3-small');
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalled();
  });
});
