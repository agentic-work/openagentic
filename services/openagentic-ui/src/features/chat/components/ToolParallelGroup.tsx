/**
 * Wire-in D (#82) — render container for a tool_round ContentBlock.
 *
 * The chat pipeline emits tool_round_start → N x tool_executing → N x
 * tool_complete → tool_round_end NDJSON envelopes around every parallel
 * fan-out batch. useChatStream groups them into a single tool_round
 * block whose children[] carry the individual tool_use blocks. This
 * component renders the .cw-tool-parallel container (per the mock
 * `docs/release-plans/v0.6.7-ux-mockups/01-cloud-ops.html`) with a
 * header that flips from a live "Running N tools in parallel…" counter
 * to a complete "N succeeded · M failed · Xms" breakdown once the
 * matching tool_round_end lands.
 *
 * Children are rendered by the caller-provided renderer so we don't
 * diverge from the existing per-tool card style (ToolCallCard + friends).
 * A minimal fallback renderer stamps a stable data-testid so the render
 * test can count children via `.cw-tool-parallel-children > *` without
 * pulling in the AgenticActivityStream tree.
 *
 * A11y: the outer div is marked role="group" with an aria-label that
 * reflects the current round state ("Parallel tool round: N tools
 * running" → "Parallel tool round: X succeeded, Y failed"), and the
 * header carries aria-live="polite" so screen readers announce the
 * transition from running → complete.
 */

import React from 'react';
import type { ContentBlock, ToolRoundBlock } from '../hooks/useChatStream';
import './ToolParallelGroup.css';

export interface ToolParallelGroupProps {
  block: ToolRoundBlock;
  /**
   * Per-child renderer. The activity-stream wiring passes its existing
   * per-block renderer so the visual style stays identical to the
   * top-level (non-parallel) path. Omitted in unit tests — a default
   * "cw-tool-parallel-child" placeholder is rendered instead so the
   * DOM shape stays assertable.
   */
  renderChild?: (child: ContentBlock, index: number) => React.ReactNode;
}

const defaultRenderChild = (child: ContentBlock): React.ReactNode => (
  <div
    key={child.id}
    className="cw-tool-parallel-child"
    data-tool-name={child.toolName}
    data-tool-id={child.toolId}
    data-tool-status={child.isComplete ? (child.error ? 'error' : 'success') : 'running'}
  >
    <span className="t-name">{child.toolName || 'tool'}</span>
  </div>
);

export const ToolParallelGroup: React.FC<ToolParallelGroupProps> = ({
  block,
  renderChild = defaultRenderChild,
}) => {
  const children = block.children ?? [];
  const headerText = block.isComplete
    ? `${block.succeeded ?? 0} succeeded · ${block.failed ?? 0} failed · ${block.durationMs ?? 0}ms`
    : `Running ${children.length} tools in parallel…`;
  const ariaLabel = block.isComplete
    ? `Parallel tool round: ${block.succeeded ?? 0} succeeded, ${block.failed ?? 0} failed`
    : `Parallel tool round: ${children.length} tools running`;

  return (
    <div
      className="cw-tool-parallel"
      data-round-id={block.roundId}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="cw-tool-parallel-header" aria-live="polite">
        {headerText}
      </div>
      <div className="cw-tool-parallel-children">
        {children.map((child, i) => (
          <React.Fragment key={child.id}>{renderChild(child, i)}</React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ToolParallelGroup;
