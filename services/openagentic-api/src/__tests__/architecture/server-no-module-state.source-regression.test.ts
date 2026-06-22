/**
 * Phase 1 source-regression test — AppContext migration.
 *
 * Asserts that:
 *  1. server.ts no longer has ANY module-scope `let` declarations for the
 *     12 variables that Phase 1 migrates into AppContext.
 *     Detection uses /^let \w+/m — only bare `let` at column 0 matches.
 *  2. The deprecated global bridge `(global as any).appContext = ctx` is
 *     GONE (Phase 4 deletes it).
 *  3. `decorateApp(server, ctx)` appears in server.ts.
 *  4. utils/bm25.ts still exists (anti-cleanup lock — Phase 3 scaffold).
 *
 * Phase 2 follow-up additions (spec-compliance review of f58f54e3):
 *  5. server.ts does NOT contain `function initializeServices` (dead husk deleted).
 *  6. 12-openapi-spec.ts does NOT exist on disk (dead step deleted).
 *  7. startup/index.ts STEPS array does NOT contain GEN_OPENAPI_SPEC.
 *
 * Phase 4 additions:
 *  8. Zero `(global as any).X =` write sites across all non-test src/ files.
 *     Test files are exempted (legitimate test harness stubs).
 *
 * Run from any CWD; paths are resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
// ../../../.. = repo root
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'services/openagentic-api/src');

const serverTs = readFileSync(join(API_SRC, 'server.ts'), 'utf-8');

/**
 * Variables that MUST NOT appear as module-scope `let` declarations in server.ts.
 * Module-scope is detected by `/^let <name>/m` — bare `let` at column zero.
 * Function-scoped `let`s (indented) are fine and not matched.
 */
const BANNED_MODULE_LETS = [
  'providerManager',
  'smartModelRouter',
  'chatStorage',
  'modelHealthCheck',
  'milvusClient',
  'milvusVectorService',
  'documentIndexingService',
  'ragService',
  'toolSemanticCache',
  'toolSemanticCacheInitialized',
  'repositoryContainer',
  'jobCompletionWatcher',
  'promptService',
] as const;

describe('Phase 1 — no module-scope let for migrated variables', () => {
  for (const varName of BANNED_MODULE_LETS) {
    it(`server.ts must NOT have a module-scope "let ${varName}"`, () => {
      const pattern = new RegExp(`^let ${varName}\\b`, 'm');
      expect(
        pattern.test(serverTs),
        `Found banned module-scope declaration: let ${varName}`,
      ).toBe(false);
    });
  }
});

describe('Phase 4 — deprecated global bridge deleted', () => {
  it('(global as any).appContext = ctx no longer appears in server.ts (Phase 4 removed it)', () => {
    const bridge = '(global as any).appContext = ctx';
    const occurrences = serverTs.split(bridge).length - 1;
    expect(occurrences).toBe(0);
  });
});

describe('Phase 1 — decorateApp wired into server.ts', () => {
  it('decorateApp(server, ctx) call is present in server.ts', () => {
    expect(serverTs).toContain('decorateApp(server, ctx)');
  });
});

describe('Phase 0 — anti-cleanup lock (carried forward from Phase 0 regression test)', () => {
  it('utils/bm25.ts still exists — intentional Phase-3 scaffold for no-embedding-model fallback', () => {
    expect(existsSync(join(API_SRC, 'utils/bm25.ts'))).toBe(true);
  });
});

describe('Phase 2 follow-up — FIX-3: dead initializeServices() deleted from server.ts', () => {
  it('server.ts does NOT contain "function initializeServices" (body extracted into step modules; dead husk removed)', () => {
    expect(serverTs).not.toMatch(/\bfunction initializeServices\b/);
  });

  it('server.ts does NOT contain "async function initializeServices" (variant check)', () => {
    expect(serverTs).not.toMatch(/async function initializeServices\b/);
  });

  it('server.ts does NOT contain "const initializeServices = async" (arrow-fn variant check)', () => {
    expect(serverTs).not.toMatch(/const initializeServices\s*=\s*async/);
  });
});

describe('Phase 2 follow-up — FIX-4: dead step 12 (openapi-spec) deleted', () => {
  it('startup/12-openapi-spec.ts does NOT exist on disk (step was dead — ran before routes registered)', () => {
    expect(existsSync(join(API_SRC, 'startup/12-openapi-spec.ts'))).toBe(false);
  });

  it('startup/__tests__/12-openapi-spec.test.ts does NOT exist on disk (orphan test deleted)', () => {
    expect(existsSync(join(API_SRC, 'startup/__tests__/12-openapi-spec.test.ts'))).toBe(false);
  });

  it('startup/index.ts STEPS array does NOT reference GEN_OPENAPI_SPEC', () => {
    const { readFileSync: readFS } = require('node:fs');
    const indexTs = readFS(join(API_SRC, 'startup/index.ts'), 'utf-8');
    expect(indexTs).not.toContain('GEN_OPENAPI_SPEC');
  });

  it('inline generateOpenAPISpec() call still exists in server.ts (the correct post-routes path)', () => {
    expect(serverTs).toContain('generateOpenAPISpec()');
  });
});

describe('Phase 2 quality cleanup — FLAGGED-5: orphan static imports removed from server.ts', () => {
  const orphanImports = [
    'InitializationService',
    'validateAdminPortalConfiguration',
    'ragInitService',
    'MCPToolIndexingService',
    'ToolPgvectorSearchService',
    'setToolPgvectorSearchService',
    'SmartModelRouter',
    'setSmartModelRouter',
    'getSmartModelRouter',
    'ProviderConfigService',
    'ModelCapabilityRegistry',
    'setModelCapabilityRegistry',
    'initializeHookRunner',
    'registerBuiltInHooks',
  ] as const;

  for (const sym of orphanImports) {
    it(`server.ts does NOT import ${sym} (moved to step files; only import line existed)`, () => {
      // Match only static import lines (not type references or dynamic imports)
      const importPattern = new RegExp(`^import[^\\n]*\\b${sym}\\b[^\\n]*from\\s+['"]\\.`, 'm');
      expect(importPattern.test(serverTs)).toBe(false);
    });
  }
});

describe('Phase 2 quality cleanup — FLAGGED-6: dead promptService check moved to step 09', () => {
  it('06-rag.ts does NOT contain the always-undefined ctx.promptService guard', () => {
    const ragTs = readFileSync(join(API_SRC, 'startup/06-rag.ts'), 'utf-8');
    // The dead check was: if (ctx.promptService) { ... validateSystemPrompts ... }
    expect(ragTs).not.toMatch(/if\s*\(\s*ctx\.promptService\s*\)/);
  });

  // validateSystemPrompts check RIPPED 2026-05-11 (the chat-pipeline refactor Phase E
  // final): the CachedPromptService that backed it is deleted along with
  // the PromptTemplate / UserPromptAssignment / SystemPrompt / PromptUsage
  // Prisma models. 09-prompt-cache.ts is now the RBAC system-prompt seed +
  // service init only — Layer-1 of the three-layer prompt architecture.
});

describe('Phase 2 quality cleanup — BLOCKER-4: ctx.milvusClient used in 06-rag.ts', () => {
  it('06-rag.ts does NOT read (global as any).milvusClient for UserMemoryService initialization', () => {
    const ragTs = readFileSync(join(API_SRC, 'startup/06-rag.ts'), 'utf-8');
    expect(ragTs).not.toMatch(/\(global as any\)\.milvusClient/);
  });

  it('06-rag.ts reads ctx.milvusClient for UserMemoryService initialization', () => {
    const ragTs = readFileSync(join(API_SRC, 'startup/06-rag.ts'), 'utf-8');
    expect(ragTs).toContain('ctx.milvusClient');
  });
});

describe('Phase 2 quality cleanup — FLAGGED-7: no hardcoded model ID in 04-providers.ts', () => {
  it("04-providers.ts does NOT contain hardcoded 'gpt-oss' model literal", () => {
    const providersTs = readFileSync(join(API_SRC, 'startup/04-providers.ts'), 'utf-8');
    expect(providersTs).not.toContain("'gpt-oss'");
    expect(providersTs).not.toContain('"gpt-oss"');
  });

  it('04-providers.ts reads OLLAMA_WARMUP_MODEL env var for warm-up', () => {
    const providersTs = readFileSync(join(API_SRC, 'startup/04-providers.ts'), 'utf-8');
    expect(providersTs).toContain('OLLAMA_WARMUP_MODEL');
  });
});

describe('Phase 3.1 quality cleanup — orphan construction block removed from server.ts', () => {
  it('server.ts does NOT import ChatCompletionService (moved to routes/chat; orphan import deleted)', () => {
    expect(serverTs).not.toContain('ChatCompletionService');
  });

  it('server.ts does NOT import ChatCacheService (moved to routes/chat; orphan import deleted)', () => {
    expect(serverTs).not.toContain('ChatCacheService');
  });

  it('server.ts does NOT contain redisClientForCache (orphan construction block deleted)', () => {
    expect(serverTs).not.toContain('redisClientForCache');
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — zero (global as any).X write sites across all non-test src/ files
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .ts files under a directory, excluding .test.ts.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('Phase 4 — no (global as any).X write sites in non-test source files', () => {
  const writePattern = /\(global as any\)\.\w+\s*=/;

  it('zero (global as any).X = ... write sites remain across all src/ non-test .ts files', () => {
    const srcFiles = collectSourceFiles(API_SRC);
    const violations: string[] = [];

    for (const filePath of srcFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Skip comment lines (single-line // or JSDoc * lines)
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (writePattern.test(line)) {
          violations.push(`${filePath}:${idx + 1}: ${trimmed}`);
        }
      });
    }

    expect(violations, `Found (global as any).X = write sites:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
