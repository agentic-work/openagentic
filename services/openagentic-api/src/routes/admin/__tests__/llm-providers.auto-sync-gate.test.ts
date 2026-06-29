/**
 * Task 1 verification — POST /api/admin/llm-providers must gate the
 * RegistryUpsertService call behind shouldAutoSyncRegistry(providerType).
 *
 * This is a wire-up test: we read the compiled handler's source and assert
 * the gate is present in the provider-create path. It complements the
 * live-DB integration test in llm-providers.registry-upsert.test.ts (which
 * exercises the same path but requires DATABASE_URL).
 *
 * Catches regressions where someone rips the gate out without updating the
 * shouldAutoSyncRegistry module.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The POST /llm-providers handler (auto-sync gate wiring) moved into the
// provider-CRUD sub-module during the routes/admin/llm-providers.ts split.
const routeSrcPath = join(__dirname, '..', 'llm-providers', 'providers-crud.routes.ts');

describe('POST /api/admin/llm-providers — auto-sync gate wiring (task #311)', () => {
  const src = readFileSync(routeSrcPath, 'utf-8');

  it('imports shouldAutoSyncRegistry from the policy module', () => {
    expect(src).toMatch(/from ['"][^'"]*registryAutoSyncPolicy[^'"]*['"]/);
    expect(src).toMatch(/shouldAutoSyncRegistry/);
  });

  it('calls shouldAutoSyncRegistry(providerType) before upsertDiscoveredModels', () => {
    // Locate the upsert call site
    const upsertIdx = src.indexOf('upsertDiscoveredModels(');
    expect(upsertIdx).toBeGreaterThan(0);

    // Find the nearest preceding `if (shouldAutoSyncRegistry(...))` within 500 chars
    const window = src.slice(Math.max(0, upsertIdx - 500), upsertIdx);
    expect(window).toMatch(/if\s*\(\s*shouldAutoSyncRegistry\s*\(\s*providerType\s*\)\s*\)/);
  });

  it('logs a "Registry auto-sync skipped" message on the non-allowlisted branch so operators can debug', () => {
    expect(src).toMatch(/Registry auto-sync skipped/);
  });
});
