/**
 * Parity test — server `contentBlocksAccumulator.consume()` ≡ client
 * `applyCanonicalFrame` for every wire frame the pipeline emits.
 *
 * REGRESSION pin — Track B Phase 0 of the canonical streaming rip
 * (<internal-plan>, Phases 7+8).
 *
 * Why: the server persists `chat_messages.content_blocks` (Json column)
 * by feeding the same wire NDJSON through `contentBlocksAccumulator.ts`
 * that the UI feeds through `applyCanonicalFrame.ts`. The two reducers
 * MUST produce deep-equal block arrays for stream-DOM ≡ reload-DOM to
 * hold by construction. Smoking gun: today the server drops `text_delta`,
 * has no `grounding_result` handler, accepts `'content_delta'` /
 * `'stream'` envelopes the UI reducer ignores, and is missing
 * `tool_round` nesting.
 *
 * Phase 7 of the rip exports `applyCanonicalFrame` from
 * `@openagentic/sdk`, the server imports it, and the legacy accumulator
 * gets deleted — making this parity test green by construction. Until
 * then this test is RED.
 *
 * Fixture: mocks/UX/AI/Chatmode/fixtures/_phase0-test.ndjson — minimal
 * stub covering 1 thinking, 1 prose delta, 1 tool_use cycle, 1 follow_up,
 * 1 grounding_result, 1 message_complete. Replaced in Phase 1 by recorded
 * real-model NDJSON captured via the wire-capture middleware.
 *
 * TODO(Track B Phase 1): swap the stub fixture for a recorded NDJSON
 * captured from a real Sonnet 4.6 turn via WIRE_CAPTURE_ENABLED=true on
 * the api deployment. The recorded fixture exercises the full frame
 * vocabulary (parallel tool rounds, viz_render, app_render, sub_agent
 * cards, HITL chips) that the stub fixture intentionally elides.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  applyCanonicalFrame,
  initialFrameState,
  type WireFrame,
} from '../hooks/streamReducer/applyCanonicalFrame';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// services/openagentic-ui/src/features/chat/__tests__ → repo root
// __tests__ → chat → features → src → openagentic-ui → services → agentic (repo root)
const REPO_ROOT = join(__dirname, '../../../../../..');
const FIXTURE_PATH = join(
  REPO_ROOT,
  'mocks/UX/AI/Chatmode/fixtures/_phase0-test.ndjson',
);
// The server accumulator currently lives at this path; deleted in Phase 7.
const SERVER_ACCUMULATOR_PATH = join(
  REPO_ROOT,
  'services/openagentic-api/src/routes/chat/handlers/contentBlocksAccumulator.ts',
);

function loadFixture(): WireFrame[] {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as WireFrame);
}

function reduceClient(frames: WireFrame[]) {
  return frames.reduce(applyCanonicalFrame, initialFrameState()).contentBlocks;
}

// Translate a WireFrame to (frameType, payload) — the shape the server's
// `consume(type, payload)` expects. The exact translation is the contract
// being tested: server and client must agree on what each wire frame means.
function consumeServer(frames: WireFrame[]): unknown[] {
  // Dynamic require so this test can SKIP if the server file has been
  // deleted (Phase 7) rather than failing to import.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createContentBlocksAccumulator } = require(SERVER_ACCUMULATOR_PATH);
  const acc = createContentBlocksAccumulator();
  for (const frame of frames) {
    acc.consume((frame as { type: string }).type, frame);
  }
  return acc.snapshot();
}

describe('Parity: server contentBlocksAccumulator ≡ client applyCanonicalFrame', () => {
  it('produces deep-equal ContentBlock[] for the phase-0 fixture', () => {
    if (!existsSync(FIXTURE_PATH)) {
      throw new Error(
        `Fixture missing at ${FIXTURE_PATH}. ` +
          `Phase 0 ships a minimal stub; Phase 1 replaces it with recorded NDJSON.`,
      );
    }

    if (!existsSync(SERVER_ACCUMULATOR_PATH)) {
      // Phase 7 has shipped — server now imports applyCanonicalFrame from
      // @openagentic/sdk so parity is structural. This test passes by
      // construction; the no-server-content-blocks-accumulator arch test
      // is the gate that proves it.
      return;
    }

    const frames = loadFixture();
    const uiBlocks = reduceClient(frames);
    const serverBlocks = consumeServer(frames);

    // Deep equality contract: same block count, same `type` ordering,
    // same `content` payloads, same tool fields. Until Phase 7 unifies
    // the reducers via @openagentic/sdk, the two shapes diverge.
    expect(serverBlocks).toEqual(uiBlocks);
  });
});
