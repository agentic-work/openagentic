/**
 * StatusRow — v2 chatmode primitive (#502).
 *
 * Horizontal flex row of label / value status items, optionally
 * decorated with leading icons and severity tones.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatusRow } from '../StatusRow';

describe('StatusRow', () => {
  it('renders one item per `items` prop entry', () => {
    const { container } = render(
      <StatusRow
        items={[
          { label: 'Region' },
          { label: 'Cost' },
          { label: 'Status' },
        ]}
      />,
    );
    const items = container.querySelectorAll('.cm-sr-item');
    expect(items.length).toBe(3);
  });

  it('renders each item label', () => {
    render(
      <StatusRow
        items={[
          { label: 'Region' },
          { label: 'Cost' },
        ]}
      />,
    );
    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
  });

  it('renders the value when provided in JetBrains Mono font', () => {
    const { container } = render(
      <StatusRow items={[{ label: 'Region', value: 'eastus2' }]} />,
    );
    const valueEl = container.querySelector('.cm-sr-value') as HTMLSpanElement;
    expect(valueEl).not.toBeNull();
    expect(valueEl.textContent).toBe('eastus2');
    expect(valueEl.style.fontFamily).toContain('JetBrains Mono');
  });

  it('renders the icon when provided', () => {
    render(
      <StatusRow
        items={[
          {
            label: 'Region',
            icon: <span data-testid="custom-icon">[*]</span>,
          },
        ]}
      />,
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  // #873 (2026-05-15) — Rule 8(b): severity colors resolve via canonical
  // --cm-* tokens so light/dark/accent variants all win at runtime.
  // jsdom does not evaluate CSS custom properties, so style.color reads
  // back as the raw `var(--cm-*)` literal — that's the contract we pin.
  it('severity "ok" applies var(--cm-ok)', () => {
    const { container } = render(
      <StatusRow items={[{ label: 'Healthy', severity: 'ok' }]} />,
    );
    const item = container.querySelector('.cm-sr-item') as HTMLSpanElement;
    expect(item.style.color).toBe('var(--cm-ok)');
  });

  it('severity "warn" applies var(--cm-warn)', () => {
    const { container } = render(
      <StatusRow items={[{ label: 'Degraded', severity: 'warn' }]} />,
    );
    const item = container.querySelector('.cm-sr-item') as HTMLSpanElement;
    expect(item.style.color).toBe('var(--cm-warn)');
  });

  it('severity "err" applies var(--cm-err)', () => {
    const { container } = render(
      <StatusRow items={[{ label: 'Down', severity: 'err' }]} />,
    );
    const item = container.querySelector('.cm-sr-item') as HTMLSpanElement;
    expect(item.style.color).toBe('var(--cm-err)');
  });

  it('with no severity, item color falls back to neutral fg', () => {
    const { container } = render(
      <StatusRow items={[{ label: 'Plain' }]} />,
    );
    const item = container.querySelector('.cm-sr-item') as HTMLSpanElement;
    // No severity inline color — should be empty (inherits from row).
    expect(item.style.color).toBe('');
  });
});
