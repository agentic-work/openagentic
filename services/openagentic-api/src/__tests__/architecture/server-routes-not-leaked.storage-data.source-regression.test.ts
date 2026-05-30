/**
 * Phase 3.3 source-regression test — storage-data routes extraction.
 *
 * Asserts that after Phase 3.3:
 *  1. server.ts does NOT dynamic-import storageRoutes from routes/storage.js
 *  2. server.ts does NOT dynamic-import imageRoutes from routes/images.js
 *  3. server.ts does NOT dynamic-import faviconRoutes from routes/favicon.js
 *  4. server.ts does NOT dynamic-import fileAttachmentPlugin from
 *     routes/file-attachment/index.js
 *  5. server.ts does NOT dynamic-import dataSourceRoutes from routes/data-sources.js
 *  6. server.ts DOES contain `register(storageDataRoutesPlugin` (the call site,
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

describe('Phase 3.3 — storage-data domain dynamic imports removed from server.ts', () => {
  it('server.ts does NOT dynamic-import storageRoutes (moved to storage-data.plugin.ts)', () => {
    // Pre-3.3 pattern: const storageRoutes = (await import('./routes/storage.js')).default
    expect(serverTs).not.toContain("routes/storage.js'");
    expect(serverTs).not.toContain('routes/storage.js"');
    expect(serverTs).not.toContain("'./routes/storage'");
    expect(serverTs).not.toContain('"./routes/storage"');
    expect(serverTs).not.toMatch(/const\s+storageRoutes\s*=/);
  });

  it('server.ts does NOT dynamic-import imageRoutes (moved to storage-data.plugin.ts)', () => {
    // Pre-3.3 pattern: const { imageRoutes } = await import('./routes/images.js')
    expect(serverTs).not.toContain("routes/images.js'");
    expect(serverTs).not.toContain('routes/images.js"');
    expect(serverTs).not.toContain("'./routes/images'");
    expect(serverTs).not.toContain('"./routes/images"');
    expect(serverTs).not.toMatch(/const\s*\{\s*imageRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import faviconRoutes (moved to storage-data.plugin.ts)', () => {
    // Pre-3.3 pattern: const { faviconRoutes } = await import('./routes/favicon.js')
    expect(serverTs).not.toContain("routes/favicon.js'");
    expect(serverTs).not.toContain('routes/favicon.js"');
    expect(serverTs).not.toContain("'./routes/favicon'");
    expect(serverTs).not.toContain('"./routes/favicon"');
    expect(serverTs).not.toMatch(/const\s*\{\s*faviconRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import fileAttachmentPlugin (moved to storage-data.plugin.ts)', () => {
    // Pre-3.3 pattern: const { fileAttachmentPlugin } = await import('./routes/file-attachment/index.js')
    expect(serverTs).not.toContain("file-attachment/index.js'");
    expect(serverTs).not.toContain('file-attachment/index.js"');
    expect(serverTs).not.toContain("'./routes/file-attachment/index'");
    expect(serverTs).not.toContain('"./routes/file-attachment/index"');
    expect(serverTs).not.toMatch(/const\s*\{\s*fileAttachmentPlugin\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import dataSourceRoutes (moved to storage-data.plugin.ts)', () => {
    // Pre-3.3 pattern: const { default: dataSourceRoutes } = await import('./routes/data-sources.js')
    expect(serverTs).not.toContain("routes/data-sources.js'");
    expect(serverTs).not.toContain('routes/data-sources.js"');
    expect(serverTs).not.toContain("'./routes/data-sources'");
    expect(serverTs).not.toContain('"./routes/data-sources"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*dataSourceRoutes\s*\}\s*=/);
  });
});

describe('Phase 3.3 — storageDataRoutesPlugin is registered in server.ts', () => {
  it('server.ts DOES contain register(storageDataRoutesPlugin (the call site, not just symbol)', () => {
    // Lock the actual register call site per Phase 3.1 lesson #1:
    // a bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(storageDataRoutesPlugin');
  });

  it('server.ts DOES import storageDataRoutesPlugin from plugins/storage-data.plugin.js', () => {
    expect(serverTs).toContain('storage-data.plugin');
  });
});
