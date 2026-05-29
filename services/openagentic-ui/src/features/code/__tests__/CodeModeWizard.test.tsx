// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeModeWizard } from '../wizard/CodeModeWizard';

// Mock apiRequest
vi.mock('../../../utils/api', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../../utils/api';

const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>;

// Mirror the real /api/chat/models shape: { models: [...] } (NOT a bare array).
const MODELS_RESPONSE = {
  models: [
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
  ],
};

const SESSION_RESPONSE = { id: 'sess-001', sessionId: 'sess-001', workspacePath: '/workspace' };

function makeJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe('CodeModeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Welcome step on initial render', () => {
    mockApiRequest.mockResolvedValue(makeJsonResponse(MODELS_RESPONSE));
    render(<CodeModeWizard onLaunched={vi.fn()} />);
    expect(screen.getByText(/welcome/i)).toBeInTheDocument();
  });

  it('calls models endpoint and shows "available" when models exist', async () => {
    mockApiRequest.mockResolvedValue(makeJsonResponse(MODELS_RESPONSE));
    render(<CodeModeWizard onLaunched={vi.fn()} />);

    // Click Next from Welcome → Prereq
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('/api/chat/models');
    });

    await waitFor(() => {
      expect(screen.getByText(/model available/i)).toBeInTheDocument();
    });
  });

  it('shows "no models" message when models list is empty', async () => {
    mockApiRequest.mockResolvedValue(makeJsonResponse({ models: [] }));
    render(<CodeModeWizard onLaunched={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/no models/i)).toBeInTheDocument();
    });
  });

  it('lists fetched models plus Smart Router option in model select', async () => {
    mockApiRequest.mockResolvedValue(makeJsonResponse(MODELS_RESPONSE));
    render(<CodeModeWizard onLaunched={vi.fn()} />);

    // Welcome → Prereq
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => screen.getByText(/model available/i));

    // Prereq → Model
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const optionValues = options.map((o) => (o as HTMLOptionElement).value);
    const optionTexts = options.map((o) => o.textContent);

    // Smart Router option (value = '')
    expect(optionValues).toContain('');
    expect(optionTexts.some((t) => /smart router/i.test(t ?? ''))).toBe(true);

    // Model options from API
    expect(optionValues).toContain('claude-opus-4-5');
    expect(optionValues).toContain('gpt-4o');
  });

  it('launches session and calls onLaunched with returned session', async () => {
    const onLaunched = vi.fn();

    // First call: models; second call: session creation
    mockApiRequest
      .mockResolvedValueOnce(makeJsonResponse(MODELS_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(SESSION_RESPONSE));

    render(<CodeModeWizard onLaunched={onLaunched} />);

    // Welcome → Prereq
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => screen.getByText(/model available/i));

    // Prereq → Model
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    // Model → Workspace
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Choose "empty" workspace (should already be selected by default)
    const emptyRadio = screen.getByLabelText(/empty/i);
    expect(emptyRadio).toBeInTheDocument();

    // Workspace → Launch
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Click "Open Code Mode"
    const launchBtn = screen.getByRole('button', { name: /open code mode/i });
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/api/code/sessions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"repoUrl"') === undefined
            ? expect.any(String)
            : expect.any(String),
        })
      );
    });

    // Verify body does NOT include repoUrl for empty workspace
    const sessionCallArgs = mockApiRequest.mock.calls.find(
      (c) => c[0] === '/api/code/sessions'
    );
    expect(sessionCallArgs).toBeDefined();
    const body = JSON.parse(sessionCallArgs![1].body);
    expect(body.repoUrl).toBeUndefined();

    await waitFor(() => {
      expect(onLaunched).toHaveBeenCalledWith(SESSION_RESPONSE);
    });
  });

  it('includes repoUrl when clone workspace is selected', async () => {
    const onLaunched = vi.fn();

    mockApiRequest
      .mockResolvedValueOnce(makeJsonResponse(MODELS_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(SESSION_RESPONSE));

    render(<CodeModeWizard onLaunched={onLaunched} />);

    // Navigate to Workspace step
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => screen.getByText(/model available/i));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Select clone
    const cloneRadio = screen.getByLabelText(/clone/i);
    fireEvent.click(cloneRadio);

    // Enter repo URL
    const urlInput = screen.getByPlaceholderText(/https:\/\/github.com/i);
    fireEvent.change(urlInput, { target: { value: 'https://github.com/org/repo' } });

    // Workspace → Launch
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /open code mode/i }));

    await waitFor(() => {
      const sessionCallArgs = mockApiRequest.mock.calls.find(
        (c) => c[0] === '/api/code/sessions'
      );
      const body = JSON.parse(sessionCallArgs![1].body);
      expect(body.repoUrl).toBe('https://github.com/org/repo');
    });
  });

  it('calls onClose when Close button is clicked', () => {
    const onClose = vi.fn();
    mockApiRequest.mockResolvedValue(makeJsonResponse(MODELS_RESPONSE));
    render(<CodeModeWizard onLaunched={vi.fn()} onClose={onClose} />);

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
