/**
 * RED-first contract for the canonical-wire → ContentBlock[] pure reducer.
 *
 * `applyCanonicalFrame(state, frame)` is the single source of truth that
 * translates one NDJSON wire frame into the next FrameState. No side
 * effects, no DOM coupling, no shared mutable state. The reducer plus
 * `initialFrameState` is what useChatStream will call once Step 3 wires
 * it in (current useChatStream has ~80 inline switch arms that this
 * function will replace for the canonical-shape ones).
 *
 * Step 1 (wireShape.realQ1.test.ts) pinned the WIRE contract — what
 * /api/chat/stream emits today. This file pins the REDUCER contract —
 * what the wire becomes inside the client.
 *
 * Source ground truth for the Q1 replay test:
 *   reports/verify-cadence/Q-loop-post-811-604acc6d/Q1-admin-obo.ndjson
 *   821 frames · 642 thinking_delta · 2 tool dispatches paired by
 *   call_rj6syfic + call_zcqcy60j · success=true.
 */
import { describe, it, expect } from 'vitest';
import {
  applyCanonicalFrame,
  initialFrameState,
  type FrameState,
  type WireFrame,
} from '../applyCanonicalFrame';
import {
  loadNDJSONFixture,
  Q1_AZURE_SUBS_RGS_FIXTURE,
} from '../../../__tests__/integration/wireShape.fixtures';

const reduce = (frames: WireFrame[]): FrameState =>
  frames.reduce<FrameState>(applyCanonicalFrame, initialFrameState());

describe('initialFrameState', () => {
  it('returns an empty FrameState', () => {
    const s = initialFrameState();
    expect(s.contentBlocks).toEqual([]);
    expect(s.currentThinkingIdx).toBeNull();
    expect(s.currentTextIdx).toBeNull();
    expect(s.toolIdxByUseId).toEqual({});
    expect(s.nextBlockIndex).toBe(0);
  });
});

describe('applyCanonicalFrame — stream_start', () => {
  it('resets state to initialFrameState even from a dirty prior state', () => {
    const dirty: FrameState = {
      contentBlocks: [
        {
          id: 'b1',
          index: 0,
          type: 'thinking',
          content: 'leftover',
          isComplete: false,
        },
      ],
      currentThinkingIdx: 0,
      currentTextIdx: null,
      toolIdxByUseId: { abc: 0 },
      nextBlockIndex: 1,
    };
    const next = applyCanonicalFrame(dirty, { type: 'stream_start' });
    expect(next).toEqual(initialFrameState());
  });
});

describe('applyCanonicalFrame — content_block_delta', () => {
  it('opens a thinking block on first thinking_delta with delta.thinking content', () => {
    const next = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'thinking_delta', thinking: 'Need to ' },
    });
    expect(next.contentBlocks).toHaveLength(1);
    expect(next.contentBlocks[0].type).toBe('thinking');
    expect(next.contentBlocks[0].content).toBe('Need to ');
    expect(next.contentBlocks[0].isComplete).toBe(false);
    expect(next.currentThinkingIdx).toBe(0);
    expect(next.nextBlockIndex).toBe(1);
  });

  it('appends to the open thinking block when a second thinking_delta arrives', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'thinking_delta', thinking: 'Need to ' },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'content_block_delta',
      _ts: 101,
      delta: { type: 'thinking_delta', thinking: 'list subs' },
    });
    expect(s2.contentBlocks).toHaveLength(1);
    expect(s2.contentBlocks[0].content).toBe('Need to list subs');
    expect(s2.nextBlockIndex).toBe(1);
  });

  it('opens a separate text block on text_delta (does NOT mix into thinking)', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'thinking_delta', thinking: 'thought' },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'content_block_delta',
      _ts: 200,
      delta: { type: 'text_delta', text: 'Here is the answer.' },
    });
    expect(s2.contentBlocks).toHaveLength(2);
    expect(s2.contentBlocks[0].type).toBe('thinking');
    expect(s2.contentBlocks[1].type).toBe('text');
    expect(s2.contentBlocks[1].content).toBe('Here is the answer.');
  });

  it('ignores input_json_delta when no tool block is open (nothing to accumulate into)', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"a":' },
    });
    expect(s1.contentBlocks).toEqual([]);
  });

  it('ignores signature_delta (always — these are anti-replay signatures, not user content)', () => {
    const s2 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      delta: { type: 'signature_delta', signature: 'sig' },
    });
    expect(s2.contentBlocks).toEqual([]);
  });
});

// #815 — Tool cards must show LIVE input args as the model streams them in,
// not just after `tool_call_complete` lands. The canonical wire emits:
//   content_block_start { content_block: { type:'tool_use', id, name, input:{} } }
//   content_block_delta { delta: { type:'input_json_delta', partial_json } }+
//   content_block_stop
//   tool_executing
//   tool_result
// The reducer opens the tool_use block at content_block_start (NOT at
// tool_call_complete), accumulates partial_json into block.content (which the
// UI renders as inputDeltaContent in ToolCallCard.tsx:62-65), and leaves
// isComplete=false until tool_result/tool_error fires.
describe('applyCanonicalFrame — #815 live tool input streaming', () => {
  it('content_block_start opens an in-flight tool_use block', () => {
    const s = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'call_aaa',
        name: 'azure_list_subscriptions',
        input: {},
      },
    });
    expect(s.contentBlocks).toHaveLength(1);
    expect(s.contentBlocks[0].type).toBe('tool_use');
    expect(s.contentBlocks[0].toolId).toBe('call_aaa');
    expect(s.contentBlocks[0].toolName).toBe('azure_list_subscriptions');
    expect(s.contentBlocks[0].isComplete).toBe(false);
    expect(s.toolIdxByUseId.call_aaa).toBe(0);
  });

  it('input_json_delta accumulates partial_json into the open tool_use block.content', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_aaa', name: 'kubectl_get_pods', input: {} },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"namespace":"' },
    });
    const s3 = applyCanonicalFrame(s2, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: 'default"}' },
    });
    expect(s3.contentBlocks[0].content).toBe('{"namespace":"default"}');
    expect(s3.contentBlocks[0].isComplete).toBe(false);
  });

  it('content_block_stop does NOT close a tool_use block (tool waits for result/error)', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_aaa', name: 'aws_list_accounts', input: {} },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    });
    const s3 = applyCanonicalFrame(s2, { type: 'content_block_stop', index: 0 });
    expect(s3.contentBlocks[0].isComplete).toBe(false);
  });

  it('tool_call_complete fills final input on the already-open block (no double-open)', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_aaa', name: 'kubectl_get_pods', input: {} },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"namespace":"default"}' },
    });
    const s3 = applyCanonicalFrame(s2, {
      type: 'tool_call_complete',
      id: 'call_aaa',
      name: 'kubectl_get_pods',
      input: { namespace: 'default' },
    });
    expect(s3.contentBlocks).toHaveLength(1);
    expect(s3.contentBlocks[0].toolId).toBe('call_aaa');
    expect(s3.contentBlocks[0].input).toEqual({ namespace: 'default' });
    expect(s3.contentBlocks[0].isComplete).toBe(false);
  });

  it('tool_result on an already-open block closes it + records the output', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_aaa', name: 'aws_list_accounts', input: {} },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    });
    const s3 = applyCanonicalFrame(s2, {
      type: 'tool_result',
      tool_use_id: 'call_aaa',
      content: { summary: 'Found 3 accounts', data: { accounts: ['a', 'b', 'c'] } },
    });
    expect(s3.contentBlocks).toHaveLength(1);
    expect(s3.contentBlocks[0].isComplete).toBe(true);
    expect(s3.contentBlocks[0].result).toEqual({ summary: 'Found 3 accounts', data: { accounts: ['a', 'b', 'c'] } });
  });

  it('tool_error on an already-open block closes it + records the error', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_aaa', name: 'gcp_list_projects', input: {} },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'tool_error',
      tool_use_id: 'call_aaa',
      error: 'permission denied',
    });
    expect(s2.contentBlocks[0].isComplete).toBe(true);
    expect(s2.contentBlocks[0].error).toBe('permission denied');
  });

  it('content_block_start for type=text behaves as a no-op (legacy text path uses text_delta)', () => {
    // Other content_block_start types (text, thinking) are handled by the
    // delta path already. content_block_start for them must NOT double-open
    // an empty placeholder block.
    const s = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    expect(s.contentBlocks).toEqual([]);
  });
});

describe('applyCanonicalFrame — tool_call_complete', () => {
  it('closes any open thinking block and opens a new tool_use block', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'thinking_delta', thinking: 'plan' },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'tool_call_complete',
      _ts: 200,
      id: 'call_abc',
      name: 'tool_search',
      input: { query: 'azure subs' },
    });
    expect(s2.contentBlocks).toHaveLength(2);
    // First block: prior thinking, now closed
    expect(s2.contentBlocks[0].type).toBe('thinking');
    expect(s2.contentBlocks[0].isComplete).toBe(true);
    // Second block: new tool_use
    expect(s2.contentBlocks[1].type).toBe('tool_use');
    expect(s2.contentBlocks[1].toolId).toBe('call_abc');
    expect(s2.contentBlocks[1].toolName).toBe('tool_search');
    expect(s2.contentBlocks[1].input).toEqual({ query: 'azure subs' });
    expect(s2.contentBlocks[1].isComplete).toBe(false);
    expect(s2.currentThinkingIdx).toBeNull();
    expect(s2.toolIdxByUseId.call_abc).toBe(1);
  });

  it('without a prior block, still opens the tool_use block at index 0', () => {
    const s = applyCanonicalFrame(initialFrameState(), {
      type: 'tool_call_complete',
      _ts: 200,
      id: 'call_solo',
      name: 'tool_search',
      input: {},
    });
    expect(s.contentBlocks).toHaveLength(1);
    expect(s.contentBlocks[0].toolId).toBe('call_solo');
    expect(s.toolIdxByUseId.call_solo).toBe(0);
  });
});

describe('applyCanonicalFrame — tool_executing', () => {
  it('is idempotent when the tool_use block already exists from tool_call_complete', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'tool_call_complete',
      _ts: 200,
      id: 'call_x',
      name: 'tool_search',
      input: {},
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'tool_executing',
      _ts: 201,
      tool_use_id: 'call_x',
      name: 'tool_search',
      input: {},
    });
    // No new block created.
    expect(s2.contentBlocks).toHaveLength(1);
    expect(s2.toolIdxByUseId.call_x).toBe(0);
  });

  it('synthesizes a tool_use block when tool_executing arrives with no prior tool_call_complete (legacy wire)', () => {
    const s = applyCanonicalFrame(initialFrameState(), {
      type: 'tool_executing',
      _ts: 200,
      tool_use_id: 'call_legacy',
      name: 'tool_search',
      input: { q: 'x' },
    });
    expect(s.contentBlocks).toHaveLength(1);
    expect(s.contentBlocks[0].type).toBe('tool_use');
    expect(s.contentBlocks[0].toolId).toBe('call_legacy');
    expect(s.contentBlocks[0].toolName).toBe('tool_search');
  });
});

describe('applyCanonicalFrame — tool_result', () => {
  it('patches the matching tool_use block by tool_use_id with result + isComplete=true', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'tool_call_complete',
      _ts: 200,
      id: 'call_x',
      name: 'tool_search',
      input: {},
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'tool_result',
      _ts: 250,
      tool_use_id: 'call_x',
      content: { summary: '5 rows', data: ['a', 'b'] },
    });
    expect(s2.contentBlocks).toHaveLength(1);
    const b = s2.contentBlocks[0];
    expect(b.isComplete).toBe(true);
    expect(b.resultRaw).toEqual(['a', 'b']);
    expect(b.content).toBe('5 rows');
    expect(b.duration).toBeGreaterThan(0);
  });

  it('is a no-op when tool_use_id has no matching block', () => {
    const s = applyCanonicalFrame(initialFrameState(), {
      type: 'tool_result',
      tool_use_id: 'call_unknown',
      content: { summary: 'x', data: 'x' },
    });
    expect(s).toEqual(initialFrameState());
  });
});

describe('applyCanonicalFrame — tool_error', () => {
  it('marks the matching tool_use block as complete with an error message', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'tool_call_complete',
      _ts: 200,
      id: 'call_x',
      name: 'tool_search',
      input: {},
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'tool_error',
      _ts: 250,
      tool_use_id: 'call_x',
      error: 'mcp unreachable',
    });
    expect(s2.contentBlocks[0].isComplete).toBe(true);
    expect(s2.contentBlocks[0].error).toBe('mcp unreachable');
  });
});

describe('applyCanonicalFrame — terminal frames', () => {
  it('thinking_complete closes any open thinking block', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'thinking_delta', thinking: 'final' },
    });
    expect(s1.contentBlocks[0].isComplete).toBe(false);
    const s2 = applyCanonicalFrame(s1, { type: 'thinking_complete' });
    expect(s2.contentBlocks[0].isComplete).toBe(true);
    expect(s2.currentThinkingIdx).toBeNull();
  });

  // #813 — InlineThinkingBlock derives `endedAt = startTime + duration`.
  // When duration is undefined or 0 the UI shows "Thought · 0.0s · ~N tok"
  // even though real wall-clock time elapsed. Close paths MUST set duration
  // from the frame timestamp on the close signal so the UI header reads true.
  it('thinking_complete sets duration on the closed thinking block', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'thinking_delta', thinking: 'a' },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'content_block_delta',
      _ts: 1234,
      delta: { type: 'thinking_delta', thinking: 'b' },
    });
    const s3 = applyCanonicalFrame(s2, { type: 'thinking_complete', _ts: 1500 });
    expect(s3.contentBlocks[0].duration).toBe(1400); // 1500 - 100
  });

  it('stream_complete sets duration on a still-open thinking block', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 200,
      delta: { type: 'thinking_delta', thinking: 'a' },
    });
    const s2 = applyCanonicalFrame(s1, { type: 'stream_complete', _ts: 2200, success: true });
    expect(s2.contentBlocks[0].duration).toBe(2000);
  });

  it('a tool_use dispatch during streaming closes the prior thinking block with duration', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 1000,
      delta: { type: 'thinking_delta', thinking: 'plan' },
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'tool_call_complete',
      _ts: 1750,
      id: 't1',
      name: 'azure_list_subscriptions',
      input: {},
    });
    expect(s2.contentBlocks[0].type).toBe('thinking');
    expect(s2.contentBlocks[0].isComplete).toBe(true);
    expect(s2.contentBlocks[0].duration).toBe(750);
  });

  it('stream_complete closes any open blocks (final-flush)', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'text_delta', text: 'partial' },
    });
    const s2 = applyCanonicalFrame(s1, { type: 'stream_complete', success: true });
    expect(s2.contentBlocks[0].isComplete).toBe(true);
    expect(s2.currentTextIdx).toBeNull();
  });
});

describe('applyCanonicalFrame — unknown frames', () => {
  it('passes state through unchanged for ping / done / token_metrics / etc.', () => {
    const start = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      _ts: 100,
      delta: { type: 'thinking_delta', thinking: 'x' },
    });
    const next = applyCanonicalFrame(start, { type: 'ping' });
    const next2 = applyCanonicalFrame(next, { type: 'done' });
    const next3 = applyCanonicalFrame(next2, { type: 'token_metrics', tokens: 42 });
    expect(next3).toBe(start);
  });
});

const q1Fixture = loadNDJSONFixture(
  Q1_AZURE_SUBS_RGS_FIXTURE.path,
  Q1_AZURE_SUBS_RGS_FIXTURE.prompt,
);

(q1Fixture ? describe : describe.skip)(
  'applyCanonicalFrame — Q1 real-NDJSON replay (mock-16 anatomy)',
  () => {
    const finalState = reduce(q1Fixture!.frames);

    it('produces ≥2 tool_use blocks paired to the two real tool_use_ids', () => {
      const toolBlocks = finalState.contentBlocks.filter((b) => b.type === 'tool_use');
      expect(toolBlocks.length).toBeGreaterThanOrEqual(2);
      const toolIds = new Set(toolBlocks.map((b) => b.toolId));
      expect(toolIds.has('call_rj6syfic')).toBe(true);
      expect(toolIds.has('call_zcqcy60j')).toBe(true);
    });

    it('names the two tool_use blocks correctly (tool_search + azure_list_subscriptions)', () => {
      const byId = Object.fromEntries(
        finalState.contentBlocks
          .filter((b) => b.type === 'tool_use')
          .map((b) => [b.toolId, b.toolName]),
      );
      expect(byId.call_rj6syfic).toBe('tool_search');
      expect(byId.call_zcqcy60j).toBe('azure_list_subscriptions');
    });

    it('every tool_use block is isComplete at end of stream (tool_result paired)', () => {
      const toolBlocks = finalState.contentBlocks.filter((b) => b.type === 'tool_use');
      for (const b of toolBlocks) {
        expect(b.isComplete, `tool_use ${b.toolId} should be complete`).toBe(true);
      }
    });

    it('interleaves thinking blocks between tool_use blocks (chronological narrative)', () => {
      const types = finalState.contentBlocks.map((b) => b.type);
      // We expect at least: thinking → tool_use → thinking → tool_use → thinking
      // because the wire interleaves 642 thinking_deltas across the two tool dispatches.
      const firstToolIdx = types.indexOf('tool_use');
      const lastToolIdx = types.lastIndexOf('tool_use');
      expect(firstToolIdx).toBeGreaterThan(0); // a thinking block came first
      // There MUST be at least one thinking block between the first and last tool_use
      // (the model was thinking between the two tool calls).
      const slice = types.slice(firstToolIdx + 1, lastToolIdx);
      expect(slice).toContain('thinking');
    });

    it('every thinking block is complete at end of stream', () => {
      const thinkingBlocks = finalState.contentBlocks.filter((b) => b.type === 'thinking');
      for (const b of thinkingBlocks) {
        expect(b.isComplete, 'all thinking blocks complete after stream_complete').toBe(true);
      }
    });

    it('emits no orphan text blocks (this capture has zero text_delta on wire)', () => {
      const textBlocks = finalState.contentBlocks.filter((b) => b.type === 'text');
      expect(textBlocks).toHaveLength(0);
    });

    it('preserves total tool count (2) and accumulates all 642 thinking deltas into N≥1 thinking blocks', () => {
      const toolCount = finalState.contentBlocks.filter((b) => b.type === 'tool_use').length;
      expect(toolCount).toBe(2);
      const thinkingBlocks = finalState.contentBlocks.filter((b) => b.type === 'thinking');
      expect(thinkingBlocks.length).toBeGreaterThanOrEqual(1);
      const totalThinkingChars = thinkingBlocks
        .map((b) => b.content.length)
        .reduce((a, b) => a + b, 0);
      // 642 deltas, each at least a few chars — sanity floor at 500 chars total.
      expect(totalThinkingChars).toBeGreaterThan(500);
    });
  },
);
