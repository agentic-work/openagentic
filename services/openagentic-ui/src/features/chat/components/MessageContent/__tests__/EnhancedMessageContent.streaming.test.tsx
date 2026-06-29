/**
 * #503 — wire SmoothStreamingText into the live message render path.
 *
 * The user's complaint: assistant prose appears as bursty NDJSON deltas
 * because EnhancedMessageContent's text branch goes straight to
 * SharedMarkdownRenderer with no pacing. SmoothStreamingText (already
 * shipped in #503) provides the char-by-char pacer + blinking cursor that
 * matches mocks/UX/mock.html.
 *
 * Contract under test:
 *
 *   1. When `isStreaming === true`, the prose render path must go through
 *      SmoothStreamingText (so the user sees paced reveal + cursor).
 *
 *   2. When `isStreaming === false` (completed message, history replay),
 *      the prose render path must NOT use SmoothStreamingText — it must
 *      render SharedMarkdownRenderer directly. Replaying the pacer on
 *      every history scroll-back would be jarring.
 *
 *   3. When content updates while still streaming, SmoothStreamingText
 *      must remain the chosen renderer (the pacer keeps up with growth
 *      via its own internal contract — see useTextPacer.test.ts).
 *
 * Both child components are mocked so we are testing the wiring decision
 * inside EnhancedMessageContent only — not pacer math, not markdown.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock SharedMarkdownRenderer — emits a stable testid we can assert on.
// ---------------------------------------------------------------------------
vi.mock('../SharedMarkdownRenderer', () => ({
  SharedMarkdownRenderer: ({ content, isStreaming }: { content: string; isStreaming?: boolean }) => (
    <div
      data-testid="shared-markdown-renderer"
      data-streaming={String(!!isStreaming)}
    >
      {content}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock SmoothStreamingText — emits its own stable testid so we can
// distinguish it from SharedMarkdownRenderer in the rendered tree.
// ---------------------------------------------------------------------------
vi.mock('../../SmoothStreamingText', () => ({
  SmoothStreamingText: ({
    content,
    enableAnimation,
    theme,
  }: {
    content: string;
    enableAnimation?: boolean;
    theme?: string;
  }) => (
    <div
      data-testid="smooth-streaming-text"
      data-enabled={String(!!enableAnimation)}
      data-theme={theme ?? ''}
    >
      {content}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// framer-motion — collapse motion.* to plain divs, drop AnimatePresence.
// ---------------------------------------------------------------------------
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: any) => React.createElement('div', props, props?.children),
    },
  ),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

// ---------------------------------------------------------------------------
// Heavy/irrelevant deps — stub them out so the component mounts cleanly.
// ---------------------------------------------------------------------------
vi.mock('../ShikiCodeBlock', () => ({ default: () => <div data-testid="shiki" /> }));
vi.mock('../../AnimatedTokenCost', () => ({ default: () => <div data-testid="cost" /> }));
vi.mock('../../InlineModelBadge', () => ({ default: () => <div data-testid="badge" /> }));
vi.mock('../DataVisualization', () => ({ default: () => <div data-testid="viz" /> }));
vi.mock('../MetricCard', () => ({ default: () => <div data-testid="metric" /> }));

// nanoid — deterministic id keeps test output stable.
vi.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

// Import AFTER all mocks so the component picks them up.
// eslint-disable-next-line import/first
import EnhancedMessageContent from '../EnhancedMessageContent';

afterEach(() => {
  cleanup();
});

describe('EnhancedMessageContent — #503 SmoothStreamingText wire-up', () => {
  it('routes prose through SmoothStreamingText while isStreaming === true', () => {
    render(
      <EnhancedMessageContent
        content="hello world"
        theme="dark"
        isStreaming={true}
      />,
    );

    // Streaming path → SmoothStreamingText is mounted with the live content
    // and animation enabled. The non-paced renderer must NOT appear for
    // the prose section.
    const paced = screen.getByTestId('smooth-streaming-text');
    expect(paced).toBeInTheDocument();
    expect(paced).toHaveAttribute('data-enabled', 'true');
    expect(paced).toHaveAttribute('data-theme', 'dark');
    expect(paced.textContent).toBe('hello world');

    expect(screen.queryByTestId('shared-markdown-renderer')).not.toBeInTheDocument();
  });

  it('routes prose directly through SharedMarkdownRenderer when isStreaming === false', () => {
    render(
      <EnhancedMessageContent
        content="completed message text"
        theme="dark"
        isStreaming={false}
      />,
    );

    // Non-streaming path → SharedMarkdownRenderer renders inline, NO pacer
    // wrapper (history replay must not animate).
    const direct = screen.getByTestId('shared-markdown-renderer');
    expect(direct).toBeInTheDocument();
    expect(direct).toHaveAttribute('data-streaming', 'false');
    expect(direct.textContent).toBe('completed message text');

    expect(screen.queryByTestId('smooth-streaming-text')).not.toBeInTheDocument();
  });

  it('keeps SmoothStreamingText in the tree when streaming content grows', () => {
    const { rerender } = render(
      <EnhancedMessageContent
        content="hi"
        theme="dark"
        isStreaming={true}
      />,
    );

    expect(screen.getByTestId('smooth-streaming-text').textContent).toBe('hi');

    // Simulate a streaming append — content grows, isStreaming still true.
    rerender(
      <EnhancedMessageContent
        content="hi there friend"
        theme="dark"
        isStreaming={true}
      />,
    );

    const paced = screen.getByTestId('smooth-streaming-text');
    expect(paced).toBeInTheDocument();
    expect(paced.textContent).toBe('hi there friend');
    // Still no fallback path — pacer owns the prose throughout streaming.
    expect(screen.queryByTestId('shared-markdown-renderer')).not.toBeInTheDocument();
  });

  it('flips from paced to direct render when streaming completes', () => {
    const { rerender } = render(
      <EnhancedMessageContent
        content="streaming text"
        theme="light"
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('smooth-streaming-text')).toBeInTheDocument();

    // Streaming finishes → isStreaming flips false. Prose should swap to
    // the direct renderer; the pacer must unmount.
    rerender(
      <EnhancedMessageContent
        content="streaming text"
        theme="light"
        isStreaming={false}
      />,
    );

    expect(screen.queryByTestId('smooth-streaming-text')).not.toBeInTheDocument();
    expect(screen.getByTestId('shared-markdown-renderer')).toBeInTheDocument();
  });
});
