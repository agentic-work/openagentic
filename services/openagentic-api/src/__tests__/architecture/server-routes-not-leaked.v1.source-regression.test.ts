/**
 * Phase 3.9 source-regression test — v1 router dual-mount extraction.
 *
 * Asserts that after Phase 3.9:
 *  1. server.ts does NOT contain `register(v1Router,` for the /api/v1 mount.
 *  2. server.ts does NOT contain `register(v1Router,` for the /v1 alias mount.
 *     (Both mounts must be gone — only the plugin wrapper survives.)
 *  3. server.ts does NOT dynamically import v1Router directly
 *     (the dynamic `import('./routes/v1/index.js')` block is removed).
 *  4. server.ts DOES contain `register(v1RoutesPlugin` (the call site, not
 *     just the symbol — per Phase 3.1 lesson #1: assert the call site).
 *  5. server.ts DOES import v1RoutesPlugin from plugins/v1.plugin.js.
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

// ── v1Router inline mounts removed from server.ts ────────────────────────────

describe('Phase 3.9 — v1Router dual-mount removed from server.ts', () => {
  it('server.ts does NOT contain register(v1Router, (both mounts must be gone)', () => {
    expect(serverTs).not.toContain('register(v1Router,');
  });

  it('server.ts does NOT dynamically import v1Router directly (moved to v1.plugin.ts)', () => {
    // The inline `const { v1Router } = await import('./routes/v1/index.js')` block is gone.
    expect(serverTs).not.toMatch(/const\s*\{\s*v1Router\s*\}\s*=\s*await\s+import/);
  });
});

// ── Plugin registration present in server.ts ────────────────────────────────

describe('Phase 3.9 — v1RoutesPlugin registered in server.ts', () => {
  it('server.ts DOES contain register(v1RoutesPlugin (the call site, not just the symbol)', () => {
    // A bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(v1RoutesPlugin');
  });

  it('server.ts DOES import v1RoutesPlugin from plugins/v1.plugin.js', () => {
    expect(serverTs).toContain('v1.plugin');
  });
});
