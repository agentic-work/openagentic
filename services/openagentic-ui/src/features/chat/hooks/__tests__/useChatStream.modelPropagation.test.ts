/**
 * P0-2 of chatmode UX parity — propagate the wire `model` string onto the
 * ChatMessage object as `model` + `modelTag` + `modelId` so MessageHeader
 * can render the assistant pill (mocks/UX/01-cloud-ops.html:206-212).
 *
 * Plan refs:
 *   - the design notes
 *   - the design notes
 *
 * The wire frame `message_received` (and `message_saved`) carries a single
 * `model` string like `claude-opus-4-7`. `splitModelIdentifier` (already
 * shipped, see useChatStream.modelBadge.test.ts) splits on the first hyphen
 * into `{ tag, id }`. This file specifies the message-stamping helper that
 * combines the wire model with a partial ChatMessage so consumers receive
 * a self-describing object — no re-parsing on every render.
 *
 * Mirrors the pure-reducer style of useChatStream.tierFrames.test.ts +
 * useChatStream.appRender.test.ts: the helper is exported from
 * useChatStream.ts and exercised here without booting the full hook.
 */

import { describe, it, expect } from 'vitest';
import { attachModelIdentifier } from '../useChatStream';

describe('attachModelIdentifier — stamp wire `model` onto a ChatMessage', () => {
  it('stamps model + modelTag + modelId for a claude wire string', () => {
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, 'claude-opus-4-7');
    expect(next.model).toBe('claude-opus-4-7');
    expect(next.modelTag).toBe('claude');
    expect(next.modelId).toBe('opus-4-7');
  });

  it('stamps tag/id for a gpt wire string', () => {
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, 'gpt-oss-20b');
    expect(next.model).toBe('gpt-oss-20b');
    expect(next.modelTag).toBe('gpt');
    expect(next.modelId).toBe('oss-20b');
  });

  it('preserves other fields on the message (does not clobber)', () => {
    const before = {
      id: 'msg-1',
      role: 'assistant' as const,
      content: 'hello world',
      timestamp: '2026-04-30T00:00:00.000Z',
      thinkingTime: 1234,
    };
    const next = attachModelIdentifier(before, 'claude-sonnet-4-5');
    expect(next.id).toBe('msg-1');
    expect(next.role).toBe('assistant');
    expect(next.content).toBe('hello world');
    expect(next.timestamp).toBe('2026-04-30T00:00:00.000Z');
    expect(next.thinkingTime).toBe(1234);
    expect(next.model).toBe('claude-sonnet-4-5');
    expect(next.modelTag).toBe('claude');
    expect(next.modelId).toBe('sonnet-4-5');
  });

  it('returns the message unchanged when model is null', () => {
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, null);
    expect(next).toEqual(before);
    // Importantly: no modelTag / modelId stamped.
    expect((next as any).modelTag).toBeUndefined();
    expect((next as any).modelId).toBeUndefined();
  });

  it('returns the message unchanged when model is undefined', () => {
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, undefined);
    expect(next).toEqual(before);
  });

  it('returns the message unchanged when model is empty string', () => {
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, '');
    expect(next).toEqual(before);
  });

  it('returns the message unchanged when model is malformed (leading hyphen)', () => {
    // splitModelIdentifier returns null for leading-hyphen inputs; the
    // helper should treat that as "no badge" rather than stamp half a pill.
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, '-broken');
    expect(next).toEqual(before);
  });

  it('handles single-token models (no hyphen) — modelTag set, modelId empty string suppressed', () => {
    // splitModelIdentifier('qwen') → { tag: 'qwen', id: '' }. The helper
    // should stamp model + modelTag, but the empty id suppresses to undefined
    // so MessageHeader's optional id span renders nothing.
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, 'qwen');
    expect(next.model).toBe('qwen');
    expect(next.modelTag).toBe('qwen');
    expect(next.modelId).toBeUndefined();
  });

  it('does not mutate the input message (returns a new object on stamp)', () => {
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, 'claude-opus-4-7');
    expect(next).not.toBe(before);
    expect((before as any).model).toBeUndefined();
    expect((before as any).modelTag).toBeUndefined();
    expect((before as any).modelId).toBeUndefined();
  });

  it('trims whitespace from the wire model before splitting', () => {
    const before = { id: 'msg-1', role: 'assistant' as const, content: '', timestamp: '' };
    const next = attachModelIdentifier(before, '  claude-opus-4-7  ');
    expect(next.modelTag).toBe('claude');
    expect(next.modelId).toBe('opus-4-7');
  });
});
