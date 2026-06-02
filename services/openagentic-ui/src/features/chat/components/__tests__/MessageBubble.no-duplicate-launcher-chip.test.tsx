/**
 * #971 follow-up (Sev-1) — second-tier guard for the artifact duplicate.
 *
 * The earlier #971 fix (commit ff5aabfd) ripped the
 * `message.visualizations.forEach(...) → parsed.push({type:'visualization'})`
 * block from EnhancedMessageContent + MessageContent so the duplicate
 * `<DataVisualization>` iframes stopped rendering at the bottom of the
 * markdown body.
 *
 * BUT a second duplicate render path still existed at
 * MessageBubble:1362-1381 — the `ArtifactSlideOutLauncher` chip block.
 * It iterates `extractArtifacts(message)` and renders a click-to-open
 * chip per artifact, even when AgenticActivityStream has ALREADY mounted
 * the corresponding `viz_render` / `app_render` content block inline via
 * InlineVizBadge / InlineAppBadge.
 *
 * Same source data (`message.visualizations[]` + `tool_result._meta.artifactKind`),
 * rendered TWICE in different visual forms: inline iframe AND launcher chip.
 *
 * The intentional design: ArtifactSlideOutLauncher is the affordance to
 * open a side-panel for the artifact. We KEEP it active when AAS does
 * NOT inline-mount the artifact (legacy persisted messages, fallback
 * artifacts the AAS render path doesn't handle). But when AAS HAS
 * already mounted `viz_render` / `app_render` blocks for this message,
 * the launcher chip row is redundant + visually confusing and must be
 * suppressed.
 *
 * Source-content test (the established convention for MessageBubble —
 * see MessageBubble.cm-msg-asst.test.tsx, .noDoubleRender.test.tsx —
 * MessageBubble is 1400+ LOC with a heavy props surface; full-render
 * tests are infeasible and the existing tests source-grep instead).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'MessageBubble.tsx');

describe('#971 follow-up — MessageBubble must not render launcher chips when AAS has inline artifacts', () => {
  it('computes a flag indicating whether the activity stream contains inline artifact blocks', () => {
    // The guard requires a derived boolean — name it
    // `activityStreamHasInlineArtifacts` to match the existing
    // `activityStreamHasText` naming convention at line 923.
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/const\s+activityStreamHasInlineArtifacts\s*=/);
  });

  it('derives the flag from finalContentBlocks viz_render / app_render block types', () => {
    // The flag MUST be computed from finalContentBlocks (the canonical
    // chronology used by AAS) and look for the two inline-mounting
    // block types: viz_render (InlineVizBadge) + app_render (InlineAppBadge).
    const src = readFileSync(SRC, 'utf8');
    // Match the derivation. Allow either some(...) or filter(...).length>0 form.
    expect(src).toMatch(
      /activityStreamHasInlineArtifacts\s*=\s*finalContentBlocks\.[\s\S]{0,200}?viz_render[\s\S]{0,200}?app_render/,
    );
  });

  it('short-circuits the artifact-launcher render when AAS has inline artifacts', () => {
    // Before the launcher IIFE runs extractArtifacts(message), it MUST
    // bail when activityStreamHasInlineArtifacts is true. The early-out
    // can be either a guard inside the IIFE (e.g. `if (activityStreamHasInlineArtifacts) return null;`)
    // OR a logical-AND at the JSX guard (`!activityStreamHasInlineArtifacts && (() => {...})()`).
    const src = readFileSync(SRC, 'utf8');
    const launcherIdx = src.indexOf('artifact-launcher-list');
    expect(launcherIdx).toBeGreaterThan(-1);

    // Slice a window around the launcher render — the early-out must
    // appear within ~400 chars before the launcher render call, OR
    // inside the IIFE body just before extractArtifacts is called.
    const windowStart = Math.max(0, launcherIdx - 600);
    const launcherWindow = src.slice(windowStart, launcherIdx + 200);
    expect(launcherWindow).toMatch(/activityStreamHasInlineArtifacts/);
  });

  it('still calls extractArtifacts(message) inside the render path (legacy/fallback preserved)', () => {
    // Regression guard — KEEP the launcher render path active for the
    // fallback case (no inline AAS mount). We are NOT blanket-ripping.
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/extractArtifacts\(message\)/);
  });

  it('does NOT touch the InlineGroundingChip render branch (line ~1421)', () => {
    // The grounding chip is an entirely separate concern (#940 P1).
    // The fix must NOT alter that render.
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(
      /message\.role\s*===\s*'assistant'\s*&&\s*!isStreaming\s*&&\s*\(\s*<InlineGroundingChip\s+assistantText=\{message\.content\}\s*\/>\s*\)/,
    );
  });

  it('does NOT touch the EnhancedMessageContent guard (#966 — must remain `!activityStreamHasText` only)', () => {
    // Regression guard for #966 — the EnhancedMessageContent branch is
    // gated only on `!activityStreamHasText` (and the streaming check).
    // The new `activityStreamHasInlineArtifacts` flag must NOT be
    // smuggled into this guard.
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(
      /message\.content\s*&&\s*!\(isStreaming\s*&&\s*streamingContentBlocks\s*&&\s*streamingContentBlocks\.length\s*>\s*0\)\s*&&\s*!activityStreamHasText\s*&&\s*\(/,
    );
  });
});
