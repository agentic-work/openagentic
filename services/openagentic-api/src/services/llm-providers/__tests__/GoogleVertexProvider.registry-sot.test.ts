/**
 * Registry SoT v1 (F3) — GoogleVertexProvider model resolution.
 *
 * The provider must NOT fall back to the cross-provider `process.env.DEFAULT_MODEL`
 * (chat) or `process.env.EMBEDDING_MODEL` (embedding) env vars. Those are
 * shared across providers and frequently point at an Ollama / non-Vertex model,
 * so reading them from the Vertex provider produces a wrong/invalid model id.
 *
 * Correct resolution order:
 *   chat:       request.model || VERTEX_DEFAULT_MODEL
 *                 || ModelConfigurationService.getDefaultChatModel()
 *   embedding:  VERTEX_AI_EMBEDDING_MODEL
 *                 || RegistryReader.getDefaultModel('embedding').model
 *
 * Both resolvers read the Registry (admin.model_role_assignments) — the
 * single source of truth. This pins that the provider routes through the
 * Registry resolver and never the forbidden cross-provider env fallbacks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROVIDER_SRC = join(__dirname, '..', 'GoogleVertexProvider.ts');

describe('GoogleVertexProvider — Registry SoT model resolution', () => {
  const source = readFileSync(PROVIDER_SRC, 'utf8');

  it('does NOT read the cross-provider process.env.DEFAULT_MODEL fallback', () => {
    expect(source).not.toMatch(/process\.env\.DEFAULT_MODEL\b/);
  });

  it('does NOT read the cross-provider process.env.EMBEDDING_MODEL fallback', () => {
    expect(source).not.toMatch(/process\.env\.EMBEDDING_MODEL\b/);
  });

  it('resolves the chat role via the Registry SoT resolver (getDefaultChatModel)', () => {
    expect(source).toMatch(/getDefaultChatModel/);
  });

  it('resolves the embedding role via the Registry SoT resolver (RegistryReader.getDefaultModel)', () => {
    expect(source).toMatch(/RegistryReader/);
    expect(source).toMatch(/getDefaultModel\(['"]embedding['"]\)/);
  });

  it('still honors the provider-specific bootstrap env vars first', () => {
    expect(source).toMatch(/process\.env\.VERTEX_DEFAULT_MODEL\b/);
    expect(source).toMatch(/process\.env\.VERTEX_AI_EMBEDDING_MODEL\b/);
  });
});
