/**
 * #940 — Orphan ThinkingSphere on session change / unmount.
 *
 * Bug surface: when the user switches chats (or closes the window) mid-
 * stream, the live "thinking" indicator (ThinkingSphere in the assistant
 * avatar slot) keeps animating after the session has changed.
 * Symptom (customer report): "AI looks like it's still working but the
 * session changed."
 *
 * Root cause: the `useChatStream` session-switch effect at the anchor
 * comment "CRITICAL FIX: Abort active stream AND reset state when
 * session changes" resets `currentMessage`, `contentBlocks`, sub-agents,
 * etc. — but does NOT reset `isStreaming`, `turnStartedAt`,
 * `liveTokensIn/Out`, `liveActivity`, `thinkingPhase`, or `ttftMs`.
 * `MessageBubble` keys its ThinkingSphere render off `isStreaming` (see
 * `MessageBubble.tsx:1092`), so the sphere stays visible for the prior
 * session's now-orphaned assistant placeholder.
 *
 * Secondary causes also fixed in the same change:
 *  - No hook-level unmount cleanup that aborts the in-flight controller
 *    and clears the streaming flag, so closing the window mid-stream
 *    can leave the indicator visible on reload (state hydrated from a
 *    persisted placeholder + isStreaming starting true from a stale
 *    initialState path).
 *  - No "stale" watchdog: if no frame arrives for > N seconds while
 *    `isStreaming === true`, the indicator should auto-clear.
 *
 * Fix in `useChatStream.ts`:
 *  1. Session-switch effect resets `isStreaming` + live-turn state.
 *  2. Hook-level unmount effect aborts controller + flips
 *     `isStreaming=false`.
 *  3. Stale-frame watchdog clears `isStreaming` after STREAM_STALE_MS
 *     of frame silence (default 60s — large enough to never fire on a
 *     healthy stream, small enough to rescue users from an orphan
 *     indicator).
 *
 * This test is a source-content arch-grep test. Same pattern as
 * `useChatStream.sessionSwitchClears.test.ts` (P0-1 sub-agent ghost
 * regression) — rendering the full hook + auth + fetch stack just to
 * observe one setState fire is fragile, so we instead lock the source
 * spec in place so any future refactor that drops one of these clears
 * fails CI.
 *
 * RED first: before the fix lands, the assertions on
 * `setIsStreaming(false)`, `setTurnStartedAt(null)`,
 * `setLiveActivity('thinking')`, the unmount cleanup, and the stale
 * watchdog all fail. GREEN after the source edit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOK_SRC = readFileSync(
  join(__dirname, '..', '..', 'hooks', 'useChatStream.ts'),
  'utf-8',
);

const MESSAGE_BUBBLE_SRC = readFileSync(
  join(__dirname, '..', 'MessageBubble.tsx'),
  'utf-8',
);

describe('#940 — ThinkingSphere orphan-on-session-change (useChatStream guards)', () => {
  it('sanity anchor: session-switch effect comment exists', () => {
    expect(HOOK_SRC).toMatch(
      /CRITICAL FIX: Abort active stream AND reset state when session changes/,
    );
  });

  it('sanity anchor: MessageBubble keys ThinkingSphere on isStreaming', () => {
    // If this ever changes (e.g. the sphere becomes its own session-
    // scoped slice), revisit the guard surface in this test.
    expect(MESSAGE_BUBBLE_SRC).toMatch(/isStreaming\s*\?\s*\(/);
    expect(MESSAGE_BUBBLE_SRC).toMatch(/<ThinkingSphere\s+state="thinking"/);
  });

  it('session-switch effect ALSO clears isStreaming + live-turn state (#940)', () => {
    // Bound search to the session-switch block so we don't accidentally
    // match a setIsStreaming(false) on a different code path (e.g. the
    // finally{} at the end of the stream loop or stopStreaming).
    const anchor = HOOK_SRC.indexOf(
      'CRITICAL FIX: Abort active stream AND reset state when session changes',
    );
    expect(anchor).toBeGreaterThan(0);
    const block = HOOK_SRC.slice(anchor, anchor + 6000);

    // Each of these is a piece of "is the AI working right now?" state
    // that, if left stale across a session switch, surfaces as the
    // orphan thinking indicator (or a phantom token counter, or a
    // stuck "calling tool_x" caption underneath the avatar).
    const requiredClears = [
      /setIsStreaming\(false\)/,        // the load-bearing one
      /setTurnStartedAt\(null\)/,        // LiveTurnStatus elapsed counter
      /setLiveTokensIn\(0\)/,            // running input-token counter
      /setLiveTokensOut\(0\)/,           // running output-token counter
      /setLiveActivity\(['"]thinking['"]\)/, // caption under sphere
      /setThinkingPhase\(['"]thinking['"]\)/, // color/phase
      /setTtftMs\(null\)/,               // TTFT debug pill
    ];

    for (const re of requiredClears) {
      expect(block).toMatch(re);
    }
  });

  it('session-switch effect aborts the in-flight stream BEFORE clearing isStreaming (#940)', () => {
    // Ordering matters: if we flip isStreaming=false before aborting,
    // a frame that lands in the gap could flip it back on. Abort first,
    // then clear.
    const anchor = HOOK_SRC.indexOf(
      'CRITICAL FIX: Abort active stream AND reset state when session changes',
    );
    const block = HOOK_SRC.slice(anchor, anchor + 6000);
    const abortIdx = block.indexOf('abortControllerRef.current.abort()');
    const clearIdx = block.indexOf('setIsStreaming(false)');
    expect(abortIdx).toBeGreaterThan(0);
    expect(clearIdx).toBeGreaterThan(abortIdx);
  });

  it('hook has unmount cleanup that aborts controller + clears isStreaming (#940)', () => {
    // Closing the window / navigating away from the chat page should
    // not leave a half-streaming state hydrating into the next mount
    // with isStreaming=true. The cleanup must be present and bound to
    // the hook lifecycle, not the session-switch effect.
    expect(HOOK_SRC).toMatch(/#940.*unmount cleanup|unmount cleanup.*#940/s);
    // The cleanup body must abort + clear.
    const unmountAnchor = HOOK_SRC.indexOf('unmount cleanup');
    expect(unmountAnchor).toBeGreaterThan(0);
    const block = HOOK_SRC.slice(unmountAnchor, unmountAnchor + 1500);
    // Either `abortControllerRef.current?.abort()` or
    // `if (abortControllerRef.current) abortControllerRef.current.abort()`
    // is acceptable — both close the in-flight stream on unmount.
    expect(block).toMatch(/abortControllerRef\.current(?:\?\.abort\(\)|.*\.abort\(\))/s);
    expect(block).toMatch(/setIsStreaming\(false\)/);
  });

  it('hook has stale-frame watchdog that clears isStreaming after N seconds of silence (#940)', () => {
    // A network drop / silent provider hang must not leave the sphere
    // animating forever. The watchdog name is locked so it stays
    // greppable.
    expect(HOOK_SRC).toMatch(/STREAM_STALE_MS/);
    expect(HOOK_SRC).toMatch(/lastFrameAtRef/);
    // The watchdog must read isStreaming + lastFrameAtRef and clear
    // isStreaming on staleness.
    expect(HOOK_SRC).toMatch(/stale.*frame.*watchdog|frame.*stale.*watchdog/i);
  });
});
