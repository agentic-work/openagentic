/**
 * RED gate — RIP the viz-tier ladder.
 *
 * Plan: /home/trent/.claude/plans/sprightly-percolating-brook.md
 *
 * `useChatStream` today returns `tierHints` and `handoffOffers` in its
 * destructured return value (useChatStream.ts:5907-5908), wired to the
 * `applyTierHintFrame` and `applyHandoffOfferFrame` reducers. The plan
 * rips both reducers, both state slots, both NDJSON dispatch cases, and
 * both consumers (`<TierBadge>`, `<HandoffChip>`).
 *
 * This file pins the post-rip contract on the HOOK RETURN SHAPE via
 * TypeScript. We don't render the hook (the full SSE / auth / store
 * stack pulled in by useChatStream is heavy to mock); a compile-time
 * assertion is sufficient as the RED gate per the plan rip checklist.
 *
 *  - `@ts-expect-error` lines fail (unused-suppression error) WHILE
 *    `tierHints` / `handoffOffers` are still on the return shape — the
 *    suppression has nothing to suppress, so tsc reports the directive
 *    itself as the error. That's the RED state.
 *  - After the rip, those keys are gone, the suppression catches the
 *    real "Property does not exist" error, and the assertion goes GREEN.
 *
 * The runtime block is the contract escape hatch: vitest still loads the
 * file, sees ZERO `it()` blocks if compile fails, and surfaces the typecheck
 * error. We add one trivial runtime `it()` so vitest reports a normal
 * test count when the typecheck eventually passes.
 *
 * Pattern reference:
 *   services/openagentic-ui/src/features/chat/hooks/__tests__/useChatStream.tierFrames.test.ts
 */
import { describe, it, expect } from 'vitest';
import type { useChatStream } from '../hooks/useChatStream';

type ChatStreamReturn = ReturnType<typeof useChatStream>;

describe('useChatStream — RIP tierHints / handoffOffers from hook return shape', () => {
  it('return type does NOT expose `tierHints`', () => {
    // RED today: tierHints is on the return — the @ts-expect-error
    // directive on the next line has nothing to suppress, which itself
    // surfaces as a TypeScript error ("Unused @ts-expect-error directive").
    type _Pick = Pick<
      ChatStreamReturn,
      // @ts-expect-error post-rip: `tierHints` is gone from useChatStream return.
      'tierHints'
    >;
    // Reference the alias so it isn't tree-shaken / flagged as unused.
    const _v: _Pick | undefined = undefined;
    expect(_v).toBeUndefined();
  });

  it('return type does NOT expose `handoffOffers`', () => {
    // Same RED-state mechanic as the previous test, for handoffOffers.
    type _Pick = Pick<
      ChatStreamReturn,
      // @ts-expect-error post-rip: `handoffOffers` is gone from useChatStream return.
      'handoffOffers'
    >;
    const _v: _Pick | undefined = undefined;
    expect(_v).toBeUndefined();
  });

  it('TierHint / HandoffOffer named exports are gone from the module', async () => {
    // Belt and braces — the named exports tied to the ripped reducers
    // (TierHint, HandoffOffer, applyTierHintFrame, applyHandoffOfferFrame,
    // bufferOrApplyTierHint, flushPendingTierHint, dispatchTierFrame)
    // must NOT exist on the module after the rip. Today they all do.
    const mod: Record<string, unknown> = await import('../hooks/useChatStream');
    expect(
      mod.applyTierHintFrame,
      'applyTierHintFrame must be removed from useChatStream exports',
    ).toBeUndefined();
    expect(
      mod.applyHandoffOfferFrame,
      'applyHandoffOfferFrame must be removed from useChatStream exports',
    ).toBeUndefined();
    expect(
      mod.dispatchTierFrame,
      'dispatchTierFrame must be removed from useChatStream exports',
    ).toBeUndefined();
    expect(
      mod.bufferOrApplyTierHint,
      'bufferOrApplyTierHint must be removed from useChatStream exports',
    ).toBeUndefined();
    expect(
      mod.flushPendingTierHint,
      'flushPendingTierHint must be removed from useChatStream exports',
    ).toBeUndefined();
  });
});
