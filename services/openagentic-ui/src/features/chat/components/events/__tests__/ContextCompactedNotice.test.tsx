/**
 * Phase H (task #153) — ContextCompactedNotice render tests.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContextCompactedNotice } from '../ContextCompactedNotice';

describe('ContextCompactedNotice', () => {
  it('renders tokens freed + messages summarized', () => {
    render(
      <ContextCompactedNotice
        tokensFreed={12847}
        messagesRemoved={14}
        messagesSummarized={14}
        compactionLevel="medium"
      />
    );
    const el = screen.getByTestId('context-compacted-notice');
    expect(el.getAttribute('data-tokens-freed')).toBe('12847');
    expect(el.getAttribute('data-messages-removed')).toBe('14');
    expect(el.textContent).toMatch(/Trimmed/);
    // formatTokens rounds >=10k to integer k — 12847 → "13k".
    expect(el.textContent).toMatch(/13k/);
    expect(el.textContent).toMatch(/14 messages summarized/);
  });

  it('falls back to "messages trimmed" when nothing is summarized', () => {
    render(
      <ContextCompactedNotice
        tokensFreed={5000}
        messagesRemoved={5}
      />
    );
    expect(screen.getByTestId('context-compacted-notice').textContent).toMatch(/5 messages trimmed/);
  });

  it('formats small token counts literally (under 1000)', () => {
    render(
      <ContextCompactedNotice
        tokensFreed={423}
        messagesRemoved={2}
      />
    );
    expect(screen.getByTestId('context-compacted-notice').textContent).toMatch(/423 tokens/);
  });

  it('includes tooltip when reason + level supplied', () => {
    render(
      <ContextCompactedNotice
        tokensFreed={3000}
        messagesRemoved={3}
        reason="budget_85_percent"
        compactionLevel="light"
        tokensBefore={20000}
        tokensAfter={17000}
      />
    );
    const el = screen.getByTestId('context-compacted-notice');
    const title = el.getAttribute('title') || '';
    expect(title).toContain('budget_85_percent');
    expect(title).toContain('light');
    expect(title).toContain('20k');
    expect(title).toContain('17k');
  });
});
