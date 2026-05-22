/**
 * P1 + P2 — Pause, Resume, Cancel toolbar buttons
 *
 * P1. Pause button visible when running, becomes Resume when paused.
 * P2. Cancel button visible when running or paused; shows confirmation dialog.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── Mocks ─────────────────────────────────────────────────────────────── */

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
  Pause: () => <span data-testid="pause-icon">||</span>,
  Square: () => <span data-testid="cancel-icon">[]</span>,
  RefreshCw: () => <span data-testid="resume-icon">RW</span>,
}));

/* ── Component under test ───────────────────────────────────────────────── */
import { WorkflowToolbar } from '../toolbar/WorkflowToolbar';

/* ── Shared props helper ─────────────────────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════════════════
   P1 — Pause / Resume button
   ═══════════════════════════════════════════════════════════════════════ */

describe('P1 – Pause / Resume button', () => {
  afterEach(cleanup);

  it('Pause button is NOT visible when executionState is idle', () => {
    render(<WorkflowToolbar {...baseProps} executionState="idle" onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('workflow-pause-button')).not.toBeInTheDocument();
  });

  it('Pause button IS visible when executionState is running', () => {
    render(<WorkflowToolbar {...baseProps} executionState="running" onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('workflow-pause-button')).toBeInTheDocument();
  });

  it('clicking Pause button calls onPause()', () => {
    const onPause = vi.fn();
    render(<WorkflowToolbar {...baseProps} executionState="running" onPause={onPause} onResume={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('workflow-pause-button'));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('shows Resume button (not Pause) when executionState is paused', () => {
    const onResume = vi.fn();
    render(<WorkflowToolbar {...baseProps} executionState="paused" onPause={vi.fn()} onResume={onResume} onCancel={vi.fn()} />);
    expect(screen.getByTestId('workflow-resume-button')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-pause-button')).not.toBeInTheDocument();
  });

  it('clicking Resume calls onResume()', () => {
    const onResume = vi.fn();
    render(<WorkflowToolbar {...baseProps} executionState="paused" onPause={vi.fn()} onResume={onResume} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('workflow-resume-button'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   P2 — Cancel button + confirmation dialog
   ═══════════════════════════════════════════════════════════════════════ */

describe('P2 – Cancel button', () => {
  afterEach(cleanup);

  it('Cancel button is NOT visible when executionState is idle', () => {
    render(<WorkflowToolbar {...baseProps} executionState="idle" onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('workflow-cancel-button')).not.toBeInTheDocument();
  });

  it('Cancel button is visible when executionState is running', () => {
    render(<WorkflowToolbar {...baseProps} executionState="running" onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('workflow-cancel-button')).toBeInTheDocument();
  });

  it('Cancel button is visible when executionState is paused', () => {
    render(<WorkflowToolbar {...baseProps} executionState="paused" onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('workflow-cancel-button')).toBeInTheDocument();
  });

  it('clicking Cancel shows a confirmation dialog', () => {
    render(<WorkflowToolbar {...baseProps} executionState="running" onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('workflow-cancel-button'));
    expect(screen.getByTestId('cancel-confirm-dialog')).toBeInTheDocument();
  });

  it('confirming in dialog calls onCancel()', () => {
    const onCancel = vi.fn();
    render(<WorkflowToolbar {...baseProps} executionState="running" onPause={vi.fn()} onResume={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('workflow-cancel-button'));
    fireEvent.click(screen.getByTestId('cancel-confirm-ok'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('dismissing confirmation dialog does NOT call onCancel()', () => {
    const onCancel = vi.fn();
    render(<WorkflowToolbar {...baseProps} executionState="running" onPause={vi.fn()} onResume={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('workflow-cancel-button'));
    fireEvent.click(screen.getByTestId('cancel-confirm-dismiss'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cancel-confirm-dialog')).not.toBeInTheDocument();
  });
});
