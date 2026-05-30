/**
 * Phase 3.2 source-regression test — integrations routes extraction.
 *
 * Asserts that after Phase 3.2:
 *  1. server.ts does NOT dynamic-import azureADSyncRoutes from routes/azure-ad-sync.js
 *  2. server.ts does NOT dynamic-import accountLinkingRoutes from routes/account-linking.js
 *  3. server.ts does NOT dynamic-import azureIntegrationPlugin from
 *     routes/azure-integration/index.js
 *  4. server.ts DOES contain `register(integrationsRoutesPlugin` (the call site,
 *     not just a bare symbol — per Phase 3.1 lesson #1: assert the call site).
 *
 * "Directly import" means a dynamic `await import('./routes/<file>')` OR a
 * destructured `{ symbol }` from that import. We check for the symbol/path string
 * in server.ts so a future accidental re-introduction is caught regardless of how
 * the import is written.
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

describe('Phase 3.2 — integrations-domain dynamic imports removed from server.ts', () => {
  it('server.ts does NOT dynamic-import azureADSyncRoutes (moved to integrations.plugin.ts)', () => {
    // Pre-3.2 pattern: const { azureADSyncRoutes } = await import('./routes/azure-ad-sync.js')
    // We check the import path and the destructure pattern, NOT the bare symbol (may appear in comments).
    expect(serverTs).not.toContain('azure-ad-sync.js');
    expect(serverTs).not.toContain("'./routes/azure-ad-sync'");
    expect(serverTs).not.toContain('"./routes/azure-ad-sync"');
    expect(serverTs).not.toMatch(/const\s*\{\s*azureADSyncRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import accountLinkingRoutes (moved to integrations.plugin.ts)', () => {
    // Pre-3.2 pattern: const { accountLinkingRoutes } = await import('./routes/account-linking.js')
    // We check the import path and the destructure pattern, NOT the bare symbol (may appear in comments).
    expect(serverTs).not.toContain('account-linking.js');
    expect(serverTs).not.toContain("'./routes/account-linking'");
    expect(serverTs).not.toContain('"./routes/account-linking"');
    expect(serverTs).not.toMatch(/const\s*\{\s*accountLinkingRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import azureIntegrationPlugin (moved to integrations.plugin.ts)', () => {
    // Pre-3.2 pattern: const { azureIntegrationPlugin } = await import('./routes/azure-integration/index.js')
    // We check for the dynamic import path and the destructure pattern, NOT the bare symbol name
    // (the bare symbol may legitimately appear in a comment summarising what was moved).
    expect(serverTs).not.toContain('azure-integration/index.js');
    expect(serverTs).not.toContain("'./routes/azure-integration/index'");
    expect(serverTs).not.toContain('"./routes/azure-integration/index"');
    // Assert the destructure / await-import pattern is gone from server.ts.
    expect(serverTs).not.toMatch(/const\s*\{\s*azureIntegrationPlugin\s*\}\s*=/);
  });
});

describe('Phase 3.2 — integrationsRoutesPlugin is registered in server.ts', () => {
  it('server.ts DOES contain register(integrationsRoutesPlugin (the call site, not just symbol)', () => {
    // Lock the actual register call site per Phase 3.1 lesson #1:
    // a bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(integrationsRoutesPlugin');
  });
});
