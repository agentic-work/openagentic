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

const sendMessageMock = vi.fn();
const sendControlMock = vi.fn();

const baseChatReturn = {
  messages: [],
  isStreaming: false,
  error: null,
  sendMessage: sendMessageMock,
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
  sendControl: sendControlMock,
  sessionMeta: {
    tools: ['Read', 'Edit', 'Bash'],
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
  // 2026-04-30 — MemoryModal + ResumeModal now consume the daemonRPC
  // context. The chat hook owns the WS so it provides this surface;
  // tests must stub it. Returning a never-resolving promise keeps the
  // modals in their "loading" state which is enough for the trigger
  // assertions in this file (they only check the modal mounted, not
  // that data populated).
  daemonRPC: {
    call: vi.fn(() => new Promise(() => {})),
    onResponse: vi.fn(),
  },
  activePicker: null,
  closePicker: vi.fn(),
  openPicker: vi.fn(),
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
  sendMessageMock.mockReset();
  sendControlMock.mockReset();
  useCodeModeStore.setState({
    connectionState: 'connected',
    reconnectAttempts: 0,
    interactionMode: 'normal',
    currentSteps: [],
    currentTodos: [],
    agentTree: [],
  } as any, false);
  (globalThis as any).fetch = vi.fn(async () => new Response('{}', { status: 200 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Helper — type a slash command into the composer and press Enter.
 * Mirrors what the live UI does on a real keystroke.
 */
function typeAndSubmit(cmd: string) {
  const composer = screen.getByTestId('cm-floating-composer');
  const textarea = composer.querySelector('textarea') as HTMLTextAreaElement;
  expect(textarea).not.toBeNull();
  fireEvent.change(textarea, { target: { value: cmd } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

describe('CodeModeChatView slash-command modal triggers', () => {
  it('/permissions opens the Permissions modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/permissions');
    // RichModalShell renders title="Permissions" inside its header.
    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('/plan opens the Plan modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/plan');
    // CommandModals.PlanModal uses ModalShell title="/plan".
    expect(screen.getByText('/plan')).toBeInTheDocument();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('/memory opens the Memory modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/memory');
    expect(screen.getByText('/memory')).toBeInTheDocument();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('/config opens the Configuration modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/config');
    // RichModalShell renders title="Configuration".
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('/version opens the Version modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/version');
    expect(screen.getByText('/version')).toBeInTheDocument();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('/resume opens the Resume modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/resume');
    expect(screen.getByText('/resume')).toBeInTheDocument();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  // 2026-05-02 TUI parity audit (tui-vs-codemode-diff.report.md)
  // captured: typing /status in codemode produced no output. The TUI
  // shows a 3-tab `Status / Config / Usage` picker. The StatusModal
  // component already exists and is wired to openModal === 'status' —
  // we only need a dispatchSlashCommand case to set it.
  it('/status opens the Status/Config/Usage modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/status');
    // StatusModal renders three tab buttons labelled status / config / usage
    // (the 'STATUS' uppercase label appears via section header).
    expect(screen.getAllByText(/status/i).length).toBeGreaterThan(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  // 2026-05-02 TUI parity audit (tui-vs-codemode-diff.report.md)
  // captured: typing /help in codemode produced an empty assistant
  // turn — Phase 0 stripped /help from the api slash-dispatcher
  // (only /exit + /clear remain) and the daemon's headless slash
  // dispatch isn't yet wired in remote-session mode (Phase 1, in
  // companion repo). Until that lands, render /help client-side as
  // a HelpModal listing the SLASH_COMMANDS registry.
  it('/help opens the help modal locally (no WS user frame)', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/help');
    // HelpModal title is "/help" — but /help is also a row in the
    // command list rendered inside the modal body, so multiple
    // elements match.
    expect(screen.getAllByText('/help').length).toBeGreaterThan(0);
    // Must list at least one canonical p0 command.
    expect(screen.getAllByText(/clear/i).length).toBeGreaterThan(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  // 2026-05-02 TUI parity audit (tui-vs-codemode-diff.report.md):
  // /bug is not registered as a v0.7.0 slash command; the TUI shows
  // typeahead resolving it to /superpowers:systematic-debugging
  // (skill autocomplete). Codemode previously silently dropped the
  // input — the user saw nothing happen. Fix is two-fold:
  //   - HIGH-conf typeahead match (e.g. /bug → /<skill containing bug>)
  //     when it's the only candidate
  //   - else surface "Unknown command" so users aren't left guessing.
  // For now, the simple fix: forward unknown slashes to the daemon as
  // plain prompts. This pins the regression that no "user frame" is
  // sent for known commands and that unknown slashes do reach the
  // daemon (so it can echo or run them as a prompt).
  it('/bug — unknown slash command falls through to the daemon as a prompt', () => {
    render(<CodeModeChatView sessionId="s-1" />);
    typeAndSubmit('/bug');
    // Not handled locally → must forward to the daemon. Without this,
    // the input is silently dropped (the failure mode captured 2026-05-02).
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toBe('/bug');
  });
});
