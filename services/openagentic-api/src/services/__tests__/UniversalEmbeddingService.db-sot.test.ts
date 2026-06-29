/**
 * Red test for SoT violation #1: UniversalEmbeddingService.detectAndLoadConfig
 * consulted process.env.EMBEDDING_PROVIDER BEFORE _dbEmbeddingConfig.
 * The committed comment at the top of the branch literally said
 *   "deploy-time config wins over DB"
 * which inverts the DB-SoT rule.
 *
 * Contract: when the DB has an embedding provider set (via setDbEmbeddingConfig),
 * the service MUST honor the DB choice — even if an old EMBEDDING_PROVIDER env
 * var points elsewhere. Env is a fallback only when no DB row is present.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// We deliberately don't mock AzureOpenAI — its constructor is data-only
// (stores endpoint/apiKey, doesn't connect). Same for BedrockRuntimeClient.
// The Ollama path has no SDK constructor to worry about.

import {
  UniversalEmbeddingService,
  setDbEmbeddingConfig,
} from '../UniversalEmbeddingService.js';

function newSvc() {
  return new UniversalEmbeddingService();
}

describe('UniversalEmbeddingService — DB is SoT for embedding provider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear every env var the service consults
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('EMBEDDING_') ||
          k.startsWith('AZURE_OPENAI_') ||
          k.startsWith('AWS_EMBEDDING_') ||
          k.startsWith('OLLAMA_') ||
          k.startsWith('GCP_EMBEDDING_') ||
          k.startsWith('VERTEX_AI_EMBEDDING_')) {
        delete process.env[k];
      }
    }
    setDbEmbeddingConfig(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setDbEmbeddingConfig(null);
    vi.clearAllMocks();
  });

  it('picks DB-chosen provider even when EMBEDDING_PROVIDER env points elsewhere', () => {
    // DB says azure. Env screams ollama. DB must win.
    setDbEmbeddingConfig({
      provider: 'azure-openai',
      azureEndpoint: 'https://db.openai.azure.com',
      azureApiKey: 'db-key',
      azureDeployment: 'text-embedding-3-large',
      azureApiVersion: '2024-02-15-preview',
      dimensions: 3072,
    });
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.OLLAMA_ENABLED = 'true';
    process.env.OLLAMA_BASE_URL = 'http://x.x.x.x:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';

    const svc = newSvc();

    // Public getter is not exposed; the provider is exposed via getModelName()
    // (azure → deployment name, ollama → model name). Use private for clarity.
    expect((svc as any).provider).toBe('azure-openai');
  });

  it('falls back to EMBEDDING_PROVIDER env when DB is empty (bootstrap)', () => {
    setDbEmbeddingConfig(null);
    process.env.EMBEDDING_PROVIDER = 'azure-openai';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://env.openai.azure.com';
    process.env.AZURE_OPENAI_API_KEY = 'env-key';
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = 'text-embedding-3-large';

    const svc = newSvc();
    expect((svc as any).provider).toBe('azure-openai');
  });

  it('DB ollama beats env azure-openai', () => {
    setDbEmbeddingConfig({
      provider: 'ollama',
      ollamaBaseUrl: 'http://db-host:11434',
      ollamaModel: 'nomic-embed-text',
      dimensions: 768,
    });
    process.env.OLLAMA_ENABLED = 'true';
    process.env.EMBEDDING_PROVIDER = 'azure-openai';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://env.openai.azure.com';
    process.env.AZURE_OPENAI_API_KEY = 'env-key';
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = 'text-embedding-3-large';

    const svc = newSvc();
    expect((svc as any).provider).toBe('ollama');
  });
});
