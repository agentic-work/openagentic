/**
 * thinkingShape — unified canonical thinking-block conversion helpers.
 *
 * Canonical thinking block: `{ type: 'thinking', thinking: '<text>',
 * signature?: '<base64>' }` — matches Anthropic Messages API native shape.
 *
 * Each helper extracts thinking from the named provider's native event/
 * delta shape. Today the api has 5 different shapes for "where does the
 * thinking text live" — this module is the SoT.
 *
 * the design notes
 *        §"Phase 0.2 — SDK shared canonical invariants"
 *
 * Audit refs: F2-8 (Ollama <think> tag legacy), L4-3 (Vertex thought parts).
 */
import { describe, it, expect } from 'vitest';
import {
  extractThinkingFromOpenAIDelta,
  extractThinkingFromAIFResponses,
  extractThinkingFromVertexGemini,
  extractThinkingFromOllamaContent,
  wrapAsCanonicalThinking,
} from '../thinkingShape.js';

describe('extractThinkingFromOpenAIDelta', () => {
  it('pulls delta.reasoning_content (Azure OpenAI gpt-5 / o-series)', () => {
    const delta = { reasoning_content: 'Let me think...' };
    expect(extractThinkingFromOpenAIDelta(delta)).toBe('Let me think...');
  });

  it('returns null when reasoning_content is absent', () => {
    expect(extractThinkingFromOpenAIDelta({ content: 'hello' })).toBeNull();
  });

  it('returns null when reasoning_content is null', () => {
    expect(extractThinkingFromOpenAIDelta({ reasoning_content: null })).toBeNull();
  });

  it('returns null when reasoning_content is empty string', () => {
    expect(extractThinkingFromOpenAIDelta({ reasoning_content: '' })).toBeNull();
  });

  it('returns null on non-string reasoning_content', () => {
    expect(extractThinkingFromOpenAIDelta({ reasoning_content: 42 })).toBeNull();
  });

  it('returns null on null / undefined input', () => {
    expect(extractThinkingFromOpenAIDelta(null)).toBeNull();
    expect(extractThinkingFromOpenAIDelta(undefined)).toBeNull();
  });
});

describe('extractThinkingFromAIFResponses', () => {
  it('pulls reasoning summary text from a reasoning output item', () => {
    const event = {
      type: 'reasoning',
      id: 'rs_123',
      summary: [
        { type: 'summary_text', text: 'First I considered...' },
        { type: 'summary_text', text: 'Then I decided to...' },
      ],
    };
    // Each summary_text part is preserved as a separate chunk; we
    // concatenate when there are multiple.
    expect(extractThinkingFromAIFResponses(event)).toBe(
      'First I considered...Then I decided to...',
    );
  });

  it('returns null when summary array is empty', () => {
    expect(
      extractThinkingFromAIFResponses({
        type: 'reasoning',
        id: 'rs_x',
        summary: [],
      }),
    ).toBeNull();
  });

  it('returns null when summary is undefined', () => {
    expect(
      extractThinkingFromAIFResponses({ type: 'reasoning', id: 'rs_x' }),
    ).toBeNull();
  });

  it('returns null when item.type is not reasoning', () => {
    expect(
      extractThinkingFromAIFResponses({
        type: 'message',
        content: [],
      }),
    ).toBeNull();
  });

  it('skips non-summary_text parts in the array', () => {
    const event = {
      type: 'reasoning',
      id: 'rs_y',
      summary: [
        { type: 'other_thing', text: 'ignore me' },
        { type: 'summary_text', text: 'keep me' },
      ],
    };
    expect(extractThinkingFromAIFResponses(event)).toBe('keep me');
  });
});

describe('extractThinkingFromVertexGemini', () => {
  it('extracts text from a part with thought=true', () => {
    const part = { thought: true, text: 'Considering options...' };
    expect(extractThinkingFromVertexGemini(part)).toBe('Considering options...');
  });

  it('returns null when thought field is absent (regular text part)', () => {
    expect(extractThinkingFromVertexGemini({ text: 'hello' })).toBeNull();
  });

  it('returns null when thought=false', () => {
    expect(
      extractThinkingFromVertexGemini({ thought: false, text: 'visible reply' }),
    ).toBeNull();
  });

  it('returns null when text is missing on a thought part', () => {
    expect(extractThinkingFromVertexGemini({ thought: true })).toBeNull();
  });

  it('returns null on null / undefined', () => {
    expect(extractThinkingFromVertexGemini(null)).toBeNull();
    expect(extractThinkingFromVertexGemini(undefined)).toBeNull();
  });
});

describe('extractThinkingFromOllamaContent — <think>...</think> XML parsing', () => {
  it('extracts thinking inside a complete tag pair', () => {
    const out = extractThinkingFromOllamaContent(
      '<think>reasoning here</think>visible reply',
    );
    expect(out.thinking).toBe('reasoning here');
    expect(out.rest).toBe('visible reply');
  });

  it('returns null thinking and full rest when no <think> tag is present', () => {
    const out = extractThinkingFromOllamaContent('just a reply');
    expect(out.thinking).toBeNull();
    expect(out.rest).toBe('just a reply');
  });

  it('handles content that starts with <think> and ends mid-tag (streaming chunk)', () => {
    // Streaming case: tag opened but not yet closed in this chunk. Implementation
    // returns the partial thinking AND a flag the caller can use to know it's
    // unclosed — but for v1 we collapse to "thinking = partial, rest = ''" so
    // the caller never confuses unclosed-think content with rest text.
    const out = extractThinkingFromOllamaContent('<think>partial');
    expect(out.thinking).toBe('partial');
    expect(out.rest).toBe('');
  });

  it('handles content with prefix text then a complete tag pair then suffix', () => {
    const out = extractThinkingFromOllamaContent(
      'prefix <think>middle</think> suffix',
    );
    expect(out.thinking).toBe('middle');
    expect(out.rest).toBe('prefix  suffix');
  });

  it('handles multiple <think> tags by concatenating thinking content', () => {
    const out = extractThinkingFromOllamaContent(
      '<think>one</think>between<think>two</think>after',
    );
    expect(out.thinking).toBe('onetwo');
    expect(out.rest).toBe('betweenafter');
  });

  it('handles empty string', () => {
    const out = extractThinkingFromOllamaContent('');
    expect(out.thinking).toBeNull();
    expect(out.rest).toBe('');
  });
});

describe('wrapAsCanonicalThinking', () => {
  it('produces the canonical block shape from a text fragment', () => {
    const block = wrapAsCanonicalThinking('reasoning');
    expect(block).toEqual({ type: 'thinking', thinking: 'reasoning' });
  });

  it('attaches signature when provided', () => {
    const block = wrapAsCanonicalThinking('reasoning', 'base64sig==');
    expect(block).toEqual({
      type: 'thinking',
      thinking: 'reasoning',
      signature: 'base64sig==',
    });
  });

  it('omits signature when undefined', () => {
    const block = wrapAsCanonicalThinking('reasoning', undefined);
    expect('signature' in block).toBe(false);
  });
});

describe('real-capture replay (todo — fills in next slice)', () => {
  // The current Ollama real capture at fixtures/ollama-gpt-oss-20b-tool-call.ndjson
  // uses the native message.thinking field (gpt-oss:20b — modern Ollama). The
  // <think>...</think> XML pattern is from deepseek-r1 / qwq-class models. We
  // need a separate capture against one of those before this replay test can run.
  it.todo('replays a deepseek-r1-style <think>...</think> Ollama stream and asserts canonical thinking output');
});
