/**
 * 3-Sev-0 Bug #3 — "some completed responses are not rendered" on
 * chat.openagentic.local image 0.7.1-f65b94e4 (2026-05-18).
 *
 * Live evidence — fresh assistant turn just persisted on the dev environment:
 *
 *   session_id = session_1779146618786_csb4w5mcd
 *   user msg   = "Write one short sentence about RFC 6749. Just one sentence."
 *   API wire   = 200+ content_block_delta frames with thinking_delta payload,
 *                followed by content_block_delta with text_delta, followed by
 *                follow_up + stream_complete + done.
 *
 *   Persisted chat_messages.content_blocks (DB query):
 *     SELECT id, content_blocks::jsonb -> 0 ->> 'type' AS block0_type,
 *                content_blocks::jsonb -> 1 ->> 'type' AS block1_type
 *     FROM chat_messages WHERE session_id = ... AND role = 'assistant';
 *
 *       block0_type | block1_type
 *       ------------+-------------
 *       text        | follow_up
 *
 *   THE THINKING BLOCK IS MISSING. The model emitted 200+ thinking deltas
 *   that rendered live during streaming but were never persisted to DB.
 *   On session reload AAS rehydrates from persistedContentBlocks → no
 *   thinking block in the DOM → the completed response is rendered
 *   incompletely.
 *
 * Root cause:
 *   useChatStream.ts:5707 reads `contentBlocks: contentBlocksRef.current` for
 *   buildDoneMessagePayload. The api emits thinking_delta on the canonical
 *   `content_block_delta` frame WITHOUT a top-level `index`. The legacy
 *   switch arm at useChatStream.ts:5080-5118 only updates `contentBlocksRef`
 *   when `deltaIndex !== undefined` — so thinking blocks NEVER accumulate
 *   into the legacy ref. They DO accumulate into the canonical reducer at
 *   `canonicalReducerStateRef.current.contentBlocks` (via applyCanonicalFrame
 *   at useChatStream.ts:2709).
 *
 *   Therefore the done payload reads the WRONG ref. The fix: prefer the
 *   canonical reducer state when it has more blocks than the legacy ref.
 *
 * Test contract:
 *   The done handler in useChatStream must read from the canonical reducer
 *   state when it has equal-or-more blocks than the legacy ref. A
 *   source-content test pins this against future regressions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = join(__dirname, '..', 'useChatStream.ts');

describe('useChatStream done finalize — canonical-reducer source (3-Sev-0 #3)', () => {
  it('derives contentBlocks for buildDoneMessagePayload from the canonical reducer state, not the legacy ref alone', () => {
    const src = readFileSync(SRC, 'utf8');
    // Locate the buildDoneMessagePayload call.
    const callIdx = src.indexOf('buildDoneMessagePayload(');
    expect(callIdx).toBeGreaterThan(-1);

    // Walk BACKWARD from the call to find the surrounding scope (~2000 chars
    // covers the source-block selection lines). The fix introduces a local
    // `sourceBlocks` that prefers `canonicalReducerStateRef.current.contentBlocks`
    // — both identifiers must appear above the `contentBlocks:` arg.
    const sliceStart = Math.max(0, callIdx - 2000);
    const callBlock = src.slice(sliceStart, callIdx + 2000);

    // Source-block selection references the canonical reducer state.
    expect(callBlock).toMatch(/canonicalReducerStateRef\.current\.contentBlocks/);

    // The buildDoneMessagePayload call's `contentBlocks:` arg points at the
    // chosen source (either a local var derived from canonical state, or
    // canonicalReducerStateRef directly — both are acceptable so long as
    // the canonical state is the source). Reject the raw legacy form
    // `contentBlocks: contentBlocksRef.current,` which was the pre-fix bug.
    expect(callBlock).not.toMatch(/contentBlocks:\s*contentBlocksRef\.current\s*,/);
  });

  it('does not regress — the buildDoneMessagePayload call still exists at the done case', () => {
    const src = readFileSync(SRC, 'utf8');
    // Regression guard — keep the helper wire-in.
    expect(src).toMatch(/buildDoneMessagePayload\(/);
  });

  it('keeps the canonical reducer state ref allocated for the done case to read', () => {
    const src = readFileSync(SRC, 'utf8');
    // The canonical reducer state ref must exist (initialFrameState init).
    expect(src).toMatch(/canonicalReducerStateRef\s*=\s*useRef/);
  });
});
