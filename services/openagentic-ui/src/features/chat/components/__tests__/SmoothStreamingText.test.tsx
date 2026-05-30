/**
 * #503 — pacing contract for SmoothStreamingText.
 *
 * The component now delegates char-pacing to `useTextPacer`. This test
 * exists to lock the user-visible behavior:
 *
 *   - char-by-char reveal (NO multi-char bursts)
 *   - cadence honors `typingSpeed` (chars/sec → 1000/typingSpeed ms/char)
 *   - immediate full reveal when `enableAnimation === false`
 *   - clean unmount (no leaked timers)
 *
 * The previous implementation revealed 4 chars per 66ms tick (15fps), which
 * looked like janky bursts. Reference: mocks/UX/mock.html lines 378-409 use
 * 15-20ms/char single-char reveal.
 *
 * SharedMarkdownRenderer is mocked because we are testing pacing, not
 * markdown — the renderer's own tests cover that.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { SmoothStreamingText } from '../SmoothStreamingText';

vi.mock('../MessageContent/SharedMarkdownRenderer', () => ({
  SharedMarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const getDisplayedContent = (container: HTMLElement): string => {
  const el = container.querySelector('[data-testid="markdown-content"]');
  return el?.textContent ?? '';
};

describe('SmoothStreamingText — #503 pacing contract', () => {
  it('reveals nothing before the first tick', () => {
    const { container } = render(
      <SmoothStreamingText content="hello" typingSpeed={67} />,
    );
    expect(getDisplayedContent(container)).toBe('');
  });

  it('reveals one char per tick at 67 chars/sec (~15ms/char)', () => {
    const { container } = render(
      <SmoothStreamingText content="abcd" typingSpeed={67} />,
    );

    act(() => { vi.advanceTimersByTime(15); });
    expect(getDisplayedContent(container)).toBe('a');

    act(() => { vi.advanceTimersByTime(15); });
    expect(getDisplayedContent(container)).toBe('ab');

    act(() => { vi.advanceTimersByTime(15); });
    expect(getDisplayedContent(container)).toBe('abc');

    act(() => { vi.advanceTimersByTime(15); });
    expect(getDisplayedContent(container)).toBe('abcd');
  });

  it('respects a slower typingSpeed (50 chars/sec → 20ms/char)', () => {
    const { container } = render(
      <SmoothStreamingText content="xy" typingSpeed={50} />,
    );

    act(() => { vi.advanceTimersByTime(19); });
    expect(getDisplayedContent(container)).toBe('');

    act(() => { vi.advanceTimersByTime(1); });
    expect(getDisplayedContent(container)).toBe('x');

    act(() => { vi.advanceTimersByTime(20); });
    expect(getDisplayedContent(container)).toBe('xy');
  });

  it('renders the full content immediately when enableAnimation is false', () => {
    const { container } = render(
      <SmoothStreamingText content="instant" enableAnimation={false} />,
    );
    expect(getDisplayedContent(container)).toBe('instant');
  });

  it('cleans up its timer on unmount (no leaks)', () => {
    const { unmount } = render(
      <SmoothStreamingText content="abcd" typingSpeed={67} />,
    );
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues revealing when content grows over time (streaming append)', () => {
    const { container, rerender } = render(
      <SmoothStreamingText content="ab" typingSpeed={67} />,
    );
    act(() => { vi.advanceTimersByTime(45); });
    expect(getDisplayedContent(container)).toBe('ab');

    rerender(<SmoothStreamingText content="abcd" typingSpeed={67} />);
    act(() => { vi.advanceTimersByTime(15); });
    expect(getDisplayedContent(container)).toBe('abc');

    act(() => { vi.advanceTimersByTime(15); });
    expect(getDisplayedContent(container)).toBe('abcd');
  });
});
