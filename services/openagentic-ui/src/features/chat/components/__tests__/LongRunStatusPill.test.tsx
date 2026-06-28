/**
 * LongRunStatusPill — Sev-1 #923
 *
 * For long-running prompts (multi-minute capstone drives), the ThinkingSphere
 * at the assistant message header scrolls out of view. Users have no way to
 * tell whether the agent is still working. This component lives INSIDE the
 * composer container (NOT floating) and surfaces a "still working" pill with
 * model, elapsed time, output tokens, and status — but ONLY after 30s into a
 * stream, so it does not appear for typical sub-30s responses.
 *
 * Theme-token compliant: var(--cm-*) only. CLAUDE.md rule 8(b).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LongRunStatusPill } from '../LongRunStatusPill';

describe('LongRunStatusPill (Sev-1 #923 long-run progress indicator)', () => {
  it('renders nothing when isStreaming=false', () => {
    const { container } = render(
      <LongRunStatusPill isStreaming={false} streamStartedAt={null} />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('long-run-status-pill')).toBeNull();
  });

  it('renders nothing during the first 30s of a stream (avoid noise on short responses)', () => {
    const { container } = render(
      <LongRunStatusPill
        isStreaming={true}
        streamStartedAt={Date.now() - 10_000}
        modelLabel="Sonnet 4.6"
        outputTokens={120}
      />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('long-run-status-pill')).toBeNull();
  });

  it('renders the pill with model, elapsed time, and token count after 30s', () => {
    render(
      <LongRunStatusPill
        isStreaming={true}
        streamStartedAt={Date.now() - 35_000}
        modelLabel="Sonnet 4.6"
        outputTokens={396}
      />
    );
    const pill = screen.getByTestId('long-run-status-pill');
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toContain('Sonnet 4.6');
    // mm:ss elapsed formatting — ~0:35 (allow a 1-2s timing wobble in CI)
    expect(pill.textContent).toMatch(/0:3[4-7]/);
    expect(pill.textContent).toContain('396');
  });

  it('disappears immediately when isStreaming flips to false', () => {
    const startedAt = Date.now() - 60_000;
    const { rerender, container } = render(
      <LongRunStatusPill
        isStreaming={true}
        streamStartedAt={startedAt}
        modelLabel="Sonnet 4.6"
        outputTokens={500}
      />
    );
    expect(screen.getByTestId('long-run-status-pill')).toBeInTheDocument();
    rerender(
      <LongRunStatusPill
        isStreaming={false}
        streamStartedAt={startedAt}
        modelLabel="Sonnet 4.6"
        outputTokens={500}
      />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('long-run-status-pill')).toBeNull();
  });
});
