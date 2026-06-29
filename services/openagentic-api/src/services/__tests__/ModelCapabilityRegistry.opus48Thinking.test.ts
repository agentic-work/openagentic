/**
 * #cap-sync (2026-06-16) — pins the Opus 4.8 / 4.7 capability resolution that
 * fixes the "thinking not supported" symptom on a pinned Bedrock Opus 4.8.
 *
 * Root cause (verified against the claude-api skill, authoritative): the
 * registry had explicit patterns for Opus 4.6/4.5/4.1/4.0 but NONE for 4.8/4.7,
 * so a pinned `claude-opus-4-8` fell through the greedy Opus-4.0 catch-all
 * `/claude-opus-4(?!\.)/` (the `-8` satisfies the no-dot lookahead) and
 * inherited maxOutput:4096 + Opus-3 cost + the wrong (enabled) thinking shape →
 * Bedrock 400 → THINKING_NOT_SUPPORTED. A second hazard: the cache `includes`
 * partial-match let a cached `claude-opus-4` row hijack `claude-opus-4-8`.
 *
 * Authoritative facts (claude-api skill): Opus 4.8 is adaptive-thinking-only
 * (budget_tokens 400s), 1M context, 128K max output, $5/$25 per 1M.
 */
import { describe, it, expect } from 'vitest';
import { ModelCapabilityRegistry } from '../ModelCapabilityRegistry.js';

const noopLogger: any = {
  child: () => noopLogger,
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};

function reg() {
  return new ModelCapabilityRegistry(noopLogger);
}

describe('#cap-sync — Opus 4.8/4.7 capability resolution', () => {
  it('resolves a pinned claude-opus-4-8 to adaptive thinking + 128K output + $5/$25', () => {
    const caps = reg().getCapabilities('claude-opus-4-8');
    expect(caps.thinking).toBe(true);
    expect(caps.thinkingCapabilities?.thinkingMode).toBe('adaptive');
    expect(caps.maxOutputTokens).toBe(128000);
    expect(caps.maxContextTokens).toBe(1000000);
    expect(caps.inputCostPer1k).toBe(0.005);
    expect(caps.outputCostPer1k).toBe(0.025);
    // It must NOT have mis-resolved to the Opus-4.0 catch-all (maxOutput 4096).
    expect(caps.maxOutputTokens).not.toBe(4096);
  });

  it('resolves the Bedrock inference-profile form us.anthropic.claude-opus-4-8 the same way', () => {
    const caps = reg().getCapabilities('us.anthropic.claude-opus-4-8-v1:0');
    expect(caps.thinkingCapabilities?.thinkingMode).toBe('adaptive');
    expect(caps.maxOutputTokens).toBe(128000);
  });

  it('resolves claude-opus-4-7 to the same adaptive-only surface', () => {
    const caps = reg().getCapabilities('claude-opus-4-7');
    expect(caps.thinkingCapabilities?.thinkingMode).toBe('adaptive');
    expect(caps.maxOutputTokens).toBe(128000);
    expect(caps.maxOutputTokens).not.toBe(4096);
  });

  it('still resolves Opus 4.6 to the legacy (enabled) thinking surface', () => {
    const caps = reg().getCapabilities('claude-opus-4-6');
    expect(caps.thinking).toBe(true);
    // 4.6 keeps fixed-budget thinking — thinkingMode unset = treated as 'enabled'.
    expect(caps.thinkingCapabilities?.thinkingMode).toBeUndefined();
  });

  it('still resolves Opus 4.0 / Claude-3-Opus to the catch-all (maxOutput 4096)', () => {
    const caps = reg().getCapabilities('claude-opus-4');
    expect(caps.maxOutputTokens).toBe(4096);
  });

  it('cache partial-match does NOT let a cached opus-4 row hijack opus-4-8', () => {
    const r = reg();
    // Prime the cache with the 4.0 row first (this is what used to poison 4.8).
    const v40 = r.getCapabilities('claude-opus-4');
    expect(v40.maxOutputTokens).toBe(4096);
    // Now resolve 4.8 — it must NOT inherit the cached 4.0 row.
    const v48 = r.getCapabilities('claude-opus-4-8');
    expect(v48.maxOutputTokens).toBe(128000);
    expect(v48.thinkingCapabilities?.thinkingMode).toBe('adaptive');
  });

  it('supportsThinking() is true for Opus 4.8', () => {
    expect(reg().supportsThinking('claude-opus-4-8')).toBe(true);
  });
});
