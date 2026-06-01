/**
 * Unit tests for the embedding INPUT-text safety cap.
 *
 * Guards the live failure (open-dev 2026-06-01): one over-long MCP tool
 * description ("the input length exceeds the context length") 500'd the whole
 * 14-tool batch embed, leaving the vector catalog empty.
 *
 * Contract:
 *   - input under cap → unchanged
 *   - input over cap → truncated to the leading `maxChars`
 *   - a batch with one oversized input → others untouched, oversized
 *     truncated, NONE dropped (length preserved)
 *   - shrink-on-failure halves the budget (with a floor) so a still-too-long
 *     input degrades instead of failing the catalog
 */

import { describe, it, expect } from 'vitest';
import {
  EMBEDDING_INPUT_MAX_CHARS,
  capEmbeddingInput,
  capEmbeddingInputs,
  shrinkEmbeddingInput,
} from '../embeddingInputCap.js';

describe('capEmbeddingInput — single input', () => {
  it('returns an under-cap string unchanged (same reference)', () => {
    const short = 'list my azure subscriptions';
    expect(capEmbeddingInput(short)).toBe(short);
  });

  it('returns an exactly-at-cap string unchanged', () => {
    const atCap = 'x'.repeat(EMBEDDING_INPUT_MAX_CHARS);
    const out = capEmbeddingInput(atCap);
    expect(out).toBe(atCap);
    expect(out).toHaveLength(EMBEDDING_INPUT_MAX_CHARS);
  });

  it('truncates an over-cap string to the leading maxChars', () => {
    const huge = 'a'.repeat(EMBEDDING_INPUT_MAX_CHARS + 5000);
    const out = capEmbeddingInput(huge);
    expect(out).toHaveLength(EMBEDDING_INPUT_MAX_CHARS);
    // leading text preserved (most discriminative for semantic search)
    expect(out[0]).toBe('a');
    expect(out).toBe('a'.repeat(EMBEDDING_INPUT_MAX_CHARS));
  });

  it('honors a custom cap', () => {
    expect(capEmbeddingInput('abcdef', 3)).toBe('abc');
    expect(capEmbeddingInput('abc', 3)).toBe('abc');
  });

  it('never throws on non-string / null input', () => {
    expect(capEmbeddingInput(undefined as any)).toBe('');
    expect(capEmbeddingInput(null as any)).toBe('');
    expect(capEmbeddingInput(12345 as any)).toBe('12345');
  });

  it('non-positive / non-finite cap leaves input untouched', () => {
    const s = 'hello world';
    expect(capEmbeddingInput(s, 0)).toBe(s);
    expect(capEmbeddingInput(s, -10)).toBe(s);
    expect(capEmbeddingInput(s, NaN)).toBe(s);
  });
});

describe('capEmbeddingInputs — batch with one oversized input', () => {
  it('truncates only the oversized input; others unchanged; none dropped', () => {
    const a = 'short one';
    const oversized = 'b'.repeat(EMBEDDING_INPUT_MAX_CHARS + 4000); // read_documentation-style
    const c = 'another short';

    const out = capEmbeddingInputs([a, oversized, c]);

    // NONE dropped — batch length must equal input length so insert indices
    // stay aligned with the tool array.
    expect(out).toHaveLength(3);

    expect(out[0]).toBe(a); // untouched
    expect(out[2]).toBe(c); // untouched

    expect(out[1]).toHaveLength(EMBEDDING_INPUT_MAX_CHARS); // truncated
    expect(out[1]).toBe('b'.repeat(EMBEDDING_INPUT_MAX_CHARS));
  });

  it('all-under-cap batch is returned with every element unchanged', () => {
    const inputs = ['one', 'two', 'three'];
    const out = capEmbeddingInputs(inputs);
    expect(out).toEqual(inputs);
    out.forEach((v, i) => expect(v).toBe(inputs[i]));
  });

  it('non-array input yields an empty array (no throw)', () => {
    expect(capEmbeddingInputs(undefined as any)).toEqual([]);
  });
});

describe('shrinkEmbeddingInput — retry-on-failure escape hatch', () => {
  it('halves the budget when the input is still longer than half', () => {
    const huge = 'c'.repeat(EMBEDDING_INPUT_MAX_CHARS);
    const out = shrinkEmbeddingInput(huge, EMBEDDING_INPUT_MAX_CHARS);
    expect(out).toHaveLength(Math.floor(EMBEDDING_INPUT_MAX_CHARS / 2));
  });

  it('floors at the minimum so it can never spin to empty', () => {
    const text = 'd'.repeat(1000);
    // currentMax tiny → next would be < floor → clamp to floor (256)
    const out = shrinkEmbeddingInput(text, 100, 256);
    expect(out).toHaveLength(256);
  });

  it('returns a short input untouched when already under the shrink target', () => {
    const short = 'tiny';
    expect(shrinkEmbeddingInput(short, EMBEDDING_INPUT_MAX_CHARS)).toBe(short);
  });
});
