/**
 * ollamaHarmonySynthesisSalvage — pure-helper unit tests (#1071, 2026-05-24).
 *
 * These pin the building blocks of the Harmony-leak salvage re-call. The
 * authoritative output-shape gate is the live gpt-oss:20b harness; these
 * just keep the request transform honest.
 */
import { describe, it, expect } from 'vitest';
import {
  historyHasToolResult,
  buildHarmonySynthesisRecall,
  extractOllamaContent,
  HARMONY_SYNTHESIS_NUDGE,
} from '../ollamaHarmonySynthesisSalvage.js';

describe('historyHasToolResult', () => {
  it('true when a role:tool message is present', () => {
    expect(
      historyHasToolResult([
        { role: 'user', content: 'q' },
        { role: 'tool', content: '{"x":1}' },
      ]),
    ).toBe(true);
  });

  it('true when an assistant turn recorded tool_calls', () => {
    expect(
      historyHasToolResult([
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 't' } }] },
      ]),
    ).toBe(true);
  });

  it('false for a plain user-only history', () => {
    expect(historyHasToolResult([{ role: 'user', content: 'q' }])).toBe(false);
  });

  it('false for non-array / empty input', () => {
    expect(historyHasToolResult(undefined)).toBe(false);
    expect(historyHasToolResult(null)).toBe(false);
    expect(historyHasToolResult([])).toBe(false);
    expect(historyHasToolResult('nope' as any)).toBe(false);
  });

  it('false when assistant has an empty tool_calls array', () => {
    expect(
      historyHasToolResult([{ role: 'assistant', content: 'hi', tool_calls: [] }]),
    ).toBe(false);
  });
});

describe('buildHarmonySynthesisRecall', () => {
  const base = {
    model: 'gpt-oss:20b',
    messages: [
      { role: 'user', content: 'q' },
      { role: 'tool', content: '{"x":1}' },
    ],
    tools: [{ type: 'function', function: { name: 't' } }],
    tool_choice: 'auto',
    think: true,
    format: 'json',
    stream: true,
  };

  it('strips tools, tool_choice, and format', () => {
    const out = buildHarmonySynthesisRecall(base as any);
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
    expect(out.format).toBeUndefined();
  });

  it('forces think:false so gpt-oss writes the answer to content, not the reasoning channel', () => {
    // #1071 follow-up (live Q2 IAM evidence 2026-05-24): deleting `think`
    // lets Ollama default gpt-oss reasoning ON, which can route the whole
    // synthesis into message.thinking and leave message.content empty →
    // salvage punts. Forcing think:false pushes output to content.
    expect(buildHarmonySynthesisRecall(base as any).think).toBe(false);
  });

  it('forces stream:false', () => {
    expect(buildHarmonySynthesisRecall(base as any).stream).toBe(false);
  });

  it('appends the synthesis nudge as a trailing system message', () => {
    const out = buildHarmonySynthesisRecall(base as any);
    const msgs = out.messages as any[];
    expect(msgs).toHaveLength(3);
    expect(msgs[2]).toEqual({ role: 'system', content: HARMONY_SYNTHESIS_NUDGE });
  });

  it('does not mutate the input request', () => {
    const input = JSON.parse(JSON.stringify(base));
    buildHarmonySynthesisRecall(input);
    expect(input).toEqual(base);
  });

  it('preserves the model and original history order', () => {
    const out = buildHarmonySynthesisRecall(base as any);
    expect(out.model).toBe('gpt-oss:20b');
    const msgs = out.messages as any[];
    expect(msgs[0]).toEqual({ role: 'user', content: 'q' });
    expect(msgs[1]).toEqual({ role: 'tool', content: '{"x":1}' });
  });
});

describe('extractOllamaContent', () => {
  it('returns trimmed content from a non-stream chat response', () => {
    expect(
      extractOllamaContent({ message: { content: '  hello world  ' }, done: true }),
    ).toBe('hello world');
  });

  it('returns null for empty / whitespace content', () => {
    expect(extractOllamaContent({ message: { content: '   ' } })).toBeNull();
    expect(extractOllamaContent({ message: { content: '' } })).toBeNull();
  });

  it('returns null when message/content is absent or wrong type', () => {
    expect(extractOllamaContent({})).toBeNull();
    expect(extractOllamaContent({ message: {} })).toBeNull();
    expect(extractOllamaContent({ message: { content: 123 } })).toBeNull();
    expect(extractOllamaContent(null)).toBeNull();
    expect(extractOllamaContent('x')).toBeNull();
  });

  // #1071 follow-up (live Q2 IAM 2026-05-24): the salvage re-call sometimes
  // comes back with empty `content` because gpt-oss routed the synthesis into
  // its Harmony reasoning channel (message.thinking). Falling back to thinking
  // salvages the real grounded answer instead of punting "Please retry".
  it('falls back to message.thinking when content is empty', () => {
    expect(
      extractOllamaContent({
        message: { content: '', thinking: '  Here are your IAM users: blitz, test  ' },
      }),
    ).toBe('Here are your IAM users: blitz, test');
  });

  it('falls back to thinking when content is whitespace-only', () => {
    expect(
      extractOllamaContent({ message: { content: '   ', thinking: 'summary' } }),
    ).toBe('summary');
  });

  it('prefers content over thinking when content is non-empty', () => {
    expect(
      extractOllamaContent({ message: { content: 'real answer', thinking: 'noisy reasoning' } }),
    ).toBe('real answer');
  });

  it('returns null when both content and thinking are empty/absent', () => {
    expect(extractOllamaContent({ message: { content: '', thinking: '   ' } })).toBeNull();
    expect(extractOllamaContent({ message: { content: '' } })).toBeNull();
    expect(extractOllamaContent({ message: { thinking: 42 } })).toBeNull();
  });
});
