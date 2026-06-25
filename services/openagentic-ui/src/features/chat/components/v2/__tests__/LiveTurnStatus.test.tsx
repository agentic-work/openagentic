/**
 * LiveTurnStatus — codemode-pattern strip for chatmode (AC, 2026-05-08)
 *
 * Mirrors openagentic/src/components/Spinner/SpinnerAnimationRow.tsx — the
 * `(elapsed · ↓ tokens · activity)` line that ticks during a turn.
 *
 * Format SoT (codemode):
 *   `(1m 23s · ↓ 1,247 tokens · thinking)`
 *
 * Chatmode adaptation: split arrows so we show ↑ input AND ↓ output, plus a
 * one-line activity summary so the user can see WHAT the model is doing
 * (e.g. "Calling tool azure_list_resource_groups").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LiveTurnStatus } from '../LiveTurnStatus';

describe('LiveTurnStatus — live time + token strip (codemode pattern)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders elapsed seconds + ticks once per second', () => {
    render(
      <LiveTurnStatus
        turnStartedAt={Date.now() - 7_500}
        firstTokenAt={null}
        tokensIn={0}
        tokensOut={0}
        activitySummary="thinking"
        isStreaming={true}
      />,
    );
    // 7.5s elapsed shows as "7s"
    expect(screen.getByTestId('live-turn-elapsed')).toHaveTextContent(/7s/);

    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByTestId('live-turn-elapsed')).toHaveTextContent(/9s/);
  });

  it('formats minutes+seconds when elapsed > 60s', () => {
    render(
      <LiveTurnStatus
        turnStartedAt={Date.now() - 95_000}
        firstTokenAt={null}
        tokensIn={0}
        tokensOut={0}
        activitySummary="thinking"
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('live-turn-elapsed')).toHaveTextContent(/1m 35s/);
  });

  it('renders ↑ tokensIn and ↓ tokensOut with comma thousands', () => {
    render(
      <LiveTurnStatus
        turnStartedAt={Date.now() - 1000}
        firstTokenAt={Date.now() - 500}
        tokensIn={2543}
        tokensOut={1247}
        activitySummary="generating"
        isStreaming={true}
      />,
    );
    const tokens = screen.getByTestId('live-turn-tokens');
    expect(tokens.textContent).toMatch(/↑/);
    expect(tokens.textContent).toMatch(/2,543/);
    expect(tokens.textContent).toMatch(/↓/);
    expect(tokens.textContent).toMatch(/1,247/);
  });

  it('shows a "first token in" badge when firstTokenAt is set during streaming', () => {
    render(
      <LiveTurnStatus
        turnStartedAt={Date.now() - 3_500}
        firstTokenAt={Date.now() - 1_500}
        tokensIn={0}
        tokensOut={42}
        activitySummary="generating"
        isStreaming={true}
      />,
    );
    // 3.5s - 1.5s = 2.0s → "first token in 2.0s" or similar
    expect(screen.getByTestId('live-turn-ttft').textContent).toMatch(/2\.0s|2\.00s/);
  });

  it('renders activity summary verbatim', () => {
    render(
      <LiveTurnStatus
        turnStartedAt={Date.now()}
        firstTokenAt={null}
        tokensIn={0}
        tokensOut={0}
        activitySummary="Calling tool: azure_list_resource_groups"
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('live-turn-activity')).toHaveTextContent(
      'Calling tool: azure_list_resource_groups',
    );
  });

  it('stops ticking once isStreaming flips to false (final summary stays)', () => {
    const { rerender } = render(
      <LiveTurnStatus
        turnStartedAt={Date.now() - 12_000}
        firstTokenAt={Date.now() - 10_500}
        tokensIn={120}
        tokensOut={400}
        activitySummary="generating"
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('live-turn-elapsed')).toHaveTextContent(/12s/);

    // Now flip to !isStreaming — ticking should freeze, label survives.
    rerender(
      <LiveTurnStatus
        turnStartedAt={Date.now() - 12_000}
        firstTokenAt={Date.now() - 10_500}
        tokensIn={120}
        tokensOut={400}
        activitySummary="done"
        isStreaming={false}
      />,
    );
    act(() => { vi.advanceTimersByTime(5_000); });
    // Should still display the final 12s (frozen at !isStreaming).
    expect(screen.getByTestId('live-turn-elapsed')).toHaveTextContent(/12s/);
  });

  it('renders nothing when turnStartedAt is null', () => {
    const { container } = render(
      <LiveTurnStatus
        turnStartedAt={null}
        firstTokenAt={null}
        tokensIn={0}
        tokensOut={0}
        activitySummary=""
        isStreaming={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
