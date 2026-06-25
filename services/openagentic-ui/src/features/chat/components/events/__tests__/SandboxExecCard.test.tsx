/**
 * SandboxExecCard — task #158 render test.
 *
 * Covers the three visible states: auto-run → success, error from a
 * rejected runner, and the pre-filled `result` path used for history
 * re-hydration.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SandboxExecCard } from '../SandboxExecCard';
import type { BrowserExecRequest, BrowserExecResult } from '../../../../../sandbox/types';

const req: BrowserExecRequest = {
  requestId: 'r-1',
  language: 'python',
  code: 'print("hi")',
};

describe('SandboxExecCard', () => {
  it('renders the code snippet and language pill', () => {
    render(<SandboxExecCard request={req} autoRun={false} />);
    expect(screen.getByTestId('sandbox-exec-card')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-code')).toHaveTextContent('print("hi")');
    expect(screen.getByTestId('sandbox-exec-card').getAttribute('data-language'))
      .toBe('python');
  });

  it('auto-runs on mount and renders stdout on success', async () => {
    const result: BrowserExecResult = {
      requestId: 'r-1',
      ok: true,
      stdout: 'hi\n',
      stderr: '',
      durationMs: 42,
    };
    const onRun = vi.fn().mockResolvedValue(result);

    await act(async () => {
      render(<SandboxExecCard request={req} onRun={onRun} />);
    });

    await waitFor(() => {
      expect(onRun).toHaveBeenCalledWith(req);
      expect(screen.getByTestId('sandbox-stdout')).toHaveTextContent('hi');
      expect(screen.getByTestId('sandbox-exec-card').getAttribute('data-state'))
        .toBe('success');
    });
  });

  it('renders the error state when the runner throws', async () => {
    const onRun = vi.fn().mockRejectedValue(new Error('worker died'));
    await act(async () => {
      render(<SandboxExecCard request={req} onRun={onRun} />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-exec-card').getAttribute('data-state'))
        .toBe('error');
      expect(screen.getByTestId('sandbox-stderr')).toHaveTextContent('worker died');
    });
  });

  it('hydrates from an external result without calling the runner', () => {
    const onRun = vi.fn();
    const result: BrowserExecResult = {
      requestId: 'r-1',
      ok: true,
      stdout: 'cached\n',
      stderr: '',
      durationMs: 100,
    };
    render(<SandboxExecCard request={req} result={result} onRun={onRun} autoRun={false} />);
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('sandbox-stdout')).toHaveTextContent('cached');
    expect(screen.getByTestId('sandbox-exec-card').getAttribute('data-state'))
      .toBe('success');
  });

  it('renders base64 image data URLs when the sandbox returns figures', () => {
    const result: BrowserExecResult = {
      requestId: 'r-1',
      ok: true,
      stdout: '',
      stderr: '',
      durationMs: 10,
      images: [{ mime: 'image/png', base64: 'iVBORw0KGgo=' }],
    };
    render(<SandboxExecCard request={req} result={result} autoRun={false} />);
    const imgs = screen.getByTestId('sandbox-images');
    expect(imgs.querySelector('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });

  it('labels the card "JS Sandbox" for javascript runs', () => {
    render(
      <SandboxExecCard
        request={{ ...req, language: 'javascript' }}
        autoRun={false}
      />,
    );
    expect(screen.getByTestId('sandbox-exec-card').textContent).toContain('JS Sandbox');
  });
});
