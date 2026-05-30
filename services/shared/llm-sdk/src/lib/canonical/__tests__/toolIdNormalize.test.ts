/**
 * toolIdNormalize — canonical tool_use_id format is `toolu_*` (matches the
 * Anthropic Messages API native shape). Inbound from non-Anthropic providers,
 * normalize their native ID to a `toolu_*`-prefixed form. Outbound to non-
 * Anthropic providers, strip the `toolu_` prefix and replace with the
 * provider-native one.
 *
 * Today the api normalizes IDs inconsistently per-provider — audit L4-4
 * + L5-6. This single SoT collapses those normalizations.
 *
 * Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */
import { describe, it, expect } from 'vitest';
import { toToolu, fromToolu, type ProviderHint } from '../toolIdNormalize.js';

describe('toToolu — inbound provider native ID → canonical toolu_*', () => {
  it('passes through an already-canonical id unchanged', () => {
    expect(toToolu('toolu_abc123', 'anthropic')).toBe('toolu_abc123');
    expect(toToolu('toolu_X-Y_Z', 'openai')).toBe('toolu_X-Y_Z');
  });

  it('prepends toolu_ to a raw provider native id', () => {
    expect(toToolu('call_abc', 'openai')).toBe('toolu_call_abc');
    expect(toToolu('vc_xyz', 'vertex')).toBe('toolu_vc_xyz');
    expect(toToolu('123abc', 'ollama')).toBe('toolu_123abc');
  });

  it('replaces non-[A-Za-z0-9_-] characters with underscore', () => {
    expect(toToolu('call:abc/xyz', 'openai')).toBe('toolu_call_abc_xyz');
    expect(toToolu('a.b.c', 'ollama')).toBe('toolu_a_b_c');
  });

  it('handles empty input by producing a bare toolu_ stub', () => {
    expect(toToolu('', 'openai')).toBe('toolu_');
  });

  it('preserves hyphens and underscores already in the id', () => {
    expect(toToolu('call_abc-def', 'openai')).toBe('toolu_call_abc-def');
  });
});

describe('fromToolu — outbound canonical toolu_* → provider native', () => {
  it.each([
    ['toolu_abc123', 'anthropic', 'toolu_abc123'],
    ['toolu_abc123', 'bedrock-anthropic', 'toolu_abc123'],
    ['toolu_abc123', 'foundry-anthropic', 'toolu_abc123'],
    ['toolu_abc123', 'vertex-anthropic', 'toolu_abc123'],
    ['toolu_abc123', 'openai', 'call_abc123'],
    ['toolu_abc123', 'aif-responses', 'call_abc123'],
    ['toolu_abc123', 'ollama', 'call_abc123'],
    ['toolu_abc123', 'vertex', 'vc_abc123'],
  ] as const)('maps %s + %s → %s', (canonical, provider, expected) => {
    expect(fromToolu(canonical, provider as ProviderHint)).toBe(expected);
  });

  it('passes through a non-canonical id unchanged (defensive)', () => {
    // If caller hands us something that isn't toolu_*-prefixed, we can't
    // strip safely — return as-is so the boundary doesn't silently corrupt.
    expect(fromToolu('call_abc', 'openai')).toBe('call_abc');
    expect(fromToolu('vc_xyz', 'vertex')).toBe('vc_xyz');
  });

  it('handles a bare toolu_ prefix without losing the prefix entirely', () => {
    expect(fromToolu('toolu_', 'openai')).toBe('call_');
    expect(fromToolu('toolu_', 'vertex')).toBe('vc_');
    expect(fromToolu('toolu_', 'anthropic')).toBe('toolu_');
  });
});

describe('toToolu / fromToolu — round-trip stability', () => {
  // For providers whose native id space we KNOW (call_*, vc_*), round-trip
  // must be lossless — model-emitted ids echo back in tool_call_id and any
  // drift (e.g. `call_abc` → `call_call_abc`) breaks pairing on the wire.
  it.each([
    ['call_abc123', 'openai'],
    ['call_xyz', 'aif-responses'],
    ['call_abc', 'ollama'],
    ['vc_pqr', 'vertex'],
  ] as const)('round-trips %s through %s WITHOUT prefix doubling', (nativeId, provider) => {
    const canonical = toToolu(nativeId, provider as ProviderHint);
    expect(canonical.startsWith('toolu_')).toBe(true);
    const native = fromToolu(canonical, provider as ProviderHint);
    expect(native).toBe(nativeId);
  });

  it('round-trips a non-prefixed native id (e.g. raw_id_789) by prepending the canonical native prefix', () => {
    const canonical = toToolu('raw_id_789', 'ollama');
    expect(canonical).toBe('toolu_raw_id_789');
    // Ollama native shape gets `call_` because the body had no native prefix.
    expect(fromToolu(canonical, 'ollama')).toBe('call_raw_id_789');
  });
});
