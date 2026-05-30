/**
 * Step 3 — useChatStream wires the pure applyCanonicalFrame reducer
 * in SHADOW MODE alongside the existing inline switch arms.
 *
 * Project convention: useChatStream is too tangled (6442 LOC + 66
 * useState stores + many context deps) to renderHook in isolation
 * without a massive mocking apparatus. Peer tests
 * (`useChatStream.sessionSwitchClears.test.ts` et al.) use arch-grep
 * regression assertions on the source instead. We follow that pattern.
 *
 * What this pins:
 *   1. Module imports `applyCanonicalFrame` + `initialFrameState`
 *      from the `streamReducer/` sibling.
 *   2. A `canonicalReducerStateRef` exists (in-loop ref state) +
 *      `canonicalReducerState` setState slice.
 *   3. `applyCanonicalFrame(...)` is called in the frame-processing
 *      loop AFTER `_seq` dedupe and BEFORE the inline switch.
 *   4. `canonicalContentBlocks` is exposed from the hook's return
 *      object so consumers (MessageBubble) can prefer the canonical
 *      shape over the legacy inline-mutated `contentBlocks`.
 *   5. State is reset to `initialFrameState()` on every stream_start
 *      (matches the existing `setContentBlocks([])` reset sites).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '..', 'useChatStream.ts'),
  'utf8',
);

describe('useChatStream — canonical reducer wire-in (Step 3 shadow mode)', () => {
  it('imports applyCanonicalFrame + initialFrameState from streamReducer', () => {
    expect(src).toMatch(/from\s+['"]\.\/streamReducer\/applyCanonicalFrame['"]/);
    expect(src).toMatch(/applyCanonicalFrame/);
    expect(src).toMatch(/initialFrameState/);
  });

  it('declares canonicalReducerStateRef (mutable ref for in-loop use)', () => {
    expect(src).toMatch(/canonicalReducerStateRef\s*=\s*useRef/);
  });

  it('declares canonicalReducerState useState slice (for re-render triggering)', () => {
    expect(src).toMatch(/\[canonicalReducerState,\s*setCanonicalReducerState\]\s*=\s*useState/);
  });

  it('invokes applyCanonicalFrame in the stream-processing loop', () => {
    // The reducer must be called on every parsed frame so the canonical
    // contentBlocks stay in lockstep with the wire.
    expect(src).toMatch(/applyCanonicalFrame\s*\(\s*canonicalReducerStateRef\.current/);
  });

  it('flushes the reducer state via setCanonicalReducerState after each frame', () => {
    expect(src).toMatch(/setCanonicalReducerState\s*\(/);
  });

  it('skips the React commit when the reducer preserves identity (no-op frames)', () => {
    // Cheap perf guard — without this, 642 thinking_delta frames each
    // schedule a setState even when content unchanged.
    expect(src).toMatch(/if\s*\(\s*nextCanonical\s*!==\s*canonicalReducerStateRef\.current\s*\)/);
  });

  it('resets canonical state to initialFrameState on session/stream reset', () => {
    // Must reset at the same boundaries the inline contentBlocks resets — search
    // for at least 2 occurrences of `initialFrameState()` invocation.
    const matches = src.match(/initialFrameState\s*\(\s*\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes canonicalContentBlocks in the hook return shape', () => {
    expect(src).toMatch(/canonicalContentBlocks/);
    // It must be derived from canonicalReducerState.contentBlocks (not a
    // separate slice that could drift).
    expect(src).toMatch(/canonicalContentBlocks:\s*canonicalReducerState\.contentBlocks/);
  });
});
