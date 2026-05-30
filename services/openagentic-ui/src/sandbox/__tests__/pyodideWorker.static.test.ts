import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The pyodide worker is spawned with `{ type: 'module' }` in sandboxManager.ts.
// Module-type workers cannot call `importScripts()` — attempting to do so
// throws `Failed to execute 'importScripts' on 'WorkerGlobalScope': Module
// scripts don't support importScripts()`, which made every
// browser_sandbox_exec call hang until the server-side timeout. This
// regression test pins the fix: the worker must bootstrap Pyodide via a
// dynamic `import()` of `pyodide.mjs` and must NOT call `importScripts`.
describe('pyodideWorker bootstrap', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const workerPath = resolve(here, '..', 'pyodideWorker.ts');
  const source = readFileSync(workerPath, 'utf8');

  it('does not use importScripts (incompatible with module worker)', () => {
    // Strip `//` single-line and `/* ... */` block comments so the check
    // only fires on real code references, not explanatory prose.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\*.*$/gm, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bimportScripts\s*\(/);
  });

  it('imports pyodide.mjs (ESM bootstrap) via dynamic import', () => {
    expect(source).toMatch(/import\s*\([^)]*pyodide\.mjs/);
  });

  it('does not declare or reference the global importScripts', () => {
    expect(source).not.toMatch(/declare\s+function\s+importScripts/);
  });
});
