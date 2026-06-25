/**
 * Regression tests for the docs-scrape → vite-build wiring in package.json.
 *
 * The critical invariant: every `npm run build` of the UI MUST regenerate
 * `public/docs/generated/_version.json` so the API's RAGInitService can
 * detect manifest-hash drift and re-ingest docs into the Milvus
 * `platform_docs` collection.
 *
 * The wiring has four moving parts — any one of them silently removed
 * means the docs RAG collection goes stale. This test file pins them all:
 *
 *   1. package.json `build` script must invoke generate:docs (either via
 *      the `prebuild` lifecycle hook, an explicit `&&` chain, or the
 *      maybe-generate-docs.mjs wrapper).
 *   2. `prebuild` hook (belt+suspenders in case `build` is shortened).
 *   3. `generate:docs` script exists and points at generate-docs.ts.
 *   4. The `maybe-generate-docs.mjs` wrapper exists (so SKIP_DOCS_GENERATE
 *      honors the Dockerfile ui-builder stage).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(__dirname, '..', '..');
const PKG_PATH = resolve(UI_ROOT, 'package.json');

function readPkg(): Record<string, any> {
  return JSON.parse(readFileSync(PKG_PATH, 'utf8'));
}

describe('UI build → docs-scrape wiring (task: docs autoingest automation)', () => {
  test('package.json has a generate:docs script pointing at generate-docs.ts', () => {
    const pkg = readPkg();
    expect(pkg.scripts?.['generate:docs']).toBeDefined();
    expect(pkg.scripts['generate:docs']).toMatch(/(docs\/generate|generate-docs)\.ts/);
  });

  test('npm run build invokes the docs generator (directly or via the wrapper)', () => {
    const pkg = readPkg();
    const buildScript: string = pkg.scripts?.build || '';

    // Must chain-call something that generates docs. Accept any of:
    //   - `npm run generate:docs && vite build`
    //   - `node scripts/maybe-generate-docs.mjs && vite build`
    //   - tsx scripts/generate-docs.ts && vite build
    const triggersGen =
      /generate:docs/.test(buildScript) ||
      /maybe-generate-docs/.test(buildScript) ||
      /(docs\/generate|generate-docs)\.ts/.test(buildScript);

    expect(
      triggersGen,
      `package.json "build" script must invoke docs generation before vite. ` +
      `Current: "${buildScript}"`,
    ).toBe(true);
  });

  test('prebuild lifecycle hook runs the docs generator (belt+suspenders)', () => {
    const pkg = readPkg();
    const prebuild: string = pkg.scripts?.prebuild || '';

    const triggersGen =
      /generate:docs/.test(prebuild) ||
      /maybe-generate-docs/.test(prebuild) ||
      /(docs\/generate|generate-docs)\.ts/.test(prebuild);

    expect(
      triggersGen,
      `package.json "prebuild" hook must invoke docs generation. ` +
      `npm auto-runs prebuild before build even if build is rewritten to drop the inline call. ` +
      `Current: "${prebuild}"`,
    ).toBe(true);
  });

  test('maybe-generate-docs.mjs wrapper exists and respects SKIP_DOCS_GENERATE', () => {
    const wrapperPath = resolve(UI_ROOT, 'scripts', 'maybe-generate-docs.mjs');
    expect(existsSync(wrapperPath)).toBe(true);

    const src = readFileSync(wrapperPath, 'utf8');
    // Dockerfile ui-builder stage sets SKIP_DOCS_GENERATE=1 — the wrapper
    // must bail out cleanly when it's set.
    expect(src).toMatch(/SKIP_DOCS_GENERATE/);
    // And it must know how to invoke generate-docs.ts when NOT skipped.
    expect(src).toMatch(/(docs\/generate|generate-docs)\.ts/);
  });

  test('the docs generator exists at the path the scripts reference', () => {
    // Cutover 2026-05-13 — replaced scripts/generate-docs.ts with
    // scripts/docs/generate.ts (unified manifest-driven generator). Accept
    // either path for forward-compat with any old infra still referencing
    // the legacy name.
    const newPath = resolve(UI_ROOT, 'scripts', 'docs', 'generate.ts');
    const legacyPath = resolve(UI_ROOT, 'scripts', 'generate-docs.ts');
    expect(existsSync(newPath) || existsSync(legacyPath)).toBe(true);
  });
});
