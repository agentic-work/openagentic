/**
 * ConnectionDot — replaces the mocked "READY" pill in
 * CodeModeRunningHeader. Subscribes to useCodeModeStore.connectionState
 * and renders a real-time WebSocket connection indicator:
 *
 *   ●  connected      (success green)
 *   ●  connecting     (info blue, slowly pulsing)
 *   ●  reconnecting   (warning amber, with attempt count)
 *   ●  offline        (error red)  — for 'disconnected' or 'error'
 *
 * Plan: P5a in /home/trent/.claude/plans/logical-kindling-horizon.md.
 *
 * RED-first contract pinned here. The store selector is mocked so the
 * unit test doesn't need a full store provider.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { ConnectionDot } from '../ConnectionDot';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

afterEach(() => cleanup());

function setStore(
  state: {
    connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
    reconnectAttempts?: number;
  },
) {
  useCodeModeStore.setState(state as any, false);
}

describe('ConnectionDot', () => {
  it('renders "connected" when store.connectionState === "connected"', () => {
    setStore({ connectionState: 'connected' });
    render(<ConnectionDot />);
    expect(screen.getByTestId('cm-connection-dot')).toHaveAttribute(
      'data-state',
      'connected',
    );
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it('renders "connecting" when store.connectionState === "connecting"', () => {
    setStore({ connectionState: 'connecting' });
    render(<ConnectionDot />);
    expect(screen.getByTestId('cm-connection-dot')).toHaveAttribute(
      'data-state',
      'connecting',
    );
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders "reconnecting" with attempt number when reconnecting', () => {
    setStore({ connectionState: 'reconnecting', reconnectAttempts: 3 });
    render(<ConnectionDot />);
    expect(screen.getByTestId('cm-connection-dot')).toHaveAttribute(
      'data-state',
      'reconnecting',
    );
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('renders "offline" when store.connectionState === "disconnected"', () => {
    setStore({ connectionState: 'disconnected' });
    render(<ConnectionDot />);
    expect(screen.getByTestId('cm-connection-dot')).toHaveAttribute(
      'data-state',
      'offline',
    );
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('renders "offline" when store.connectionState === "error"', () => {
    setStore({ connectionState: 'error' });
    render(<ConnectionDot />);
    expect(screen.getByTestId('cm-connection-dot')).toHaveAttribute(
      'data-state',
      'offline',
    );
  });

  it('renders a single colored dot regardless of state', () => {
    // Fix #117 dropped the literal `●` text glyph (it was redundant
    // alongside the animated CSS dot — user feedback was "a bit over
    // much"). The ARIA-hidden circle <span> with non-zero
    // width/height is the canonical visual now.
    setStore({ connectionState: 'connected' });
    render(<ConnectionDot />);
    const dot = screen.getByTestId('cm-connection-dot');
    const circles = dot.querySelectorAll('span[aria-hidden="true"]');
    // At least one aria-hidden span carrying the dot circle.
    expect(circles.length).toBeGreaterThan(0);
  });
});

describe('ConnectionDot — does NOT mention "READY"', () => {
  // Hard regression guard: the new dot replaces the fake READY pill.
  // Any string containing READY would mean we accidentally regressed.
  for (const s of ['connected', 'connecting', 'reconnecting', 'disconnected', 'error'] as const) {
    it(`state=${s} contains no "READY" string`, () => {
      setStore({ connectionState: s });
      render(<ConnectionDot />);
      const text = document.body.textContent || '';
      expect(text).not.toMatch(/READY/);
      expect(text).not.toMatch(/\bTHINKING\b/);
    });
  }
});
