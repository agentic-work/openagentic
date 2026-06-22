/**
 * #650 Sev-0 — POST /llm-providers/:providerId/models must NOT use body
 * data fields as the source of truth for model details. Body is
 * admin-overrides only (display name, role-priority overrides). The data
 * — capabilities, limits, defaults, pricing — comes from
 * provider.discoverModelDetails(modelId, region).
 *
 * This arch cage stays RED until U6 rewrites the POST handler. Pinned so
 * a regression cannot silently re-introduce body-as-data after U6 ships.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HANDLER_PATH = resolve(__dirname, '../../routes/admin/llm-providers.ts');
const SRC = readFileSync(HANDLER_PATH, 'utf8');

describe('arch: POST /llm-providers/:id/models — no body-fields-as-data (#650)', () => {
  it('does not pass modelCfg.maxOutputTokens as max_tokens source on Registry write', () => {
    // Cage shape: any modelRoleAssignment.create/update block must NOT
    // contain `max_tokens: modelCfg?.maxOutputTokens` as the assignment.
    // After U6 the handler will read that from discoverModelDetails first
    // and merge an admin override on top intentionally, not blindly.
    const banned = /max_tokens:\s*modelCfg\?\.\s*maxOutputTokens/g;
    const matches = SRC.match(banned) ?? [];
    expect(
      matches.length,
      `Found ${matches.length} occurrence(s) of body-as-data: max_tokens: modelCfg?.maxOutputTokens`,
    ).toBe(0);
  });

  it('does not pass modelCfg.temperature as temperature source on Registry write', () => {
    const banned = /temperature:\s*modelCfg\?\.\s*temperature/g;
    const matches = SRC.match(banned) ?? [];
    expect(matches.length).toBe(0);
  });

  it('does not pass body capabilities directly as capabilities source on Registry write', () => {
    // Specifically the assignment `capabilities: normalizedCaps as any`.
    // After U6 the handler will read discovered.capabilities and merge
    // body overrides on top intentionally.
    const banned = /capabilities:\s*normalizedCaps\s+as\s+any/g;
    const matches = SRC.match(banned) ?? [];
    expect(
      matches.length,
      'Body capabilities cannot be the SoT — must come from discoverModelDetails',
    ).toBe(0);
  });

  it('imports ModelDiscoveryRecord (proves it consumes the new contract)', () => {
    expect(SRC).toMatch(/import.*ModelDiscoveryRecord/);
  });

  it('calls provider.discoverModelDetails before the Registry write', () => {
    // After U6, the handler MUST contain a call to discoverModelDetails
    // BEFORE any modelRoleAssignment.create/update. We assert structurally
    // by index position.
    const callIdx = SRC.indexOf('discoverModelDetails(');
    const writeIdx = SRC.indexOf('modelRoleAssignment.create');
    expect(callIdx, 'discoverModelDetails must be called in this handler').toBeGreaterThan(0);
    expect(writeIdx, 'modelRoleAssignment.create site missing').toBeGreaterThan(0);
    expect(callIdx, 'discoverModelDetails must precede modelRoleAssignment.create').toBeLessThan(
      writeIdx,
    );
  });
});
