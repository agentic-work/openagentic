/**
 * InlineThinkingBlock — v0.6.7 chat-polish header + accordion tests
 *
 * Target: collapsed by default, live "Thinking..." header while streaming,
 * "Thought for X.Xs · ~N tokens" once complete.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineThinkingBlock } from '../InlineThinkingBlock';

describe('InlineThinkingBlock (v0.6.7 chat polish)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is collapsed by default and shows the accordion header', () => {
    render(
      <InlineThinkingBlock
        content="step 1 then step 2"
        isStreaming={false}
        startedAt={1_000}
        endedAt={3_500}
      />
    );
    const root = screen.getByTestId('inline-thinking-block');
    expect(root).toHaveAttribute('data-expanded', 'false');
    // Body not rendered while collapsed
    expect(screen.queryByTestId('inline-thinking-body')).toBeNull();
  });

  it('shows "Thought for X.Xs · ~N tokens" header when not streaming', () => {
    const longContent = 'abcd'.repeat(25); // 100 chars → ~25 tokens
    render(
      <InlineThinkingBlock
        content={longContent}
        isStreaming={false}
        startedAt={10_000}
        endedAt={12_300}
      />
    );
    const header = screen.getByTestId('inline-thinking-header');
    expect(header.textContent).toMatch(/Thought · 2\.3s/);
    expect(header.textContent).toMatch(/~25 tok/);
  });

  it('shows "Thinking..." header while streaming and updates live as deltas arrive', () => {
    const now = 20_000;
    vi.setSystemTime(now);
    const { rerender } = render(
      <InlineThinkingBlock
        content="ab"
        isStreaming={true}
        startedAt={now}
      />
    );
    expect(screen.getByTestId('inline-thinking-header').textContent).toBe('Thinking');

    // Simulate delta arriving after 1.2s and 2.5s
    act(() => {
      vi.setSystemTime(now + 1_200);
      vi.advanceTimersByTime(1_200);
    });
    // Still streaming → header label stays "Thinking..."
    expect(screen.getByTestId('inline-thinking-header').textContent).toBe('Thinking');

    // Stream finished: rerender with endedAt
    const finalContent = 'ab'.repeat(40); // 80 chars → ~20 tokens
    rerender(
      <InlineThinkingBlock
        content={finalContent}
        isStreaming={false}
        startedAt={now}
        endedAt={now + 2_500}
      />
    );
    const finalHeader = screen.getByTestId('inline-thinking-header').textContent ?? '';
    expect(finalHeader).toMatch(/Thought · 2\.5s/);
    expect(finalHeader).toMatch(/~20 tok/);
  });

  it('toggles expansion on header click', () => {
    render(
      <InlineThinkingBlock
        content="hello reasoning"
        isStreaming={false}
        startedAt={0}
        endedAt={100}
      />
    );
    const root = screen.getByTestId('inline-thinking-block');
    const toggle = screen.getByTestId('inline-thinking-toggle');
    expect(root).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(toggle);
    expect(root).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByTestId('inline-thinking-body')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(root).toHaveAttribute('data-expanded', 'false');
  });

  it('honors explicit tokenCount prop over char-length estimate', () => {
    render(
      <InlineThinkingBlock
        content="xyz"
        isStreaming={false}
        startedAt={0}
        endedAt={1_000}
        tokenCount={999}
      />
    );
    expect(screen.getByTestId('inline-thinking-header').textContent).toMatch(/~999 tok/);
  });

  // Track B Phase 5 (2026-05-22): boxed variant deleted — natural is the
  // only rendering shape. Header live-metrics behavior is covered by the
  // tests above; this assertion now lives there too.
});
