/**
 * Phase 1 of universal-anatomy parity — ToolsPill (topbar internal/connected).
 *
 * Mock anatomy: mocks/UX/01:146-152 + 10:205
 *   <span class="cm-tools-pill">
 *     <span class="cm-dot" />
 *     11 internal · 158 connected
 *   </span>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolsPill } from '../ToolsPill';

describe('ToolsPill (mock 10:205)', () => {
  it('renders cm-tools-pill with cm-dot and "N internal · M connected" text', () => {
    const { container } = render(<ToolsPill internal={11} connected={158} />);
    const pill = container.querySelector('.cm-tools-pill');
    expect(pill).not.toBeNull();
    expect(pill!.querySelector('.cm-dot')).not.toBeNull();
    expect(pill).toHaveTextContent('11 internal');
    expect(pill).toHaveTextContent('158 connected');
  });

  it('omits the connected segment when connected is 0', () => {
    const { container } = render(<ToolsPill internal={11} connected={0} />);
    expect(container.querySelector('.cm-tools-pill')).toHaveTextContent('11 internal');
    expect(container.querySelector('.cm-tools-pill')).not.toHaveTextContent('connected');
  });

  it('renders nothing when both counts are 0', () => {
    const { container } = render(<ToolsPill internal={0} connected={0} />);
    expect(container.querySelector('.cm-tools-pill')).toBeNull();
  });
});
