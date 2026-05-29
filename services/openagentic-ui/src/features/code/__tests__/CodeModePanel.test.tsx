// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CodeModePanel } from '../CodeModePanel';

// ---------------------------------------------------------------------------
// Mock: apiRequest (used by useCodeModeFirstRun)
// ---------------------------------------------------------------------------
vi.mock('../../../utils/api', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../../utils/api';
const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mock: useCodeModeStore — minimal shape that CodeModePanel consumes.
// We return a stable mock so zustand's persist layer is never exercised.
// ---------------------------------------------------------------------------
const mockSetActiveSession = vi.fn();

// Default: no active session in the store.
let mockStoreSession: any = null;

vi.mock('../../../stores/useCodeModeStore', () => ({
  useCodeModeStore: (selector: (s: any) => any) =>
    selector({
      session: mockStoreSession,
      setActiveSession: mockSetActiveSession,
    }),
}));

// ---------------------------------------------------------------------------
// Mock: Terminal — renders a simple div so we don't need xterm / WebSocket
// in the test environment.  We preserve the data-testid added to the real
// component so assertions stay consistent.
// ---------------------------------------------------------------------------
vi.mock('../Terminal', () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="code-terminal" data-session-id={sessionId} />
  ),
}));

// ---------------------------------------------------------------------------
// Mock: CodeModeWizard — render a recognisable heading so assertions are
// simple without needing the full wizard DOM.
// ---------------------------------------------------------------------------
vi.mock('../wizard/CodeModeWizard', () => ({
  CodeModeWizard: ({ startStep }: { startStep?: string }) => (
    <div>
      <h2>Code Mode</h2>
      <span data-testid="wizard-start-step">{startStep ?? 'welcome'}</span>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helper: build a fake settings API response
// ---------------------------------------------------------------------------
function makeJsonResponse(data: unknown, ok = true) {
  return { ok, json: async () => data } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodeModePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreSession = null; // reset to "no active session" before each test
  });

  it('(a) shows wizard Welcome when first run is not complete and no session active', async () => {
    mockApiRequest.mockResolvedValue(
      makeJsonResponse({ settings: { codeMode: { firstRunComplete: false } } })
    );

    render(<CodeModePanel />);

    // Initially loading; wait for the settings fetch to resolve
    await waitFor(() => {
      expect(screen.queryByText(/loading code mode/i)).not.toBeInTheDocument();
    });

    // Wizard should be shown
    expect(screen.getByRole('heading', { name: /code mode/i })).toBeInTheDocument();

    // startStep should default to 'welcome' when first run is not complete
    expect(screen.getByTestId('wizard-start-step').textContent).toBe('welcome');
  });

  it('(a) shows wizard at "model" step when first run IS complete and no session active', async () => {
    mockApiRequest.mockResolvedValue(
      makeJsonResponse({ settings: { codeMode: { firstRunComplete: true } } })
    );

    render(<CodeModePanel />);

    await waitFor(() => {
      expect(screen.queryByText(/loading code mode/i)).not.toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /code mode/i })).toBeInTheDocument();
    expect(screen.getByTestId('wizard-start-step').textContent).toBe('model');
  });

  it('(b) renders Terminal when a session is active in the store', async () => {
    // Put an active session into the store mock BEFORE rendering
    mockStoreSession = {
      sessionId: 'test-session-123',
      userId: 'u1',
      workspacePath: '/workspace',
      model: 'claude-opus-4-5',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    mockApiRequest.mockResolvedValue(
      makeJsonResponse({ settings: { codeMode: { firstRunComplete: true } } })
    );

    render(<CodeModePanel />);

    // Terminal should appear regardless of the loading state because localSession
    // is initialised from storeSession synchronously.
    expect(screen.getByTestId('code-terminal')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /code mode/i })).not.toBeInTheDocument();
  });
});
