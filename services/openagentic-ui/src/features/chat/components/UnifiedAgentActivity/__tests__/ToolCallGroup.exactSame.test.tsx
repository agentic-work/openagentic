/**
 * Stream ≡ final-render invariant (CLAUDE.md rule 8a + user direction
 * 2026-05-17 PM: "stream and finished result have to be EXACTLY THE SAME").
 *
 * Per the user's repeated standing direction, the rendered DOM during
 * streaming and at finalize must be IDENTICAL in shape — no collapse
 * transition from "individual tool cards expanded" → "cluster summary
 * with children hidden" when the second tool arrives mid-stream. This
 * overrides the prior auto-collapse contract pinned by
 * `ToolCallGroup.collapse.test.tsx` (the old test pinned `isExpanded =
 * false` by default for 2+ tool clusters; the user has now reversed
 * that direction).
 *
 * The cluster wrapper (header + collapse-by-click affordance) STAYS,
 * but the default state is EXPANDED so children render at all times
 * unless the user manually clicks the header to collapse. Stored state
 * (sessionStorage) still wins so manual collapse persists per session.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgenticActivityStream from '../../AgenticActivityStream/AgenticActivityStream';
import type { ContentBlock } from '../../../hooks/useChatStream';

const mkToolBlock = (over: Partial<ContentBlock> & { id: string; toolName: string }): ContentBlock => ({
  index: 0,
  type: 'tool_use',
  content: '',
  isComplete: true,
  toolId: over.id,
  timestamp: 1_700_000_000_000,
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
});

describe('Stream ≡ final-render invariant — tool clusters default EXPANDED', () => {
  it('two consecutive tool_use → cluster exists AND children visible by default', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query' }),
          mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer' }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const cluster = root.querySelector('[data-testid="tool-cluster"]')!;
    expect(cluster, 'cluster wrapper must exist for 2+ tools').not.toBeNull();
    // Children MUST render by default. The prior contract hid them and
    // required a click to reveal; the new contract under user direction
    // 2026-05-17 PM keeps them visible.
    const visibleChildren = cluster.querySelectorAll('[data-testid="tool-card"]');
    expect(visibleChildren.length, 'tool-card children must render by default in cluster').toBe(2);
  });

  it('four consecutive tool_use → cluster exists AND all 4 children visible', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query' }),
          mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer' }),
          mkToolBlock({ id: 't-3', index: 2, toolName: 'gcp_cost_query' }),
          mkToolBlock({ id: 't-4', index: 3, toolName: 'azure_advisor_recommendations' }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const cluster = root.querySelector('[data-testid="tool-cluster"]')!;
    const visibleChildren = cluster.querySelectorAll('[data-testid="tool-card"]');
    expect(visibleChildren.length, 'all 4 tool-card children must render by default').toBe(4);
  });

  it('mid-stream: 2 tools where 1 still running — both visible (no flip on completion)', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={true}
        streamingState="streaming"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query', isComplete: true }),
          mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer', isComplete: false }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const cluster = root.querySelector('[data-testid="tool-cluster"]')!;
    const visibleChildren = cluster.querySelectorAll('[data-testid="tool-card"]');
    expect(visibleChildren.length, 'mid-stream: both children must be visible').toBe(2);
  });
});
