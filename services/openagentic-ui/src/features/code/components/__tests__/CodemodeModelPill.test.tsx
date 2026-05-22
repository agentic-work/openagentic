/**
 * Task #355 — CodemodeModelPill TDD contract.
 *
 * - click → fetch /v1/models?sessionId=X, render each row as an option
 * - select row → POST model-override, pill label updates
 * - 400 response → onError called, pill label DOES NOT change
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { CodemodeModelPill } from '../CodemodeModelPill';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const result = await handler(url, init);
    return result;
  });
  (globalThis as any).fetch = fn;
  return { fn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const MODELS_RESPONSE = {
  models: [
    { id: 'global.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'bedrock', isDefault: true },
    { id: 'gpt-oss:20b', label: 'gpt-oss 20B', provider: 'ollama', isDefault: false },
  ],
  currentEffective: 'global.anthropic.claude-sonnet-4-6',
  defaultFromAdmin: 'global.anthropic.claude-sonnet-4-6',
  hasSessionOverride: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CodemodeModelPill — initial render + open dropdown', () => {
  it('fetches /v1/models?sessionId=X on mount and renders each option on click', async () => {
    mockFetch(async (url) => {
      if (url.startsWith('/api/openagentic/v1/models')) return jsonResponse(MODELS_RESPONSE);
      return jsonResponse({}, 404);
    });

    render(<CodemodeModelPill sessionId="sess-abc" authToken="jwt" />);

    // Initial load fetches models. Pill renders with admin default.
    await waitFor(() =>
      expect(screen.getByTestId('codemode-model-pill')).toBeInTheDocument(),
    );

    // Open the dropdown.
    fireEvent.click(screen.getByTestId('codemode-model-pill'));

    await waitFor(() => {
      expect(
        screen.getByTestId('codemode-model-option-global.anthropic.claude-sonnet-4-6'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('codemode-model-option-gpt-oss:20b')).toBeInTheDocument();
    });
  });
});

describe('CodemodeModelPill — select model fires POST', () => {
  it('clicking a row POSTs to /v1/session/:sid/model-override with the selected id', async () => {
    const { calls } = mockFetch(async (url, init) => {
      if (url.startsWith('/api/openagentic/v1/models')) return jsonResponse(MODELS_RESPONSE);
      if (url.includes('/model-override') && init?.method === 'POST') {
        return jsonResponse({ effectiveModel: 'gpt-oss:20b', ttlSeconds: 86400 });
      }
      return jsonResponse({}, 404);
    });

    render(<CodemodeModelPill sessionId="sess-abc" authToken="jwt" />);
    await waitFor(() => expect(screen.getByTestId('codemode-model-pill')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('codemode-model-pill'));
    await waitFor(() => expect(screen.getByTestId('codemode-model-option-gpt-oss:20b')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('codemode-model-option-gpt-oss:20b'));

    await waitFor(() => {
      const postCall = calls.find(
        (c) => c.url.includes('/v1/session/sess-abc/model-override') && c.init?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
      expect(postCall!.init!.body).toBe(JSON.stringify({ model: 'gpt-oss:20b' }));
      const headers = (postCall!.init!.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer jwt');
    });
  });
});

describe('CodemodeModelPill — pill label updates after success', () => {
  it('shows the newly-chosen model id in the pill after a 200 from POST', async () => {
    mockFetch(async (url, init) => {
      if (url.startsWith('/api/openagentic/v1/models')) return jsonResponse(MODELS_RESPONSE);
      if (url.includes('/model-override') && init?.method === 'POST') {
        return jsonResponse({ effectiveModel: 'gpt-oss:20b', ttlSeconds: 86400 });
      }
      return jsonResponse({}, 404);
    });

    render(<CodemodeModelPill sessionId="sess-abc" authToken="jwt" />);

    await waitFor(() => expect(screen.getByTestId('codemode-model-pill')).toBeInTheDocument());
    // Before override, pill shows the admin default.
    expect(screen.getByTestId('codemode-model-pill').textContent).toContain('claude-sonnet-4-6');

    fireEvent.click(screen.getByTestId('codemode-model-pill'));
    await waitFor(() =>
      expect(screen.getByTestId('codemode-model-option-gpt-oss:20b')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('codemode-model-option-gpt-oss:20b'));

    await waitFor(() => {
      expect(screen.getByTestId('codemode-model-pill').textContent).toContain('gpt-oss:20b');
      expect(screen.getByTestId('codemode-model-pill').textContent).toContain('session');
    });
  });
});

describe('CodemodeModelPill — 400 response surfaces error + does not change label', () => {
  it('calls onError with the server message and keeps the pill on the previous label', async () => {
    mockFetch(async (url, init) => {
      if (url.startsWith('/api/openagentic/v1/models')) return jsonResponse(MODELS_RESPONSE);
      if (url.includes('/model-override') && init?.method === 'POST') {
        return jsonResponse({ error: 'model not in registry for role=code' }, 400);
      }
      return jsonResponse({}, 404);
    });
    const onError = vi.fn();

    render(<CodemodeModelPill sessionId="sess-abc" authToken="jwt" onError={onError} />);
    await waitFor(() => expect(screen.getByTestId('codemode-model-pill')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('codemode-model-pill'));
    await waitFor(() =>
      expect(screen.getByTestId('codemode-model-option-gpt-oss:20b')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('codemode-model-option-gpt-oss:20b'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('model not in registry for role=code');
    });

    // Pill should still show the original admin default model.
    expect(screen.getByTestId('codemode-model-pill').textContent).toContain('claude-sonnet-4-6');
    expect(screen.getByTestId('codemode-model-pill').textContent).not.toContain('gpt-oss');
  });
});
