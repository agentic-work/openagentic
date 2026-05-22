/**
 * 3-Sev-0 #4 follow-up — disable StreamEngine for chat live rendering.
 *
 * User feedback (chat.openagentic.local, image 0.7.1-6094d801, 2026-05-18 PM):
 *
 *   - "the new reactless steaming system completely broke most compose tools-
 *      visuals, etc."  (closed by the type-filter in commit 6094d801)
 *
 *   - "rendered final seems to be fine- but streaming is not rendered- you
 *      need to figutrr that out"
 *
 *   - "thinking blocks need to be like they were before you started these
 *      changes...thinking blocks interleaves in the response that are one
 *      line closed by default but users can open them to see the cot"
 *
 * Diagnosis on the dev environment:
 *   The StreamEngine's hand-rolled DOM thinking block has multiple gaps vs
 *   the React-side `InlineThinkingBlock`:
 *     1. `.cm-thinking-body` has `max-height: 280px; overflow: hidden` from
 *        codeMode.css. Engine writes a raw Text node into it with no scroll
 *        management — once thinking grows past 280px the latest tokens are
 *        invisible → user perceives "streaming not rendered".
 *     2. Engine builds the thinking block expanded by default with no
 *        one-line collapse header → fails the user's "one line closed by
 *        default but expandable" UX.
 *     3. Engine doesn't render the "Thought · Xs · ~N tok" summary header
 *        that React's InlineThinkingBlock derives from `startTime` +
 *        `duration` on the block.
 *     4. Engine has no React parity for `compose_visual` / chart bridge /
 *        ReactFlow / mermaid (closed in part by the type-filter, but the
 *        engine still bears the burden of `viz_render`/`app_render` if it
 *        ever sees them — and themeTokens is never passed to it at
 *        construction).
 *
 * Rather than re-implementing the entire React thinking/streaming UX in
 * hand-rolled DOM, the pragmatic fix is to default the engine OFF in the
 * production Dockerfile and let `AgenticActivityStream` own the live phase
 * via React — which the user explicitly confirmed worked before these
 * changes.
 *
 * This test pins the contract: the Dockerfile build-arg default for
 * `VITE_FEATURE_STREAM_ENGINE` is `false` (engine ripped from the
 * production bundle). Flag stays in the code so future iterations can
 * re-enable for benchmark/A-B work, but production builds default OFF.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCKERFILE = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'Dockerfile',
);

describe('StreamEngine flag default — disabled for chat production (3-Sev-0 follow-up)', () => {
  it('Dockerfile defaults VITE_FEATURE_STREAM_ENGINE to false', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');
    // The ARG declaration line — must default to "false" (not "true").
    expect(dockerfile).toMatch(/^ARG\s+VITE_FEATURE_STREAM_ENGINE=false\s*$/m);
    // Defensive: assert the old true default is GONE so we can't silently
    // flip back to engine-on without updating this test.
    expect(dockerfile).not.toMatch(/^ARG\s+VITE_FEATURE_STREAM_ENGINE=true\s*$/m);
  });

  it('still passes VITE_FEATURE_STREAM_ENGINE through to the build environment (flag is preserved, just default-off)', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');
    expect(dockerfile).toMatch(/VITE_FEATURE_STREAM_ENGINE=\$\{VITE_FEATURE_STREAM_ENGINE\}/);
  });
});
