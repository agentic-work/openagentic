/**
 * Phase 1 — ChatHeader integration: topbar must render Crumbs + ToolsPill +
 * TopbarCostPill in left-to-right order to match mock 01:128-153 anatomy.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// ExportButton transitively imports html2pdf.js which doesn't resolve in
// jsdom; stub it out — this test only cares about the v2 topbar primitives.
vi.mock('../ExportButton', () => ({ default: () => null }));

import ChatHeader from '../ChatHeader';

describe('ChatHeader topbar parity (mock 01:128-153)', () => {
  it('renders cm-crumbs, cm-tools-pill, and cm-cost-pill in that order', () => {
    const { container } = render(
      <ChatHeader
        title="VM right-sizing audit"
        crumbsTrail={['Chat', 'Azure', 'VM right-sizing audit']}
        toolsInternal={11}
        toolsConnected={158}
      />,
    );
    const root = container.querySelector('.cm-v2');
    expect(root).not.toBeNull();

    const crumbs = root!.querySelector('.cm-crumbs');
    const toolsPill = root!.querySelector('.cm-tools-pill');
    const costPill = root!.querySelector('.cm-cost-pill');

    expect(crumbs).not.toBeNull();
    expect(toolsPill).not.toBeNull();
    expect(costPill).not.toBeNull();

    // Document order: crumbs first, tools-pill before cost-pill.
    const all = Array.from(root!.querySelectorAll('.cm-crumbs, .cm-tools-pill, .cm-cost-pill'));
    expect(all[0]).toBe(crumbs);
    expect(all[1]).toBe(toolsPill);
    expect(all[2]).toBe(costPill);
  });
});
