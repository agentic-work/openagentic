/**
 * Tests for the firstSentencePreview helper used by the collapsed
 * ThinkingRow header — gives the user a glanceable hint of the model's
 * chain-of-thought without expanding the full block. Matches Claude
 * Code TUI behavior: thinking opens by default, collapse shows preview.
 */
import { describe, it, expect } from 'vitest';
import { firstSentencePreview } from '../MessageTree';

describe('firstSentencePreview', () => {
  it('returns the empty string for empty/undefined input', () => {
    expect(firstSentencePreview('')).toBe('');
    expect(firstSentencePreview('   \n\t  ')).toBe('');
  });

  it('returns the first sentence ending in a period', () => {
    expect(
      firstSentencePreview(
        'Let me start by surveying the workspace. Then I will write a plan.',
      ),
    ).toBe('Let me start by surveying the workspace.');
  });

  it('handles question marks and exclamation marks as sentence terminators', () => {
    expect(firstSentencePreview('Should I use RGA? Yes, intention preservation matters.'))
      .toBe('Should I use RGA?');
    expect(firstSentencePreview('Eureka! I found it. The fix is simple.'))
      .toBe('Eureka!');
  });

  it('collapses runs of whitespace + newlines into single spaces', () => {
    expect(firstSentencePreview('Line one.\n\n   Line two.'))
      .toBe('Line one.');
    expect(firstSentencePreview('   leading\n\twhitespace.   trailing.'))
      .toBe('leading whitespace.');
  });

  it('returns the whole text when there is no sentence terminator (under cap)', () => {
    expect(firstSentencePreview('thinking out loud no punctuation here'))
      .toBe('thinking out loud no punctuation here');
  });

  it('truncates a very long single sentence to 137 chars + ellipsis', () => {
    const long = 'a'.repeat(300);
    const result = firstSentencePreview(long);
    expect(result.length).toBe(138); // 137 + …
    expect(result.endsWith('…')).toBe(true);
  });

  it('does NOT truncate a sentence ≤140 chars even without terminator', () => {
    const text = 'a'.repeat(140);
    expect(firstSentencePreview(text)).toBe(text);
  });

  it('still trims a sentence shorter than the cap', () => {
    expect(firstSentencePreview('short.')).toBe('short.');
  });
});
