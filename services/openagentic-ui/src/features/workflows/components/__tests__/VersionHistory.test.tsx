/**
 * R9-R14: Version History surface tests
 *
 * R9.  WorkflowToolbar has a "History" button
 * R10. Clicking it opens a panel listing WorkflowVersion rows (timestamp, author, changelog)
 * R11. Each row has "Compare" + "Restore" buttons
 * R12. "Restore" prompts confirmation then calls restoreVersion API
 * R13. Save button prompts for optional changelog message
 * R14. 5+ test cases
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── Mocks ─────────────────────────────────────────────────────────── */

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
  CheckCircle: () => <span>✓</span>,
  Clock: () => <span data-testid="clock-icon">🕐</span>,
  History: () => <span data-testid="history-icon">H</span>,
  X: () => <span>X</span>,
  ChevronLeft: () => <span>&lt;</span>,
  GitBranch: () => <span>GB</span>,
  ArrowRight: () => <span>&gt;</span>,
  RotateCcw: () => <span>RC</span>,
  Plus: () => <span>+</span>,
  Minus: () => <span>-</span>,
  Edit: () => <span>E</span>,
  ChevronDown: () => <span>v</span>,
  ChevronRight: () => <span>&gt;</span>,
}));

/* ── Import components under test ───────────────────────────────────── */
import { WorkflowToolbar } from '../toolbar/WorkflowToolbar';
import { VersionHistoryPanel } from '../VersionHistoryPanel';

/* ── Sample data ─────────────────────────────────────────────────────── */

const SAMPLE_VERSIONS = [
  {
    id: 'v3',
    workflowId: 'wf-1',
    version: 3,
    changelog: 'Added HTTP node for external API call',
    createdAt: '2026-04-25T10:30:00Z',
    createdBy: 'alice@example.com',
    isActive: true,
    definition: { nodes: [], edges: [] },
  },
  {
    id: 'v2',
    workflowId: 'wf-1',
    version: 2,
    changelog: 'Fixed prompt template',
    createdAt: '2026-04-24T14:00:00Z',
    createdBy: 'bob@example.com',
    isActive: false,
    definition: { nodes: [], edges: [] },
  },
  {
    id: 'v1',
    workflowId: 'wf-1',
    version: 1,
    changelog: 'Initial version',
    createdAt: '2026-04-23T09:00:00Z',
    createdBy: 'alice@example.com',
    isActive: false,
    definition: { nodes: [], edges: [] },
  },
];

/* ═══════════════════════════════════════════════════════════════════════
   R9 — WorkflowToolbar has a "History" button
   ═══════════════════════════════════════════════════════════════════════ */

describe('R9 – WorkflowToolbar History button', () => {
  afterEach(cleanup);

  it('renders a History button when onShowHistory prop is provided', () => {
    const onShowHistory = vi.fn();
    render(
      <WorkflowToolbar
        workflowName="Test Workflow"
        onNameChange={vi.fn()}
        nodeCount={3}
        edgeCount={2}
        showPalette={false}
        onTogglePalette={vi.fn()}
        isSaving={false}
        isExecuting={false}
        saveStatus="idle"
        canExecute={true}
        onSave={vi.fn()}
        onExecute={vi.fn()}
        onShowHistory={onShowHistory}
      />
    );
    const historyBtn = screen.getByTestId('workflow-history-button');
    expect(historyBtn).toBeInTheDocument();
  });

  it('calls onShowHistory when the History button is clicked', () => {
    const onShowHistory = vi.fn();
    render(
      <WorkflowToolbar
        workflowName="Test Workflow"
        onNameChange={vi.fn()}
        nodeCount={3}
        edgeCount={2}
        showPalette={false}
        onTogglePalette={vi.fn()}
        isSaving={false}
        isExecuting={false}
        saveStatus="idle"
        canExecute={true}
        onSave={vi.fn()}
        onExecute={vi.fn()}
        onShowHistory={onShowHistory}
      />
    );
    fireEvent.click(screen.getByTestId('workflow-history-button'));
    expect(onShowHistory).toHaveBeenCalledOnce();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   R10 — VersionHistoryPanel lists versions newest-first
   ═══════════════════════════════════════════════════════════════════════ */

describe('R10 – VersionHistoryPanel lists versions', () => {
  afterEach(cleanup);

  it('renders version rows with timestamp, author, changelog', () => {
    render(
      <VersionHistoryPanel
        versions={SAMPLE_VERSIONS}
        currentVersion={SAMPLE_VERSIONS[0]}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    // Should show all version changelogs
    expect(screen.getByText('Added HTTP node for external API call')).toBeInTheDocument();
    expect(screen.getByText('Fixed prompt template')).toBeInTheDocument();
    expect(screen.getByText('Initial version')).toBeInTheDocument();
  });

  it('shows version number for each row', () => {
    render(
      <VersionHistoryPanel
        versions={SAMPLE_VERSIONS}
        currentVersion={SAMPLE_VERSIONS[0]}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    expect(screen.getByText(/v3/i)).toBeInTheDocument();
    expect(screen.getByText(/v2/i)).toBeInTheDocument();
    expect(screen.getByText(/v1/i)).toBeInTheDocument();
  });

  it('shows author for each version', () => {
    render(
      <VersionHistoryPanel
        versions={SAMPLE_VERSIONS}
        currentVersion={SAMPLE_VERSIONS[0]}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   R11 — Each version row has Compare + Restore buttons
   ═══════════════════════════════════════════════════════════════════════ */

describe('R11 – VersionHistoryPanel Compare + Restore buttons', () => {
  afterEach(cleanup);

  it('renders Compare and Restore buttons for each non-current version', () => {
    render(
      <VersionHistoryPanel
        versions={SAMPLE_VERSIONS}
        currentVersion={SAMPLE_VERSIONS[0]}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    // Should have Compare buttons for v1 and v2 (not current v3)
    const compareBtns = screen.getAllByRole('button', { name: /compare/i });
    expect(compareBtns.length).toBeGreaterThanOrEqual(2);
    // Should have Restore buttons
    const restoreBtns = screen.getAllByRole('button', { name: /restore/i });
    expect(restoreBtns.length).toBeGreaterThanOrEqual(2);
  });

  it('calls onCompare with the version when Compare is clicked', () => {
    const onCompare = vi.fn();
    render(
      <VersionHistoryPanel
        versions={SAMPLE_VERSIONS}
        currentVersion={SAMPLE_VERSIONS[0]}
        onClose={vi.fn()}
        onCompare={onCompare}
        onRestore={vi.fn()}
      />
    );
    const compareBtns = screen.getAllByRole('button', { name: /compare/i });
    fireEvent.click(compareBtns[0]);
    expect(onCompare).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }));
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   R12 — Restore prompts confirmation then calls API
   ═══════════════════════════════════════════════════════════════════════ */

describe('R12 – VersionHistoryPanel Restore flow', () => {
  afterEach(cleanup);

  it('shows confirmation dialog when Restore is clicked', () => {
    render(
      <VersionHistoryPanel
        versions={SAMPLE_VERSIONS}
        currentVersion={SAMPLE_VERSIONS[0]}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    const restoreBtns = screen.getAllByRole('button', { name: /restore/i });
    fireEvent.click(restoreBtns[0]);
    // Should show confirmation prompt
    expect(screen.getByTestId('restore-confirm-dialog')).toBeInTheDocument();
  });

  it('calls onRestore with the version when confirmed', async () => {
    const onRestore = vi.fn();
    render(
      <VersionHistoryPanel
        versions={SAMPLE_VERSIONS}
        currentVersion={SAMPLE_VERSIONS[0]}
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onRestore={onRestore}
      />
    );
    const restoreBtns = screen.getAllByRole('button', { name: /restore/i });
    fireEvent.click(restoreBtns[0]);
    // Confirm the dialog
    const confirmBtn = screen.getByTestId('restore-confirm-button');
    fireEvent.click(confirmBtn);
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }));
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   R13 — Save button prompts for optional changelog message
   ═══════════════════════════════════════════════════════════════════════ */

describe('R13 – WorkflowToolbar Save with changelog prompt', () => {
  afterEach(cleanup);

  it('shows a changelog input prompt when Save is clicked (if onSaveWithChangelog is provided)', () => {
    render(
      <WorkflowToolbar
        workflowName="Test Workflow"
        onNameChange={vi.fn()}
        nodeCount={2}
        edgeCount={1}
        showPalette={false}
        onTogglePalette={vi.fn()}
        isSaving={false}
        isExecuting={false}
        saveStatus="idle"
        canExecute={true}
        onSave={vi.fn()}
        onExecute={vi.fn()}
        onSaveWithChangelog={vi.fn()}
      />
    );
    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);
    // Changelog dialog should appear
    expect(screen.getByTestId('changelog-prompt')).toBeInTheDocument();
  });

  it('calls onSaveWithChangelog with changelog message when submitted', async () => {
    const onSaveWithChangelog = vi.fn();
    render(
      <WorkflowToolbar
        workflowName="Test Workflow"
        onNameChange={vi.fn()}
        nodeCount={2}
        edgeCount={1}
        showPalette={false}
        onTogglePalette={vi.fn()}
        isSaving={false}
        isExecuting={false}
        saveStatus="idle"
        canExecute={true}
        onSave={vi.fn()}
        onExecute={vi.fn()}
        onSaveWithChangelog={onSaveWithChangelog}
      />
    );
    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);
    const input = screen.getByTestId('changelog-input');
    fireEvent.change(input, { target: { value: 'Added new HTTP node' } });
    const submitBtn = screen.getByTestId('changelog-submit');
    fireEvent.click(submitBtn);
    expect(onSaveWithChangelog).toHaveBeenCalledWith('Added new HTTP node');
  });
});
