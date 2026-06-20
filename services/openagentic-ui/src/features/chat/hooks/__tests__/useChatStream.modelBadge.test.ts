/**
 * P0-2 of chatmode UX parity — model badge in assistant message header.
 *
 * Plan ref: the design notes
 *
 * Mock 01 spec (mocks/UX/01-cloud-ops.html:206-212):
 *   <span class="model">
 *     <span class="tag">claude</span>3.5 sonnet
 *   </span>
 *
 * The header pill shows the model family in accent color (`tag`) followed
 * by the model id in muted color (`id`). The wire frame `message_received`
 * carries a single `model` string like `claude-opus-4-7` or `gpt-oss-20b`;
 * the UI splits it on the first hyphen so the family becomes the colored
 * prefix.
 *
 * This file specifies the pure splitter `splitModelIdentifier`. It is
 * exported from useChatStream.ts so MessageBubble / MessageHeader can
 * call it deterministically without re-parsing model strings on every
 * render. The wire-side propagation (extracting `model` off
 * `message_received`/`message_saved` frames and stashing it on the
 * message object) is covered separately.
 */

import { describe, it, expect } from 'vitest';
import { splitModelIdentifier } from '../useChatStream';

describe('splitModelIdentifier — model-string → {tag, id} for MessageHeader pill', () => {
  it('claude-opus-4-7 → tag="claude", id="opus-4-7"', () => {
    expect(splitModelIdentifier('claude-opus-4-7')).toEqual({
      tag: 'claude',
      id: 'opus-4-7',
    });
  });

  it('claude-sonnet-4-5 → tag="claude", id="sonnet-4-5"', () => {
    expect(splitModelIdentifier('claude-sonnet-4-5')).toEqual({
      tag: 'claude',
      id: 'sonnet-4-5',
    });
  });

  it('gpt-oss-20b → tag="gpt", id="oss-20b" (first hyphen splits)', () => {
    expect(splitModelIdentifier('gpt-oss-20b')).toEqual({
      tag: 'gpt',
      id: 'oss-20b',
    });
  });

  it('gpt-5.2 → tag="gpt", id="5.2"', () => {
    expect(splitModelIdentifier('gpt-5.2')).toEqual({
      tag: 'gpt',
      id: '5.2',
    });
  });

  it('gemini-2.5-flash → tag="gemini", id="2.5-flash"', () => {
    expect(splitModelIdentifier('gemini-2.5-flash')).toEqual({
      tag: 'gemini',
      id: '2.5-flash',
    });
  });

  it('preserves casing on both halves (claude-Sonnet-4-5)', () => {
    // We don't lowercase — the assistant header shows whatever the
    // server identifier looks like. Mock 01 shows the family tag in
    // lowercase and the rest in lowercase; if a model is registered
    // with mixed case, we surface it faithfully.
    expect(splitModelIdentifier('claude-Sonnet-4-5')).toEqual({
      tag: 'claude',
      id: 'Sonnet-4-5',
    });
  });

  it('no hyphen → tag = whole string, id = empty (e.g. "qwen")', () => {
    // Some Ollama tags are single-word ("qwen", "phi", "llama"). Treat
    // the whole identifier as the family tag so the pill still renders;
    // the empty id half is suppressed by the consumer.
    expect(splitModelIdentifier('qwen')).toEqual({
      tag: 'qwen',
      id: '',
    });
  });

  it('trailing hyphen → tag = prefix, id = empty (defensive against malformed wire)', () => {
    expect(splitModelIdentifier('claude-')).toEqual({
      tag: 'claude',
      id: '',
    });
  });

  it('leading hyphen → returns null (not a valid model identifier)', () => {
    // A model starting with `-` is malformed wire data; we'd rather
    // suppress the badge than render a tagless pill that confuses users.
    expect(splitModelIdentifier('-broken')).toBeNull();
  });

  it('empty string → returns null (no badge to render)', () => {
    expect(splitModelIdentifier('')).toBeNull();
  });

  it('whitespace-only → returns null', () => {
    expect(splitModelIdentifier('   ')).toBeNull();
  });

  it('null/undefined → returns null', () => {
    // Callers pass `message.model` directly; we accept undefined to
    // avoid forcing the call site to coalesce.
    expect(splitModelIdentifier(null)).toBeNull();
    expect(splitModelIdentifier(undefined)).toBeNull();
  });

  it('trims surrounding whitespace before splitting', () => {
    expect(splitModelIdentifier('  claude-opus-4-7  ')).toEqual({
      tag: 'claude',
      id: 'opus-4-7',
    });
  });

  // ---- Dotted vendor-prefix stripping (Bedrock ARN-style ids) ---------------
  // Mock 01:206-212 anatomy: <span class="tag">claude</span>3.5 sonnet.
  // The tag should be the SHORT family name. Bedrock-style ids look like
  // `global.anthropic.claude-sonnet-4-5-20250929-v1:0` — splitting on the
  // first hyphen alone yields tag=`global.anthropic.claude` which bloats
  // the pill. Strip the dotted vendor prefix so only the family appears.

  it('strips dotted vendor prefix: global.anthropic.claude-sonnet-4-5', () => {
    expect(splitModelIdentifier('global.anthropic.claude-sonnet-4-5')).toEqual({
      tag: 'claude',
      id: 'sonnet-4-5',
    });
  });

  it('strips dotted vendor prefix: global.anthropic.claude-sonnet-4-5-20250929-v1:0 (real Bedrock id)', () => {
    expect(
      splitModelIdentifier('global.anthropic.claude-sonnet-4-5-20250929-v1:0'),
    ).toEqual({
      tag: 'claude',
      id: 'sonnet-4-5-20250929-v1:0',
    });
  });

  it('strips regional Bedrock prefix: us.amazon.nova-pro-v1:0', () => {
    expect(splitModelIdentifier('us.amazon.nova-pro-v1:0')).toEqual({
      tag: 'nova',
      id: 'pro-v1:0',
    });
  });

  it('strips two-segment vendor prefix: anthropic.claude-3-haiku', () => {
    expect(splitModelIdentifier('anthropic.claude-3-haiku')).toEqual({
      tag: 'claude',
      id: '3-haiku',
    });
  });

  it('preserves single-segment tags without dots (regression guard)', () => {
    // Don't accidentally strip a single-word tag.
    expect(splitModelIdentifier('claude-opus-4-7')).toEqual({
      tag: 'claude',
      id: 'opus-4-7',
    });
  });
});
