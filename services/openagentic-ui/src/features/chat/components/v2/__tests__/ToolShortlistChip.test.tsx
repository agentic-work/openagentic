/**
 * ToolShortlistChip — Wave 3 (#525) RED→GREEN contract.
 *
 * Per-message pill rendered in the assistant message header (next to or
 * in place of TierBadge / HandoffChip). Driven by the server-emitted
 * `tool_shortlist` NDJSON frame (Wave 2):
 *
 *   {
 *     type: 'tool_shortlist',
 *     total_available: number,
 *     count: number,
 *     intent: string,
 *     kept: string[],
 *   }
 *
 * Contract:
 *   - Renders pill labeled "<count> / <total_available> tools (<intent>)".
 *   - Click opens a small popover listing `kept` (up to 5) with
 *     "...and N more" when count > kept.length.
 *   - ESC closes the popover.
 *   - Renders nothing when totalAvailable === 0 (defensive — frame
 *     missing or pipeline misconfigured).
 *   - Trigger button has accessible name "Tool shortlist info".
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolShortlistChip } from '../ToolShortlistChip.js';

describe('ToolShortlistChip — Wave 3 per-message tool shortlist pill', () => {
  it('renders the count / total / intent string', () => {
    render(
      <ToolShortlistChip
        totalAvailable={276}
        count={30}
        intent="cloud-list"
        kept={['Bash', 'Read', 'Write', 'Edit', 'Glob']}
      />,
    );
    const chip = screen.getByTestId('tool-shortlist-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent(/30/);
    expect(chip).toHaveTextContent(/276/);
    expect(chip).toHaveTextContent(/cloud-list/);
    expect(chip).toHaveTextContent(/tools/i);
  });

  it('opens a popover on click listing the kept tool names', () => {
    render(
      <ToolShortlistChip
        totalAvailable={276}
        count={30}
        intent="cloud-list"
        kept={['Bash', 'Read', 'Write', 'Edit', 'Glob']}
      />,
    );
    // Popover not visible until click.
    expect(screen.queryByTestId('tool-shortlist-popover')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /tool shortlist info/i }));
    const pop = screen.getByTestId('tool-shortlist-popover');
    expect(pop).toBeInTheDocument();
    expect(pop).toHaveTextContent('Bash');
    expect(pop).toHaveTextContent('Read');
    expect(pop).toHaveTextContent('Write');
    expect(pop).toHaveTextContent('Edit');
    expect(pop).toHaveTextContent('Glob');
  });

  it('closes the popover on ESC', () => {
    render(
      <ToolShortlistChip
        totalAvailable={276}
        count={30}
        intent="cloud-list"
        kept={['Bash', 'Read']}
      />,
    );
    const btn = screen.getByRole('button', { name: /tool shortlist info/i });
    fireEvent.click(btn);
    expect(screen.getByTestId('tool-shortlist-popover')).toBeInTheDocument();
    // ESC closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('tool-shortlist-popover')).toBeNull();
  });

  it('renders nothing when totalAvailable === 0', () => {
    const { container } = render(
      <ToolShortlistChip
        totalAvailable={0}
        count={0}
        intent=""
        kept={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders "...and N more" when count > kept.length', () => {
    render(
      <ToolShortlistChip
        totalAvailable={276}
        count={30}
        intent="cloud-list"
        kept={['Bash', 'Read', 'Write', 'Edit', 'Glob']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /tool shortlist info/i }));
    const pop = screen.getByTestId('tool-shortlist-popover');
    // 30 - 5 = 25 more.
    expect(pop).toHaveTextContent(/25 more/i);
  });

  it('exposes accessible name "Tool shortlist info" on the trigger button', () => {
    render(
      <ToolShortlistChip
        totalAvailable={276}
        count={30}
        intent="cloud-list"
        kept={['Bash']}
      />,
    );
    const btn = screen.getByRole('button', { name: /tool shortlist info/i });
    expect(btn).toBeInTheDocument();
  });
});
