/**
 * RailSurfaceModal — TDD regression pin for the rail-opens-its-own-modal
 * contract (user directive 2026-05-14 round 2):
 *
 *   > the rail in flows workspaces per user should open its own
 *   > modal / settings page for each option
 *
 * Before this fix the rail dispatched `openFlowsConfig` which forced an
 * inline canvas takeover. Now it dispatches `openFlowsRailSurface` and
 * this component renders the matching section inside its own centered
 * BaseModal — dismissable via ESC + backdrop + X.
 *
 * Pins under test:
 *   1. Mounting alone renders NOTHING (no open section).
 *   2. Dispatching `openFlowsRailSurface { detail: { section: 'settings' } }`
 *      opens a dialog whose accessible name is "Workflow Settings".
 *   3. Pressing Escape closes the dialog (BaseModal contract).
 *   4. Dispatching with `section: 'variables'` opens a dialog whose
 *      accessible name is "Workflow Variables".
 *   5. The dialog has role=dialog + aria-modal=true (a11y contract).
 *
 * NOTE: we mock `sectionRenderRegistry` so the test stays focused on
 * the modal chrome / event wiring — the underlying section bodies pull
 * in 3700 lines of SidebarSectionModal which is its own test scope.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the body registry so we don't drag in the giant section module.
vi.mock('../sidebar/sectionRenderRegistry', () => ({
  sectionTitleFor: (section: string) => {
    const titles: Record<string, string> = {
      settings: 'Workflow Settings',
      variables: 'Workflow Variables',
      runs: 'My Runs',
      insights: 'Insights',
      templates: 'Templates',
      agents: 'Agent Configuration',
      team: 'Team & Sharing',
      data: 'Data Stores',
      artifacts: 'Artifacts',
    };
    return titles[section] || section;
  },
  renderSectionBody: ({ section }: { section: string }) => (
    <div data-testid={`mock-body-${section}`}>mock body for {section}</div>
  ),
}));

// Stub framer-motion's AnimatePresence so children render synchronously
// in jsdom (mount/unmount transitions aren't relevant to these pins).
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<any>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { RailSurfaceModal } from '../RailSurfaceModal';

const dispatchOpen = (section: string) => {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('openFlowsRailSurface', { detail: { section } }),
    );
  });
};

describe('RailSurfaceModal', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders nothing initially', () => {
    const { container } = render(<RailSurfaceModal />);
    expect(container.firstChild).toBeNull();
    // No open dialog
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a dialog with the Settings title when openFlowsRailSurface fires for settings', () => {
    render(<RailSurfaceModal />);
    dispatchOpen('settings');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // BaseModal sets aria-modal=true
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Title rendered inside customHeader
    expect(screen.getByText('Workflow Settings')).toBeInTheDocument();
    expect(screen.getByTestId('rail-surface-settings')).toBeInTheDocument();
    expect(screen.getByTestId('mock-body-settings')).toBeInTheDocument();
  });

  it('opens a dialog with the Variables title when openFlowsRailSurface fires for variables', () => {
    render(<RailSurfaceModal />);
    dispatchOpen('variables');
    expect(screen.getByText('Workflow Variables')).toBeInTheDocument();
    expect(screen.getByTestId('rail-surface-variables')).toBeInTheDocument();
  });

  it('opens the Runs surface', () => {
    render(<RailSurfaceModal />);
    dispatchOpen('runs');
    expect(screen.getByText('My Runs')).toBeInTheDocument();
  });

  it('opens the Artifacts surface (regression pin — was 404 via /api/knowledge/search)', () => {
    render(<RailSurfaceModal />);
    dispatchOpen('artifacts');
    expect(screen.getByText('Artifacts')).toBeInTheDocument();
    expect(screen.getByTestId('rail-surface-artifacts')).toBeInTheDocument();
  });

  it('switches sections when a new event fires', () => {
    render(<RailSurfaceModal />);
    dispatchOpen('settings');
    expect(screen.getByText('Workflow Settings')).toBeInTheDocument();
    dispatchOpen('runs');
    // New section title displayed; old title gone
    expect(screen.getByText('My Runs')).toBeInTheDocument();
    expect(screen.queryByText('Workflow Settings')).toBeNull();
  });

  it('dialog has Close button (BaseModal a11y contract)', () => {
    render(<RailSurfaceModal />);
    dispatchOpen('settings');
    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    render(<RailSurfaceModal />);
    dispatchOpen('settings');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      // BaseModal listens on document — not window.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    // After ESC the BaseModal closes; the RailSurfaceModal returns null.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores events with no detail.section', () => {
    render(<RailSurfaceModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent('openFlowsRailSurface', { detail: {} }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
