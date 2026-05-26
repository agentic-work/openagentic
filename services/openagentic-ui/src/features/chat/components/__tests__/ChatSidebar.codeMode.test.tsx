/**
 * A.13 — ChatSidebar code mode: renders FileTreeSection when appMode='code'.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Router stub ────────────────────────────────────────────────────────────
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// ── Auth stub ──────────────────────────────────────────────────────────────
vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'tester@openagentic.io', name: 'Tester' },
    logout: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
    getAccessToken: vi.fn().mockResolvedValue('tok-1'),
  }),
}));

// ── Theme context stub ─────────────────────────────────────────────────────
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

// ── useConfirm stub ────────────────────────────────────────────────────────
vi.mock('@/shared/hooks/useConfirm', () => ({
  useConfirm: () => vi.fn(),
}));

// ── FlowsSidebar stub (not under test) ────────────────────────────────────
vi.mock('@/features/workflows/components/FlowsSidebar', () => ({
  FlowsSidebar: () => <div data-testid="flows-sidebar" />,
}));

// ── CodeSessionsPanel stub ────────────────────────────────────────────────
vi.mock('../CodeSessionsPanel', () => ({
  CodeSessionsPanel: () => <div data-testid="code-sessions-panel" />,
}));

// ── AgentTree stub ────────────────────────────────────────────────────────
vi.mock('../v2/AgentTree', () => ({
  AgentTree: () => <div data-testid="agent-tree" />,
}));

// ── FileTreeSection stub (verifying it's rendered) ────────────────────────
vi.mock('@/codemode/components/FileTreeSection', () => ({
  FileTreeSection: ({ rootPath }: { rootPath: string }) => (
    <div data-testid="file-tree-section" data-root={rootPath} />
  ),
}));

// ── CompanyLogo + VersionBadge stubs ──────────────────────────────────────
vi.mock('@/components/CompanyLogo', () => ({
  CompanyLogo: () => <div data-testid="company-logo" />,
}));

vi.mock('@/components/VersionBadge', () => ({
  VersionBadge: () => <div data-testid="version-badge" />,
}));

import ChatSidebar from '../ChatSidebar';

const defaultProps = {
  sessions: [],
  currentSessionId: null,
  showDeleteConfirm: null,
  onSessionSelect: vi.fn(),
  onSessionDelete: vi.fn(),
  onNewSession: vi.fn(),
  onShowDeleteConfirm: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatSidebar — code mode (A.13)', () => {
  it('renders FileTreeSection when appMode=code and canUseCodeMode=true', async () => {
    await act(async () => {
      render(
        <ChatSidebar
          {...defaultProps}
          appMode="code"
          canUseCodeMode={true}
        />,
      );
    });

    expect(screen.getByTestId('file-tree-section')).toBeInTheDocument();
  });

  it('does NOT render FileTreeSection when appMode=chat', async () => {
    await act(async () => {
      render(
        <ChatSidebar
          {...defaultProps}
          appMode="chat"
          canUseCodeMode={true}
        />,
      );
    });

    expect(screen.queryByTestId('file-tree-section')).toBeNull();
  });

  it('does NOT render FileTreeSection when canUseCodeMode=false', async () => {
    await act(async () => {
      render(
        <ChatSidebar
          {...defaultProps}
          appMode="code"
          canUseCodeMode={false}
        />,
      );
    });

    expect(screen.queryByTestId('file-tree-section')).toBeNull();
  });
});
