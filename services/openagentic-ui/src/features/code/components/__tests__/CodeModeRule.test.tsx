import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { CodeModeRule } from '../CodeModeRule';

afterEach(() => cleanup());

describe('CodeModeRule', () => {
  it('renders all primary signals: pill, tok, cost, elapsed, model, cwd', () => {
    const startedAt = Date.now() - 75 * 1000; // 1m 15s ago
    const { container } = render(
      <CodeModeRule
        model="claude-sonnet-4-6"
        cwd="scratch/url-shortener"
        contextTokens={22418}
        totalCostUsd={0.281}
        sessionStartedAt={startedAt}
        isStreaming
        error={null}
      />,
    );

    const root = container.querySelector('[data-testid="cm-rule"]');
    expect(root).not.toBeNull();
    expect(root?.classList.contains('cm-rule')).toBe(true);
    expect(root?.getAttribute('data-pill')).toBe('thinking');

    const pill = container.querySelector('[data-testid="cm-rule-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent || '').toMatch(/THINKING/);

    expect(container.querySelector('[data-testid="cm-rule-tok"]')?.textContent || '').toMatch(
      /22[,.]?418\s*tok/,
    );
    expect(container.querySelector('[data-testid="cm-rule-cost"]')?.textContent || '').toMatch(
      /\$0\.28/,
    );
    expect(container.querySelector('[data-testid="cm-rule-elapsed"]')?.textContent || '').toMatch(
      /1m\s*\d+s\s*elapsed/,
    );
    expect(container.querySelector('[data-testid="cm-rule-model"]')?.textContent || '').toBe(
      'claude-sonnet-4-6',
    );
    expect(container.querySelector('[data-testid="cm-rule-cwd"]')?.textContent || '').toMatch(
      /workspace:\s*scratch\/url-shortener/,
    );
  });

  it('switches pill class to "ready" when not streaming and no error', () => {
    const { container } = render(
      <CodeModeRule model="m" cwd="c" isStreaming={false} error={null} />,
    );
    const root = container.querySelector('[data-testid="cm-rule"]');
    expect(root?.getAttribute('data-pill')).toBe('ready');
    const pill = container.querySelector('[data-testid="cm-rule-pill"]');
    expect(pill?.textContent || '').toMatch(/READY/);
  });

  it('switches pill class to "error" when error is set', () => {
    const { container } = render(
      <CodeModeRule model="m" cwd="c" isStreaming={false} error="something broke" />,
    );
    const root = container.querySelector('[data-testid="cm-rule"]');
    expect(root?.getAttribute('data-pill')).toBe('error');
  });

  it('hides when hideWhenEmpty=true and no signals are set', () => {
    const { container } = render(<CodeModeRule hideWhenEmpty />);
    expect(container.querySelector('[data-testid="cm-rule"]')).toBeNull();
  });
});
