/**
 * AWSBedrockProvider.inferMaxOutputTokens — capability-sync for Opus 4.7/4.8.
 *
 * LIVE-CAPTURED DEFECT (2026-06-16, brainbow, Bedrock Opus 4.8): a large
 * interactive 3D-topology artifact FAILED with Bedrock `stop_reason:max_tokens`
 * (output_tokens capped at 8192). Root cause: `inferMaxOutputTokens` is a
 * hardcoded pattern table that had NO match for claude-opus-4-8 / 4-7 → fell
 * through to the 8192 catch-all → became the wire `modelOutputCap` floor →
 * truncated the artifact. The ModelCapabilityRegistry correctly has opus-4-8
 * at 128000; the inference table diverged from it. Same fix-class as the
 * adaptive-thinking capability sync.
 *
 * FIX: inferMaxOutputTokens consults the registry FIRST (single source of
 * truth), and the pattern-table fallback now matches 4-7/4-8 at 128000.
 *
 * RED FIRST: these assert >= 100000 for opus-4-8/4-7 BEFORE the fix (where the
 * table returned 8192).
 */
import { describe, it, expect } from 'vitest';
import { AWSBedrockProvider } from '../AWSBedrockProvider.js';

// inferMaxOutputTokens is private; access via an `as any` cast for the unit.
function infer(modelId: string): number {
  const p = Object.create(AWSBedrockProvider.prototype) as any;
  return p.inferMaxOutputTokens(modelId);
}

describe('AWSBedrockProvider.inferMaxOutputTokens — Opus 4.7/4.8 cap-sync', () => {
  it('opus-4-8 resolves to the full output window (>= 100K, not the 8192 catch-all)', () => {
    expect(infer('claude-opus-4-8')).toBeGreaterThanOrEqual(100000);
    expect(infer('claude-opus-4-8')).not.toBe(8192);
  });

  it('the us.anthropic. inference-profile form of opus-4-8 also resolves to >= 100K', () => {
    expect(infer('us.anthropic.claude-opus-4-8')).toBeGreaterThanOrEqual(100000);
  });

  it('opus-4-7 resolves to the full output window (>= 100K)', () => {
    expect(infer('claude-opus-4-7')).toBeGreaterThanOrEqual(100000);
    expect(infer('us.anthropic.claude-opus-4-7')).toBeGreaterThanOrEqual(100000);
  });

  it('opus-4-6 / sonnet-4-6 still resolve to 128000 (unchanged)', () => {
    expect(infer('claude-opus-4-6')).toBe(128000);
    expect(infer('claude-sonnet-4-6')).toBe(128000);
  });

  it('claude-3 family still resolves to its lower ceiling (no over-lift)', () => {
    expect(infer('claude-3-haiku')).toBe(4096);
    expect(infer('claude-3-5-sonnet')).toBe(8192);
  });
});
