/**
 * ThemeContext regression — instant (no-reload) repaint.
 *
 * The bug this guards: ThemeContext fired a synthetic same-tab `storage`
 * event for accent (applyAccentColor) but NOT for theme (applyTheme), so
 * theme toggles never reached the admin `useTheme` hook (which re-reads only
 * on real storage/focus) — admin surfaces needed a reload to repaint.
 *
 * These tests assert the SOT writes happen synchronously on change:
 *   - changeTheme → [data-theme] on <html> + <body> + a same-tab `ac-theme`
 *     StorageEvent so the admin hook re-syncs without a reload.
 *   - changeAccentColor → inline --user-accent on <html> (the canonical accent
 *     driver theme.css derives every tint from) + the same-tab `ac-accent-color`
 *     StorageEvent (unchanged, must stay intact).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as React from 'react';
import { ThemeProvider, useTheme, accentColors } from '../ThemeContext';

// A tiny harness that surfaces the context setters to the test.
let api: ReturnType<typeof useTheme> | null = null;
function Capture() {
  api = useTheme();
  return null;
}

function mount() {
  return render(
    <ThemeProvider>
      <Capture />
    </ThemeProvider>,
  );
}

describe('ThemeContext — instant repaint (no reload)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.body.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--user-accent');
    api = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('changeTheme sets [data-theme] on <html> and <body> synchronously', () => {
    mount();
    expect(api).not.toBeNull();

    act(() => api!.changeTheme('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.body.getAttribute('data-theme')).toBe('light');

    act(() => api!.changeTheme('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('data-theme')).toBe('dark');
  });

  it('changeTheme fires a same-tab ac-theme storage event so admin re-syncs without reload', () => {
    mount();
    const events: StorageEvent[] = [];
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ac-theme') events.push(e);
    };
    window.addEventListener('storage', onStorage);

    act(() => api!.changeTheme('light'));

    window.removeEventListener('storage', onStorage);
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].newValue).toBe('light');
    // The fresh value must be persisted BEFORE the event fires, so a listener
    // that re-reads localStorage on the event sees 'light', not a stale value.
    expect(localStorage.getItem('ac-theme')).toBe('light');
  });

  it('changeAccentColor writes the inline --user-accent driver on <html>', () => {
    mount();
    const target = accentColors.find((a) => a.name === 'Blue') ?? accentColors[1];

    act(() => api!.changeAccentColor(target));
    expect(document.documentElement.style.getPropertyValue('--user-accent')).toBe(target.primary);
  });

  it('changeAccentColor still fires the same-tab ac-accent-color storage event', () => {
    mount();
    const events: StorageEvent[] = [];
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ac-accent-color') events.push(e);
    };
    window.addEventListener('storage', onStorage);

    const target = accentColors.find((a) => a.name === 'Green') ?? accentColors[2];
    act(() => api!.changeAccentColor(target));

    window.removeEventListener('storage', onStorage);
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.parse(events[events.length - 1].newValue || 'null')?.name).toBe(target.name);
  });
});
