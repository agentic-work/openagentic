/**
 * Architecture cage — RETIRED (Sev-0 F1-6, 2026-05-17).
 *
 * Background: this cage was put in place 2026-05-12 to keep an earlier
 * "rip" of the follow-up chip strip from drifting back into the
 * codebase. The 2026-05-17 audit pinned a different conclusion: every
 * one of the 17 northstar chatmode mocks at
 * `mocks/UX/AI/Chatmode/end-state-{01..17}.html` renders a `.followups`
 * row with 3 `.chip` buttons immediately after final synthesis.
 * Without a `follow_up` frame chatmode cannot match the northstar.
 *
 * The original 2026-05-12 directive was specifically about a BAD
 * earlier generation (generic strings divorced from conversation data:
 * "Drill into the top 3 cost centers / Project spend at current
 * burn rate / Compare to last month / Explain what this means in
 * business terms"). The F1-6 implementation generates the 3 prompts
 * via a per-turn model call grounded in the actual assistant synthesis
 * + user prompt, which is what the mocks always demanded.
 *
 * This file is kept as a no-op marker so the cage's path remains
 * findable in `git log` / `git blame` archaeology — but the
 * forbidden-patterns suite is now empty. Re-introducing a stale
 * `FollowUpGenerator` service-class or hardcoded chip string list is
 * separately blocked by:
 *   - `buildFollowUp` SDK builder validation (0..5 items, non-empty)
 *   - `chatLoop.followUp.test.ts` integration test (chip-gen uses the
 *     live streamProvider, not a static list)
 */
import { describe, it, expect } from 'vitest';

describe('Architecture: follow_up chip path (cage retired 2026-05-17 — F1-6)', () => {
  it('cage retired — see file header for context', () => {
    expect(true).toBe(true);
  });
});
