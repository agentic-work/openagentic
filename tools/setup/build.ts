/**
 * Build script for @openagentic/setup wizard.
 * Bundles src/index.tsx + all imports into dist/index.js using esbuild.
 * The output runs with plain `node dist/index.js` — no tsx, no TypeScript
 * compiler needed at runtime, so `npx @openagentic/setup` works with any
 * Node 20+ installation.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(join(__dirname, 'dist'), { recursive: true });

await build({
  entryPoints: [join(__dirname, 'src/index.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(__dirname, 'dist/index.js'),
  // Ink, React, and execa must stay external so they resolve from the
  // installed node_modules (they have native ESM that can't be bundled cleanly).
  external: ['ink', 'react', 'react-dom', 'execa', 'open', 'figures', 'react-devtools-core'],
  // Keep the shebang so the compiled file is directly executable
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  minify: false,   // readable output for debugging install issues
  logLevel: 'info',
});

console.log('✓ dist/index.js built');
