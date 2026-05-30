/**
 * Regression tests for the DB-authored capability overlay.
 *
 * The ModelCapabilityGate auto-upgrade cascade reads
 * ProviderManager.getDiscoveredCapabilities() to decide whether a
 * user-pinned model has tool support. Before the 2026-04-22 fix, the cache
 * was populated purely from each provider's `discoverModels()` — which for
 * Bedrock's inference profiles infers capabilities from naming patterns
 * and sometimes returns `tools: false` even when the admin has explicitly
 * set `tools: true` via the Add-Model UI.
 *
 * This file unit-tests the pure OVERLAY logic: given a discovery-inferred
 * capabilities object and an admin-authored DB capabilities object, the
 * DB values MUST win for every key present in the DB object.
 *
 * We don't spin up the full ProviderManager — we just validate the merge
 * algorithm used in `discoverAllModelCapabilities()` (lines in
 * services/llm-providers/ProviderManager.ts).
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirror of the merge expression used inside ProviderManager.
 * `{ ...existing.capabilities, ...m.capabilities }` — DB wins per-key.
 */
function overlayCapabilities(
  discovered: Record<string, boolean | undefined>,
  dbAuthored: Record<string, boolean | undefined>,
): Record<string, boolean | undefined> {
  return { ...discovered, ...dbAuthored };
}

describe('capability overlay — DB wins over discovery', () => {
  it('admin-set tools:true overrides discovery tools:false (2026-04-21 Sonnet incident)', () => {
    const discovered = { chat: true, tools: false, streaming: true, vision: true };
    const dbAuthored = { chat: true, tools: true, vision: true, streaming: true };
    expect(overlayCapabilities(discovered, dbAuthored).tools).toBe(true);
  });

  it('admin-unset tools leaves discovery value untouched', () => {
    const discovered = { chat: true, tools: true };
    const dbAuthored = { chat: true }; // tools not set on DB entry
    expect(overlayCapabilities(discovered, dbAuthored).tools).toBe(true);
  });

  it('admin can explicitly override tools to false', () => {
    const discovered = { chat: true, tools: true };
    const dbAuthored = { chat: true, tools: false };
    expect(overlayCapabilities(discovered, dbAuthored).tools).toBe(false);
  });

  it('admin-set vision overrides discovery', () => {
    const discovered = { chat: true, vision: false };
    const dbAuthored = { chat: true, vision: true };
    expect(overlayCapabilities(discovered, dbAuthored).vision).toBe(true);
  });

  it('keeps discovered fields when DB does not mention them', () => {
    const discovered = { chat: true, tools: true, vision: true, thinking: true };
    const dbAuthored = { chat: true, tools: true, streaming: true };
    const merged = overlayCapabilities(discovered, dbAuthored);
    expect(merged.thinking).toBe(true);   // from discovery
    expect(merged.vision).toBe(true);     // from discovery
    expect(merged.streaming).toBe(true);  // from DB
  });

  it('handles empty DB capabilities object without clobbering discovery', () => {
    const discovered = { chat: true, tools: true };
    const dbAuthored = {};
    expect(overlayCapabilities(discovered, dbAuthored)).toEqual(discovered);
  });

  it('handles empty discovery when DB is fully authored', () => {
    const discovered = {};
    const dbAuthored = { chat: true, tools: true, streaming: true, vision: false };
    expect(overlayCapabilities(discovered, dbAuthored)).toEqual(dbAuthored);
  });

  describe('2026-04-21 Sonnet 4.5 incident reproduction', () => {
    // Exact shapes observed in the incident
    const sonnetDiscovery = {
      chat: true,
      streaming: true,
      tools: false,  // WRONG — Bedrock inference heuristic got this wrong
      vision: true,
      embeddings: false,
      imageGeneration: false,
    };
    const sonnetDbAuthored = {
      chat: true,
      tools: true,   // admin fix applied via DB patch
      vision: true,
      streaming: true,
      embeddings: false,
      imageGeneration: false,
    };

    it('after overlay, tools is true (upgrade cascade should not fire)', () => {
      const merged = overlayCapabilities(sonnetDiscovery, sonnetDbAuthored);
      expect(merged.tools).toBe(true);
    });
  });
});
