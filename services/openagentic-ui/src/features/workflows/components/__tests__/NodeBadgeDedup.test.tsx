/**
 * NodeBadgeDedup — guards against the "two badges per node" regression
 * surfaced 2026-05-14 in flows-two-errors-fix.
 *
 * Before this guard, CustomNode rendered two separate badges keyed on the
 * same conditional (validation errors, execution errors), so any node with
 * stale validation errors or a failed run displayed TWO orange / red
 * pip badges in the same top-right corner.
 *
 * Rules enforced:
 *   1. Pre-execution validation errors → ONE orange "validation-warning-badge".
 *   2. Post-completion (successful run) → ZERO validation badges, regardless
 *      of stale config validation state. If the node ran, the warnings
 *      weren't blocking — surface them at edit time, not after a successful run.
 *   3. Failed run → ONE red exec badge (`wf-exec-badge`), NO duplicate
 *      `wf-error-badge` floating circle on top of it.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('reactflow', () => ({
  Handle: ({ type, position, id }: any) =>
    <div data-testid={`handle-${type}-${id || position}`} />,
  Position: { Left: 'Left', Right: 'Right', Top: 'Top', Bottom: 'Bottom' },
  useReactFlow: () => ({
    getNodes: () => [],
    addNodes: vi.fn(),
    deleteElements: vi.fn(),
    setNodes: vi.fn(),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/shared/icons', () => ({
  Trash2: () => <span>T2</span>,
  Copy: () => <span>CP</span>,
  Settings: () => <span>ST</span>,
  CheckCircle: () => <span data-testid="check-circle">v</span>,
  XCircle: () => <span data-testid="x-circle">x</span>,
  Clock: () => <span>CK</span>,
  AlertCircle: () => <span data-testid="alert-circle">!</span>,
  Play: () => <span>PL</span>,
}));

vi.mock('../../utils/nodeConfigs', () => ({
  nodeTypeConfigs: {
    transform: { label: 'Transform', color: '#06b6d4', icon: 'T', description: 'transform', category: 'logic' },
  },
}));

vi.mock('../nodes/nodeIcons', () => ({
  getNodeIcon: () => <span>icon</span>,
}));

import { CustomNode } from '../nodes/CustomNode';

function renderNode(data: Record<string, any>, nodeType = 'transform') {
  return render(
    <div style={{ position: 'relative', width: 260 }}>
      <CustomNode
        id="node-1"
        data={{ label: 'Test', ...data }}
        selected={false}
        type={nodeType}
        isConnectable
        xPos={0}
        yPos={0}
        zIndex={0}
        dragging={false}
      />
    </div>,
  );
}

/** Count badge dots: top-right absolute circle elements that render an
 *  error / warning indicator. We match any element whose data-testid /
 *  class identifies it as a top-corner status badge. */
function countWarningBadges(root: HTMLElement): number {
  const sel = [
    '[data-testid="validation-warning-badge"]',
    '.wf-validation-badge',
  ].join(',');
  return root.querySelectorAll(sel).length;
}

function countErrorBadges(root: HTMLElement): number {
  // wf-exec-badge with failed style is the keep; wf-error-badge is the cull.
  return root.querySelectorAll('.wf-error-badge').length;
}

function countExecBadges(root: HTMLElement): number {
  return root.querySelectorAll('.wf-exec-badge').length;
}

describe('CustomNode badge dedup (2026-05-14 regression)', () => {
  afterEach(cleanup);

  it('renders exactly ONE validation badge when validationErrors present and no execution', () => {
    const { container } = renderNode({
      validationErrors: [{ message: 'Missing transformType' }],
    });
    expect(countWarningBadges(container)).toBe(1);
  });

  it('renders ZERO validation badges after successful completion', () => {
    const { container } = renderNode({
      validationErrors: [{ message: 'Missing transformType' }],
      executionState: 'completed',
      executionOutput: { ok: true },
    });
    // After a successful run, do NOT keep yelling about stale config
    // warnings — if the node ran, the warning clearly wasn't blocking.
    expect(countWarningBadges(container)).toBe(0);
  });

  it('renders exactly ONE exec badge (and zero wf-error-badge) on failure', () => {
    const { container } = renderNode({
      executionState: 'failed',
      executionError: 'boom: connection refused',
    });
    expect(countExecBadges(container)).toBe(1);
    expect(countErrorBadges(container)).toBe(0);
  });

  it('does not stack validation + error badges when failed with stale validationErrors', () => {
    const { container } = renderNode({
      validationErrors: [{ message: 'Missing transformType' }],
      executionState: 'failed',
      executionError: 'transform threw',
    });
    // One exec badge for the failure; zero validation badges (failure takes priority).
    expect(countExecBadges(container)).toBe(1);
    expect(countWarningBadges(container)).toBe(0);
    expect(countErrorBadges(container)).toBe(0);
  });
});
