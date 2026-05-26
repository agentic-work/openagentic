/**
 * CodemodeFooterModelPill — reactive footer pill that surfaces the
 * currently-active codemode model.
 *
 * Source of truth: `useCodeModeStore.session.model`. The /model slash
 * command goes daemon-side, the daemon emits a `warmup` event, the
 * websocket hook calls `store.updateSessionModel(model)`, and this
 * pill re-renders. Pre-fix the footer showed no model at all — users
 * could swap models with /model and nothing on the screen confirmed
 * the swap landed.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { CodemodeFooterModelPill } from '../CodemodeFooterModelPill';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

function setSession(model: string | null) {
  useCodeModeStore.setState(
    {
      session: model === null
        ? null
        : ({
            sessionId: 's1',
            userId: 'u1',
            workspacePath: '/workspace',
            model,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
          } as any),
    } as any,
    false,
  );
}

beforeEach(() => {
  setSession('claude-sonnet-4-6');
});

afterEach(() => {
  cleanup();
});

describe('CodemodeFooterModelPill', () => {
  it('renders the model from session.model', () => {
    render(<CodemodeFooterModelPill />);
    const pill = screen.getByTestId('cm-composer-model-chip');
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toContain('claude-sonnet-4-6');
  });

  it('falls back to "auto" when session.model is empty', () => {
    setSession('');
    render(<CodemodeFooterModelPill />);
    const pill = screen.getByTestId('cm-composer-model-chip');
    expect(pill.textContent).toContain('auto');
  });

  it('falls back to "auto" when there is no session at all', () => {
    setSession(null);
    render(<CodemodeFooterModelPill />);
    const pill = screen.getByTestId('cm-composer-model-chip');
    expect(pill.textContent).toContain('auto');
  });

  it('reacts to updateSessionModel — the canonical /model slash path', () => {
    render(<CodemodeFooterModelPill />);
    expect(screen.getByTestId('cm-composer-model-chip').textContent).toContain(
      'claude-sonnet-4-6',
    );

    // Simulate the daemon→websocket→store update path that /model fires.
    act(() => {
      useCodeModeStore.getState().updateSessionModel('gpt-oss:20b');
    });

    expect(screen.getByTestId('cm-composer-model-chip').textContent).toContain(
      'gpt-oss:20b',
    );
  });

  it('exposes a "model" label prefix so the chip reads as cwd does', () => {
    render(<CodemodeFooterModelPill />);
    const pill = screen.getByTestId('cm-composer-model-chip');
    expect(pill.textContent).toContain('model');
  });

  it('full model id stays available via title attribute for hover', () => {
    setSession('us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    render(<CodemodeFooterModelPill />);
    const pill = screen.getByTestId('cm-composer-model-chip');
    expect(pill.getAttribute('title')).toBe(
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    );
  });
});
