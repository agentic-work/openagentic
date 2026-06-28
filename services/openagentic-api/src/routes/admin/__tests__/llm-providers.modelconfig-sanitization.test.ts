/**
 * Provider-create regression — `model_config` must be sanitized of
 * model-list fields on POST /api/admin/llm-providers.
 *
 * Live evidence (2026-04-30): user adds a Bedrock provider via the wizard
 * without selecting any models. The persisted row's `model_config` is:
 *   {
 *     chatModel: "nvidia.nemotron-nano-12b-v2",     ← phantom default
 *     embeddingModel: "amazon.nova-2-multimodal-embeddings-v1:0", ← phantom
 *     additionalModels: [88 model IDs from discovery]              ← flood
 *   }
 * The wizard's Test-Connection step runs `discoverModels()` and the UI
 * stuffs the catalog into `modelConfig` before POSTing. The server stores
 * it verbatim, violating the "Registry == explicit add" rule.
 *
 * Contract pinned here:
 *   1. Provider-create accepts `modelConfig` in the body but the server
 *      MUST strip model-list fields (chatModel / embeddingModel /
 *      additionalModels / codeModel / defaultModel) before persistence.
 *      Provider creation = creds + non-model config only.
 *   2. Registry is the single source of truth for which models are
 *      available on a provider. Models enter Registry through:
 *        - Admin "Add Model" wizard (POST /llm-providers/:id/models), OR
 *        - For curated-upstream providers (AIF, Ollama), the post-create
 *          `discoverModels()` → `upsertDiscoveredModels()` flow that
 *          writes Registry rows directly (NOT model_config).
 *   3. `sanitizeProviderModelConfig(input)` is the helper that performs
 *      the strip, exported for unit-testability.
 *
 * Source-grep gates the wiring; unit asserts the sanitizer's behavior.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The POST /llm-providers handler + sanitizeProviderModelConfig helper moved
// into the provider-CRUD sub-module during the routes/admin/llm-providers.ts
// split. (The runtime helper is still re-exported from '../llm-providers.js'.)
const routeSrcPath = join(__dirname, '..', 'llm-providers', 'providers-crud.routes.ts');

describe('POST /api/admin/llm-providers — model_config sanitization (#459 follow-up)', () => {
  const src = readFileSync(routeSrcPath, 'utf-8');

  it('exports a sanitizeProviderModelConfig helper from the route module', () => {
    // The helper must exist (named export OR top-level function) so unit
    // tests + future callers can reuse it.
    expect(src).toMatch(/(?:export\s+)?function\s+sanitizeProviderModelConfig\s*\(/);
  });

  it('uses sanitizeProviderModelConfig on the POST body before persisting', () => {
    // Find the prisma.lLMProvider.create call inside the POST handler.
    const createIdx = src.indexOf('prisma.lLMProvider.create');
    expect(createIdx).toBeGreaterThan(0);

    // The 600-char window around the create call must contain a call to
    // sanitizeProviderModelConfig. Catches regressions where someone wires
    // raw `modelConfig` into the data block.
    const window = src.slice(Math.max(0, createIdx - 600), createIdx + 400);
    expect(window).toMatch(/model_config\s*:\s*sanitizeProviderModelConfig\s*\(/);
    // Negative: no raw `model_config: modelConfig,` left behind.
    expect(window).not.toMatch(/model_config\s*:\s*modelConfig\s*,/);
  });
});

describe('sanitizeProviderModelConfig — pure helper behavior', () => {
  // Lazy import so the source-grep tests above can fail RED without
  // requiring the helper to exist yet at module-load time. Once the GREEN
  // implementation lands, this dynamic import resolves cleanly.
  const importHelper = async () => {
    const mod: any = await import('../llm-providers.js').catch(() => null);
    return mod?.sanitizeProviderModelConfig as ((x: any) => Record<string, any>) | undefined;
  };

  it('strips chatModel / embeddingModel / additionalModels / codeModel / defaultModel', async () => {
    const fn = await importHelper();
    if (!fn) {
      // RED: helper not exported yet.
      expect(fn, 'sanitizeProviderModelConfig must be exported from llm-providers.ts').toBeDefined();
      return;
    }
    const out = fn({
      chatModel: 'nvidia.nemotron-nano-12b-v2',
      embeddingModel: 'amazon.nova-2-multimodal-embeddings-v1:0',
      additionalModels: ['x', 'y', 'z'],
      codeModel: 'q',
      defaultModel: 'r',
      // Non-model-list fields that SHOULD survive (provider-level config):
      maxTokens: 16000,
      temperature: 0.7,
      embeddingDimension: 768,
    });
    expect(out).not.toHaveProperty('chatModel');
    expect(out).not.toHaveProperty('embeddingModel');
    expect(out).not.toHaveProperty('additionalModels');
    expect(out).not.toHaveProperty('codeModel');
    expect(out).not.toHaveProperty('defaultModel');
    // Survivors:
    expect(out.maxTokens).toBe(16000);
    expect(out.temperature).toBe(0.7);
    expect(out.embeddingDimension).toBe(768);
  });

  it('returns an empty object when input is undefined / null / non-object', async () => {
    const fn = await importHelper();
    if (!fn) {
      expect(fn).toBeDefined();
      return;
    }
    expect(fn(undefined)).toEqual({});
    expect(fn(null)).toEqual({});
    expect(fn('not-an-object')).toEqual({});
    expect(fn(42)).toEqual({});
  });

  it('returns an empty object when input is the wizard regression payload', async () => {
    const fn = await importHelper();
    if (!fn) {
      expect(fn).toBeDefined();
      return;
    }
    // Exact shape of the live regression captured 2026-04-30.
    const wizardPayload = {
      chatModel: 'nvidia.nemotron-nano-12b-v2',
      embeddingModel: 'amazon.nova-2-multimodal-embeddings-v1:0',
      additionalModels: Array.from({ length: 88 }, (_, i) => `model-${i}`),
    };
    expect(fn(wizardPayload)).toEqual({});
  });
});
