/**
 * SeverityTag — inline severity pill primitive.
 *
 * Renders ok / warn / err / info pills used inside table cells, prose,
 * and status rows. Reference: mocks/UX/01-cloud-ops.html lines 1015-1071
 * (e.g. <span class="sev sev-warn">D4s_v5</span>).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SeverityTag } from '../SeverityTag';

describe('SeverityTag', () => {
  it('renders a <span> with class cm-sev cm-sev-{severity}', () => {
    const { container } = render(<SeverityTag severity="warn">D4s_v5</SeverityTag>);
    const el = container.querySelector('span');
    expect(el).toBeInTheDocument();
    expect(el!.className).toContain('cm-sev');
    expect(el!.className).toContain('cm-sev-warn');
  });

  it('renders children content', () => {
    const { container } = render(<SeverityTag severity="ok">healthy</SeverityTag>);
    expect(container.textContent).toBe('healthy');
  });

  it('severity ok uses green color', () => {
    const { container } = render(<SeverityTag severity="ok">ok</SeverityTag>);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.style.color).toBe('rgb(34, 197, 94)');
  });

  it('severity warn uses amber color', () => {
    const { container } = render(<SeverityTag severity="warn">warn</SeverityTag>);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.style.color).toBe('rgb(245, 158, 11)');
  });

  it('severity err uses red color', () => {
    const { container } = render(<SeverityTag severity="err">err</SeverityTag>);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.style.color).toBe('rgb(239, 68, 68)');
  });

  it('severity info uses blue color', () => {
    const { container } = render(<SeverityTag severity="info">info</SeverityTag>);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.style.color).toBe('rgb(56, 189, 248)');
  });

  it('respects passthrough className (appends, does not replace)', () => {
    const { container } = render(
      <SeverityTag severity="ok" className="extra-class">x</SeverityTag>,
    );
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.className).toContain('cm-sev');
    expect(el.className).toContain('cm-sev-ok');
    expect(el.className).toContain('extra-class');
  });
});
