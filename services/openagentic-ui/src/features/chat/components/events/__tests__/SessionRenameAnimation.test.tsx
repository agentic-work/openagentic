/**
 * Phase H (task #153) — SessionRenameAnimation tests.
 *
 * Verifies the cross-fade morph: the component shows the OLD title
 * briefly then settles on the new one. Uses fake timers to keep the
 * test deterministic.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SessionRenameAnimation } from '../SessionRenameAnimation';

describe('SessionRenameAnimation', () => {
  it('renders the initial title with no morph', () => {
    render(<SessionRenameAnimation sessionId="s-1" title="New Chat" />);
    const current = screen.getByTestId('session-rename-current');
    expect(current.textContent).toBe('New Chat');
    // No morphing attribute on initial render.
    expect(
      screen.getByTestId('session-rename-animation').getAttribute('data-morphing'),
    ).toBeNull();
  });

  it('enters morph state when title changes, then settles', async () => {
    const { rerender } = render(
      <SessionRenameAnimation sessionId="s-2" title="New Chat" durationMs={50} />,
    );
    rerender(
      <SessionRenameAnimation
        sessionId="s-2"
        title="Kubernetes Health Review"
        durationMs={50}
      />,
    );
    // Mid-morph: data-morphing flag is set and the previous title renders.
    expect(
      screen.getByTestId('session-rename-animation').getAttribute('data-morphing'),
    ).toBe('true');
    expect(screen.getByTestId('session-rename-previous').textContent).toBe('New Chat');
    expect(screen.getByTestId('session-rename-current').textContent).toBe(
      'Kubernetes Health Review',
    );

    // Wait for the ~50ms morph window to clear. Re-query each poll
    // because React re-renders the DOM node with the new attribute set.
    await waitFor(
      () => {
        expect(
          screen.getByTestId('session-rename-animation').getAttribute('data-morphing'),
        ).toBeNull();
      },
      { timeout: 1000, interval: 25 },
    );
    expect(screen.queryByTestId('session-rename-previous')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-rename-current').textContent).toBe(
      'Kubernetes Health Review',
    );
  });

  it('does not morph when the title is reassigned to the same value', () => {
    const { rerender } = render(
      <SessionRenameAnimation sessionId="s-3" title="X" durationMs={50} />,
    );
    rerender(<SessionRenameAnimation sessionId="s-3" title="X" durationMs={50} />);
    expect(
      screen.getByTestId('session-rename-animation').getAttribute('data-morphing'),
    ).toBeNull();
  });
});
