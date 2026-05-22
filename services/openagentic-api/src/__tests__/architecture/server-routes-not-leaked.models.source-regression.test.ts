/**
 * Phase 3.4 source-regression test — models-domain routes extraction.
 *
 * Asserts that after Phase 3.4:
 *  1. server.ts does NOT dynamic-import embeddingsRoutes from routes/embeddings.js
 *  2. server.ts does NOT dynamic-import adminEmbeddingsRoutes from routes/admin-embeddings.js
 *  3. server.ts does NOT dynamic-import aiMlServicesPlugin from routes/ai-ml-services/index.js
 *  4. server.ts does NOT dynamic-import capabilityRoutes from routes/capabilities.js
 *  5. server.ts does NOT dynamic-import modelSelectorRoutes from routes/model-selector.js
 *  6. server.ts DOES contain `register(modelsRoutesPlugin` (the call site,
 *     not just a bare symbol — per Phase 3.1 lesson #1: assert the call site).
 *
 * Run from any CWD; all paths resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'services/openagentic-api/src');

const serverTs = readFileSync(join(API_SRC, 'server.ts'), 'utf-8');

describe('Phase 3.4 — models domain dynamic imports removed from server.ts', () => {
  it('server.ts does NOT dynamic-import embeddingsRoutes (moved to models.plugin.ts)', () => {
    // Pre-3.4 pattern: const { default: embeddingsRoutes } = await import('./routes/embeddings.js')
    expect(serverTs).not.toContain("routes/embeddings.js'");
    expect(serverTs).not.toContain('routes/embeddings.js"');
    expect(serverTs).not.toContain("'./routes/embeddings'");
    expect(serverTs).not.toContain('"./routes/embeddings"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*embeddingsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import adminEmbeddingsRoutes (moved to models.plugin.ts)', () => {
    // Pre-3.4 pattern: const { default: adminEmbeddingsRoutes } = await import('./routes/admin-embeddings.js')
    expect(serverTs).not.toContain("routes/admin-embeddings.js'");
    expect(serverTs).not.toContain('routes/admin-embeddings.js"');
    expect(serverTs).not.toContain("'./routes/admin-embeddings'");
    expect(serverTs).not.toContain('"./routes/admin-embeddings"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminEmbeddingsRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import aiMlServicesPlugin (moved to models.plugin.ts)', () => {
    // Pre-3.4 pattern: const { aiMlServicesPlugin } = await import('./routes/ai-ml-services/index.js')
    expect(serverTs).not.toContain("ai-ml-services/index.js'");
    expect(serverTs).not.toContain('ai-ml-services/index.js"');
    expect(serverTs).not.toContain("'./routes/ai-ml-services/index'");
    expect(serverTs).not.toContain('"./routes/ai-ml-services/index"');
    expect(serverTs).not.toMatch(/const\s*\{\s*aiMlServicesPlugin\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import capabilityRoutes (moved to models.plugin.ts)', () => {
    // Pre-3.4 pattern: const { default: capabilityRoutes } = await import('./routes/capabilities.js')
    expect(serverTs).not.toContain("routes/capabilities.js'");
    expect(serverTs).not.toContain('routes/capabilities.js"');
    expect(serverTs).not.toContain("'./routes/capabilities'");
    expect(serverTs).not.toContain('"./routes/capabilities"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*capabilityRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import modelSelectorRoutes (moved to models.plugin.ts)', () => {
    // Pre-3.4 pattern: const { modelSelectorRoutes } = await import('./routes/model-selector.js')
    expect(serverTs).not.toContain("routes/model-selector.js'");
    expect(serverTs).not.toContain('routes/model-selector.js"');
    expect(serverTs).not.toContain("'./routes/model-selector'");
    expect(serverTs).not.toContain('"./routes/model-selector"');
    expect(serverTs).not.toMatch(/const\s*\{\s*modelSelectorRoutes\s*\}\s*=/);
  });
});

describe('Phase 3.4 — modelsRoutesPlugin is registered in server.ts', () => {
  it('server.ts DOES contain register(modelsRoutesPlugin (the call site, not just symbol)', () => {
    // Lock the actual register call site per Phase 3.1 lesson #1:
    // a bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(modelsRoutesPlugin');
  });

  it('server.ts DOES import modelsRoutesPlugin from plugins/models.plugin.js', () => {
    expect(serverTs).toContain('models.plugin');
  });
});
