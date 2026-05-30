#!/usr/bin/env node
/**
 * maybe-generate-docs.mjs
 *
 * Wrapper that runs generate-docs.ts unless SKIP_DOCS_GENERATE=1 is set.
 *
 * Why this exists
 * ---------------
 * Two execution contexts call `npm run build`:
 *
 *   1. Local dev / CI via Docker build (`./scripts/build.sh openagentic-ui`
 *      → docker buildx → Dockerfile stage `ui-builder`): the Dockerfile
 *      uses a dedicated `docs-generator` stage with the full `services/`
 *      tree and companion repos mounted. It writes manifests to
 *      `/repo/services/openagentic-ui/public/docs/generated`, which are
 *      then COPY --from=docs-generator'd into the `ui-builder` stage
 *      before `RUN npm run build`.
 *
 *      If `npm run build` inside `ui-builder` ALSO ran generate-docs.ts,
 *      it would re-scan — but `ui-builder` intentionally doesn't copy
 *      the `services/` tree or companion repos (cache-layer hygiene), so
 *      every generator returns null → `manifests.length === 0` →
 *      `process.exit(1)` → build failure, or worse, silent overwrite
 *      with empty manifests.
 *
 *      Dockerfile sets `SKIP_DOCS_GENERATE=1` for this stage → this
 *      wrapper is a no-op. Stage 1 already emitted the manifests.
 *
 *   2. Local developer iteration (`cd services/openagentic-ui && npm run
 *      build`): SKIP_DOCS_GENERATE unset → invokes generate-docs.ts →
 *      manifests regenerated from the working tree. On any source
 *      change, the manifestHash flips, and the next time the API boots
 *      (or POST /api/docs/ingest is called), RAGInitService.reconcile-
 *      DocsIngest() re-ingests into the Milvus platform_docs collection.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Cutover 2026-05-13 — points at unified docs generator (scripts/docs/generate.ts)
// which replaces the 31 hand-rolled scripts/doc-generators/*.gen.ts files.
const target = resolve(__dirname, 'docs', 'generate.ts');

const skip = process.env.SKIP_DOCS_GENERATE === '1' || process.env.SKIP_DOCS_GENERATE === 'true';

if (skip) {
  console.log('[maybe-generate-docs] SKIP_DOCS_GENERATE set — skipping generate-docs.ts');
  console.log('[maybe-generate-docs]   (expected inside Dockerfile ui-builder; Stage 1 docs-generator already emitted manifests)');
  process.exit(0);
}

console.log('[maybe-generate-docs] running generate-docs.ts via npx tsx');
const child = spawn('npx', ['tsx', target], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[maybe-generate-docs] generate-docs.ts killed by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[maybe-generate-docs] failed to spawn npx tsx:', err);
  process.exit(1);
});
