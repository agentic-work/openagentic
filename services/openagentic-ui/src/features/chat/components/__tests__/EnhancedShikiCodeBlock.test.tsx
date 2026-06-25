/**
 * EnhancedShikiCodeBlock — v0.6.7 chat-polish fix 3
 *
 * Verifies that during streaming we only call the highlighter with the
 * tail chunk that has grown since the last render, not the full code.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Record every call so the assertions can inspect which slice of code
// each codeToHtml() call received.
const codeToHtml = vi.fn((code: string) =>
  `<pre class="shiki"><code>${code
    .split('\n')
    .map(l => `<span>${l}</span>`)
    .join('\n')}</code></pre>`
);

vi.mock('shiki', () => ({
  createHighlighter: vi.fn(async () => ({
    codeToHtml,
    dispose: () => undefined,
  })),
}));

import EnhancedShikiCodeBlock from '../MessageContent/EnhancedShikiCodeBlock';

describe('EnhancedShikiCodeBlock (v0.6.7 incremental)', () => {
  beforeEach(() => {
    codeToHtml.mockClear();
  });

  it('highlights only the appended tail on streaming growth', async () => {
    const { rerender } = render(
      <EnhancedShikiCodeBlock
        code="function foo() {"
        language="typescript"
        theme="dark"
        isStreaming={true}
      />
    );
    await waitFor(() => expect(codeToHtml).toHaveBeenCalled());
    const firstCallCode = codeToHtml.mock.calls[0][0];
    expect(firstCallCode).toBe('function foo() {');

    codeToHtml.mockClear();
    rerender(
      <EnhancedShikiCodeBlock
        code={'function foo() {\n  return 1;\n}'}
        language="typescript"
        theme="dark"
        isStreaming={true}
      />
    );
    await waitFor(() => expect(codeToHtml).toHaveBeenCalled());
    // Only the tail appended should have gone through the highlighter
    const tailCall = codeToHtml.mock.calls[0][0];
    expect(tailCall).toBe('\n  return 1;\n}');
  });

  it('falls back to full re-highlight when language or theme changes', async () => {
    const { rerender } = render(
      <EnhancedShikiCodeBlock
        code="abc"
        language="typescript"
        theme="dark"
        isStreaming={true}
      />
    );
    await waitFor(() => expect(codeToHtml).toHaveBeenCalledTimes(1));
    codeToHtml.mockClear();
    rerender(
      <EnhancedShikiCodeBlock
        code="abc"
        language="javascript"
        theme="dark"
        isStreaming={true}
      />
    );
    await waitFor(() => expect(codeToHtml).toHaveBeenCalled());
    // Full re-highlight triggered by language flip → whole string sent
    expect(codeToHtml.mock.calls[0][0]).toBe('abc');
  });

  it('does final full re-highlight after stream closes', async () => {
    const { rerender } = render(
      <EnhancedShikiCodeBlock
        code="abc"
        language="typescript"
        theme="dark"
        isStreaming={true}
      />
    );
    await waitFor(() => expect(codeToHtml).toHaveBeenCalled());

    codeToHtml.mockClear();
    rerender(
      <EnhancedShikiCodeBlock
        code={'abc\nd'}
        language="typescript"
        theme="dark"
        isStreaming={false}
      />
    );
    await waitFor(() =>
      expect(
        codeToHtml.mock.calls.some(([c]) => c === 'abc\nd')
      ).toBe(true)
    );
    const root = screen.getByTestId('enhanced-shiki-code-block');
    expect(root.getAttribute('data-streaming')).toBe('false');
  });
});
