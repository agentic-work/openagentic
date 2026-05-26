/**
 * sdkAdapter — unit tests covering the result-frame close contract
 * that fixes #249 (codemode UI hangs on "Agent is working…" after
 * daemon emits result but before all content_block_stop events).
 */

import { describe, it, expect } from 'vitest';
import {
  closeAllStreamingAssistants,
  forceCloseMessageBlocks,
  formatElapsed,
  isSessionEndEvent,
  summarizeSystemEvent,
  tryParseInput,
} from '../sdkAdapter';
import type {
  AssistantChatMessage,
  ChatMessage,
  UiToolUseBlock,
  UiThinkingBlock,
  UiTextBlock,
} from '../../types/uiState';

const baseMsg = (blocks: AssistantChatMessage['blocks']): AssistantChatMessage => ({
  id: 'asst-1',
  role: 'assistant',
  blocks,
  streaming: true,
  createdAt: 1,
});

describe('tryParseInput', () => {
  it('returns parsed object for valid JSON', () => {
    expect(tryParseInput('{"a":1}')).toEqual({ a: 1 });
  });
  it('returns undefined for empty input', () => {
    expect(tryParseInput('')).toBeUndefined();
  });
  it('returns undefined for malformed JSON', () => {
    expect(tryParseInput('{"a":')).toBeUndefined();
  });
  it('returns undefined for non-object JSON (e.g. a literal)', () => {
    expect(tryParseInput('42')).toBeUndefined();
    expect(tryParseInput('"hello"')).toBeUndefined();
    expect(tryParseInput('null')).toBeUndefined();
  });

  // AIF Responses API streams TodoWrite/Edit/Write tool inputs as
  // `{}{"todos":[...]}` — an empty object prefix concatenated with the
  // real payload. Without this handling: ActiveTaskBar receives no
  // todos, generic tool_use card renders the raw text. Before this fix
  // the prefix made JSON.parse throw and tryParseInput returned
  // undefined, leaving block.input = {}.
  it('returns the real payload when AIF prefixes the stream with `{}`', () => {
    expect(
      tryParseInput('{}{"todos":[{"content":"a","status":"pending"}]}'),
    ).toEqual({ todos: [{ content: 'a', status: 'pending' }] });
  });
  it('handles multiple empty-object prefixes', () => {
    expect(tryParseInput('{}{}{"x":42}')).toEqual({ x: 42 });
  });
  it('returns undefined when the stream is only empty objects (no real payload)', () => {
    expect(tryParseInput('{}')).toBeUndefined();
    expect(tryParseInput('{}{}')).toBeUndefined();
  });
  it('still works on a real payload that LOOKS like it has a prefix (string keyed `{}`)', () => {
    // not a prefix — `{"k":"{}"}` is a single object whose value happens to be "{}"
    expect(tryParseInput('{"k":"{}"}')).toEqual({ k: '{}' });
  });
});

describe('formatElapsed', () => {
  it('formats seconds below one minute with a plain s suffix', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(1)).toBe('1s');
    expect(formatElapsed(59)).toBe('59s');
  });
  it('rounds fractional seconds to the nearest integer', () => {
    expect(formatElapsed(12.4)).toBe('12s');
    expect(formatElapsed(12.6)).toBe('13s');
  });
  it('switches to minute+second format between 1m and 1h', () => {
    expect(formatElapsed(60)).toBe('1m');
    expect(formatElapsed(65)).toBe('1m 05s');
    expect(formatElapsed(125)).toBe('2m 05s');
    expect(formatElapsed(3599)).toBe('59m 59s');
  });
  it('switches to hour+minute format at and above 1h', () => {
    expect(formatElapsed(3600)).toBe('1h');
    expect(formatElapsed(3660)).toBe('1h 1m');
    expect(formatElapsed(5000)).toBe('1h 23m');
  });
  it('handles invalid or negative inputs as zero', () => {
    expect(formatElapsed(NaN)).toBe('0s');
    expect(formatElapsed(-5)).toBe('0s');
    expect(formatElapsed(Infinity)).toBe('0s');
  });
});

describe('summarizeSystemEvent', () => {
  it('returns human-readable label for status=compacting', () => {
    expect(summarizeSystemEvent({ type: 'system', subtype: 'status', status: 'compacting' }))
      .toBe('Compacting conversation…');
  });

  it('falls through to generic status label for unknown status', () => {
    expect(summarizeSystemEvent({ type: 'system', subtype: 'status', status: 'thinking' }))
      .toBe('Status: thinking');
  });

  it('returns null for status event with no status payload', () => {
    expect(summarizeSystemEvent({ type: 'system', subtype: 'status' })).toBeNull();
  });

  it('summarizes compact_boundary with token-delta when metadata present', () => {
    const label = summarizeSystemEvent({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { pre_tokens: 24_000, post_tokens: 8_000, trigger: 'auto' },
    });
    expect(label).toBe('Conversation compacted — trimmed 16.0K tokens');
  });

  it('formats small token deltas without K suffix', () => {
    const label = summarizeSystemEvent({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { pre_tokens: 900, post_tokens: 400 },
    });
    expect(label).toBe('Conversation compacted — trimmed 500 tokens');
  });

  it('falls back to plain label when compact_boundary has no metadata', () => {
    expect(summarizeSystemEvent({ type: 'system', subtype: 'compact_boundary' }))
      .toBe('Conversation compacted');
  });

  it('returns null for non-system events and unknown subtypes', () => {
    expect(summarizeSystemEvent({ type: 'assistant' })).toBeNull();
    expect(summarizeSystemEvent({ type: 'system', subtype: 'init' })).toBeNull();
    expect(summarizeSystemEvent({ type: 'system', subtype: 'hook_response' })).toBeNull();
  });
});

describe('isSessionEndEvent', () => {
  it('returns true for result', () => {
    expect(isSessionEndEvent({ type: 'result' })).toBe(true);
  });
  it('returns true for error', () => {
    expect(isSessionEndEvent({ type: 'error' })).toBe(true);
  });
  it('returns false for stream_event, system, user, progress, control_request', () => {
    expect(isSessionEndEvent({ type: 'stream_event' })).toBe(false);
    expect(isSessionEndEvent({ type: 'system' })).toBe(false);
    expect(isSessionEndEvent({ type: 'user' })).toBe(false);
    expect(isSessionEndEvent({ type: 'progress' })).toBe(false);
    expect(isSessionEndEvent({ type: 'control_request' })).toBe(false);
    expect(isSessionEndEvent({ type: 'assistant' })).toBe(false);
  });
});

describe('forceCloseMessageBlocks', () => {
  it('clears streaming and returns the same reference when already closed', () => {
    const msg: AssistantChatMessage = {
      ...baseMsg([{ kind: 'text', text: 'done' }]),
      streaming: false,
    };
    const out = forceCloseMessageBlocks(msg);
    expect(out).toBe(msg);
  });

  it('sets message.streaming=false even when no inner blocks need closing', () => {
    const msg = baseMsg([{ kind: 'text', text: 'hi' }]);
    const out = forceCloseMessageBlocks(msg);
    expect(out.streaming).toBe(false);
    expect(out.blocks).toBe(msg.blocks); // no inner change, array reused
  });

  it('closes a streaming thinking block', () => {
    const thinking: UiThinkingBlock = {
      kind: 'thinking',
      thinking: 'partial reasoning',
      streaming: true,
    };
    const msg = baseMsg([thinking]);
    const out = forceCloseMessageBlocks(msg);
    expect(out.streaming).toBe(false);
    expect((out.blocks[0] as UiThinkingBlock).streaming).toBe(false);
    expect((out.blocks[0] as UiThinkingBlock).thinking).toBe('partial reasoning');
  });

  it('closes a streaming tool_use block and parses partialInputJson when complete', () => {
    const tool: UiToolUseBlock = {
      kind: 'tool_use',
      toolUseId: 'toolu_1',
      name: 'Bash',
      partialInputJson: '{"command":"ls"}',
      streaming: true,
    };
    const msg = baseMsg([tool]);
    const out = forceCloseMessageBlocks(msg);
    expect(out.streaming).toBe(false);
    const t = out.blocks[0] as UiToolUseBlock;
    expect(t.streaming).toBe(false);
    expect(t.input).toEqual({ command: 'ls' });
  });

  it('leaves tool_use with incomplete partialInputJson closed but without parsed input', () => {
    const tool: UiToolUseBlock = {
      kind: 'tool_use',
      toolUseId: 'toolu_2',
      name: 'Bash',
      partialInputJson: '{"command":"l', // truncated
      streaming: true,
    };
    const msg = baseMsg([tool]);
    const out = forceCloseMessageBlocks(msg);
    const t = out.blocks[0] as UiToolUseBlock;
    expect(t.streaming).toBe(false);
    expect(t.input).toBeUndefined();
  });

  it('preserves an already-parsed tool input verbatim', () => {
    const tool: UiToolUseBlock = {
      kind: 'tool_use',
      toolUseId: 'toolu_3',
      name: 'Read',
      partialInputJson: '{"file_path":"/a"}',
      input: { file_path: '/a', preserved: true },
      streaming: true,
    };
    const msg = baseMsg([tool]);
    const out = forceCloseMessageBlocks(msg);
    const t = out.blocks[0] as UiToolUseBlock;
    expect(t.input).toEqual({ file_path: '/a', preserved: true });
    expect(t.streaming).toBe(false);
  });

  it('closes multiple mixed blocks in one pass', () => {
    const thinking: UiThinkingBlock = { kind: 'thinking', thinking: 't', streaming: true };
    const text: UiTextBlock = { kind: 'text', text: 'hello' };
    const tool: UiToolUseBlock = {
      kind: 'tool_use',
      toolUseId: 'toolu_4',
      name: 'Bash',
      partialInputJson: '{"command":"ls"}',
      streaming: true,
    };
    const msg = baseMsg([thinking, text, tool]);
    const out = forceCloseMessageBlocks(msg);
    expect((out.blocks[0] as UiThinkingBlock).streaming).toBe(false);
    expect(out.blocks[1]).toBe(text); // untouched reference (text has no streaming flag)
    expect((out.blocks[2] as UiToolUseBlock).streaming).toBe(false);
    expect((out.blocks[2] as UiToolUseBlock).input).toEqual({ command: 'ls' });
  });

  it('recurses into Task tool subBlocks and closes nested streams (subagent fan-out)', () => {
    const subThinking: UiThinkingBlock = {
      kind: 'thinking',
      thinking: 'sub reasoning',
      streaming: true,
    };
    const subTool: UiToolUseBlock = {
      kind: 'tool_use',
      toolUseId: 'sub-tool',
      name: 'Read',
      partialInputJson: '{"file_path":"/x"}',
      streaming: true,
    };
    const task: UiToolUseBlock = {
      kind: 'tool_use',
      toolUseId: 'task-1',
      name: 'Task',
      partialInputJson: '{"description":"sub"}',
      input: { description: 'sub' },
      streaming: true,
      subBlocks: [subThinking, subTool],
    };
    const msg = baseMsg([task]);
    const out = forceCloseMessageBlocks(msg);
    const outTask = out.blocks[0] as UiToolUseBlock;
    expect(outTask.streaming).toBe(false);
    expect(outTask.subBlocks).toBeDefined();
    expect((outTask.subBlocks![0] as UiThinkingBlock).streaming).toBe(false);
    expect((outTask.subBlocks![1] as UiToolUseBlock).streaming).toBe(false);
    expect((outTask.subBlocks![1] as UiToolUseBlock).input).toEqual({ file_path: '/x' });
  });

  it('returns a new message reference when anything changed (for React identity)', () => {
    const msg = baseMsg([
      { kind: 'thinking', thinking: 't', streaming: true },
    ]);
    const out = forceCloseMessageBlocks(msg);
    expect(out).not.toBe(msg);
    expect(out.blocks).not.toBe(msg.blocks);
  });

  it('is idempotent — calling twice yields the same result without further mutation', () => {
    const msg = baseMsg([
      { kind: 'thinking', thinking: 't', streaming: true },
      {
        kind: 'tool_use',
        toolUseId: 'x',
        name: 'Bash',
        partialInputJson: '{"command":"ls"}',
        streaming: true,
      },
    ]);
    const first = forceCloseMessageBlocks(msg);
    const second = forceCloseMessageBlocks(first);
    // Second pass should short-circuit back to the first (no changes needed).
    expect(second).toBe(first);
  });
});

describe('closeAllStreamingAssistants', () => {
  // Defensive sweep: when the result frame's id-match misses (gpt-oss
  // sometimes emits a result whose match id differs from the in-flight
  // message_start id), the per-message streaming flag stayed true and
  // the inline activity heartbeat hung forever — even though the hook
  // saw the result and cleared isStreaming. Sweep every assistant so
  // the UI cannot get stuck.
  const userMsg = (id: string): ChatMessage => ({
    id,
    role: 'user',
    text: 'hi',
    createdAt: 0,
  });

  it('returns the same reference when nothing is streaming', () => {
    const msgs: ChatMessage[] = [
      userMsg('u1'),
      { ...baseMsg([{ kind: 'text', text: 'done' }]), streaming: false },
    ];
    expect(closeAllStreamingAssistants(msgs)).toBe(msgs);
  });

  it('closes a streaming assistant message and returns a new array', () => {
    const msgs: ChatMessage[] = [
      userMsg('u1'),
      baseMsg([{ kind: 'text', text: 'hi' }]),
    ];
    const out = closeAllStreamingAssistants(msgs);
    expect(out).not.toBe(msgs);
    expect((out[1] as AssistantChatMessage).streaming).toBe(false);
  });

  it('closes EVERY streaming assistant when the result-id-match missed', () => {
    const msgs: ChatMessage[] = [
      userMsg('u1'),
      { ...baseMsg([{ kind: 'text', text: 'a' }]), id: 'asst-A' },
      userMsg('u2'),
      { ...baseMsg([{ kind: 'text', text: 'b' }]), id: 'asst-B' },
    ];
    const out = closeAllStreamingAssistants(msgs);
    expect((out[1] as AssistantChatMessage).streaming).toBe(false);
    expect((out[3] as AssistantChatMessage).streaming).toBe(false);
  });

  it('does not touch user or system messages', () => {
    const sys: ChatMessage = {
      id: 's1',
      role: 'system',
      text: 'note',
      createdAt: 0,
    };
    const msgs: ChatMessage[] = [
      userMsg('u1'),
      sys,
      baseMsg([{ kind: 'text', text: 'hi' }]),
    ];
    const out = closeAllStreamingAssistants(msgs);
    expect(out[0]).toBe(msgs[0]);
    expect(out[1]).toBe(msgs[1]);
    expect(out[2]).not.toBe(msgs[2]);
  });
});
