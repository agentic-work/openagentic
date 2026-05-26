/**
 * CodeModeChatView — Phase H composer footer cleanup TDD.
 *
 * Pins the post-Phase-H layout:
 *   - Mic placeholder is gone (no `title="Voice input (coming soon)"` element).
 *   - Mode chip + cwd chip move from the above-input row to the below-input
 *     toolbar (DOM order: AFTER the textarea).
 *   - The above-input row contains only the pop-out button.
 *   - ThemeSelectorPill is mounted in the below-input toolbar.
 *   - A `[GitHub: Connect]` pill is mounted in the below-input toolbar.
 *   - Clicking the mode chip cycles permission mode.
 *
 * Plan: Phase H in /home/trent/openagentic/agentic/docs/plans/CODEMODE-PERMANENT-PLAN.md.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

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

vi.mock('../../hooks/usePromptHistory', () => ({
  usePromptHistory: () => ({
    push: vi.fn(),
    stepBack: vi.fn(() => null),
    stepForward: vi.fn(() => null),
    isBrowsing: false,
    resetBrowse: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTurnCompleteSound', () => ({
  useTurnCompleteSound: () => {},
  getSoundsEnabled: () => false,
  setSoundsEnabled: () => {},
}));

import { CodeModeChatView } from '../CodeModeChatView';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

beforeEach(() => {
  useCodeModeStore.setState({
    connectionState: 'connected',
    reconnectAttempts: 0,
    interactionMode: 'normal',
    currentSteps: [],
    currentTodos: [],
    agentTree: [],
  } as any, false);
  // jsdom: stub fetch for the GitHub config probe so the pill can render
  // both states without real HTTP.
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/v1/github/config')) {
      return new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (typeof url === 'string' && url.includes('/api/v1/github/status')) {
      return new Response(JSON.stringify({ connected: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CodeModeChatView composer (Phase H)', () => {
  it('does not render the mic placeholder', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    // The mic span carried `title="Voice input (coming soon)"` — gone after H.
    const mic = document.querySelector('[title*="Voice input" i]');
    expect(mic).toBeNull();
  });

  it('renders mode + cwd chips BELOW the input, not above', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const composer = screen.getByTestId('cm-floating-composer');
    const modeChip = screen.getByTestId('cm-composer-mode-chip');
    const cwdChip = screen.getByTestId('cm-composer-cwd-chip');
    const textarea = composer.querySelector('textarea');
    expect(textarea).not.toBeNull();
    // DOM order: textarea precedes both chips after Phase H.
    const followingMask = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(textarea!.compareDocumentPosition(modeChip) & followingMask).toBeTruthy();
    expect(textarea!.compareDocumentPosition(cwdChip) & followingMask).toBeTruthy();
  });

  it('above-input row contains only the pop-out button', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const popout = screen.getByTestId('cm-composer-popout-btn');
    const aboveRow = popout.parentElement!;
    expect(aboveRow.querySelector('[data-testid="cm-composer-mode-chip"]')).toBeNull();
    expect(aboveRow.querySelector('[data-testid="cm-composer-cwd-chip"]')).toBeNull();
  });

  it('renders ThemeSelectorPill in the below-input toolbar', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const theme = screen.getByTestId('cm-theme-selector-pill');
    expect(theme).toBeInTheDocument();
    // Theme pill should be after the textarea in DOM order.
    const composer = screen.getByTestId('cm-floating-composer');
    const textarea = composer.querySelector('textarea')!;
    expect(
      textarea.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // 2026-05-06: GitHub connect pill MOVED to the sidebar (under
  // Collections). User feedback: "move the github connect under
  // collections." The composer must NOT render it.
  it('does NOT render the GitHub connect pill in the composer toolbar', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    expect(screen.queryByTestId('cm-composer-github')).toBeNull();
  });

  it('clicking the mode chip cycles permission mode', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const chip = screen.getByTestId('cm-composer-mode-chip');
    const before = (chip.textContent || '').trim();
    fireEvent.click(chip);
    const after = (chip.textContent || '').trim();
    expect(after).not.toEqual(before);
  });

  it('renders only ONE mode-display element (chip not duplicated)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    const chips = document.querySelectorAll('[data-testid="cm-composer-mode-chip"]');
    expect(chips.length).toBe(1);
  });

  it('mode chip uses a fixed-width slot so cycling does NOT shift adjacent toolbar elements', () => {
    // jsdom doesn't compute layout, so we can't measure
    // getBoundingClientRect to assert the cwd chip stays put. Instead we
    // pin the contract via the inline style: the mode chip must declare
    // a non-zero `min-width` (or fixed `width`) so the slot's render box
    // stays constant across permissive→plan→strict→yolo label changes.
    render(<CodeModeChatView sessionId="s-1" />);
    const chip = screen.getByTestId('cm-composer-mode-chip') as HTMLElement;
    const inline = chip.style;
    const min = parseFloat(inline.minWidth || '0');
    const fixed = parseFloat(inline.width || '0');
    expect(min > 0 || fixed > 0).toBe(true);
    // Sanity-check the longest mode label fits — the symbol-prefixed
    // "permissive" label is the widest at 14 visual chars + ~12px
    // padding × 2; ~120px is the practical floor.
    expect(min || fixed).toBeGreaterThanOrEqual(120);
  });
});
