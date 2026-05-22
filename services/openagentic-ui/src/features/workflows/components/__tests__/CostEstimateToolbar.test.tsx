/**
 * Cost-estimate badge integration into WorkflowToolbar — TDD
 *
 * Iron law: failing test first, watched fail, minimal impl, watch pass.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/shared/icons', () => ({
  Play: () => <span>PL</span>,
  Save: () => <span>SV</span>,
  ArrowLeft: () => <span>AL</span>,
  Grid3x3: () => <span>G3</span>,
  Zap: () => <span>ZP</span>,
  Share2: () => <span>SH</span>,
  Sparkles: () => <span>SP</span>,
  RotateCw: () => <span>RT</span>,
  AlertCircle: () => <span>!</span>,
  CheckCircle: () => <span>CV</span>,
  Clock: () => <span>CK</span>,
  Pause: () => <span>||</span>,
  Square: () => <span>[]</span>,
  RefreshCw: () => <span>RW</span>,
}));

afterEach(() => cleanup());

import { WorkflowToolbar } from '../toolbar/WorkflowToolbar';

const baseProps = {
  workflowName: 'Test Flow',
  onNameChange: vi.fn(),
  nodeCount: 2,
  edgeCount: 1,
  showPalette: false,
  onTogglePalette: vi.fn(),
  isSaving: false,
  isExecuting: false,
  saveStatus: 'idle' as const,
  canExecute: true,
  onSave: vi.fn(),
  onExecute: vi.fn(),
};

describe('WorkflowToolbar cost-estimate integration — TDD', () => {
  it('RED: renders the cost-estimate badge when costEstimate is supplied', () => {
    const costEstimate = {
      totalUsd: 0.18,
      perNode: [{ nodeId: 'a', estimatedUsd: 0.18, agentCount: 1, usedFallbackRate: false }],
      ratesLoaded: true,
      hasFallbackRates: false,
      hasUnknownIterations: false,
    };
    render(<WorkflowToolbar {...baseProps} costEstimate={costEstimate as any} />);
    const badge = screen.getByTestId('cost-estimate-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('$0.18');
  });

  it('RED: omits the badge when costEstimate is null', () => {
    render(<WorkflowToolbar {...baseProps} />);
    expect(screen.queryByTestId('cost-estimate-badge')).toBeNull();
  });
});
