/**
 * deriveFlatMessage — pure helper (Phase 2.2).
 *
 * the design notes
 *
 * SoT for the legacy `assistantMessage` flat-string view of an assistant
 * turn. Replaces the stream-time `assistantMessage +=` concat that raced
 * with the canonical `content_block_delta` reducer arm and produced
 * "LetLet me" character duplication.
 *
 * After Phase 2:
 *   - The canonical reducer owns ContentBlock SoT.
 *   - `assistantMessage` is derived from contentBlocks at finalize.
 *   - Title-gen, copy-to-clipboard, and `buildFinalContentBlocks` trailing
 *     fallback all read the derived string.
 */

import type { ContentBlock } from '../useChatStream';

/**
 * Concatenate `content` of every `type: 'text'` ContentBlock in array
 * order. Thinking + tool_use blocks are skipped — they live in the
 * ContentBlock array and render via their own block type.
 */
export function deriveFlatMessage(contentBlocks: ContentBlock[]): string {
  if (!contentBlocks || contentBlocks.length === 0) return '';
  const parts: string[] = [];
  for (const block of contentBlocks) {
    if (block && block.type === 'text' && typeof block.content === 'string') {
      parts.push(block.content);
    }
  }
  return parts.join('');
}
