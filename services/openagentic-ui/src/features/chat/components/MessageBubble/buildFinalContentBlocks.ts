/**
 * Build the final render-time content blocks for an assistant message.
 *
 * Why this exists (#814):
 *   When a turn streams `[text_A, tool_use, text_B, tool_use, text_C]`,
 *   useChatStream tracks both:
 *     (a) `contentBlocks[]` — one entry per wire content_block, in order
 *     (b) `message.content` — flat concatenation of every text_delta
 *
 *   The legacy MessageBubble path appended `message.content` as a single
 *   tail text block on every completed message that had at least one
 *   activity block. The result on screen was that all prose collapsed
 *   into one trailing paragraph AFTER every tool card, instead of
 *   reading inline with the wire-emit interleave the mocks specify.
 *
 *   This helper preserves the interleave: when activity blocks ALREADY
 *   contain any text block, the message.content blob is dropped (the
 *   text is already rendered in place). Only when activity blocks have
 *   NO text at all (legacy messages persisted before per-block text was
 *   tracked) do we fall back to a single text tail so the prose isn't
 *   invisible.
 *
 * Contract: pure function. Inputs only (no React refs / state).
 */

import type { ContentBlock } from '../../hooks/useChatStream';

const THINKING_TAG_RE = /<thinking>[\s\S]*?<\/thinking>/g;
const REASONING_TAG_RE = /<reasoning>[\s\S]*?<\/reasoning>/g;
const TOOL_CODE_TAG_RE = /<tool_code>[\s\S]*?<\/tool_code>/g;

function stripWrapperTags(s: string): string {
  return s
    .replace(THINKING_TAG_RE, '')
    .replace(REASONING_TAG_RE, '')
    .replace(TOOL_CODE_TAG_RE, '')
    .trim();
}

function looksLikeRawArtifact(s: string): boolean {
  return (
    s.includes('```artifact:') ||
    s.includes('```html') ||
    s.includes('<!DOCTYPE') ||
    s.includes('<html')
  );
}

export interface BuildFinalBlocksArgs {
  /** Per-emit content blocks from useChatStream (preserves wire order). */
  activityBlocks: ContentBlock[];
  /** Flat assistant message text (concatenated text_deltas). */
  messageContent: string | null | undefined;
  /** Message id, used to namespace the synthesized tail block id. */
  messageId: string;
  /** True while NDJSON stream is open. */
  isStreaming: boolean;
  /** True when the message has at least one inline step (tool / thinking). */
  hasSteps: boolean;
}

export function buildFinalContentBlocks(args: BuildFinalBlocksArgs): ContentBlock[] {
  const { activityBlocks, messageContent, messageId, isStreaming, hasSteps } = args;

  if (isStreaming) return activityBlocks;
  if (!messageContent || !hasSteps || activityBlocks.length === 0) {
    return activityBlocks;
  }

  // The interleave already covers the prose if any text block survived
  // from the stream. Appending message.content here would duplicate the
  // prose at the end of the message.
  const hasInlineText = activityBlocks.some((b) => b.type === 'text');
  if (hasInlineText) return activityBlocks;

  const stripped = typeof messageContent === 'string' ? stripWrapperTags(messageContent) : '';
  if (!stripped) return activityBlocks;
  if (looksLikeRawArtifact(stripped)) return activityBlocks;

  return [
    ...activityBlocks,
    {
      id: `text-${messageId}`,
      type: 'text' as const,
      content: stripped,
      timestamp: Date.now(),
      isComplete: true,
    },
  ];
}
