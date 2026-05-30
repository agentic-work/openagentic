/**
 * P0-1 of chatmode UX parity — session-switch sub-agent state isolation.
 *
 * Punch list ref: docs/superpowers/specs/2026-04-30-chatmode-ux-parity-punchlist.md
 *
 * Bug 2026-04-30: switching from session A to session B left the previous
 * session's sub-agent cards visible because the session-switch useEffect
 * cleared every other session-scoped state (normalizedEvents,
 * intentClassifications, toolShortlists, …) but missed `subAgents`.
 * Sub-agents are reduced by role+status — not by sessionId — so without
 * an explicit clear they ghost across session changes.
 *
 * This file is an arch-grep regression test. We can't easily renderHook
 * the full useChatStream + auth + fetch stack just to assert one
 * setState call fired (the existing hook tests are all pure-reducer
 * unit tests for that reason). Instead we assert that the source
 * contains the missing clear inside the session-switch comment block.
 *
 * Mirrors the pattern used by
 * services/openagentic-api/src/__tests__/architecture/no-naked-mcp-array.source-regression.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOK_SRC = readFileSync(
  join(__dirname, '..', 'useChatStream.ts'),
  'utf-8',
);

describe('useChatStream session-switch effect — clears all session-scoped state (P0-1)', () => {
  it('contains the session-switch comment block (sanity anchor)', () => {
    expect(HOOK_SRC).toMatch(
      /CRITICAL FIX: Abort active stream AND reset state when session changes/,
    );
  });

  it('clears setSubAgents([]) inside the session-switch effect', () => {
    // Find the session-switch block (from the comment anchor through the
    // closing brace). The clear must appear inside it, not somewhere
    // unrelated. We bound the search to a 5kB window after the anchor.
    const anchor = HOOK_SRC.indexOf(
      'CRITICAL FIX: Abort active stream AND reset state when session changes',
    );
    expect(anchor).toBeGreaterThan(0);
    const block = HOOK_SRC.slice(anchor, anchor + 5000);
    expect(block).toMatch(/setSubAgents\(\[\]\)/);
  });

  it('clears every other already-shipped session-scoped state in the same block (regression baseline)', () => {
    // If anyone refactors the session-switch block and accidentally drops
    // one of these clears, this test catches it. Locks the spec in place.
    const anchor = HOOK_SRC.indexOf(
      'CRITICAL FIX: Abort active stream AND reset state when session changes',
    );
    const block = HOOK_SRC.slice(anchor, anchor + 5000);
    const required = [
      /setCurrentThinking\(''\)/,
      /setCurrentMessage\(''\)/,
      /setCotSteps\(\[\]\)/,
      /setContentBlocks\(\[\]\)/,
      /setNormalizedEvents\(\[\]\)/,
      /setIntentClassifications\(\{\}\)/,
      /setToolShortlists\(\{\}\)/,
      /setSubAgents\(\[\]\)/, // P0-1 — the new one, must stay
    ];
    for (const re of required) {
      expect(block).toMatch(re);
    }
  });
});
