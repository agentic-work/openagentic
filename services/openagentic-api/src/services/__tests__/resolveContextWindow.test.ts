/**
 * resolveContextWindow — RED→GREEN for L1 unblock of #1091.
 *
 * Bug: SmartModelRouter.createProfileFromDiscovery + the registryRowsByModel
 * builder both read `caps.contextWindowTokens` OR `caps.maxContextTokens`
 * only. Sonnet 4.5's seeded `capabilities.contextWindow = 200000` (no `s`)
 * matches NEITHER key → falls through to 8192 fallback → fails the
 * T3 gate (contextT3Floor=200000) → NO_T3_MODEL_IN_REGISTRY on any
 * T3 prompt → dev-environment sankey/compose_visual prompts permanently blocked.
 *
 * Audit live evidence 2026-05-25 (Prisma raw SQL on the dev environment pod):
 *   capabilities = { "contextWindow": 200000, "chat": true, ... }
 *
 * This helper canonicalizes the lookup to accept all three legacy keys:
 *   contextWindowTokens, contextWindow, maxContextTokens
 */
import { describe, it, expect } from 'vitest';
import { resolveContextWindow } from '../resolveContextWindow.js';

describe('resolveContextWindow — capability key canonicalizer (#1091 L1)', () => {
  it('reads contextWindow (Sonnet 4.5 seeded form) — RED today', () => {
    // This is the failing case that blocks T3 routing today.
    // Without this key recognized, router falls through to 8192.
    expect(
      resolveContextWindow({ contextWindow: 200_000, chat: true }),
    ).toBe(200_000);
  });

  it('reads contextWindowTokens (legacy A)', () => {
    expect(
      resolveContextWindow({ contextWindowTokens: 128_000 }),
    ).toBe(128_000);
  });

  it('reads maxContextTokens (legacy C)', () => {
    expect(
      resolveContextWindow({ maxContextTokens: 64_000 }),
    ).toBe(64_000);
  });

  it('precedence: contextWindowTokens beats contextWindow beats maxContextTokens', () => {
    // When all three keys are present, take the first-seen in the
    // canonical lookup order (Tokens > Window > Max).
    expect(
      resolveContextWindow({
        contextWindowTokens: 200_000,
        contextWindow: 150_000,
        maxContextTokens: 64_000,
      }),
    ).toBe(200_000);
    expect(
      resolveContextWindow({
        contextWindow: 150_000,
        maxContextTokens: 64_000,
      }),
    ).toBe(150_000);
  });

  it('returns undefined when caps null/undefined/non-object', () => {
    expect(resolveContextWindow(null)).toBeUndefined();
    expect(resolveContextWindow(undefined)).toBeUndefined();
    expect(resolveContextWindow({} as Record<string, unknown>)).toBeUndefined();
  });

  it('returns undefined when value is not a finite positive number', () => {
    expect(resolveContextWindow({ contextWindow: 0 })).toBeUndefined();
    expect(resolveContextWindow({ contextWindow: -1 })).toBeUndefined();
    expect(resolveContextWindow({ contextWindow: NaN })).toBeUndefined();
    expect(resolveContextWindow({ contextWindow: Infinity })).toBeUndefined();
    expect(resolveContextWindow({ contextWindow: '200000' })).toBeUndefined();
    expect(resolveContextWindow({ contextWindow: null })).toBeUndefined();
  });

  it('ignores unrelated capability keys', () => {
    expect(
      resolveContextWindow({
        chat: true,
        functionCalling: true,
        functionCallingAccuracy: 0.96,
        streaming: true,
        // none of these are context-window keys
      }),
    ).toBeUndefined();
  });
});
