/**
 * Q1-fix-2 (2026-05-12) — extractLatestUserText pulls the most-recent
 * user-turn text out of chatLoop's canonical `messages` array so
 * executeToolSearch can forward it as `userPromptHint` to
 * /api/internal/tool-search. Without it, the multi-cloud diversity
 * path doesn't fire on tri-cloud prompts where the model emits a
 * single-cloud query (the live failure mode in the Q1 driver report).
 */
import { describe, it, expect } from 'vitest';
import { extractLatestUserText } from '../chatLoop.js';

describe('extractLatestUserText — chatLoop messages → userPromptHint source', () => {
  it('returns string content as-is', () => {
    const text = extractLatestUserText([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Find top cost spikes across Azure/AWS/GCP.' },
    ]);
    expect(text).toBe('Find top cost spikes across Azure/AWS/GCP.');
  });

  it('returns the LATEST user message (not the first)', () => {
    const text = extractLatestUserText([
      { role: 'user', content: 'first prompt' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second prompt (this one)' },
    ]);
    expect(text).toBe('second prompt (this one)');
  });

  it('joins text parts of a content-block user message', () => {
    const text = extractLatestUserText([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'tri-cloud cost' },
          { type: 'text', text: 'across Azure / AWS / GCP' },
        ],
      },
    ]);
    expect(text).toBe('tri-cloud cost\nacross Azure / AWS / GCP');
  });

  it('returns empty string when no user message exists', () => {
    expect(extractLatestUserText([])).toBe('');
    expect(extractLatestUserText([{ role: 'system', content: 'only sys' }])).toBe('');
  });

  it('skips user turns with only non-text blocks (tool_result envelopes)', () => {
    const text = extractLatestUserText([
      { role: 'user', content: 'original prompt' },
      { role: 'assistant', content: 'reply' },
      {
        role: 'user',
        content: [{ type: 'tool_result', text: undefined } as any],
      },
    ]);
    // Should fall through to the earlier real user prompt.
    expect(text).toBe('original prompt');
  });
});
