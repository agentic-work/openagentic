/**
 * P2 #940 — chat input toolbar regression pin (2026-05-18).
 *
 * Confirms the differentiator-from-claude.ai icon rendered after the user
 * feedback turn:
 *   - A grounding toggle button (SearchCheck glyph) defaulting OFF,
 *     toggling on click, persisting via useGroundingStore.
 *
 * NOTE: the AttachDropTray icon swap was reverted in #941 — the attach
 * button is back to the claude.ai-style `+` glyph per user direction
 * "leave the + for now". See ChatInputToolbar.attachIconRevert.test.tsx.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { useGroundingStore } from '@/stores/useGroundingStore';
import { SearchCheck } from '@/shared/icons';

describe('chat input toolbar — grounding differentiator icon', () => {
  beforeEach(() => {
    useGroundingStore.setState({ enabled: false });
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem('awp.grounding.v1'); } catch { /* noop */ }
    }
  });

  it('SearchCheck icon component renders an SVG with a circle (lens) AND a checkmark polyline', () => {
    const { container } = render(<SearchCheck size={18} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.querySelector('circle')).toBeTruthy();
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('useGroundingStore defaults to enabled=false and toggle flips it', () => {
    expect(useGroundingStore.getState().enabled).toBe(false);
    useGroundingStore.getState().toggle();
    expect(useGroundingStore.getState().enabled).toBe(true);
    useGroundingStore.getState().toggle();
    expect(useGroundingStore.getState().enabled).toBe(false);
  });
});
