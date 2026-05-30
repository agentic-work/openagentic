/**
 * #814 — MessageBubble must NOT append `message.content` as a duplicate
 * tail text block when the activity blocks already contain inline text.
 *
 * Wire example: a turn streams [text_A, tool_use, text_B]. The flat
 * `message.content` accumulator ends up = "Part A.\n\nPart B." (every
 * text_delta concatenated). The activity block array preserves the two
 * text blocks at their wire positions.
 *
 * Pre-fix: MessageBubble.tsx:828-858 appended `message.content` as ONE
 * tail block on every completed message, regardless of whether activity
 * blocks already had text. Result on screen: prose appeared twice —
 * once inline (at correct wire position) and once again at the bottom
 * as a coalesced blob.
 *
 * Contract pinned here.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFinalContentBlocks,
  type BuildFinalBlocksArgs,
} from '../buildFinalContentBlocks';
import type { ContentBlock } from '../../../hooks/useChatStream';

const textBlock = (id: string, content: string): ContentBlock => ({
  id,
  type: 'text',
  content,
  timestamp: 1_000,
  isComplete: true,
});

const toolBlock = (id: string, name: string): ContentBlock => ({
  id,
  type: 'tool_use',
  content: '',
  timestamp: 1_100,
  isComplete: true,
  toolId: id,
  toolName: name,
});

const baseArgs = (over: Partial<BuildFinalBlocksArgs>): BuildFinalBlocksArgs => ({
  activityBlocks: [],
  messageContent: '',
  messageId: 'msg-1',
  isStreaming: false,
  hasSteps: false,
  ...over,
});

describe('buildFinalContentBlocks (#814)', () => {
  it('does NOT append message.content when activity blocks already contain text', () => {
    const activity: ContentBlock[] = [
      textBlock('a', "I'll list subscriptions first."),
      toolBlock('t1', 'openagentic_azure.azure_list_subscriptions'),
      textBlock('b', 'Now resource groups.'),
    ];
    const out = buildFinalContentBlocks(
      baseArgs({
        activityBlocks: activity,
        messageContent: "I'll list subscriptions first. Now resource groups.",
        hasSteps: true,
      }),
    );
    // Same length — no tail blob appended.
    expect(out).toHaveLength(3);
    // Order is preserved verbatim.
    expect(out.map((b) => b.id)).toEqual(['a', 't1', 'b']);
    // No synthesized `text-msg-1` block.
    expect(out.find((b) => b.id === 'text-msg-1')).toBeUndefined();
  });

  it('does append a tail text block ONLY when activity blocks contain ZERO text', () => {
    // Legacy/persisted message where only tool blocks survived in
    // activity; the original prose lives in message.content. Falling
    // back to a tail text block here keeps the prose visible.
    const activity: ContentBlock[] = [
      toolBlock('t1', 'openagentic_azure.azure_list_subscriptions'),
    ];
    const out = buildFinalContentBlocks(
      baseArgs({
        activityBlocks: activity,
        messageContent: 'Here are the subscriptions.',
        hasSteps: true,
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('t1');
    expect(out[1].id).toBe('text-msg-1');
    expect(out[1].type).toBe('text');
    expect(out[1].content).toBe('Here are the subscriptions.');
  });

  it('passes activity blocks straight through while streaming', () => {
    const activity: ContentBlock[] = [
      textBlock('a', "I'll list"),
      toolBlock('t1', 'azure_list_subscriptions'),
    ];
    const out = buildFinalContentBlocks(
      baseArgs({
        activityBlocks: activity,
        messageContent: "I'll list",
        hasSteps: true,
        isStreaming: true,
      }),
    );
    expect(out).toBe(activity);
  });

  it('returns activity blocks unchanged when there are no steps', () => {
    const activity: ContentBlock[] = [textBlock('a', 'Hello.')];
    const out = buildFinalContentBlocks(
      baseArgs({
        activityBlocks: activity,
        messageContent: 'Hello.',
        hasSteps: false,
      }),
    );
    expect(out).toBe(activity);
  });

  it('strips <thinking> / <reasoning> / <tool_code> wrapper tags before fallback', () => {
    const activity: ContentBlock[] = [toolBlock('t1', 'tool')];
    const out = buildFinalContentBlocks(
      baseArgs({
        activityBlocks: activity,
        messageContent:
          '<thinking>internal cot</thinking>Here is the real answer.<reasoning>x</reasoning>',
        hasSteps: true,
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[1].content).toBe('Here is the real answer.');
  });

  it('does NOT append a tail when message.content is a raw artifact fence', () => {
    // Artifact fences (```artifact:, <!DOCTYPE, etc) are routed via
    // EnhancedMessageContent — they must not also be rendered as a
    // text block inside the activity stream.
    const activity: ContentBlock[] = [toolBlock('t1', 'tool')];
    const out = buildFinalContentBlocks(
      baseArgs({
        activityBlocks: activity,
        messageContent: '<!DOCTYPE html><html><body>chart</body></html>',
        hasSteps: true,
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('t1');
  });

  it('returns activity blocks unchanged when message.content is empty / nullish', () => {
    const activity: ContentBlock[] = [toolBlock('t1', 'tool')];
    const out = buildFinalContentBlocks(
      baseArgs({
        activityBlocks: activity,
        messageContent: '',
        hasSteps: true,
      }),
    );
    expect(out).toBe(activity);
  });
});
