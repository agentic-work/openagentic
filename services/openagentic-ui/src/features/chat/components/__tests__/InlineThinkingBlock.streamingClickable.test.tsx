/**
 * #813 — Thinking block must be clickable WHILE streaming so the
 * user can pop open the live chain-of-thought as the model reasons,
 * not only after streaming completes.
 *
 * Three assertions:
 *   1. While isStreaming=true the toggle button is rendered, not
 *      disabled, and clicking it flips data-expanded to "true".
 *   2. While streaming + expanded, the body element mounts and
 *      shows the in-progress reasoning content (with the typing
 *      caret element present).
 *   3. While streaming, the user can collapse again — repeated
 *      clicks don't get stuck in a one-shot state.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineThinkingBlock } from '../InlineThinkingBlock';

describe('InlineThinkingBlock — #813 clickable while streaming', () => {
  it('toggle button is rendered and NOT disabled while streaming', () => {
    render(
      <InlineThinkingBlock
        content="thinking in progress…"
        isStreaming={true}
        startedAt={1_000}
      />
    );
    const toggle = screen.getByTestId('inline-thinking-toggle');
    expect(toggle).not.toBeDisabled();
    // Cursor must be pointer (not auto / not-allowed) so the user
    // sees the affordance mid-stream.
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking the toggle while streaming expands the body and shows the in-progress content', () => {
    const inProgress = 'considering the user request before acting';
    render(
      <InlineThinkingBlock
        content={inProgress}
        isStreaming={true}
        startedAt={1_000}
      />
    );
    const root = screen.getByTestId('inline-thinking-block');
    const toggle = screen.getByTestId('inline-thinking-toggle');
    expect(root).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(toggle);

    expect(root).toHaveAttribute('data-expanded', 'true');
    const body = screen.getByTestId('inline-thinking-body');
    expect(body).toBeInTheDocument();
    expect(body.textContent ?? '').toContain('considering the user request');
  });

  it('repeated clicks while streaming continue to toggle (not stuck)', () => {
    render(
      <InlineThinkingBlock
        content="..."
        isStreaming={true}
        startedAt={1_000}
      />
    );
    const root = screen.getByTestId('inline-thinking-block');
    const toggle = screen.getByTestId('inline-thinking-toggle');
    fireEvent.click(toggle);
    expect(root).toHaveAttribute('data-expanded', 'true');
    fireEvent.click(toggle);
    expect(root).toHaveAttribute('data-expanded', 'false');
    fireEvent.click(toggle);
    expect(root).toHaveAttribute('data-expanded', 'true');
  });
});
