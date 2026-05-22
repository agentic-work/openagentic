/**
 * CodeModePreviewPanel — render / iframe-src / refresh / open-in-tab
 * contract tests.
 *
 * Pins:
 *  - The iframe `src` resolves against the openagentic-api path-proxy
 *    (`/api/code/preview/<sid>/<port>/`) — never the pod-local URL.
 *    This is the security gate; if the iframe ever points at the
 *    raw localhost URL, the agent has bypassed auth.
 *  - Refresh appends a cache-bust query that changes the src.
 *  - Open-in-new-tab calls window.open with the proxy URL.
 *  - Without a session id the panel renders nothing (defensive).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  buildPreviewSrc,
  CodeModePreviewPanel,
} from '../CodeModePreviewPanel';

beforeEach(() => {
  cleanup();
});

describe('buildPreviewSrc', () => {
  it('builds the canonical proxy URL', () => {
    expect(buildPreviewSrc('', 'sess-1', 5173)).toBe(
      '/api/code/preview/sess-1/5173/',
    );
  });

  it('URL-encodes the sessionId so a colon-prefixed sid is safe', () => {
    expect(buildPreviewSrc('', 'cse_abc:def', 5173)).toBe(
      '/api/code/preview/cse_abc%3Adef/5173/',
    );
  });

  it('appends a cache-bust query when token is provided', () => {
    expect(buildPreviewSrc('', 'sess-1', 5173, 1234567)).toBe(
      '/api/code/preview/sess-1/5173/?_=1234567',
    );
  });

  it('honours the proxyOrigin override', () => {
    expect(buildPreviewSrc('https://chat-dev.openagentic.io', 'sess-1', 5173)).toBe(
      'https://chat-dev.openagentic.io/api/code/preview/sess-1/5173/',
    );
  });
});

describe('<CodeModePreviewPanel>', () => {
  it('renders an iframe pointing at the path-proxy URL', () => {
    const { getByTestId } = render(
      <CodeModePreviewPanel
        port={5173}
        displayUrl="http://localhost:5173"
        framework="vite"
        sessionIdOverride="sess-abc"
      />,
    );
    const iframe = getByTestId('cm-preview-iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/api/code/preview/sess-abc/5173/');
    expect(iframe.src).not.toContain('localhost:5173');
  });

  it('shows the pod-local URL as a label', () => {
    const { getByText } = render(
      <CodeModePreviewPanel
        port={5173}
        displayUrl="http://localhost:5173"
        framework="vite"
        sessionIdOverride="sess-abc"
      />,
    );
    expect(getByText('http://localhost:5173')).toBeInTheDocument();
  });

  it('shows the framework badge', () => {
    const { getByText } = render(
      <CodeModePreviewPanel
        port={3000}
        displayUrl="http://localhost:3000"
        framework="next"
        sessionIdOverride="sess-abc"
      />,
    );
    expect(getByText('next')).toBeInTheDocument();
  });

  it('refresh button cache-busts the iframe src', () => {
    const { getByTestId } = render(
      <CodeModePreviewPanel
        port={5173}
        displayUrl="http://localhost:5173"
        framework="vite"
        sessionIdOverride="sess-abc"
      />,
    );
    const iframe = getByTestId('cm-preview-iframe') as HTMLIFrameElement;
    const before = iframe.src;
    fireEvent.click(getByTestId('cm-preview-refresh'));
    const after = iframe.src;
    expect(after).not.toBe(before);
    expect(after).toMatch(/\?_=\d+/);
  });

  it('open-in-new-tab calls window.open with the proxy URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { getByTestId } = render(
      <CodeModePreviewPanel
        port={5173}
        displayUrl="http://localhost:5173"
        framework="vite"
        sessionIdOverride="sess-abc"
      />,
    );
    fireEvent.click(getByTestId('cm-preview-open-new-tab'));
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target] = openSpy.mock.calls[0];
    expect(typeof url === 'string' && url.includes('/api/code/preview/sess-abc/5173/')).toBe(true);
    expect(target).toBe('_blank');
    openSpy.mockRestore();
  });

  it('renders nothing when sessionId is missing', () => {
    const { container } = render(
      <CodeModePreviewPanel
        port={5173}
        displayUrl="http://localhost:5173"
        framework="vite"
        sessionIdOverride=""
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
