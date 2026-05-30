import { describe, it, expect } from 'vitest';
import { PYODIDE_VERSION } from '../pyodideWorker';

// Regression: on 2026-04-23 the worker was pinned to `0.28.4`, which doesn't
// exist on the Pyodide CDN (v0.28.3 is the last 0.28.x release per
// https://data.jsdelivr.com/v1/package/npm/pyodide/). Every dynamic
// `import(...pyodide.mjs)` therefore 404'd and the browser sandbox could
// never boot — exactly the failure mode the user hit end-to-end on
// chat-dev.
//
// This spec pins two invariants:
//   1. The version string is a valid semver triple we'd expect to see on
//      jsdelivr's Pyodide index.
//   2. The version is in the known-published set. Bump this list when a
//      deliberate Pyodide upgrade lands.

// Published releases on jsdelivr's Pyodide CDN as of 2026-04-23. Extend
// this list on intentional version bumps — do not remove older entries
// without a follow-up audit of what else still pins them.
const PUBLISHED_PYODIDE_VERSIONS = new Set([
  '0.29.3',
  '0.29.2',
  '0.29.1',
  '0.29.0',
  '0.28.3',
  '0.28.2',
  '0.28.1',
  '0.27.0',
  '0.26.4',
]);

describe('PYODIDE_VERSION', () => {
  it('is a valid semver triple', () => {
    expect(PYODIDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is a version that was actually published to the Pyodide CDN', () => {
    expect(PUBLISHED_PYODIDE_VERSIONS.has(PYODIDE_VERSION)).toBe(true);
  });
});
