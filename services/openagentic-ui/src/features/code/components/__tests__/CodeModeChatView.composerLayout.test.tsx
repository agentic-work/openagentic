/**
 * CodeModeChatView — Phase 11 composer layout TDD.
 *
 * Pins the Claude-Code-style floating composer rework:
 *   - Big pixel [OPENAGENTIC] banner is GONE (no codemode-banner-stage)
 *   - Heavy under-input metadata strip is GONE (no codemode-metadata-strip)
 *   - Old slash-hint status line is GONE (no cm-status-line)
 *   - Floating-input wrapper renders (cm-floating-composer)
 *   - cwd chip + permission mode chip + pop-out button live above the input
 *   - Model + ConnectionDot collapse into a single right-aligned chip below
 *
 * Plan: P11 in /home/trent/.claude/plans/logical-kindling-horizon.md.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Stub auth context — composer reads displayName off useAuth().user.
vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'tester@openagentic.io', name: 'Tester' },
    logout: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
    isApiDown: false,
    login: vi.fn(),
    getAuthHeaders: () => ({}),
    getAccessToken: vi.fn().mockResolvedValue(null),
    validateSession: vi.fn().mockResolvedValue(true),
  }),
}));

// Stub the useCodeModeChat hook — we don't want to spin up a WebSocket.
// Returns a realistic shape (mirrors the live UseCodeModeChatReturn).
const baseChatReturn = {
  messages: [],
  isStreaming: false,
  error: null,
  sendMessage: vi.fn(),
  clear: vi.fn(),
  cancel: vi.fn(),
  contextTokens: 0,
  compactionFlash: null,
  model: 'gpt-oss:20b',
  fastMode: undefined,
  totalCostUsd: 0,
  totalOutputTokens: 0,
  lastTurnMs: undefined,
  pendingPermission: null,
  respondToPermission: vi.fn(),
  sendControl: vi.fn(),
  sessionMeta: {
    tools: [],
    mcpServers: [],
    agents: [],
    skills: [],
    plugins: [],
    slashCommands: [],
    cwd: '/workspaces/u-1',
    permissionMode: 'default',
    openagenticVersion: '0.6.7',
    budgetCapUsd: null,
    detail: undefined,
  },
  inkDomViews: {},
  sendUiEvent: vi.fn(),
  activePicker: null,
  closePicker: vi.fn(),
  daemonRPC: { call: vi.fn(), onResponse: vi.fn() },
};

vi.mock('../../hooks/useCodeModeChat', () => ({
  useCodeModeChat: () => baseChatReturn,
}));

// Stub usePromptHistory — composer reads it but it'd otherwise touch storage.
vi.mock('../../hooks/usePromptHistory', () => ({
  usePromptHistory: () => ({
    push: vi.fn(),
    stepBack: vi.fn(() => null),
    stepForward: vi.fn(() => null),
    isBrowsing: false,
    resetBrowse: vi.fn(),
  }),
}));

// Stub useTurnCompleteSound — suppresses Audio() construction in jsdom.
vi.mock('../../hooks/useTurnCompleteSound', () => ({
  useTurnCompleteSound: () => {},
  getSoundsEnabled: () => false,
  setSoundsEnabled: () => {},
}));

import { CodeModeChatView } from '../CodeModeChatView';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

beforeEach(() => {
  // Seed the zustand store so ConnectionDot + status selectors render.
  useCodeModeStore.setState({
    connectionState: 'connected',
    reconnectAttempts: 0,
    interactionMode: 'normal',
    currentSteps: [],
    currentTodos: [],
    agentTree: [],
  } as any, false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CodeModeChatView — Phase 11 floating composer', () => {
  it('renders cm-floating-composer wrapper around the input', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.getByTestId('cm-floating-composer')).toBeInTheDocument();
  });

  it('renders cm-composer-cwd-chip with the session cwd', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const chip = screen.getByTestId('cm-composer-cwd-chip');
    expect(chip).toBeInTheDocument();
    // Display abbreviates to last segment.
    expect(chip.textContent).toContain('u-1');
  });

  it('renders cm-composer-popout-btn (restored in P11)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.getByTestId('cm-composer-popout-btn')).toBeInTheDocument();
  });

  it('renders cm-composer-mode-chip with the current mode label', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const chip = screen.getByTestId('cm-composer-mode-chip');
    expect(chip).toBeInTheDocument();
    // Default permission mode for a fresh sandbox session is bypassPermissions
    // (display label 'permissive'); we just need a non-empty string here.
    expect((chip.textContent || '').trim().length).toBeGreaterThan(0);
  });

  it('renders the input textarea', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const textareas = document.querySelectorAll('textarea');
    expect(textareas.length).toBeGreaterThan(0);
  });

  it('does NOT render the codemode-banner-stage (pixel-art logo)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.queryByTestId('codemode-banner-stage')).toBeNull();
  });

  it('does NOT render the codemode-metadata-strip (heavy under-input strip)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.queryByTestId('codemode-metadata-strip')).toBeNull();
  });

  it('does NOT render the old cm-status-line (replaced by under-input row)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.queryByTestId('cm-status-line')).toBeNull();
  });

  // 2026-05-06: cm-composer-model REMOVED — the existing model picker
  // button on the same toolbar already shows the live model name.
  // User feedback: "why is gpt-oss120b showing under the chatinput
  // toolbar- get rid of that".
  it('does NOT render the redundant cm-composer-model chip', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.queryByTestId('cm-composer-model')).toBeNull();
  });

  it('renders cm-composer-connection (ConnectionDot collapsed into right side)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.getByTestId('cm-composer-connection')).toBeInTheDocument();
  });
});
