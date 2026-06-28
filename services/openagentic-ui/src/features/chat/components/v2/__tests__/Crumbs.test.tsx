/**
 * Phase 1 of universal-anatomy parity — Crumbs (topbar breadcrumb).
 *
 * Mock anatomy: mocks/UX/01-cloud-ops.html:144 + chatmode-v2.css `.cm-crumbs`
 *   <nav class="cm-crumbs">
 *     <span class="cm-crumb">Chat</span>
 *     <span class="cm-sep">/</span>
 *     <span class="cm-crumb">Azure</span>
 *     <span class="cm-sep">/</span>
 *     <span class="cm-crumb cm-active">VM right-sizing audit</span>
 *   </nav>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Crumbs } from '../Crumbs';

describe('Crumbs (mock 01:144)', () => {
  it('renders a nav.cm-crumbs with one cm-crumb per item separated by cm-sep', () => {
    const { container } = render(<Crumbs trail={['Chat', 'Azure', 'VM right-sizing audit']} />);
    const nav = container.querySelector('nav.cm-crumbs');
    expect(nav).not.toBeNull();
    const crumbs = nav!.querySelectorAll('.cm-crumb');
    const seps = nav!.querySelectorAll('.cm-sep');
    expect(crumbs.length).toBe(3);
    expect(seps.length).toBe(2);
    expect(crumbs[0]).toHaveTextContent('Chat');
    expect(crumbs[2]).toHaveTextContent('VM right-sizing audit');
  });

  it('marks the last crumb cm-active', () => {
    const { container } = render(<Crumbs trail={['Chat', 'Azure', 'VM']} />);
    const last = container.querySelectorAll('.cm-crumb');
    expect(last[last.length - 1]).toHaveClass('cm-active');
    expect(last[0]).not.toHaveClass('cm-active');
  });

  it('renders nothing when trail is empty', () => {
    const { container } = render(<Crumbs trail={[]} />);
    expect(container.querySelector('nav.cm-crumbs')).toBeNull();
  });
});
