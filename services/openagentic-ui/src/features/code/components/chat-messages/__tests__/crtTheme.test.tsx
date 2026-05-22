import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { ThemeSelectorPill } from '../ThemeSelectorPill';

beforeEach(() => {
  localStorage.clear();
  document.body.classList.remove('cm-crt');
  // Remove any leftover overlay elements from a prior test
  document
    .querySelectorAll('[data-cm-crt-overlay]')
    .forEach((el) => el.remove());
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.classList.remove('cm-crt');
});

function openDropdown(container: HTMLElement) {
  const pill = container.querySelector(
    '[data-testid="cm-theme-selector-pill"]',
  ) as HTMLButtonElement | null;
  expect(pill).not.toBeNull();
  fireEvent.click(pill!);
}

describe('CRT theme toggle', () => {
  it('does NOT apply cm-crt class on default mount', () => {
    render(<ThemeSelectorPill />);
    expect(document.body.classList.contains('cm-crt')).toBe(false);
    expect(document.querySelector('[data-cm-crt-overlay]')).toBeNull();
  });

  it('toggling on adds .cm-crt to body, persists to localStorage, and renders overlay', () => {
    const { container } = render(<ThemeSelectorPill />);
    openDropdown(container);

    const toggle = document.querySelector(
      '[data-testid="cm-crt-toggle"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);

    expect(document.body.classList.contains('cm-crt')).toBe(true);
    expect(localStorage.getItem('cm-crt-mode')).toBe('true');

    const overlay = document.querySelector(
      '[data-cm-crt-overlay]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    // Inline style guarantees the overlay can't intercept clicks even
    // if a stylesheet rule is overridden — we assert both.
    expect(overlay!.style.pointerEvents).toBe('none');
    expect(overlay!.style.position).toBe('fixed');
  });

  it('re-mount with localStorage["cm-crt-mode"]="true" re-applies the class and overlay', () => {
    localStorage.setItem('cm-crt-mode', 'true');
    render(<ThemeSelectorPill />);

    expect(document.body.classList.contains('cm-crt')).toBe(true);
    expect(document.querySelector('[data-cm-crt-overlay]')).not.toBeNull();
  });

  it('toggling off removes the class, removes the overlay, and writes "false"', () => {
    localStorage.setItem('cm-crt-mode', 'true');
    const { container } = render(<ThemeSelectorPill />);
    expect(document.body.classList.contains('cm-crt')).toBe(true);

    openDropdown(container);
    const toggle = document.querySelector(
      '[data-testid="cm-crt-toggle"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);

    expect(document.body.classList.contains('cm-crt')).toBe(false);
    expect(localStorage.getItem('cm-crt-mode')).toBe('false');
    expect(document.querySelector('[data-cm-crt-overlay]')).toBeNull();
  });
});
