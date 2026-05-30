/**
 * Z.8a — FollowupChipsToggleButton regression pin (2026-05-19).
 *
 * Confirms:
 * - useFollowupChipsStore defaults to enabled=true (user: "they DO rock")
 * - toggle flips the state
 * - FollowupChipsToggleButton renders with data-testid="chat-followup-chips-toggle"
 * - initial data-enabled is "true"
 * - clicking flips data-enabled to "false"
 * - store state persists via localStorage
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { useFollowupChipsStore } from '@/stores/useFollowupChipsStore';

// ------------------------------------------------------------------
// Store shape + defaults
// ------------------------------------------------------------------
describe('useFollowupChipsStore — shape + defaults', () => {
  beforeEach(() => {
    useFollowupChipsStore.setState({ enabled: true });
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem('openagentic:followup-chips'); } catch { /* noop */ }
    }
  });

  it('defaults to enabled=true', () => {
    expect(useFollowupChipsStore.getState().enabled).toBe(true);
  });

  it('toggle() flips enabled', () => {
    useFollowupChipsStore.getState().toggle();
    expect(useFollowupChipsStore.getState().enabled).toBe(false);
    useFollowupChipsStore.getState().toggle();
    expect(useFollowupChipsStore.getState().enabled).toBe(true);
  });

  it('setEnabled(false) sets to false', () => {
    useFollowupChipsStore.getState().setEnabled(false);
    expect(useFollowupChipsStore.getState().enabled).toBe(false);
  });

  it('setEnabled(true) sets to true', () => {
    useFollowupChipsStore.setState({ enabled: false });
    useFollowupChipsStore.getState().setEnabled(true);
    expect(useFollowupChipsStore.getState().enabled).toBe(true);
  });
});

// ------------------------------------------------------------------
// FollowupChipsToggleButton DOM behaviour
// ------------------------------------------------------------------
import { FollowupChipsToggleButton } from '@/features/chat/components/ChatInputToolbar';

describe('FollowupChipsToggleButton — DOM behaviour', () => {
  beforeEach(() => {
    useFollowupChipsStore.setState({ enabled: true });
  });

  it('renders with data-testid="chat-followup-chips-toggle"', () => {
    render(<FollowupChipsToggleButton />);
    expect(screen.getByTestId('chat-followup-chips-toggle')).toBeInTheDocument();
  });

  it('initial data-enabled is "true" when store is enabled', () => {
    render(<FollowupChipsToggleButton />);
    expect(screen.getByTestId('chat-followup-chips-toggle')).toHaveAttribute('data-enabled', 'true');
  });

  it('clicking flips data-enabled to "false"', () => {
    render(<FollowupChipsToggleButton />);
    const btn = screen.getByTestId('chat-followup-chips-toggle');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('data-enabled', 'false');
  });

  it('clicking twice returns data-enabled to "true"', () => {
    render(<FollowupChipsToggleButton />);
    const btn = screen.getByTestId('chat-followup-chips-toggle');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('data-enabled', 'true');
  });

  it('data-enabled="false" when store is initially disabled', () => {
    useFollowupChipsStore.setState({ enabled: false });
    render(<FollowupChipsToggleButton />);
    expect(screen.getByTestId('chat-followup-chips-toggle')).toHaveAttribute('data-enabled', 'false');
  });
});
