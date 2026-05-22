/**
 * TDD — thinkingOnlyFallback
 *
 * Red→Green cycle for the "gpt-oss emitted only thinking" fix. Live
 * symptom this guards against: /api/openagentic/v1/messages returned
 * `outputTokens=0` on every codemode turn because OllamaProvider's
 * stream yielded zero `text_delta` events when the model routed its
 * final answer through the reasoning channel.
 *
 * Covers:
 *   - shouldSynthesizeFinalText decision matrix
 *   - extractFinalAnswerFromThinking for Harmony / labeled / fallback cases
 *   - buildFallbackEvents sequences the correct Anthropic streaming events
 */

import { describe, it, expect } from 'vitest';
import {
  shouldSynthesizeFinalText,
  extractFinalAnswerFromThinking,
  buildFallbackEvents,
} from '../thinkingOnlyFallback.js';

describe('shouldSynthesizeFinalText', () => {
  it('returns true when content is empty and thinking has text (the live bug)', () => {
    expect(
      shouldSynthesizeFinalText({
        accumulatedContent: '',
        accumulatedThinking: 'Let me compute... 2+2 is 4',
        hasToolCalls: false,
      }),
    ).toBe(true);
  });

  it('returns false when the stream yielded real content', () => {
    expect(
      shouldSynthesizeFinalText({
        accumulatedContent: '4',
        accumulatedThinking: 'thinking...',
        hasToolCalls: false,
      }),
    ).toBe(false);
  });

  it('returns false when thinking itself is empty (nothing to synthesize from)', () => {
    expect(
      shouldSynthesizeFinalText({
        accumulatedContent: '',
        accumulatedThinking: '',
        hasToolCalls: false,
      }),
    ).toBe(false);
  });

  it('returns false when thinking is only whitespace', () => {
    expect(
      shouldSynthesizeFinalText({
        accumulatedContent: '',
        accumulatedThinking: '   \n  \t  \n',
        hasToolCalls: false,
      }),
    ).toBe(false);
  });

  it('returns false when there are tool calls — the tool call IS the answer', () => {
    expect(
      shouldSynthesizeFinalText({
        accumulatedContent: '',
        accumulatedThinking: "I'll call the bash tool",
        hasToolCalls: true,
      }),
    ).toBe(false);
  });

  it('counts whitespace-only content as empty', () => {
    expect(
      shouldSynthesizeFinalText({
        accumulatedContent: '  \n  ',
        accumulatedThinking: 'real answer',
        hasToolCalls: false,
      }),
    ).toBe(true);
  });
});

describe('extractFinalAnswerFromThinking', () => {
  it('extracts the Harmony final-channel body when present', () => {
    const thinking =
      '<|channel|>analysis<|message|>user asks 2+2. Easy.<|end|>' +
      '<|channel|>final<|message|>4<|return|>';
    expect(extractFinalAnswerFromThinking(thinking)).toBe('4');
  });

  it('is forgiving about trailing channel markers', () => {
    // Ollama sometimes truncates before the closing `<|return|>`
    const thinking =
      '<|channel|>analysis<|message|>thinking<|end|>' +
      '<|channel|>final<|message|>The answer is 42';
    expect(extractFinalAnswerFromThinking(thinking)).toBe('The answer is 42');
  });

  it('picks up a labeled "Final answer:" line and everything after it', () => {
    const thinking =
      "Let me think step by step.\n" +
      "Step 1: I need to add.\n" +
      "Step 2: 2 + 2.\n" +
      "\n" +
      "Final answer: 4\n";
    expect(extractFinalAnswerFromThinking(thinking)).toBe('4');
  });

  it('handles plain "Answer:" label', () => {
    const thinking = "Analysis...\nAnswer: Paris";
    expect(extractFinalAnswerFromThinking(thinking)).toBe('Paris');
  });

  it('falls back to the last non-empty paragraph when no marker is found', () => {
    const thinking =
      'First paragraph of thinking.\n\n' +
      'Middle paragraph.\n\n' +
      'Conclusion: the result is correct.';
    expect(extractFinalAnswerFromThinking(thinking)).toBe(
      'Conclusion: the result is correct.',
    );
  });

  it('returns the full trimmed thinking when there are no paragraph breaks AND it is a single short sentence', () => {
    const thinking = 'single line answer';
    expect(extractFinalAnswerFromThinking(thinking)).toBe('single line answer');
  });

  // Live bug 2026-04-30: gpt-oss:20b thinking like
  //   "User asks: 'what model are you'. Likely typo. We need to answer..."
  // was being dumped verbatim into the text channel because step (3) of
  // the extractor returned the LAST PARAGRAPH — and a single-paragraph
  // chain-of-thought IS one paragraph. Result: chain-of-thought leaks
  // into the user's plain assistant content. Fix: when the trailing
  // paragraph is itself chain-of-thought reasoning (multiple sentences
  // referring to the user in third person), prefer the LAST SENTENCE
  // only — not the whole reasoning blob.
  it('extracts the last sentence when the trailing paragraph is multi-sentence chain-of-thought', () => {
    const thinking =
      "User asks: 'what model are you'. Likely typo: 'what model are you'. " +
      "We need to answer the user. I am gpt-oss:20b.";
    expect(extractFinalAnswerFromThinking(thinking)).toBe('I am gpt-oss:20b.');
  });

  it('extracts the last sentence even with reasoning prefixes that drag across many lines', () => {
    const thinking =
      "The user wants to know which model is responding. " +
      "Let me think carefully. We should respond honestly. " +
      "I am the gpt-oss 20b model running locally.";
    expect(extractFinalAnswerFromThinking(thinking)).toBe(
      'I am the gpt-oss 20b model running locally.',
    );
  });

  // When the thinking is ALL chain-of-thought meta-commentary (no
  // discernible answer at the end either), don't leak it as text —
  // emit an empty string so buildFallbackEvents can substitute a
  // placeholder. The user still sees the full reasoning under the
  // collapsed `∴ Thinking` block; we just don't pretend the
  // chain-of-thought IS the user-facing answer.
  it('returns empty string when thinking is pure chain-of-thought meta-commentary', () => {
    const thinking =
      "User asks a question. We need to think about it. " +
      "Let me consider. We should respond.";
    expect(extractFinalAnswerFromThinking(thinking)).toBe('');
  });

  it('does NOT treat short paragraphs (a single sentence) as chain-of-thought', () => {
    // Single-sentence final answer must pass through even if it begins
    // with a capital "I" — the heuristic only kicks in for multi-sentence
    // reasoning blobs.
    const thinking = 'I am claude.';
    expect(extractFinalAnswerFromThinking(thinking)).toBe('I am claude.');
  });

  it('returns empty string for empty input', () => {
    expect(extractFinalAnswerFromThinking('')).toBe('');
    expect(extractFinalAnswerFromThinking('   ')).toBe('');
  });

  it('Harmony label wins over labeled answer if both present', () => {
    const thinking =
      'Final answer: wrong\n' +
      '<|channel|>final<|message|>right<|return|>';
    expect(extractFinalAnswerFromThinking(thinking)).toBe('right');
  });
});

describe('buildFallbackEvents', () => {
  it('closes the open thinking block and emits a synthesized text block', () => {
    const out = buildFallbackEvents({
      accumulatedThinking: 'Final answer: 42',
      nextBlockIndex: 1,
      thinkingBlockOpen: true,
      openThinkingBlockIndex: 0,
    });

    expect(out.synthesizedBlockIndex).toBe(1);
    expect(out.synthesizedText).toBe('42');
    expect(out.events).toEqual([
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '42' } },
      { type: 'content_block_stop', index: 1 },
    ]);
  });

  it('skips the prior-block-close when no thinking block is open', () => {
    const out = buildFallbackEvents({
      accumulatedThinking: 'answer',
      nextBlockIndex: 0,
      thinkingBlockOpen: false,
    });

    expect(out.events[0]).toEqual({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    });
    // Exactly 3 events: start + delta + stop (no prior close)
    expect(out.events).toHaveLength(3);
    expect(out.events[2]).toEqual({ type: 'content_block_stop', index: 0 });
  });

  it('produces at least one text_delta for the Harmony-final shape (the live fix)', () => {
    // Simulates the actual gpt-oss:20b live output shape: all thinking
    // goes through the Harmony `final` channel, `content` stays empty.
    const thinking =
      '<|channel|>analysis<|message|>Reasoning about the answer.<|end|>' +
      '<|channel|>final<|message|>Hello from the reasoning channel.<|return|>';

    const out = buildFallbackEvents({
      accumulatedThinking: thinking,
      nextBlockIndex: 1,
      thinkingBlockOpen: true,
      openThinkingBlockIndex: 0,
    });

    const textDeltas = out.events.filter(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta',
    );
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]).toEqual({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Hello from the reasoning channel.' },
    });
  });

  // Live bug 2026-04-30: gpt-oss:20b sent thinking ~"User asks 'what
  // model are you'. We need to answer..." and the synthesized text was
  // the verbatim chain-of-thought, leaking into plain assistant content.
  // After the extraction-extractor fix, these reasoning-only thinkings
  // now extract to "" — buildFallbackEvents must substitute a generic
  // placeholder so the Anthropic Messages contract still gets ≥1
  // text_delta and the user sees something. The full reasoning is
  // ALREADY visible under the `∴ Thinking` block.
  it('substitutes a placeholder when extraction returns empty (chain-of-thought-only thinking)', () => {
    const thinking =
      "User asks a question. We need to think. Let me consider.";

    const out = buildFallbackEvents({
      accumulatedThinking: thinking,
      nextBlockIndex: 1,
      thinkingBlockOpen: true,
      openThinkingBlockIndex: 0,
    });

    const textDeltas = out.events.filter(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta',
    );
    expect(textDeltas).toHaveLength(1);
    // Placeholder must be NON-empty (Anthropic contract) but must NOT
    // include the chain-of-thought text.
    const text = (textDeltas[0] as any).delta.text as string;
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('User asks');
    expect(text).not.toContain('Let me consider');
  });
});
