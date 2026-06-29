/**
 * stripCacheControl — deep-copy a CanonicalMessage[] with all `cache_control`
 * fields removed from every content block (including nested tool_result
 * content blocks).
 *
 * Cache_control is Anthropic-native — it tells Anthropic where to cut the
 * prompt for billing-priced prompt caching. No other provider's wire shape
 * carries the field, so adapters targeting OpenAI / Ollama / Vertex Gemini
 * / AIF Responses must strip it before serialization. Audit L5-4.
 *
 * Pure function — no I/O, no mutation. Returns a new array.
 *
 * the design notes
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */

import type {
  CanonicalMessage,
  CanonicalRequestContentBlock,
  CanonicalRequestToolResultContentBlock,
} from './types.js';

/**
 * Returns a deep copy of `messages` with every `cache_control` field
 * removed. Input is never mutated.
 */
export function stripCacheControl(
  messages: CanonicalMessage[],
): CanonicalMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map(stripBlock),
  }));
}

function stripBlock(
  block: CanonicalRequestContentBlock,
): CanonicalRequestContentBlock {
  switch (block.type) {
    case 'text': {
      const { cache_control: _omit, ...rest } = block;
      void _omit;
      return { ...rest };
    }
    case 'thinking': {
      // Thinking blocks don't carry cache_control today, but deep-copy
      // anyway for caller-mutation safety.
      return { ...block };
    }
    case 'tool_use': {
      const { cache_control: _omit, ...rest } = block;
      void _omit;
      return { ...rest, input: { ...rest.input } };
    }
    case 'tool_result': {
      const { cache_control: _omit, content, ...rest } = block;
      void _omit;
      const strippedContent: typeof content =
        typeof content === 'string'
          ? content
          : content.map(stripToolResultInner);
      return { ...rest, content: strippedContent };
    }
    case 'image': {
      const { cache_control: _omit, source, ...rest } = block;
      void _omit;
      return { ...rest, source: { ...source } };
    }
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

function stripToolResultInner(
  block: CanonicalRequestToolResultContentBlock,
): CanonicalRequestToolResultContentBlock {
  switch (block.type) {
    case 'text': {
      const { cache_control: _omit, ...rest } = block;
      void _omit;
      return { ...rest };
    }
    case 'image': {
      const { cache_control: _omit, source, ...rest } = block;
      void _omit;
      return { ...rest, source: { ...source } };
    }
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}
