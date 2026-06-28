/**
 * deriveFlatMessage — RED tests (Phase 2 helper).
 *
 * the design notes
 *
 * Pure function (ContentBlock[]) => string. Concatenates the `content` field of
 * each `type: 'text'` block in array order. Becomes the source of truth for
 * the legacy `assistantMessage` string at finalize time — replacing the
 * stream-time concat that races with the canonical content_block_delta path
 * and produces "LetLet me" character duplication.
 *
 * Non-text blocks (thinking, tool_use) are skipped. Their content lives in
 * the ContentBlock array; the flat string is for title-gen / copy /
 * trailing-markdown fallback only.
 */
import { describe, it, expect } from 'vitest';
import { deriveFlatMessage } from '../deriveFlatMessage.js';
import type { ContentBlock } from '../../useChatStream';

function block(partial: Partial<ContentBlock> & Pick<ContentBlock, 'type'>): ContentBlock {
  return {
    id: 'b',
    index: 0,
    type: partial.type,
    content: '',
    isComplete: true,
    timestamp: 0,
    ...partial,
  } as ContentBlock;
}

describe('deriveFlatMessage', () => {
  it('concatenates the content of text blocks in array order', () => {
    const blocks: ContentBlock[] = [
      block({ type: 'text', content: 'Hello ', index: 0 }),
      block({ type: 'text', content: 'world.', index: 1 }),
    ];
    expect(deriveFlatMessage(blocks)).toBe('Hello world.');
  });

  it('skips thinking blocks', () => {
    const blocks: ContentBlock[] = [
      block({ type: 'thinking', content: 'internal monologue', index: 0 }),
      block({ type: 'text', content: 'Outward prose.', index: 1 }),
    ];
    expect(deriveFlatMessage(blocks)).toBe('Outward prose.');
  });

  it('skips tool_use blocks', () => {
    const blocks: ContentBlock[] = [
      block({ type: 'text', content: 'Before. ', index: 0 }),
      block({ type: 'tool_use', content: '{"args":1}', index: 1, toolName: 't' }),
      block({ type: 'text', content: 'After.', index: 2 }),
    ];
    expect(deriveFlatMessage(blocks)).toBe('Before. After.');
  });

  it('returns empty string for empty input', () => {
    expect(deriveFlatMessage([])).toBe('');
  });

  it('returns empty string when no text blocks exist', () => {
    const blocks: ContentBlock[] = [
      block({ type: 'thinking', content: 'x', index: 0 }),
      block({ type: 'tool_use', content: '{}', index: 1, toolName: 't' }),
    ];
    expect(deriveFlatMessage(blocks)).toBe('');
  });

  it('preserves the chronological order of interleaved text blocks', () => {
    const blocks: ContentBlock[] = [
      block({ type: 'text', content: 'Cascading across Azure tools. ', index: 0 }),
      block({ type: 'tool_use', content: '{}', index: 1, toolName: 'azure_list_subscriptions' }),
      block({ type: 'text', content: 'Got 2 subscriptions. ', index: 2 }),
      block({ type: 'tool_use', content: '{}', index: 3, toolName: 'azure_list_resource_groups' }),
      block({ type: 'text', content: 'Found 12 RGs.', index: 4 }),
    ];
    expect(deriveFlatMessage(blocks)).toBe(
      'Cascading across Azure tools. Got 2 subscriptions. Found 12 RGs.',
    );
  });

  it('does NOT duplicate text when the same canonical content arrives twice (dual-emit dedup)', () => {
    // If both `stream` envelope and `content_block_delta` produced separate
    // ContentBlocks for the same canonical text chunk, deriveFlatMessage
    // would surface the duplication. Per Phase 2 the legacy `case 'stream'`
    // no longer creates blocks — only the canonical reducer does — so a
    // single ContentBlock per canonical block is the only valid shape.
    const blocks: ContentBlock[] = [
      block({ type: 'text', content: 'Hello.', index: 0 }),
    ];
    expect(deriveFlatMessage(blocks)).toBe('Hello.');
  });
});
