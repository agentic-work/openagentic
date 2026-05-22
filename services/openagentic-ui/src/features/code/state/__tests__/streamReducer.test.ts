import { describe, it, expect } from 'vitest';
import { reduce, createInitialState } from '../streamReducer';
import type {
  ContentBlockDelta,
  ContentBlockStart,
  ContentBlockStop,
  ControlRequestEvent,
  ErrorEvent,
  MessageStart,
  MessageStop,
  MessageDelta,
  ResultEvent,
  StreamEventWrapper,
  SystemInitEvent,
  ToolProgressEvent,
  UserToolResultEvent,
} from '../../types/_sdk-bindings';
import type {
  AssistantChatMessage,
  UiToolUseBlock,
} from '../../types/uiState';

// ────────────────────────────────────────────────────────────────────
// Fixture helpers — generate realistic wire-format events.
// ────────────────────────────────────────────────────────────────────

const SESSION_ID = 'sess-test-1';

function streamEvent(
  inner: MessageStart | MessageDelta | MessageStop | ContentBlockStart | ContentBlockDelta | ContentBlockStop,
  parentToolUseId: string | null = null,
  uuid = 'uuid-' + Math.random().toString(36).slice(2, 8),
): StreamEventWrapper {
  return {
    type: 'stream_event',
    event: inner,
    session_id: SESSION_ID,
    parent_tool_use_id: parentToolUseId,
    uuid,
  };
}

function messageStart(messageId: string, model = 'claude-opus-4'): MessageStart {
  return {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
}

function contentBlockStartText(index: number): ContentBlockStart {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  };
}

function contentBlockStartToolUse(index: number, id: string, name: string): ContentBlockStart {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {} },
  };
}

function contentBlockTextDelta(index: number, text: string): ContentBlockDelta {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  };
}

function contentBlockInputJsonDelta(index: number, partialJson: string): ContentBlockDelta {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  };
}

function contentBlockStop(index: number): ContentBlockStop {
  return { type: 'content_block_stop', index };
}

function messageDelta(stopReason: string | null = 'end_turn', outputTokens = 0): MessageDelta {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason },
    usage: { output_tokens: outputTokens },
  };
}

function messageStop(): MessageStop {
  return { type: 'message_stop' };
}

function toolResultEvent(toolUseId: string, content: string, isError = false): UserToolResultEvent {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: SESSION_ID,
    uuid: 'uuid-tr-' + Math.random().toString(36).slice(2, 8),
  };
}

function resultSuccess(usage = { input_tokens: 100, output_tokens: 50 }, costUsd = 0.0023): ResultEvent {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1234,
    duration_api_ms: 800,
    num_turns: 1,
    session_id: SESSION_ID,
    total_cost_usd: costUsd,
    usage,
    uuid: 'uuid-res-' + Math.random().toString(36).slice(2, 8),
  };
}

function resultErrorDuringExecution(message = 'Something went wrong'): ResultEvent {
  return {
    type: 'result',
    subtype: 'error' as 'success' | 'error' | 'error_max_turns',
    is_error: true,
    duration_ms: 1000,
    session_id: SESSION_ID,
    result: message,
    uuid: 'uuid-err-' + Math.random().toString(36).slice(2, 8),
  };
}

function controlRequestCanUseTool(
  requestId: string,
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
): ControlRequestEvent {
  return {
    type: 'control_request',
    request_id: requestId,
    request: {
      subtype: 'can_use_tool',
      tool_name: toolName,
      input,
      tool_use_id: toolUseId,
    },
    session_id: SESSION_ID,
  };
}

function progressEvent(toolUseId: string, parentToolUseId: string, output?: string, elapsedSec?: number): ToolProgressEvent {
  return {
    type: 'progress',
    data: {
      type: 'tool_progress',
      ...(output !== undefined ? { output } : {}),
      ...(elapsedSec !== undefined ? { elapsedTimeSeconds: elapsedSec } : {}),
    },
    toolUseID: toolUseId,
    parentToolUseID: parentToolUseId,
    uuid: 'uuid-prog-' + Math.random().toString(36).slice(2, 8),
  };
}

function systemInit(): SystemInitEvent {
  return {
    type: 'system',
    subtype: 'init',
    cwd: '/workspace',
    session_id: SESSION_ID,
    tools: ['Bash', 'Read', 'Write'],
    mcp_servers: [{ name: 'filesystem', status: 'connected' }],
    model: 'claude-opus-4',
    permissionMode: 'bypassPermissions',
    slash_commands: ['/help', '/model'],
    apiKeySource: 'env',
    openagentic_version: '0.6.7',
    uuid: 'uuid-init-' + Math.random().toString(36).slice(2, 8),
    fast_mode_state: 'inactive',
    budget_cap_usd: null,
  };
}

function compactBoundary(trigger: 'auto' | 'manual' = 'auto') {
  return {
    type: 'system' as const,
    subtype: 'compact_boundary' as const,
    trigger,
    uuid: 'uuid-cb-' + Math.random().toString(36).slice(2, 8),
  };
}

function controlResponseSuccess(requestId: string) {
  return {
    type: 'control_response' as const,
    response: {
      subtype: 'success' as const,
      request_id: requestId,
      response: { behavior: 'allow' },
    },
  };
}

function controlResponseError(requestId: string, error: string) {
  return {
    type: 'control_response' as const,
    response: {
      subtype: 'error' as const,
      request_id: requestId,
      error,
    },
  };
}

function errorEvent(message: string): ErrorEvent {
  return {
    type: 'error',
    message,
    session_id: SESSION_ID,
  };
}

/**
 * Seeds the reducer with an active streaming assistant message — same
 * shape useCodeModeChat.sendMessage() pushes onto messages before
 * forwarding the user's text to the daemon. Returns the seeded state
 * AND the message id (so tests can assert against it).
 */
function seedStreamingAssistant(stateOverride?: Partial<ReturnType<typeof createInitialState>>) {
  const base = { ...createInitialState(), ...(stateOverride ?? {}) };
  const msgId = 'asst-test-1';
  const seed: AssistantChatMessage = {
    id: msgId,
    role: 'assistant',
    blocks: [],
    streaming: true,
    createdAt: 1000,
  };
  return {
    state: { ...base, messages: [...base.messages, seed], streamingMessageId: msgId },
    msgId,
  };
}

// ────────────────────────────────────────────────────────────────────
// Scenario A — simple text turn
// ────────────────────────────────────────────────────────────────────

describe('reduce — simple text turn', () => {
  it('flattens message_start → text deltas → result into one assistant message with concatenated text', () => {
    let { state } = seedStreamingAssistant();

    state = reduce(state, streamEvent(messageStart('msg_1')));
    state = reduce(state, streamEvent(contentBlockStartText(0)));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'Hello')));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, ', ')));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'world!')));
    state = reduce(state, streamEvent(contentBlockStop(0)));
    state = reduce(state, streamEvent(messageDelta('end_turn', 12)));
    state = reduce(state, streamEvent(messageStop()));
    state = reduce(state, resultSuccess({ input_tokens: 50, output_tokens: 12 }, 0.0001));

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst).toBeDefined();
    expect(asst.blocks).toHaveLength(1);
    expect(asst.blocks[0]).toEqual({ kind: 'text', text: 'Hello, world!' });
    expect(asst.streaming).toBe(false);
    expect(asst.stopReason).toBe('end_turn');
    expect(asst.usage?.inputTokens).toBe(50);
    expect(asst.usage?.outputTokens).toBe(12);
    expect(state.streamingMessageId).toBe(null);
    expect(state.contextTokens).toBe(50);
    expect(state.totalCostUsd).toBeCloseTo(0.0001);
    expect(state.totalOutputTokens).toBe(12);
    expect(state.lastTurnMs).toBe(1234);
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario B — tool call + result
// ────────────────────────────────────────────────────────────────────

describe('reduce — tool call + result', () => {
  it('streams a tool_use block with input_json deltas and attaches the matching tool_result', () => {
    let { state } = seedStreamingAssistant();

    state = reduce(state, streamEvent(messageStart('msg_2')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_X', 'Bash')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"command"')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, ':"echo hi"')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '}')));
    state = reduce(state, streamEvent(contentBlockStop(0)));

    let asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const tool = asst.blocks[0] as UiToolUseBlock;
    expect(tool.kind).toBe('tool_use');
    expect(tool.toolUseId).toBe('toolu_X');
    expect(tool.name).toBe('Bash');
    expect(tool.input).toEqual({ command: 'echo hi' });
    expect(tool.streaming).toBe(false);

    state = reduce(state, toolResultEvent('toolu_X', 'hi'));
    asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const tool2 = asst.blocks[0] as UiToolUseBlock;
    expect(tool2.result?.text).toBe('hi');
    expect(tool2.result?.isError).toBe(false);
    expect(tool2.streaming).toBe(false);
  });

  it('handles an array of typed content blocks in tool_result (text + image)', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_2b')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_IMG', 'Read')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"path":"/tmp/p.png"}')));
    state = reduce(state, streamEvent(contentBlockStop(0)));

    state = reduce(state, {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_IMG',
            content: [
              { type: 'text', text: 'image follows' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } },
            ],
            is_error: false,
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
      uuid: 'uuid-tr-img',
    });
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const tool = asst.blocks[0] as UiToolUseBlock;
    expect(tool.result?.text).toBe('image follows');
    expect(tool.result?.hasImage).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario C — parallel subagents (THE KEY ONE)
// ────────────────────────────────────────────────────────────────────

describe('reduce — parallel subagents', () => {
  it('routes top-level interleaved sub-transcripts into the correct parent Task tool block subBlocks', () => {
    // Realistic openagentic wire format: the model fires THREE separate
    // Task tool_use calls in one assistant turn (toolu_TA, toolu_TB,
    // toolu_TC). Each Task spawns ONE subagent, and all three subagent
    // streams interleave at the top level (different parent_tool_use_id
    // per sub-stream). This is the actual concurrent case the reducer
    // must handle — each sub-stream is sequential per its own parent,
    // but the THREE PARENTS' events are interleaved on the wire.
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_top')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_TA', 'Task')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"description":"A"}')));
    state = reduce(state, streamEvent(contentBlockStop(0)));
    state = reduce(state, streamEvent(contentBlockStartToolUse(1, 'toolu_TB', 'Task')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(1, '{"description":"B"}')));
    state = reduce(state, streamEvent(contentBlockStop(1)));
    state = reduce(state, streamEvent(contentBlockStartToolUse(2, 'toolu_TC', 'Task')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(2, '{"description":"C"}')));
    state = reduce(state, streamEvent(contentBlockStop(2)));

    // Sub-streams interleave by timestamp (network jitter / merged
    // generators). Each parent_tool_use_id is sequential within itself
    // but the THREE parents are mixed.
    // Step 1: A's message_start
    state = reduce(state, streamEvent(messageStart('sub_a'), 'toolu_TA'));
    // Step 2: A's text block start + first delta
    state = reduce(state, streamEvent(contentBlockStartText(0), 'toolu_TA'));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'A1'), 'toolu_TA'));
    // Step 3: B's message_start (interleaved)
    state = reduce(state, streamEvent(messageStart('sub_b'), 'toolu_TB'));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_subB', 'Read'), 'toolu_TB'));
    // Step 4: A continues (gets a second text delta)
    state = reduce(state, streamEvent(contentBlockTextDelta(0, '_more'), 'toolu_TA'));
    // Step 5: C's message_start (interleaved with both)
    state = reduce(state, streamEvent(messageStart('sub_c'), 'toolu_TC'));
    state = reduce(state, streamEvent(contentBlockStartText(0), 'toolu_TC'));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'C1'), 'toolu_TC'));
    // Step 6: B finishes its input
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"path":"/x"}'), 'toolu_TB'));
    state = reduce(state, streamEvent(contentBlockStop(0), 'toolu_TB'));
    // Step 7: A wraps up
    state = reduce(state, streamEvent(contentBlockStop(0), 'toolu_TA'));
    state = reduce(state, streamEvent(messageStop(), 'toolu_TA'));
    // Step 8: C continues then wraps up
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'C2'), 'toolu_TC'));
    state = reduce(state, streamEvent(contentBlockStop(0), 'toolu_TC'));

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.blocks).toHaveLength(3);

    // Parent A — subBlocks contains text 'A1_more'
    const parentA = asst.blocks[0] as UiToolUseBlock;
    expect(parentA.toolUseId).toBe('toolu_TA');
    expect(parentA.subBlocks).toHaveLength(1);
    expect(parentA.subBlocks![0]).toMatchObject({ kind: 'text', text: 'A1_more' });

    // Parent B — subBlocks contains tool_use 'toolu_subB' with parsed input
    const parentB = asst.blocks[1] as UiToolUseBlock;
    expect(parentB.toolUseId).toBe('toolu_TB');
    expect(parentB.subBlocks).toHaveLength(1);
    expect(parentB.subBlocks![0]).toMatchObject({
      kind: 'tool_use',
      toolUseId: 'toolu_subB',
      name: 'Read',
    });
    expect((parentB.subBlocks![0] as UiToolUseBlock).input).toEqual({ path: '/x' });
    expect((parentB.subBlocks![0] as UiToolUseBlock).streaming).toBe(false);

    // Parent C — subBlocks contains text 'C1C2'
    const parentC = asst.blocks[2] as UiToolUseBlock;
    expect(parentC.toolUseId).toBe('toolu_TC');
    expect(parentC.subBlocks).toHaveLength(1);
    expect(parentC.subBlocks![0]).toMatchObject({ kind: 'text', text: 'C1C2' });
  });

  it('preserves sub-stream order: the FIRST sub_A → sub_B → sub_C message_start determines subBlocks indexing per parent', () => {
    // For each parent, only ONE sub-stream runs (one Task = one
    // subagent), so subBlocks[0] is just the first block of that
    // single sub-stream's first message. This test asserts that even
    // when Sub A finishes after Sub C starts, A's subBlocks slot is
    // not overwritten by C's events.
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_p')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_P1', 'Task')));
    state = reduce(state, streamEvent(contentBlockStop(0)));
    state = reduce(state, streamEvent(contentBlockStartToolUse(1, 'toolu_P2', 'Task')));
    state = reduce(state, streamEvent(contentBlockStop(1)));

    state = reduce(state, streamEvent(messageStart('sa'), 'toolu_P1'));
    state = reduce(state, streamEvent(contentBlockStartText(0), 'toolu_P1'));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'first'), 'toolu_P1'));
    // Now P2's sub starts BEFORE P1's content_block_stop — the
    // _subMessageBlockOffset on P1 must not be confused by P2's events.
    state = reduce(state, streamEvent(messageStart('sb'), 'toolu_P2'));
    state = reduce(state, streamEvent(contentBlockStartText(0), 'toolu_P2'));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'second'), 'toolu_P2'));
    state = reduce(state, streamEvent(contentBlockStop(0), 'toolu_P2'));
    // P1's content_block_stop arrives AFTER P2's. Should still close
    // P1's text block, not P2's.
    state = reduce(state, streamEvent(contentBlockTextDelta(0, '_late'), 'toolu_P1'));
    state = reduce(state, streamEvent(contentBlockStop(0), 'toolu_P1'));

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const p1 = asst.blocks[0] as UiToolUseBlock;
    const p2 = asst.blocks[1] as UiToolUseBlock;
    expect(p1.subBlocks?.[0]).toMatchObject({ kind: 'text', text: 'first_late' });
    expect(p2.subBlocks?.[0]).toMatchObject({ kind: 'text', text: 'second' });
  });

  it('attaches a sub-tool result to the matching nested tool_use block (recursion)', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_p')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_PARENT2', 'Task')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"description":"x"}')));
    state = reduce(state, streamEvent(contentBlockStop(0)));

    state = reduce(state, streamEvent(messageStart('sub_x'), 'toolu_PARENT2'));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_inner', 'Read'), 'toolu_PARENT2'));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"path":"/a"}'), 'toolu_PARENT2'));
    state = reduce(state, streamEvent(contentBlockStop(0), 'toolu_PARENT2'));

    state = reduce(state, toolResultEvent('toolu_inner', 'inner result text'));

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const parent = asst.blocks[0] as UiToolUseBlock;
    const inner = parent.subBlocks![0] as UiToolUseBlock;
    expect(inner.toolUseId).toBe('toolu_inner');
    expect(inner.result?.text).toBe('inner result text');
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario D — permission round-trip
// ────────────────────────────────────────────────────────────────────

describe('reduce — permission round-trip', () => {
  it('sets pendingPermission on can_use_tool, clears it on a control_response success', () => {
    let state = createInitialState();
    state = reduce(
      state,
      controlRequestCanUseTool('r1', 'toolu_perm', 'Bash', { command: 'ls' }),
    );
    expect(state.pendingPermission).not.toBeNull();
    expect(state.pendingPermission?.request_id).toBe('r1');
    expect(state.pendingPermission?.tool_name).toBe('Bash');
    expect(state.pendingPermission?.input).toEqual({ command: 'ls' });
    expect(state.pendingPermission?.tool_use_id).toBe('toolu_perm');

    state = reduce(state, controlResponseSuccess('r1'));
    expect(state.pendingPermission).toBeNull();
  });

  it('surfaces error subtype on control_response into state.error', () => {
    let state = createInitialState();
    state = reduce(state, controlResponseError('r2', 'Marketplace not found'));
    expect(state.error).toBe('Marketplace not found');
  });

  it('does not clear an unrelated pendingPermission on a control_response error', () => {
    let state = createInitialState();
    state = reduce(state, controlRequestCanUseTool('r3', 'toolu_y', 'Read', { path: '/x' }));
    state = reduce(state, controlResponseError('r-other', 'Plugin install failed'));
    expect(state.pendingPermission).not.toBeNull();
    expect(state.error).toBe('Plugin install failed');
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario E — compact boundary
// ────────────────────────────────────────────────────────────────────

describe('reduce — compact boundary', () => {
  it('sets compactionFlash=auto on a system/compact_boundary with trigger=auto', () => {
    let state = createInitialState();
    state = reduce(state, compactBoundary('auto') as any);
    expect(state.compactionFlash).toBe('auto');
  });

  it('sets compactionFlash=manual when trigger=manual', () => {
    let state = createInitialState();
    state = reduce(state, compactBoundary('manual') as any);
    expect(state.compactionFlash).toBe('manual');
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario F — error_during_execution / error
// ────────────────────────────────────────────────────────────────────

describe('reduce — error during execution', () => {
  it('result with subtype=error freezes all blocks and clears streaming', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_err')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_pending', 'Bash')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"command":"sleep')));
    // Daemon errors mid-tool — no content_block_stop, no message_stop.
    state = reduce(state, resultErrorDuringExecution('subprocess hung'));

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.streaming).toBe(false);
    const tool = asst.blocks[0] as UiToolUseBlock;
    expect(tool.streaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });

  it('top-level error event freezes the in-flight assistant and surfaces the message', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_err2')));
    state = reduce(state, streamEvent(contentBlockStartText(0)));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'partial')));

    state = reduce(state, errorEvent('socket closed'));
    expect(state.streamingMessageId).toBeNull();
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.streaming).toBe(false);
    // The reducer appends a marker text block reflecting the error
    const lastBlock = asst.blocks[asst.blocks.length - 1];
    expect(lastBlock.kind).toBe('text');
    if (lastBlock.kind === 'text') {
      expect(lastBlock.text).toContain('socket closed');
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario G — progress events
// ────────────────────────────────────────────────────────────────────

describe('reduce — progress events', () => {
  it('attaches liveOutput and elapsedSec to the matching tool_use block', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_prog')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_long', 'Bash')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"command":"sleep 30"}')));
    state = reduce(state, streamEvent(contentBlockStop(0)));

    state = reduce(state, progressEvent('toolu_long', 'toolu_long', 'progress chunk 1', 5));
    state = reduce(state, progressEvent('toolu_long', 'toolu_long', undefined, 12));

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const tool = asst.blocks[0] as UiToolUseBlock;
    expect(tool.liveOutput).toBe('progress chunk 1');
    expect(tool.elapsedSec).toBe(12);
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario H — idempotent upsert
// ────────────────────────────────────────────────────────────────────

describe('reduce — idempotent upsert', () => {
  it('repeated tool_result for the same tool_use_id is a no-op (no duplicate result fields)', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_idem')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_idem', 'Bash')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"command":"echo"}')));
    state = reduce(state, streamEvent(contentBlockStop(0)));

    state = reduce(state, toolResultEvent('toolu_idem', 'first'));
    const after1 = state.messages;
    state = reduce(state, toolResultEvent('toolu_idem', 'first'));
    const after2 = state.messages;
    // Same logical state — counts unchanged.
    expect(after2).toHaveLength(after1.length);
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.blocks).toHaveLength(1);
    const tool = asst.blocks[0] as UiToolUseBlock;
    expect(tool.result?.text).toBe('first');
  });

  it('a materialized assistant event (type=assistant) is a no-op (deltas already rendered)', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_mat')));
    state = reduce(state, streamEvent(contentBlockStartText(0)));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'rendered')));
    state = reduce(state, streamEvent(contentBlockStop(0)));

    const before = state.messages.length;
    state = reduce(state, {
      type: 'assistant',
      message: {
        id: 'msg_mat',
        role: 'assistant',
        content: [{ type: 'text', text: 'rendered' }],
        model: 'claude-opus-4',
      },
      session_id: SESSION_ID,
      uuid: 'uuid-mat',
    });
    expect(state.messages.length).toBe(before);
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.blocks).toHaveLength(1);
    expect(asst.blocks[0]).toEqual({ kind: 'text', text: 'rendered' });
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario — system init
// ────────────────────────────────────────────────────────────────────

describe('reduce — system init', () => {
  it('captures sessionMeta, model, and fastMode', () => {
    let state = createInitialState();
    state = reduce(state, systemInit());
    expect(state.model).toBe('claude-opus-4');
    expect(state.fastMode).toBe('inactive');
    expect(state.sessionMeta).not.toBeNull();
    expect(state.sessionMeta!.tools).toEqual(['Bash', 'Read', 'Write']);
    expect(state.sessionMeta!.cwd).toBe('/workspace');
    expect(state.sessionMeta!.permissionMode).toBe('bypassPermissions');
    expect(state.sessionMeta!.budgetCapUsd).toBe(null);
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario — multiple Anthropic messages in one turn (block offsets)
// ────────────────────────────────────────────────────────────────────

describe('reduce — multi-message turn (block offsets)', () => {
  it('preserves content_block indices across two consecutive message_start sequences', () => {
    let { state } = seedStreamingAssistant();

    // First message: text only.
    state = reduce(state, streamEvent(messageStart('msg_a')));
    state = reduce(state, streamEvent(contentBlockStartText(0)));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'Hi.')));
    state = reduce(state, streamEvent(contentBlockStop(0)));
    state = reduce(state, streamEvent(messageStop()));

    // Second message in same turn: tool call. Its content_block index restarts at 0.
    state = reduce(state, streamEvent(messageStart('msg_b')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, 'toolu_late', 'Bash')));
    state = reduce(state, streamEvent(contentBlockInputJsonDelta(0, '{"command":"echo"}')));
    state = reduce(state, streamEvent(contentBlockStop(0)));
    state = reduce(state, streamEvent(messageStop()));

    state = reduce(state, resultSuccess());

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    expect(asst.blocks).toHaveLength(2);
    expect(asst.blocks[0]).toEqual({ kind: 'text', text: 'Hi.' });
    const tool = asst.blocks[1] as UiToolUseBlock;
    expect(tool.kind).toBe('tool_use');
    expect(tool.toolUseId).toBe('toolu_late');
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario — stale streaming msg, defensive close
// ────────────────────────────────────────────────────────────────────

describe('reduce — defensive close on result with mismatched id', () => {
  it('closes all in-flight assistant messages when result arrives without a matching streamingMessageId', () => {
    // Seed without setting streamingMessageId — simulates the gpt-oss:20b
    // case where the daemon emits a result whose target id doesn't match
    // any in-flight message.
    let state = createInitialState();
    const seed: AssistantChatMessage = {
      id: 'asst-orphan',
      role: 'assistant',
      blocks: [
        { kind: 'thinking', thinking: 'still spinning', streaming: true },
        {
          kind: 'tool_use',
          toolUseId: 'toolu_o',
          name: 'Bash',
          partialInputJson: '{"command":"echo"}',
          streaming: true,
        },
      ],
      streaming: true,
      createdAt: 1,
    };
    state = { ...state, messages: [seed] };
    state = reduce(state, resultSuccess());
    const asst = state.messages[0] as AssistantChatMessage;
    expect(asst.streaming).toBe(false);
    expect((asst.blocks[0] as any).streaming).toBe(false);
    expect((asst.blocks[1] as UiToolUseBlock).streaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario — subagent assistant/user envelopes with parent_tool_use_id
//
// The daemon emits a `progress` event of type `agent_progress` for every
// step a Task/Agent subagent takes. The normalizer in openagentic's
// queryHelpers.ts then materializes the wrapped inner message as either
//
//   { type:'assistant', message:{...content:[tool_use|text]}, parent_tool_use_id:<task-id> }
//
// or (for tool_results)
//
//   { type:'user', message:{role:'user', content:[tool_result]}, parent_tool_use_id:<task-id> }
//
// The matching `stream_event` deltas are NOT emitted with the parent id
// populated (print.ts hardcodes parent_tool_use_id:null on stream_event
// envelopes), so the only signal the UI gets that a tool_use belongs to
// a subagent is the assistant/user envelope. The reducer MUST therefore
// route these envelopes — when a non-null parent id is present — into
// the parent Task tool_use's `subBlocks`.
// ────────────────────────────────────────────────────────────────────

describe('reduce — subagent envelopes route into parent Task subBlocks', () => {
  function assistantEnvelope(opts: {
    messageId: string;
    parentToolUseId: string | null;
    content: Array<
      | { type: 'text'; text: string }
      | {
          type: 'tool_use';
          id: string;
          name: string;
          input: Record<string, unknown>;
        }
    >;
  }) {
    return {
      type: 'assistant' as const,
      message: {
        id: opts.messageId,
        type: 'message',
        role: 'assistant',
        content: opts.content,
        model: 'claude-haiku-4-5',
      },
      parent_tool_use_id: opts.parentToolUseId,
      session_id: SESSION_ID,
      uuid: 'uuid-asst-' + Math.random().toString(36).slice(2, 8),
    };
  }

  function userToolResultEnvelope(opts: {
    parentToolUseId: string;
    toolUseId: string;
    content: string;
    isError?: boolean;
  }) {
    return {
      type: 'user' as const,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: opts.toolUseId,
            content: opts.content,
            is_error: opts.isError === true,
          },
        ],
      },
      parent_tool_use_id: opts.parentToolUseId,
      session_id: SESSION_ID,
      uuid: 'uuid-tr-sub-' + Math.random().toString(36).slice(2, 8),
    };
  }

  function seedStateWithTaskTool(taskToolUseId: string) {
    let { state } = seedStreamingAssistant();
    // Stream a Task tool_use into the parent's blocks.
    state = reduce(state, streamEvent(messageStart('msg_top')));
    state = reduce(state, streamEvent(contentBlockStartToolUse(0, taskToolUseId, 'Task')));
    state = reduce(
      state,
      streamEvent(
        contentBlockInputJsonDelta(0, '{"description":"research thing"}'),
      ),
    );
    state = reduce(state, streamEvent(contentBlockStop(0)));
    return state;
  }

  it('appends a subagent text content block into the parent Task tool_use subBlocks', () => {
    let state = seedStateWithTaskTool('toolu_TASK_TEXT');
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'sub_msg_1',
        parentToolUseId: 'toolu_TASK_TEXT',
        content: [{ type: 'text', text: 'Sub-agent says hi.' }],
      }),
    );
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const taskBlock = asst.blocks.find(
      (b) => b.kind === 'tool_use' && (b as UiToolUseBlock).toolUseId === 'toolu_TASK_TEXT',
    ) as UiToolUseBlock;
    expect(taskBlock).toBeDefined();
    expect(taskBlock.subBlocks).toBeDefined();
    expect(taskBlock.subBlocks!.length).toBe(1);
    expect(taskBlock.subBlocks![0]).toEqual({
      kind: 'text',
      text: 'Sub-agent says hi.',
    });
  });

  it('appends a subagent tool_use content block into the parent Task subBlocks', () => {
    let state = seedStateWithTaskTool('toolu_TASK_TOOL');
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'sub_msg_2',
        parentToolUseId: 'toolu_TASK_TOOL',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_SUB_BASH',
            name: 'Bash',
            input: { command: 'pwd' },
          },
        ],
      }),
    );
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const taskBlock = asst.blocks.find(
      (b) => b.kind === 'tool_use' && (b as UiToolUseBlock).toolUseId === 'toolu_TASK_TOOL',
    ) as UiToolUseBlock;
    expect(taskBlock.subBlocks!.length).toBe(1);
    const inner = taskBlock.subBlocks![0] as UiToolUseBlock;
    expect(inner.kind).toBe('tool_use');
    expect(inner.toolUseId).toBe('toolu_SUB_BASH');
    expect(inner.name).toBe('Bash');
    expect(inner.input).toEqual({ command: 'pwd' });
    expect(inner.streaming).toBe(false); // materialized envelopes are non-streaming
  });

  it('attaches a subagent tool_result to the matching nested tool_use', () => {
    let state = seedStateWithTaskTool('toolu_TASK_RES');
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'sub_msg_3',
        parentToolUseId: 'toolu_TASK_RES',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_SUB_READ',
            name: 'Read',
            input: { file_path: '/etc/hostname' },
          },
        ],
      }),
    );
    state = reduce(
      state,
      userToolResultEnvelope({
        parentToolUseId: 'toolu_TASK_RES',
        toolUseId: 'toolu_SUB_READ',
        content: 'openagentic-pod-x',
      }),
    );
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const taskBlock = asst.blocks.find(
      (b) => b.kind === 'tool_use' && (b as UiToolUseBlock).toolUseId === 'toolu_TASK_RES',
    ) as UiToolUseBlock;
    const inner = taskBlock.subBlocks![0] as UiToolUseBlock;
    expect(inner.result).toBeDefined();
    expect(inner.result!.text).toBe('openagentic-pod-x');
    expect(inner.result!.isError).toBe(false);
  });

  it('handles a multi-block subagent message (text + tool_use) in one envelope', () => {
    let state = seedStateWithTaskTool('toolu_TASK_MIX');
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'sub_msg_mix',
        parentToolUseId: 'toolu_TASK_MIX',
        content: [
          { type: 'text', text: "I'll list workspaces." },
          {
            type: 'tool_use',
            id: 'toolu_SUB_LS',
            name: 'Bash',
            input: { command: 'ls /workspaces' },
          },
        ],
      }),
    );
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const taskBlock = asst.blocks.find(
      (b) => b.kind === 'tool_use' && (b as UiToolUseBlock).toolUseId === 'toolu_TASK_MIX',
    ) as UiToolUseBlock;
    expect(taskBlock.subBlocks!.length).toBe(2);
    expect(taskBlock.subBlocks![0]).toEqual({ kind: 'text', text: "I'll list workspaces." });
    const tool = taskBlock.subBlocks![1] as UiToolUseBlock;
    expect(tool.kind).toBe('tool_use');
    expect(tool.toolUseId).toBe('toolu_SUB_LS');
  });

  it('a root-level assistant envelope (parent_tool_use_id=null) stays a no-op (deltas already rendered)', () => {
    // Regression — preserves the existing top-level assistant no-op
    // contract: the top-level streaming render is driven by stream_event
    // deltas, NOT the materialized assistant envelope.
    let { state } = seedStreamingAssistant();
    state = reduce(state, streamEvent(messageStart('msg_top')));
    state = reduce(state, streamEvent(contentBlockStartText(0)));
    state = reduce(state, streamEvent(contentBlockTextDelta(0, 'rendered')));
    state = reduce(state, streamEvent(contentBlockStop(0)));
    const before = state.messages.length;
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'msg_top',
        parentToolUseId: null,
        content: [{ type: 'text', text: 'rendered' }],
      }),
    );
    expect(state.messages.length).toBe(before);
    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    // Single text block, NOT duplicated by the assistant envelope.
    expect(asst.blocks).toHaveLength(1);
    expect(asst.blocks[0]).toEqual({ kind: 'text', text: 'rendered' });
  });

  it('appends multiple subagent assistant turns into the SAME parent subBlocks (think → act → observe)', () => {
    let state = seedStateWithTaskTool('toolu_TASK_MULTI');
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'sub_t1',
        parentToolUseId: 'toolu_TASK_MULTI',
        content: [{ type: 'text', text: 'thinking…' }],
      }),
    );
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'sub_t2',
        parentToolUseId: 'toolu_TASK_MULTI',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_SUB_GREP',
            name: 'Grep',
            input: { pattern: 'foo' },
          },
        ],
      }),
    );
    state = reduce(
      state,
      assistantEnvelope({
        messageId: 'sub_t3',
        parentToolUseId: 'toolu_TASK_MULTI',
        content: [{ type: 'text', text: 'final answer' }],
      }),
    );

    const asst = state.messages.find((m) => m.role === 'assistant') as AssistantChatMessage;
    const taskBlock = asst.blocks.find(
      (b) => b.kind === 'tool_use' && (b as UiToolUseBlock).toolUseId === 'toolu_TASK_MULTI',
    ) as UiToolUseBlock;
    expect(taskBlock.subBlocks!.length).toBe(3);
    expect(taskBlock.subBlocks![0]).toMatchObject({ kind: 'text', text: 'thinking…' });
    expect((taskBlock.subBlocks![1] as UiToolUseBlock).name).toBe('Grep');
    expect(taskBlock.subBlocks![2]).toMatchObject({ kind: 'text', text: 'final answer' });
  });
});

// ── /clear regression — TUI parity audit 2026-05-02 ────────────────
//
// tui-vs-codemode-diff.report.md: "/clear between tool calls doesn't
// actually wipe transcript (leftover Bash block survived)". Pin the
// reducer's `clear` action to TRULY reset messages even when prior
// turns left tool_use / tool_result blocks behind.
describe("reduce — 'clear' truly empties the transcript", () => {
  it('wipes messages, streamingMessageId, error, pendingPermission, inkDomViews even after a tool-use turn', () => {
    let state = createInitialState();
    // Drop a message + a tool block in directly via the dirty-state
    // path — the goal here is to verify the reducer's `clear` action,
    // not to recreate the full streaming pipeline. This pins the
    // regression where a Bash tool block survived /clear (audited
    // 2026-05-02).
    state = {
      ...state,
      messages: [
        {
          role: 'user',
          messageId: 'u-1',
          parentToolUseId: null,
          blocks: [{ kind: 'text', text: 'hello' }],
          isStreaming: false,
        } as any,
        {
          role: 'assistant',
          messageId: 'a-1',
          parentToolUseId: null,
          blocks: [
            { kind: 'tool_use', toolUseId: 'toolu_BASH', name: 'Bash', input: { command: 'ls' }, status: 'pending', subBlocks: [] } as any,
          ],
          isStreaming: true,
          model: 'gpt-oss:20b',
        } as any,
      ],
      streamingMessageId: 'a-1',
      error: 'stale error',
      inkDomViews: { 'view-1': { id: 'view-1' } as any },
    };

    // Now /clear — reducer must produce an empty transcript and reset
    // streaming/permission/inkdom side-state.
    state = reduce(state, { type: 'clear' } as never);
    expect(state.messages).toEqual([]);
    expect(state.streamingMessageId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.pendingPermission).toBeNull();
    expect(state.inkDomViews).toEqual({});
  });

  it('keeps session-scoped metadata (model, sessionMeta) after clear', () => {
    let state = createInitialState();
    state = reduce(state, {
      type: 'system',
      subtype: 'init',
      session_id: SESSION_ID,
      uuid: 'init',
      cwd: '/workspace',
      tools: ['Bash'],
      mcp_servers: [],
      model: 'gpt-oss:20b',
      permissionMode: 'default',
      apiKeySource: 'env',
    } as SystemInitEvent);
    expect(state.model).toBe('gpt-oss:20b');
    state = reduce(state, { type: 'clear' } as never);
    // model + sessionMeta survive a /clear — the daemon session itself
    // doesn't reset, only the visible transcript does.
    expect(state.model).toBe('gpt-oss:20b');
    expect(state.sessionMeta).not.toBeNull();
  });
});
