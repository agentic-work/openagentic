/**
 * Wire-in D (#82) — render specs for the .tool-parallel group container.
 *
 *   1. A tool_round block with 3 children produces exactly one .cw-tool-parallel
 *      element with 3 child tool cards in .cw-tool-parallel-children.
 *   2. Header text for an incomplete round is "Running N tools in parallel…".
 *   3. Header text for a complete round shows "succeeded · failed · Xms".
 *   4. Container has role="group" and an aria-label describing the round state.
 *   5. Header has aria-live="polite" so screen readers announce transitions.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolParallelGroup } from '../ToolParallelGroup';
import type { ToolRoundBlock, ContentBlock } from '../../hooks/useChatStream';

const mkChild = (toolName: string, slot: number): ContentBlock => ({
  id: `child-${toolName}`,
  index: slot,
  type: 'tool_use',
  content: '',
  isComplete: false,
  toolName,
  toolId: `call-${toolName}`,
  startTime: 1_700_000_000_000 + slot,
});

const mkRound = (over: Partial<ToolRoundBlock> = {}): ToolRoundBlock => ({
  id: 'round-1',
  index: 0,
  type: 'tool_round',
  content: '',
  roundId: 'r-1',
  toolIds: [],
  children: [],
  isComplete: false,
  startTime: 1_700_000_000_000,
  ...over,
});

describe('ToolParallelGroup — Wire-in D (#82)', () => {
  it('renders one .cw-tool-parallel element with N child tool cards', () => {
    const round = mkRound({
      children: [mkChild('a', 0), mkChild('b', 1), mkChild('c', 2)],
    });
    const { container } = render(<ToolParallelGroup block={round} />);

    const groups = container.querySelectorAll('.cw-tool-parallel');
    expect(groups).toHaveLength(1);
    expect(groups[0].getAttribute('data-round-id')).toBe('r-1');

    const children = container.querySelectorAll(
      '.cw-tool-parallel > .cw-tool-parallel-children > *'
    );
    expect(children).toHaveLength(3);
  });

  it('shows "Running N tools in parallel…" for an incomplete round', () => {
    const round = mkRound({
      isComplete: false,
      children: [mkChild('x', 0), mkChild('y', 1)],
    });
    const { container } = render(<ToolParallelGroup block={round} />);
    const hdr = container.querySelector('.cw-tool-parallel-header');
    expect(hdr).not.toBeNull();
    expect(hdr!.textContent).toMatch(/Running 2 tools in parallel/);
  });

  it('shows "succeeded · failed · Xms" for a complete round', () => {
    const round = mkRound({
      isComplete: true,
      succeeded: 3,
      failed: 1,
      durationMs: 874,
      children: [
        mkChild('a', 0),
        mkChild('b', 1),
        mkChild('c', 2),
        mkChild('d', 3),
      ],
    });
    const { container } = render(<ToolParallelGroup block={round} />);
    const hdr = container.querySelector('.cw-tool-parallel-header');
    expect(hdr).not.toBeNull();
    const txt = hdr!.textContent ?? '';
    expect(txt).toMatch(/3 succeeded/);
    expect(txt).toMatch(/1 failed/);
    expect(txt).toMatch(/874ms/);
  });

  it('container has role="group" and an aria-label describing the round state', () => {
    const round = mkRound({
      isComplete: false,
      children: [mkChild('a', 0), mkChild('b', 1)],
    });
    const { container } = render(<ToolParallelGroup block={round} />);
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('aria-label')).toMatch(
      /Parallel tool round: 2 tools running/
    );
  });

  it('header has aria-live="polite" so screen readers announce transitions', () => {
    const round = mkRound({
      children: [mkChild('a', 0)],
    });
    const { container } = render(<ToolParallelGroup block={round} />);
    const hdr = container.querySelector('.cw-tool-parallel-header');
    expect(hdr).not.toBeNull();
    expect(hdr!.getAttribute('aria-live')).toBe('polite');
  });
});
