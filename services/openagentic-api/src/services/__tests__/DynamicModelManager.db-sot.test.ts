/**
 * Red-green lock for SoT fix in DynamicModelManager (plan task 6a, File 6).
 *
 * Pre-fix (lines 52-56):
 *   const embeddingModel = process.env.EMBEDDING_MODEL ||
 *                          process.env.EMBEDDING_OLLAMA_MODEL ||
 *                          process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
 *                          process.env.VERTEX_AI_EMBEDDING_MODEL ||
 *                          process.env.AWS_BEDROCK_EMBEDDING_MODEL;
 *
 * Fix:
 *   const embeddingAssignment = await ModelConfigurationService.getServiceModel('embedding');
 *   const embeddingModel = embeddingAssignment?.modelId ?? '';
 *
 * Note: line 63 (EMBEDDING_PROVIDER) is a provider-type label, NOT a model ID — left untouched.
 *
 * Scenarios:
 *   1. DB embedding model wins over poisoned env vars
 *   2. DB fails → null result (not env value)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
    getServiceModel: vi.fn(),
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
// DynamicModelManager exports a singleton instance, not the class directly.
// We import the module and call getEmbeddingModel() on it.
import { dynamicModelManager } from '../DynamicModelManager.js';

describe('DynamicModelManager — DB is SoT for embedding model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getServiceModel as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('DB embedding model wins over poisoned env vars', async () => {
    process.env.EMBEDDING_MODEL = 'env-poisoned-embed';
    process.env.EMBEDDING_OLLAMA_MODEL = 'env-poisoned-ollama';
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = 'env-poisoned-azure-embed';
    process.env.VERTEX_AI_EMBEDDING_MODEL = 'env-poisoned-vertex-embed';
    process.env.AWS_BEDROCK_EMBEDDING_MODEL = 'env-poisoned-bedrock-embed';
    // Set dimension so the call returns a result object
    process.env.EMBEDDING_DIMENSIONS = '1536';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue({ modelId: 'db-embed' });

    const result = await dynamicModelManager.getEmbeddingModel();

    expect(result).not.toBeNull();
    expect(result!.model).toBe('db-embed');
    expect(result!.model).not.toBe('env-poisoned-embed');
    expect(result!.model).not.toBe('env-poisoned-ollama');
    expect(result!.model).not.toBe('env-poisoned-azure-embed');
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('embedding');
  });

  it('DB fails → null returned (not env value)', async () => {
    process.env.EMBEDDING_MODEL = 'env-poisoned-embed';
    process.env.EMBEDDING_OLLAMA_MODEL = 'env-poisoned-ollama';
    process.env.EMBEDDING_DIMENSIONS = '1536';

    (ModelConfigurationService.getServiceModel as any).mockRejectedValue(new Error('DB down'));

    const result = await dynamicModelManager.getEmbeddingModel();

    // When DB fails and embeddingModel resolves to '', the function returns null (no model configured)
    expect(result).toBeNull();
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('embedding');
  });
});
