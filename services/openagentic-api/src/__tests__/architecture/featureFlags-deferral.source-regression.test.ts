/**
 * Phase 5 source-regression test — featureFlags wired assertion.
 *
 * Phase 5 removed the deferral notice from featureFlags.ts and wired
 * consumers in admin, auth, and chat plugins. This test
 * asserts that featureFlags.ts is actively consumed by those plugins.
 *
 * Run from any CWD; paths are resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
// ../../../.. = repo root
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'services/openagentic-api/src');

const featureFlagsTs = readFileSync(join(API_SRC, 'config/featureFlags.ts'), 'utf-8');
const adminPlugin = readFileSync(join(API_SRC, 'plugins/admin.plugin.ts'), 'utf-8');
const authPlugin = readFileSync(join(API_SRC, 'plugins/auth.plugin.ts'), 'utf-8');
const chatPlugin = readFileSync(join(API_SRC, 'plugins/chat.plugin.ts'), 'utf-8');

describe('featureFlags — Phase 5 consumer wiring', () => {
  it('featureFlags.ts does not contain the deferral notice (Phase 5 has landed)', () => {
    expect(featureFlagsTs).not.toContain('intentionally unused');
  });

  it('admin.plugin.ts imports featureFlags', () => {
    expect(adminPlugin).toContain('featureFlags');
  });

  it('auth.plugin.ts imports featureFlags', () => {
    expect(authPlugin).toContain('featureFlags');
  });

  it('chat.plugin.ts imports featureFlags', () => {
    expect(chatPlugin).toContain('featureFlags');
  });
});
