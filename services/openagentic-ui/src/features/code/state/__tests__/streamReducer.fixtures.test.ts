import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupParallelTools, reduce, INITIAL_STATE, type ChatAction } from '../streamReducer';
import type {
  AssistantChatMessage,
  ChatMessage,
  UiBoundaryBlock,
  UiParallelGroupBlock,
  UiToolUseBlock,
} from '../../types/uiState';
import type { StreamJsonEvent } from '../../types/_sdk-bindings';

// ────────────────────────────────────────────────────────────────────
// Fixture loading
// ────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, '..', '__fixtures__');

function loadFixture(name: string): StreamJsonEvent[] {
  const raw = readFileSync(join(FIXTURE_DIR, `${name}.jsonl`), 'utf-8');
  const events: StreamJsonEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    events.push(JSON.parse(trimmed) as StreamJsonEvent);
  }
  return events;
}

/**
 * Apply each event through the reducer wrapped as `{type:'event', event}`.
 * The Phase-C ChatAction discriminator the hook uses to flow wire frames.
 */
function fold(events: StreamJsonEvent[], initialOverride?: typeof INITIAL_STATE) {
  const start = initialOverride ?? INITIAL_STATE;
  return events.reduce(
    (s, e) => reduce(s, { type: 'event', event: e } as ChatAction),
    start,
  );
}

/**
 * Seed an active streaming assistant message — same shape sendMessage()
 * pushes onto messages before the daemon emits any frames for that turn.
 * The submit_user action does this atomically; for the fixture tests we
 * pre-seed manually since the fixtures don't include the submit_user.
 */
function seedStreamingAssistant(stateOverride?: Partial<typeof INITIAL_STATE>) {
  const base = { ...INITIAL_STATE, ...(stateOverride ?? {}) };
  const msgId = 'asst-fxt-1';
  const seed: AssistantChatMessage = {
    id: msgId,
    role: 'assistant',
    blocks: [],
    streaming: true,
    createdAt: 1000,
  };
  return {
    state: {
      ...base,
      messages: [...base.messages, seed],
      streamingMessageId: msgId,
    },
    msgId,
  };
}

function findAssistant(messages: ChatMessage[]): AssistantChatMessage | undefined {
  return messages.find((m) => m.role === 'assistant') as AssistantChatMessage | undefined;
}

// ────────────────────────────────────────────────────────────────────
// Fixture 1 — simple-text-turn
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: simple-text-turn', () => {
  it('replays "Hi! How can I help?" into a single text block', () => {
    const events = loadFixture('simple-text-turn');
    const { state: seed, msgId } = seedStreamingAssistant();

    const final = fold(events, seed);

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.id).toBe(msgId);
    expect(asst!.blocks).toHaveLength(1);
    expect(asst!.blocks[0]).toEqual({ kind: 'text', text: 'Hi! How can I help?' });
    expect(asst!.streaming).toBe(false);
    expect(asst!.stopReason).toBe('end_turn');
    expect(final.streamingMessageId).toBeNull();
    expect(final.error).toBeNull();
    expect(final.contextTokens).toBe(12);
    expect(final.totalOutputTokens).toBe(7);
    expect(final.totalCostUsd).toBeCloseTo(0.0023);
    expect(final.lastTurnMs).toBe(1234);
    expect(final.sessionMeta).not.toBeNull();
  });

  it('idempotency: replaying the same simple-text fixture twice converges except totals double', () => {
    const events = loadFixture('simple-text-turn');
    const seed1 = seedStreamingAssistant();
    const oncePassed = fold(events, seed1.state);

    // To replay twice, we re-seed (the second turn would normally come
    // from a fresh submit_user). For this idempotency test we only re-fold
    // the SAME events through the SAME oncePassed state — the events alone
    // (no submit_user between) should be no-ops for the messages already
    // closed (asserts upsert idempotency on text content) but DOUBLE the
    // running cost/output counters because `result` accumulates.
    const twice = fold(events, oncePassed);

    const asst = findAssistant(twice.messages);
    expect(asst).toBeDefined();
    // Streaming state stays closed; second fold doesn't re-open the message.
    expect(asst!.streaming).toBe(false);
    // Running totals double — by design (result accumulates per-turn).
    expect(twice.totalCostUsd).toBeCloseTo(0.0023 * 2);
    expect(twice.totalOutputTokens).toBe(7 * 2);
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture 2 — tool-use-pair
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: tool-use-pair', () => {
  it('streams Bash tool_use, attaches tool_result, and renders the follow-up text', () => {
    const events = loadFixture('tool-use-pair');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.blocks.length).toBeGreaterThanOrEqual(2);

    const tool = asst!.blocks[0] as UiToolUseBlock;
    expect(tool.kind).toBe('tool_use');
    expect(tool.toolUseId).toBe('toolu_FX2');
    expect(tool.name).toBe('Bash');
    expect(tool.input).toEqual({ command: 'echo hello' });
    expect(tool.streaming).toBe(false);
    expect(tool.result?.text).toBe('hello\n');
    expect(tool.result?.isError).toBe(false);
    expect(tool.liveOutput).toBe('hello'); // From progress event

    const text = asst!.blocks[1];
    expect(text.kind).toBe('text');
    if (text.kind === 'text') expect(text.text).toBe('Done.');

    expect(final.streamingMessageId).toBeNull();
    expect(final.error).toBeNull();
    expect(asst!.streaming).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture 3 — parallel-task-3-subagents
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: parallel-task-3-subagents', () => {
  it('routes each subagent stream into the matching parent Task subBlocks', () => {
    const events = loadFixture('parallel-task-3-subagents');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.blocks).toHaveLength(3);

    const taskA = asst!.blocks[0] as UiToolUseBlock;
    expect(taskA.toolUseId).toBe('toolu_TA');
    expect(taskA.subBlocks).toBeDefined();
    expect(taskA.subBlocks).toHaveLength(1);
    const subAText = taskA.subBlocks![0];
    expect(subAText.kind).toBe('text');
    if (subAText.kind === 'text') expect(subAText.text).toBe('foundA bar');
    expect(taskA.result?.text).toBe('foundA bar');

    const taskB = asst!.blocks[1] as UiToolUseBlock;
    expect(taskB.toolUseId).toBe('toolu_TB');
    expect(taskB.subBlocks).toHaveLength(1);
    const subBText = taskB.subBlocks![0];
    expect(subBText.kind).toBe('text');
    if (subBText.kind === 'text') expect(subBText.text).toBe('foundB');

    const taskC = asst!.blocks[2] as UiToolUseBlock;
    expect(taskC.toolUseId).toBe('toolu_TC');
    expect(taskC.subBlocks).toHaveLength(1);
    const subCText = taskC.subBlocks![0];
    expect(subCText.kind).toBe('text');
    if (subCText.kind === 'text') expect(subCText.text).toBe('foundC');

    expect(final.streamingMessageId).toBeNull();
    expect(final.error).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture 4 — permission-roundtrip
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: permission-roundtrip', () => {
  it('sets pendingPermission on can_use_tool, clears it on the matching control_response, then renders text', () => {
    const events = loadFixture('permission-roundtrip');
    const { state: seed } = seedStreamingAssistant();

    // We need to assert intermediate state — pendingPermission
    // is set BETWEEN the control_request and control_response.
    let mid = seed;
    let sawPending = false;
    for (const e of events) {
      mid = reduce(mid, { type: 'event', event: e } as ChatAction);
      if (mid.pendingPermission) sawPending = true;
    }
    const final = mid;

    expect(sawPending).toBe(true);
    expect(final.pendingPermission).toBeNull();

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.blocks).toHaveLength(2); // tool_use + text follow-up
    const tool = asst!.blocks[0] as UiToolUseBlock;
    expect(tool.toolUseId).toBe('toolu_PERM');
    expect(tool.input).toEqual({ command: 'rm -rf /tmp/x' });

    const text = asst!.blocks[1];
    expect(text.kind).toBe('text');
    if (text.kind === 'text') expect(text.text).toBe('Removed /tmp/x');

    expect(final.error).toBeNull();
    expect(final.streamingMessageId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture 5 — compact-boundary
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: compact-boundary', () => {
  it('sets compactionFlash mid-turn, completes the text turn cleanly', () => {
    const events = loadFixture('compact-boundary');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);
    expect(final.compactionFlash).toBe('auto');

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.blocks).toHaveLength(1);
    const text = asst!.blocks[0];
    expect(text.kind).toBe('text');
    if (text.kind === 'text') {
      expect(text.text).toBe('Working on it. After compaction, continuing.');
    }
    expect(final.streamingMessageId).toBeNull();
  });

  it('idempotency: replaying compact_boundary keeps compactionFlash set, not toggled', () => {
    const events = loadFixture('compact-boundary');
    const { state: seed } = seedStreamingAssistant();

    const once = fold(events, seed);
    // Re-fold the same events. compactionFlash stays 'auto' (no toggle).
    const twice = fold(events, once);
    expect(twice.compactionFlash).toBe('auto');
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture 6 — slash-cost
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: slash-cost', () => {
  it('renders the /cost text body in the assistant blocks (NOT empty — this is the bug being fixed)', () => {
    const events = loadFixture('slash-cost');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.blocks).toHaveLength(1);
    const text = asst!.blocks[0];
    expect(text.kind).toBe('text');
    if (text.kind === 'text') {
      // The CRITICAL assertion. Today the inline reducer's race causes
      // blocks: [] here because streamingMsgIdRef is null when deltas
      // arrive. With the pure reducer, blocks[0] holds the cost body.
      expect(text.text).toContain('Total cost: $0.0000');
      expect(text.text).toContain('Total duration (API): 0s');
    }
    expect(asst!.streaming).toBe(false);
    expect(final.streamingMessageId).toBeNull();
  });

  it('idempotency: re-replaying the slash-cost fixture preserves the message text', () => {
    const events = loadFixture('slash-cost');
    const { state: seed } = seedStreamingAssistant();

    const once = fold(events, seed);
    const twice = fold(events, once);

    const asst = findAssistant(twice.messages);
    const text = asst!.blocks[0];
    expect(text.kind).toBe('text');
    if (text.kind === 'text') {
      expect(text.text).toContain('Total cost: $0.0000');
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture 7 — slash-help-jsx
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: slash-help-jsx (today: kind=error path, body has Error: prefix)', () => {
  it('renders the JSX-mount-error body as text (Phase E will replace with real picker)', () => {
    const events = loadFixture('slash-help-jsx');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.blocks).toHaveLength(1);
    const text = asst!.blocks[0];
    expect(text.kind).toBe('text');
    if (text.kind === 'text') {
      expect(text.text).toMatch(/^Error: slash \/help failed to mount/);
    }
    expect(asst!.streaming).toBe(false);
    expect(final.streamingMessageId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture 8 — error-during-tool
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: error-during-tool', () => {
  it('result subtype=error_during_execution force-closes the in-flight tool_use and clears streaming', () => {
    const events = loadFixture('error-during-tool');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.streaming).toBe(false);
    const tool = asst!.blocks[0] as UiToolUseBlock;
    expect(tool.streaming).toBe(false);
    expect(final.streamingMessageId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Cross-fixture: ChatAction surface (submit_user, clear, etc.)
// ────────────────────────────────────────────────────────────────────

describe('ChatAction — submit_user / clear / interrupt / connection_closed', () => {
  it('submit_user atomically appends user+assistant messages and sets streamingMessageId', () => {
    const state = reduce(INITIAL_STATE, {
      type: 'submit_user',
      userMsgId: 'user-1',
      asstMsgId: 'asst-1',
      text: 'hello',
      createdAt: 1000,
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
    expect(state.streamingMessageId).toBe('asst-1');
  });

  it('after submit_user, replaying the simple-text fixture flows deltas into the asst-1 bubble (no race)', () => {
    let state = reduce(INITIAL_STATE, {
      type: 'submit_user',
      userMsgId: 'user-2',
      asstMsgId: 'asst-2',
      text: 'hi',
      createdAt: 2000,
    });

    const events = loadFixture('simple-text-turn');
    state = events.reduce(
      (s, e) => reduce(s, { type: 'event', event: e } as ChatAction),
      state,
    );

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.id).toBe('asst-2');
    expect(asst.blocks).toHaveLength(1);
    expect(asst.blocks[0]).toEqual({ kind: 'text', text: 'Hi! How can I help?' });
    expect(state.streamingMessageId).toBeNull();
  });

  it('clear resets state to INITIAL_STATE', () => {
    let state = reduce(INITIAL_STATE, {
      type: 'submit_user',
      userMsgId: 'u',
      asstMsgId: 'a',
      text: 't',
      createdAt: 0,
    });
    expect(state.messages).toHaveLength(2);

    state = reduce(state, { type: 'clear' });
    expect(state.messages).toHaveLength(0);
    expect(state.streamingMessageId).toBeNull();
    expect(state.error).toBeNull();
  });

  it('interrupt appends a marker block and clears streaming', () => {
    let state = reduce(INITIAL_STATE, {
      type: 'submit_user',
      userMsgId: 'u',
      asstMsgId: 'a',
      text: 't',
      createdAt: 0,
    });
    state = reduce(state, { type: 'interrupt', markerCreatedAt: 1 });

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.streaming).toBe(false);
    const last = asst.blocks[asst.blocks.length - 1];
    expect(last.kind).toBe('text');
    if (last.kind === 'text') expect(last.text).toMatch(/interrupted/i);
    expect(state.streamingMessageId).toBeNull();
  });

  it('connection_closed appends a closure marker and clears streaming', () => {
    let state = reduce(INITIAL_STATE, {
      type: 'submit_user',
      userMsgId: 'u',
      asstMsgId: 'a',
      text: 't',
      createdAt: 0,
    });
    state = reduce(state, { type: 'connection_closed', code: 1006 });

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.streaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
    const last = asst.blocks[asst.blocks.length - 1];
    expect(last.kind).toBe('text');
    if (last.kind === 'text') expect(last.text).toMatch(/closed.*1006/);
  });

  it('set_error sets the error string', () => {
    let state = reduce(INITIAL_STATE, { type: 'set_error', message: 'oops' });
    expect(state.error).toBe('oops');
  });

  it('permission_response clears pendingPermission only if requestId matches', () => {
    let state: typeof INITIAL_STATE = {
      ...INITIAL_STATE,
      pendingPermission: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: {},
        tool_use_id: 'toolu_X',
        request_id: 'r1',
      } as any,
    };

    // Mismatched request — no clear.
    state = reduce(state, { type: 'permission_response', requestId: 'r-other' });
    expect(state.pendingPermission).not.toBeNull();

    // Matched request — cleared.
    state = reduce(state, { type: 'permission_response', requestId: 'r1' });
    expect(state.pendingPermission).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture: gpt-oss-thinking-turn — gpt-oss:20b reasoning render parity
//
// Live render-parity bug 2026-04-30: gpt-oss thinking_delta events were
// reaching the UI but the user reported the chain-of-thought rendering
// as plain text. Root-cause analysis showed the WIRE was correct (deltas
// flagged as `thinking_delta`); the leak happened upstream in the API's
// thinking-only fallback (separately fixed). This test pins the
// reducer's contract: thinking_delta MUST land in a `kind:'thinking'`
// block, NEVER a `kind:'text'` block.
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// Fixture: gpt-oss-mock2-turn — boundary frames + parallel grouping
//
// Visual parity with mocks/codemode-tui-parity/mock-2-fullstack-build.html
// (gaps 1 + 2 from the 2026-04-30 audit). Asserts:
//   - system/plugin_loaded → kind:'boundary' subtype:'plugin' block
//   - system/skill_invoked → kind:'boundary' subtype:'skill' block
//   - 3 consecutive tool_use blocks coalesce under groupParallelTools
//     into a single parallel_group with .tools.length === 3
// ────────────────────────────────────────────────────────────────────

describe('reduce — fixture: gpt-oss-mock2-turn (boundary + parallel grouping)', () => {
  it('emits boundary blocks for plugin_loaded + skill_invoked system events', () => {
    const events = loadFixture('gpt-oss-mock2-turn');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);
    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();

    // First two blocks should be boundaries (plugin then skill).
    const boundaries = asst!.blocks.filter(
      (b): b is UiBoundaryBlock => b.kind === 'boundary',
    );
    expect(boundaries).toHaveLength(2);

    expect(boundaries[0].subtype).toBe('plugin');
    expect(boundaries[0].label).toBe('Plugin loaded');
    expect(boundaries[0].body).toContain('fastapi-scaffold');
    expect(boundaries[0].body).toContain('1.4.0');
    expect(boundaries[0].body).toContain('anthropics/claude-plugins-official');
    expect(boundaries[0].body).toContain('6 tools');

    expect(boundaries[1].subtype).toBe('skill');
    expect(boundaries[1].label).toBe('Skill invoked');
    expect(boundaries[1].body).toContain('fullstack-scaffolder/python-react');
    expect(boundaries[1].body).toContain('fullstack URL shortener');
  });

  it('three consecutive Write tool_use blocks coalesce under groupParallelTools', () => {
    const events = loadFixture('gpt-oss-mock2-turn');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);
    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();

    // Underlying state: tool_use blocks remain flat in `blocks`.
    const flatTools = asst!.blocks.filter(
      (b): b is UiToolUseBlock => b.kind === 'tool_use',
    );
    expect(flatTools).toHaveLength(3);
    expect(flatTools.map((t) => t.toolUseId)).toEqual([
      'toolu_M2_W1',
      'toolu_M2_W2',
      'toolu_M2_W3',
    ]);

    // Render-time view: groupParallelTools wraps the trio under a parallel_group.
    const grouped = groupParallelTools(asst!.blocks);
    const group = grouped.find(
      (b): b is UiParallelGroupBlock => b.kind === 'parallel_group',
    );
    expect(group).toBeDefined();
    expect(group!.tools).toHaveLength(3);
    expect(group!.tools.every((t) => t.kind === 'tool_use')).toBe(true);

    // The two boundaries should NOT be collapsed into the parallel group —
    // they live as siblings before the group.
    const boundaryIdx = grouped.findIndex((b) => b.kind === 'boundary');
    const groupIdx = grouped.findIndex((b) => b.kind === 'parallel_group');
    expect(boundaryIdx).toBeLessThan(groupIdx);
  });

  it('groupParallelTools is idempotent: re-running on the output produces the same shape', () => {
    const events = loadFixture('gpt-oss-mock2-turn');
    const { state: seed } = seedStreamingAssistant();
    const final = fold(events, seed);
    const asst = findAssistant(final.messages);

    const once = groupParallelTools(asst!.blocks);
    const twice = groupParallelTools(once);
    expect(twice).toEqual(once);
  });

  it('groupParallelTools passes through a single tool_use without wrapping', () => {
    const single: UiToolUseBlock[] = [
      {
        kind: 'tool_use',
        toolUseId: 'one',
        name: 'Bash',
        partialInputJson: '{}',
        input: {},
        streaming: false,
      },
    ];
    const out = groupParallelTools(single);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('tool_use');
  });

  it('groupParallelTools splits groups across non-tool_use boundaries', () => {
    const blocks: any = [
      { kind: 'tool_use', toolUseId: 'a', name: 'X', partialInputJson: '{}', input: {}, streaming: false },
      { kind: 'tool_use', toolUseId: 'b', name: 'Y', partialInputJson: '{}', input: {}, streaming: false },
      { kind: 'text', text: 'between' },
      { kind: 'tool_use', toolUseId: 'c', name: 'Z', partialInputJson: '{}', input: {}, streaming: false },
      { kind: 'tool_use', toolUseId: 'd', name: 'W', partialInputJson: '{}', input: {}, streaming: false },
    ];
    const out = groupParallelTools(blocks);
    // Expect: parallel_group(a,b), text, parallel_group(c,d).
    expect(out).toHaveLength(3);
    expect(out[0].kind).toBe('parallel_group');
    expect((out[0] as any).tools).toHaveLength(2);
    expect(out[1].kind).toBe('text');
    expect(out[2].kind).toBe('parallel_group');
    expect((out[2] as any).tools).toHaveLength(2);
  });
});

describe('reduce — fixture: gpt-oss-thinking-turn', () => {
  it('routes thinking_delta events into a kind:"thinking" block, not text', () => {
    const events = loadFixture('gpt-oss-thinking-turn');
    const { state: seed } = seedStreamingAssistant();

    const final = fold(events, seed);

    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();

    // Two blocks: thinking THEN text. Crucially the thinking content
    // must NOT have leaked into the text block.
    expect(asst!.blocks).toHaveLength(2);
    expect(asst!.blocks[0].kind).toBe('thinking');
    expect(asst!.blocks[1].kind).toBe('text');

    if (asst!.blocks[0].kind === 'thinking') {
      expect(asst!.blocks[0].thinking).toBe(
        "The user asks 'what model are you'. I am gpt-oss:20b.",
      );
      // streaming flag flips false on content_block_stop.
      expect(asst!.blocks[0].streaming).toBe(false);
    }
    if (asst!.blocks[1].kind === 'text') {
      // Final answer is the post-reasoning text — clean, no chain-of-thought.
      expect(asst!.blocks[1].text).toBe('I am gpt-oss:20b.');
      // The chain-of-thought MUST NOT appear in the text block.
      expect(asst!.blocks[1].text).not.toContain('asks');
      expect(asst!.blocks[1].text).not.toContain("'what model");
    }

    expect(asst!.streaming).toBe(false);
    expect(asst!.stopReason).toBe('end_turn');
    expect(final.streamingMessageId).toBeNull();
    expect(final.error).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Boot-time boundary buffer + flush — the ONE remaining mock-2 parity
// bug: daemon emits `system/plugin_loaded` events at boot BEFORE any
// assistant message exists. The reducer used to drop them silently
// (`if (!state.streamingMessageId) return state;`).
//
// Fix design: buffer boot boundaries in `pendingBoundaryBlocks`. On the
// next assistant `message_start`, prepend the buffered boundaries to the
// new assistant message's blocks, in arrival order, ahead of any text.
//
// Verified live in openagentic 99f5086 — the daemon does emit 2× plugin_loaded
// at boot and 1× skill_invoked mid-turn. Mid-turn already worked; boot did not.
// ────────────────────────────────────────────────────────────────────

describe('reduce — boot-time boundary buffer + flush', () => {
  // Helpers — mint plugin_loaded / skill_invoked / message_start envelopes.
  const pluginLoaded = (pluginId: string, opts: Record<string, unknown> = {}) => ({
    type: 'system' as const,
    subtype: 'plugin_loaded' as const,
    data: { pluginId, version: '1.0.0', marketplace: 'official', tools: 3, skills: 1, ...opts },
    uuid: `uuid-plug-${pluginId}`,
  });
  const skillInvoked = (skillId: string, rule: string) => ({
    type: 'system' as const,
    subtype: 'skill_invoked' as const,
    data: { skillId, version: '1.0', rule },
    uuid: `uuid-skill-${skillId}`,
  });
  const systemInit = () => ({
    type: 'system' as const,
    subtype: 'init' as const,
    cwd: '/',
    session_id: 'sess-boot',
    tools: [],
    mcp_servers: [],
    model: 'm',
    permissionMode: 'bypassPermissions' as const,
    slash_commands: [],
    apiKeySource: 'env' as const,
    openagentic_version: '0',
    uuid: 'uuid-init-boot',
  });
  const messageStart = (msgId: string, parent: string | null = null) => ({
    type: 'stream_event' as const,
    event: {
      type: 'message_start' as const,
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'm',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
    session_id: 'sess-boot',
    parent_tool_use_id: parent,
    uuid: `uuid-ms-${msgId}`,
  });
  const textDelta = (msgId: string, idx: number, text: string) => ({
    type: 'stream_event' as const,
    event: {
      type: 'content_block_delta' as const,
      index: idx,
      delta: { type: 'text_delta' as const, text },
    },
    session_id: 'sess-boot',
    parent_tool_use_id: null,
    uuid: `uuid-td-${msgId}-${idx}`,
  });
  const contentBlockStart = (msgId: string, idx: number) => ({
    type: 'stream_event' as const,
    event: {
      type: 'content_block_start' as const,
      index: idx,
      content_block: { type: 'text' as const, text: '' },
    },
    session_id: 'sess-boot',
    parent_tool_use_id: null,
    uuid: `uuid-cbs-${msgId}-${idx}`,
  });

  it('buffers boot-time plugin_loaded events when no assistant exists, then flushes ahead of text on the next message_start', () => {
    let state = INITIAL_STATE;

    // Boot sequence: init + 2× plugin_loaded BEFORE any user/assistant message.
    state = reduce(state, { type: 'event', event: systemInit() as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: pluginLoaded('fastapi-scaffold') as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: pluginLoaded('react-toolkit') as StreamJsonEvent });

    // Buffer should hold both, in arrival order.
    expect(state.pendingBoundaryBlocks).toBeDefined();
    expect(state.pendingBoundaryBlocks).toHaveLength(2);
    expect(state.pendingBoundaryBlocks![0].subtype).toBe('plugin');
    expect(state.pendingBoundaryBlocks![0].body).toContain('fastapi-scaffold');
    expect(state.pendingBoundaryBlocks![1].body).toContain('react-toolkit');

    // No phantom assistant message synthesised.
    const asstBefore = state.messages.find((m) => m.role === 'assistant');
    expect(asstBefore).toBeUndefined();

    // User submits — submit_user creates the empty assistant placeholder.
    state = reduce(state, {
      type: 'submit_user',
      userMsgId: 'u-1',
      asstMsgId: 'a-1',
      text: 'hi',
      createdAt: 1000,
    });

    // Daemon now streams: message_start → text deltas.
    state = reduce(state, { type: 'event', event: messageStart('msg-1') as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: contentBlockStart('msg-1', 0) as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: textDelta('msg-1', 0, 'Hello.') as StreamJsonEvent });

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst).toBeDefined();

    // Buffered boundaries are now PREPENDED, ahead of the text block.
    expect(asst.blocks.length).toBeGreaterThanOrEqual(3);
    expect(asst.blocks[0].kind).toBe('boundary');
    expect(asst.blocks[1].kind).toBe('boundary');
    const b0 = asst.blocks[0] as UiBoundaryBlock;
    const b1 = asst.blocks[1] as UiBoundaryBlock;
    expect(b0.subtype).toBe('plugin');
    expect(b0.body).toContain('fastapi-scaffold');
    expect(b1.subtype).toBe('plugin');
    expect(b1.body).toContain('react-toolkit');

    // Last block is the text block with our delta applied.
    const last = asst.blocks[asst.blocks.length - 1];
    expect(last.kind).toBe('text');
    if (last.kind === 'text') expect(last.text).toBe('Hello.');

    // Buffer cleared after flush.
    expect(state.pendingBoundaryBlocks ?? []).toHaveLength(0);
  });

  it('dedupes duplicate plugin_loaded for the same plugin (boot-init re-fire) — keeps first', () => {
    let state = INITIAL_STATE;
    state = reduce(state, { type: 'event', event: systemInit() as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: pluginLoaded('fastapi-scaffold') as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: pluginLoaded('fastapi-scaffold') as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: pluginLoaded('react-toolkit') as StreamJsonEvent });

    // Only 2 unique entries — second fastapi-scaffold deduped.
    expect(state.pendingBoundaryBlocks).toHaveLength(2);
    expect(state.pendingBoundaryBlocks![0].body).toContain('fastapi-scaffold');
    expect(state.pendingBoundaryBlocks![1].body).toContain('react-toolkit');
  });

  it('mid-turn skill_invoked still appends to the streaming assistant (existing behaviour preserved)', () => {
    // Seed a streaming assistant — simulates the mid-turn case.
    const { state: seed, msgId } = seedStreamingAssistant();
    let state = seed;

    state = reduce(state, {
      type: 'event',
      event: skillInvoked('analyzer', 'parse code') as StreamJsonEvent,
    });

    const asst = state.messages.find((m) => m.id === msgId) as AssistantChatMessage;
    expect(asst.blocks).toHaveLength(1);
    expect(asst.blocks[0].kind).toBe('boundary');
    const b = asst.blocks[0] as UiBoundaryBlock;
    expect(b.subtype).toBe('skill');
    expect(b.body).toContain('analyzer');

    // Buffer untouched (mid-turn writes direct, not buffered).
    expect(state.pendingBoundaryBlocks ?? []).toHaveLength(0);
  });

  it('a second system/init mid-session does NOT wipe the buffer (openagentic re-emits init per turn)', () => {
    let state = INITIAL_STATE;
    state = reduce(state, { type: 'event', event: systemInit() as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: pluginLoaded('p1') as StreamJsonEvent });
    state = reduce(state, { type: 'event', event: pluginLoaded('p2') as StreamJsonEvent });
    expect(state.pendingBoundaryBlocks).toHaveLength(2);

    // Daemon emits a fresh init at the start of the next turn — the
    // boundary buffer must survive so the upcoming message_start can flush it.
    state = reduce(state, { type: 'event', event: systemInit() as StreamJsonEvent });
    expect(state.pendingBoundaryBlocks).toHaveLength(2);
  });

  it('clear action resets the boundary buffer alongside transcript', () => {
    let state = INITIAL_STATE;
    state = reduce(state, { type: 'event', event: pluginLoaded('p1') as StreamJsonEvent });
    expect(state.pendingBoundaryBlocks).toHaveLength(1);

    state = reduce(state, { type: 'clear' });
    expect(state.pendingBoundaryBlocks ?? []).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
  });

  it('subagent message_start (parent_tool_use_id set) does NOT flush the buffer — only top-level does', () => {
    let state = INITIAL_STATE;
    state = reduce(state, { type: 'event', event: pluginLoaded('p1') as StreamJsonEvent });
    expect(state.pendingBoundaryBlocks).toHaveLength(1);

    // Seed a streaming assistant with an existing Task tool_use so the
    // sub-transcript path can find a parent.
    state = {
      ...state,
      messages: [
        ...state.messages,
        {
          id: 'asst-x',
          role: 'assistant',
          blocks: [
            {
              kind: 'tool_use',
              toolUseId: 'toolu_TASK',
              name: 'Task',
              partialInputJson: '{}',
              input: {},
              streaming: true,
            },
          ],
          streaming: true,
          createdAt: 1,
        } as AssistantChatMessage,
      ],
      streamingMessageId: 'asst-x',
    };

    // Subagent message_start — must NOT flush boundaries into the parent message.
    state = reduce(state, {
      type: 'event',
      event: messageStart('msg-sub', 'toolu_TASK') as StreamJsonEvent,
    });

    // Buffer survives: this was a subagent open, not a top-level new message.
    expect(state.pendingBoundaryBlocks).toHaveLength(1);
    const asst = state.messages.find((m) => m.id === 'asst-x') as AssistantChatMessage;
    // Top-level blocks unchanged — no boundary prepended into the parent.
    expect(asst.blocks[0].kind).toBe('tool_use');
  });
});

// ────────────────────────────────────────────────────────────────────
// Bug 2 (2026-04-30) — `Working…` indicator stuck past final response.
//
// User filed: "the 'working' thing still shows when the model has clearly
// answered." Intermittent — sometimes resolves, sometimes doesn't. The
// cm-rule's THINKING/READY pill is driven by `streamingMessageId !== null`,
// so for it to stay THINKING after the model is done, streamingMessageId
// must still be set — meaning the reducer never closed the turn.
//
// Today the reducer flips streamingMessageId to null only on `result` /
// `error` / `interrupt` / `connection_closed` / `clear`. If the daemon's
// `result` event never arrives — observed when the tail-end frame is
// dropped or coalesced — streaming stays true forever. Defensive fix: a
// top-level `message_stop` whose preceding `message_delta` carried
// `stop_reason: end_turn` (the Anthropic signal that the model is done)
// MUST also flip the turn closed.
// ────────────────────────────────────────────────────────────────────

describe('reduce — Bug 2: streaming flip on terminal message_stop', () => {
  function topLevelStreamEvent(inner: any) {
    return {
      type: 'stream_event' as const,
      event: inner,
      session_id: 'sess-bug2',
      parent_tool_use_id: null,
      uuid: `uuid-bug2-${Math.random().toString(36).slice(2, 7)}`,
    };
  }

  it('result event flips streamingMessageId to null AND assistant.streaming to false', () => {
    // Baseline: the existing happy path. Folded explicitly here so a
    // future regression that breaks this is easy to spot — the comment
    // pins this exact assertion as the fixtures-replay invariant for
    // bug 2's TDD red→green.
    const events = loadFixture('simple-text-turn');
    const { state: seed } = seedStreamingAssistant();
    const final = fold(events, seed);

    expect(final.streamingMessageId).toBeNull();
    const asst = findAssistant(final.messages);
    expect(asst).toBeDefined();
    expect(asst!.streaming).toBe(false);
  });

  it('top-level message_stop with stop_reason=end_turn closes the turn even if `result` never arrives', () => {
    // Mimics the live race: daemon sent the model_delta(end_turn) +
    // message_stop, but the `result` event was lost / never delivered.
    // The streaming pill must STILL flip back to READY.
    const { state: seed, msgId } = seedStreamingAssistant();

    const sequence = [
      topLevelStreamEvent({
        type: 'message_start',
        message: {
          id: 'msg-end-turn',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-opus-4',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
      topLevelStreamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      topLevelStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'All done.' },
      }),
      topLevelStreamEvent({ type: 'content_block_stop', index: 0 }),
      topLevelStreamEvent({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 3 },
      }),
      topLevelStreamEvent({ type: 'message_stop' }),
      // No `result` event — simulates the lost-frame race.
    ];

    const final = sequence.reduce(
      (s, e) => reduce(s, { type: 'event', event: e } as ChatAction),
      seed as any,
    ) as typeof seed;

    // Turn must be CLOSED — the cm-rule THINKING pill keys off this.
    expect(final.streamingMessageId).toBeNull();
    const asst = final.messages.find((m: any) => m.id === msgId) as AssistantChatMessage;
    expect(asst).toBeDefined();
    expect(asst!.streaming).toBe(false);
    // Stop reason was preserved through message_delta.
    expect(asst!.stopReason).toBe('end_turn');
    // The text block content is preserved — the closure didn't wipe content.
    expect(asst!.blocks).toHaveLength(1);
    expect(asst!.blocks[0]).toMatchObject({ kind: 'text', text: 'All done.' });
  });

  it('subagent (parent_tool_use_id set) message_stop does NOT close the parent turn', () => {
    // Claude Code spawns subagent runs whose own message_start /
    // message_stop pair is wrapped with `parent_tool_use_id`. Those
    // closures must NOT prematurely close the parent assistant's turn.
    const { state: seed, msgId } = seedStreamingAssistant();

    // Seed a Task tool_use the subagent is "running inside".
    const stateWithTask: any = {
      ...seed,
      messages: seed.messages.map((m: any) => {
        if (m.id !== msgId) return m;
        return {
          ...m,
          blocks: [
            {
              kind: 'tool_use' as const,
              toolUseId: 'toolu_TASK_PARENT',
              name: 'Task',
              partialInputJson: '{}',
              input: { description: 'spawn child' },
              streaming: true,
            },
          ],
        };
      }),
    };

    const subagentEvents = [
      // Subagent message_start — note the parent_tool_use_id.
      {
        type: 'stream_event' as const,
        event: {
          type: 'message_start' as const,
          message: {
            id: 'msg-sub',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-opus-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        },
        session_id: 'sess-bug2',
        parent_tool_use_id: 'toolu_TASK_PARENT',
        uuid: 'uuid-sub-1',
      },
      {
        type: 'stream_event' as const,
        event: {
          type: 'message_delta' as const,
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        session_id: 'sess-bug2',
        parent_tool_use_id: 'toolu_TASK_PARENT',
        uuid: 'uuid-sub-2',
      },
      {
        type: 'stream_event' as const,
        event: { type: 'message_stop' as const },
        session_id: 'sess-bug2',
        parent_tool_use_id: 'toolu_TASK_PARENT',
        uuid: 'uuid-sub-3',
      },
    ];

    const final = subagentEvents.reduce(
      (s, e) => reduce(s, { type: 'event', event: e } as ChatAction),
      stateWithTask,
    );

    // Parent turn MUST still be in flight — subagent close did not
    // bubble up.
    expect(final.streamingMessageId).toBe(msgId);
  });

  // ────────────────────────────────────────────────────────────────────
  // Dark-after-turn bug (2026-05-06):
  // When a turn ends with a tool_use, openagentic's stream layer emits
  // `message_delta` with `stop_reason: end_turn` (incorrectly — the model
  // actually returned tool_use). Bug-2's defensive close trusted the
  // end_turn signal and nulled streamingMessageId BEFORE the next LLM
  // completion's message_start arrived → all subsequent stream_events
  // dropped silently at the reducer's `idx < 0` guard.
  //
  // Live capture (Sonnet 4.6, FANG prompt, 2026-05-06):
  //   daemon emit: 11 message_starts, 11 message_stops, 33 message_deltas
  //                ALL with stop_reason=end_turn, 1 result (terminal)
  //   browser reducer: only content_block_deltas reach the entry log —
  //                    every event sees streamingMessageId=null.
  //
  // Fix invariant: when the assistant message has a tool_use block as its
  // last finished block, the defensive close MUST NOT fire. The next LLM
  // completion is coming and needs streamingMessageId to still match.
  // ────────────────────────────────────────────────────────────────────
  it('end_turn message_stop with pending tool_use does NOT close the turn (dark-after-turn)', () => {
    const { state: seed, msgId } = seedStreamingAssistant();

    const sequence = [
      topLevelStreamEvent({
        type: 'message_start',
        message: {
          id: 'msg-tool-turn',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-6',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
      topLevelStreamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_whoami',
          name: 'Bash',
          input: {},
        },
      }),
      topLevelStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":"whoami"}' },
      }),
      topLevelStreamEvent({ type: 'content_block_stop', index: 0 }),
      // Daemon (incorrectly) emits stop_reason=end_turn even for tool_use turns.
      topLevelStreamEvent({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      }),
      topLevelStreamEvent({ type: 'message_stop' }),
      // Tool runs server-side; tool_result envelope arrives next:
      {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: 'toolu_whoami',
              content: 'openagentic',
              is_error: false,
            },
          ],
        },
        session_id: 'sess-bug3',
        parent_tool_use_id: null,
        uuid: 'uuid-bug3-tr',
      },
    ];

    const final = sequence.reduce(
      (s, e) => reduce(s, { type: 'event', event: e } as ChatAction),
      seed as any,
    ) as typeof seed;

    // CRITICAL invariant: streamingMessageId STAYS set so the next turn's
    // message_start can attach to the same assistant message and continue
    // streaming. Today this fails because the defensive close fires
    // unconditionally on end_turn → null → subsequent events drop.
    expect(final.streamingMessageId).toBe(msgId);
    const asst = final.messages.find((m: any) => m.id === msgId) as AssistantChatMessage;
    expect(asst).toBeDefined();
    expect(asst!.streaming).toBe(true);
    // The tool_use block should be present and finished.
    expect(asst!.blocks).toHaveLength(1);
    expect(asst!.blocks[0]).toMatchObject({
      kind: 'tool_use',
      toolUseId: 'toolu_whoami',
      name: 'Bash',
      streaming: false,
    });
  });
});
