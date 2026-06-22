/**
 * Sev-0 #3 (Q1 live drive 2026-05-15) — "fail huge tool group call wasting
 * space inline MASSIVE fail". Followed by Slice B (Q12 live drive
 * 2026-05-16) which lowered the cluster collapse threshold from N>=3 to
 * N>=2 and standardised the outer testid as `tool-cluster`.
 *
 * Contract pinned by this test (current — Slice B):
 *   - 1 tool, streaming      → EXPANDED  (single ToolCard inline)
 *   - 2 tools, streaming     → COLLAPSED (cluster, click header to expand)
 *   - 3 tools, streaming     → COLLAPSED
 *   - 4 tools, streaming     → COLLAPSED (the Q1 live-drive shape)
 *   - 5+ tools, streaming    → COLLAPSED
 *   - historical (any count) → COLLAPSED
 *
 * Detection: the grid element with data-testid="parallel-tool-group-grid"
 * is rendered ONLY when isExpanded is true. The outer root carries
 * `tool-cluster` when blocks.length >= 2 (Slice B) and the legacy
 * `parallel-tool-group` only when blocks.length === 1.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolCallGroup } from '../ToolCallGroup';
import type { ContentBlock } from '../../AgenticActivityStream/types/activity.types';

function makeBlock(i: number, opts: { complete?: boolean } = {}): ContentBlock {
  return {
    id: `block-${i}`,
    type: 'tool_use',
    timestamp: 1000 + i,
    content: '',
    isComplete: opts.complete ?? false,
    toolId: `tool-${i}`,
    toolName: `azure_list_thing_${i}`,
    toolCallRound: 1,
    parallelSlotIndex: i,
  };
}

function makeBlocks(n: number, opts: { complete?: boolean } = {}): ContentBlock[] {
  return Array.from({ length: n }, (_, i) => makeBlock(i, opts));
}

describe('ToolCallGroup cluster collapse threshold (Slice B 2026-05-16)', () => {
  it('2 tools streaming → COLLAPSED (cluster, Slice B threshold)', () => {
    const { container } = render(
      <ToolCallGroup blocks={makeBlocks(2)} isStreaming isHistorical={false} />,
    );
    expect(container.querySelector('[data-testid="parallel-tool-group-grid"]')).not.toBeInTheDocument();
  });

  it('3 tools streaming → COLLAPSED', () => {
    const { container } = render(
      <ToolCallGroup blocks={makeBlocks(3)} isStreaming isHistorical={false} />,
    );
    expect(container.querySelector('[data-testid="parallel-tool-group-grid"]')).not.toBeInTheDocument();
  });

  it('4 tools streaming → COLLAPSED (the Q1 live-drive shape)', () => {
    const { container } = render(
      <ToolCallGroup blocks={makeBlocks(4)} isStreaming isHistorical={false} />,
    );
    expect(container.querySelector('[data-testid="parallel-tool-group-grid"]')).not.toBeInTheDocument();
  });

  it('5 tools streaming → COLLAPSED (existing contract preserved)', () => {
    const { container } = render(
      <ToolCallGroup blocks={makeBlocks(5)} isStreaming isHistorical={false} />,
    );
    expect(container.querySelector('[data-testid="parallel-tool-group-grid"]')).not.toBeInTheDocument();
  });

  it('19 tools streaming → COLLAPSED (existing contract preserved)', () => {
    const { container } = render(
      <ToolCallGroup blocks={makeBlocks(19)} isStreaming isHistorical={false} />,
    );
    expect(container.querySelector('[data-testid="parallel-tool-group-grid"]')).not.toBeInTheDocument();
  });

  it('historical batch (any count) → COLLAPSED (existing contract preserved)', () => {
    const { container } = render(
      <ToolCallGroup blocks={makeBlocks(4, { complete: true })} isHistorical />,
    );
    expect(container.querySelector('[data-testid="parallel-tool-group-grid"]')).not.toBeInTheDocument();
  });

  it('header always renders so user can expand on demand', () => {
    const { container } = render(
      <ToolCallGroup blocks={makeBlocks(4)} isStreaming isHistorical={false} />,
    );
    // Slice B: cluster root carries `tool-cluster`; header carries
    // `tool-cluster-header`. Legacy `parallel-tool-group-header` chip is
    // still rendered above the grid when blocks.length > 1.
    expect(container.querySelector('[data-testid="tool-cluster"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="tool-cluster-header"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="parallel-tool-group-header"]')).toBeInTheDocument();
  });
});
