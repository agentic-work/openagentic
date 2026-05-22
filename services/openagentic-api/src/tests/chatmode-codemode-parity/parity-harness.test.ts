/**
 * Unit tests for the parity harness itself.
 *
 * Ensures the mask/normalize/diff primitives exercised by the per-category
 * tests actually behave correctly. If the harness lies, every downstream
 * parity assertion lies too — so these are the load-bearing correctness
 * tests for the entire suite.
 */

import { describe, test, expect } from 'vitest';
import {
  MASKED_FIELDS,
  maskVolatileFields,
  emitChatStream,
  emitCodemodeStream,
  normalizeChat,
  normalizeCodemode,
  diffStreams,
  runParity,
  type ParityScenario,
} from './parity-harness.js';

describe('maskVolatileFields()', () => {
  test('replaces every declared masked field with sentinel', () => {
    const input = {
      session_id: 'sess-123',
      _seq: 42,
      _ts: 1714000000,
      _runId: 'run-abc',
      _agentId: 'agent-foo',
      messageId: 'msg-1',
      message_id: 'msg-2',
      request_id: 'req-1',
      requestId: 'req-2',
      uuid: 'u-1',
      timestamp: '2026-04-22T00:00:00Z',
      startedAt: 0,
      endedAt: 1,
      duration_ms: 100,
      durationMs: 200,
      keepMe: 'load-bearing',
    };
    const masked = maskVolatileFields(input) as any;
    for (const f of MASKED_FIELDS) {
      if (f in input) {
        expect(masked[f]).toBe('<masked>');
      }
    }
    expect(masked.keepMe).toBe('load-bearing');
  });

  test('recurses into nested objects', () => {
    const input = {
      top: {
        nested: { session_id: 'x', keep: 'y' },
        _seq: 1,
      },
    };
    const masked = maskVolatileFields(input) as any;
    expect(masked.top.nested.session_id).toBe('<masked>');
    expect(masked.top.nested.keep).toBe('y');
    expect(masked.top._seq).toBe('<masked>');
  });

  test('recurses into arrays', () => {
    const input = { list: [{ _seq: 1, keep: 'a' }, { _seq: 2, keep: 'b' }] };
    const masked = maskVolatileFields(input) as any;
    expect(masked.list[0]._seq).toBe('<masked>');
    expect(masked.list[1]._seq).toBe('<masked>');
    expect(masked.list[0].keep).toBe('a');
  });

  test('preserves primitives and non-objects', () => {
    expect(maskVolatileFields(null)).toBe(null);
    expect(maskVolatileFields(42)).toBe(42);
    expect(maskVolatileFields('str')).toBe('str');
    expect(maskVolatileFields(true)).toBe(true);
  });

  test('does not mutate the input', () => {
    const input = { session_id: 'original' };
    const masked = maskVolatileFields(input) as any;
    expect(input.session_id).toBe('original');
    expect(masked.session_id).toBe('<masked>');
  });
});

describe('emitChatStream()', () => {
  test('produces at least stream_start, message_received, response_complete, stream_complete', () => {
    const scenario: ParityScenario = {
      name: 'basic',
      userPrompt: 'hi',
      script: [{ kind: 'assistant_text', text: 'hello' }],
    };
    const s = emitChatStream(scenario);
    const types = s.parsed.map(f => f.type);
    expect(types).toContain('stream_start');
    expect(types).toContain('message_received');
    expect(types).toContain('response_complete');
    expect(types).toContain('stream_complete');
  });

  test('every frame has type, session_id, _seq, _runId, _ts', () => {
    const s = emitChatStream({
      name: 'fields',
      userPrompt: 'x',
      script: [{ kind: 'assistant_text', text: 'y' }],
    });
    for (const frame of s.parsed) {
      expect(frame.type).toBeTruthy();
      expect(frame.session_id).toBeTruthy();
      expect(typeof frame._seq).toBe('number');
      expect(frame._runId).toBeTruthy();
      expect(typeof frame._ts).toBe('number');
    }
  });

  test('_seq is monotonically increasing', () => {
    const s = emitChatStream({
      name: 'seq',
      userPrompt: 'x',
      script: [
        { kind: 'assistant_text', text: 'a' },
        { kind: 'assistant_text', text: 'b' },
      ],
    });
    const seqs = s.parsed.map(f => f._seq as number);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });
});

describe('emitCodemodeStream()', () => {
  test('first frame is system:init with tool list', () => {
    const s = emitCodemodeStream({
      name: 'init',
      userPrompt: 'x',
      script: [],
      availableTools: ['ToolA', 'ToolB'],
    });
    const first = s.parsed[0] as any;
    expect(first.type).toBe('system');
    expect(first.subtype).toBe('init');
    expect(first.tools).toEqual(['ToolA', 'ToolB']);
  });

  test('wraps text_delta events inside stream_event envelopes', () => {
    const s = emitCodemodeStream({
      name: 'text',
      userPrompt: 'x',
      script: [{ kind: 'assistant_text', text: 'hello' }],
    });
    const textDelta = s.parsed.find(f => {
      const ev = (f as any).event;
      return ev?.type === 'content_block_delta' && ev?.delta?.type === 'text_delta';
    }) as any;
    expect(textDelta).toBeTruthy();
    expect(textDelta.type).toBe('stream_event');
    expect(textDelta.event.delta.text).toBe('hello');
  });

  test('tool_call becomes content_block_start(tool_use) + input_json_delta + content_block_stop', () => {
    const s = emitCodemodeStream({
      name: 'tool',
      userPrompt: 'x',
      script: [
        { kind: 'tool_call', toolName: 'k8s_get_pods', input: { ns: 'agentic-dev' } },
      ],
    });
    const starts = s.parsed.filter(f => {
      const ev = (f as any).event;
      return ev?.type === 'content_block_start' && ev?.content_block?.type === 'tool_use';
    });
    expect(starts).toHaveLength(1);
    expect(((starts[0] as any).event.content_block.name)).toBe('k8s_get_pods');

    const deltas = s.parsed.filter(f => {
      const ev = (f as any).event;
      return ev?.type === 'content_block_delta' && ev?.delta?.type === 'input_json_delta';
    });
    expect(deltas).toHaveLength(1);
    expect(((deltas[0] as any).event.delta.partial_json)).toBe('{"ns":"agentic-dev"}');
  });

  test('tool_result becomes a synthetic user frame with tool_result content block', () => {
    const s = emitCodemodeStream({
      name: 'tool-result',
      userPrompt: 'x',
      script: [
        { kind: 'tool_result', toolName: 'k8s_get_pods', result: 'output', toolId: 'id1' },
      ],
    });
    const userFrame = s.parsed.find(f => f.type === 'user') as any;
    expect(userFrame).toBeTruthy();
    expect(userFrame.message.content[0].type).toBe('tool_result');
    expect(userFrame.message.content[0].tool_use_id).toBe('id1');
    expect(userFrame.message.content[0].content).toBe('output');
  });

  test('stringifies structured results for the tool_result content field', () => {
    const s = emitCodemodeStream({
      name: 'tool-result-obj',
      userPrompt: 'x',
      script: [
        { kind: 'tool_result', toolName: 'k8s_get_pods', result: { a: 1, b: 2 } },
      ],
    });
    const userFrame = s.parsed.find(f => f.type === 'user') as any;
    expect(userFrame.message.content[0].content).toBe('{"a":1,"b":2}');
  });

  test('final frame is type:result with subtype:success', () => {
    const s = emitCodemodeStream({
      name: 'result',
      userPrompt: 'x',
      script: [],
    });
    const last = s.parsed[s.parsed.length - 1] as any;
    expect(last.type).toBe('result');
    expect(last.subtype).toBe('success');
  });
});

describe('normalizeChat() + normalizeCodemode()', () => {
  test('both surfaces yield a prompt + tool_call + tool_result + assistant_text sequence', () => {
    const scenario: ParityScenario = {
      name: 'normalize',
      userPrompt: 'p',
      script: [
        { kind: 'tool_call', toolName: 't', input: {} },
        { kind: 'tool_result', toolName: 't', result: 'r' },
        { kind: 'assistant_text', text: 'done' },
      ],
    };
    const chat = normalizeChat(emitChatStream(scenario));
    const code = normalizeCodemode(emitCodemodeStream(scenario));

    const chatKinds = chat.map(e => e.kind);
    expect(chatKinds).toContain('prompt');
    expect(chatKinds).toContain('tool_call');
    expect(chatKinds).toContain('tool_result');
    expect(chatKinds).toContain('assistant_text');

    const codeKinds = code.map(e => e.kind);
    expect(codeKinds).toContain('tool_call');
    expect(codeKinds).toContain('tool_result');
    expect(codeKinds).toContain('assistant_text');
  });

  test('chat lifecycle events (stream_start/complete) map to kind:lifecycle', () => {
    const n = normalizeChat(
      emitChatStream({ name: 'lc', userPrompt: 'x', script: [] }),
    );
    const lcEvents = n.filter(e => e.kind === 'lifecycle');
    expect(lcEvents.length).toBeGreaterThanOrEqual(3); // stream_start, response_complete, stream_complete
  });
});

describe('diffStreams()', () => {
  test('identical streams diff ok:true with no divergences', () => {
    const scenario: ParityScenario = {
      name: 'identity',
      userPrompt: 'x',
      script: [{ kind: 'tool_call', toolName: 't', input: {} }],
    };
    const run = runParity(scenario);
    // The full tool_call + result pair doesn't strictly parity-match
    // here because chat's emit adds a `content_delta` that codemode
    // doesn't. Instead test with a pure tool flow:
    const run2 = runParity({
      name: 'identity-pure',
      userPrompt: 'x',
      script: [
        { kind: 'tool_call', toolName: 't', input: { a: 1 } },
        { kind: 'tool_result', toolName: 't', result: { ok: true } },
      ],
    });
    expect(run2.diff.ok).toBe(true);
  });

  test('caps divergences at 10 for readability', () => {
    // Force a big divergence set by scripting artifact events — #300
    // remains the last open parity gap (codemode renders artifacts as
    // inline content_block_delta text by design).
    const script = Array.from({ length: 20 }, (_, i) => ({
      kind: 'artifact' as const,
      artifactType: 'markdown' as const,
      content: `# Section ${i}\n`,
    }));
    const run = runParity({ name: 'many', userPrompt: 'x', script });
    expect(run.diff.ok).toBe(false);
    expect(run.diff.divergences.length).toBeLessThanOrEqual(10);
  });

  test('ignoreLifecycle:false includes prompt + lifecycle in the diff', () => {
    const scenario: ParityScenario = {
      name: 'full',
      userPrompt: 'x',
      script: [{ kind: 'tool_call', toolName: 't', input: {} }],
    };
    const chat = normalizeChat(emitChatStream(scenario));
    const code = normalizeCodemode(emitCodemodeStream(scenario));
    const diff = diffStreams(chat, code, { ignoreLifecycle: false });
    // Diff will fail because prompt exists in chat but not in codemode (no system/init translates to prompt).
    expect(diff.ok).toBe(false);
  });

  test('kind mismatch surfaces in divergence reason', () => {
    const a = [{ kind: 'tool_call' as const, payload: { toolName: 't' } }];
    const b = [{ kind: 'assistant_text' as const, payload: { content: 'x' } }];
    const diff = diffStreams(a, b);
    expect(diff.ok).toBe(false);
    expect(diff.divergences[0].reason).toContain('kind mismatch');
  });

  test('payload mismatch surfaces in divergence reason', () => {
    const a = [{ kind: 'tool_call' as const, payload: { toolName: 'a', arguments: {} } }];
    const b = [{ kind: 'tool_call' as const, payload: { toolName: 'b', arguments: {} } }];
    const diff = diffStreams(a, b);
    expect(diff.ok).toBe(false);
    expect(diff.divergences[0].reason).toContain('payload mismatch');
  });

  test('chat-missing event is labeled correctly', () => {
    const a: any[] = [];
    const b = [{ kind: 'tool_call' as const, payload: { toolName: 't' } }];
    const diff = diffStreams(a, b);
    expect(diff.divergences[0].reason).toContain('chat missing');
  });

  test('codemode-missing event is labeled correctly', () => {
    const a = [{ kind: 'tool_call' as const, payload: { toolName: 't' } }];
    const b: any[] = [];
    const diff = diffStreams(a, b);
    expect(diff.divergences[0].reason).toContain('codemode missing');
  });

  test('relaxes toolName mismatch in tool_result events (known normalization)', () => {
    const a = [{ kind: 'tool_result' as const, payload: { toolName: 'specific', result: 'r' } }];
    const b = [{ kind: 'tool_result' as const, payload: { toolName: '<unknown>', result: 'r' } }];
    const diff = diffStreams(a, b);
    expect(diff.ok).toBe(true);
  });
});
