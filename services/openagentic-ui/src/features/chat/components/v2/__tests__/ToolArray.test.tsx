/**
 * Phase 2 of universal-anatomy parity — ToolArray (tool-array hint pill row).
 *
 * Mock 10:227-241 anatomy:
 *   <div class="cm-tool-array">
 *     <span class="cm-label">Tools</span>
 *     <span class="cm-tool-chip cm-tier-1">
 *       <span class="cm-tier">T1</span>
 *       <span class="cm-name">visualize.show_widget</span>
 *     </span>
 *     <span class="cm-tool-chip cm-tier-2">
 *       <span class="cm-tier">T2</span>
 *       <span class="cm-name">tool_search</span>
 *       <span class="cm-count">azure (46)</span>
 *     </span>
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolArray } from '../ToolArray';

const mockTools = [
  { name: 'visualize.show_widget', tier: 1 as const },
  { name: 'render_diagram_v0', tier: 1 as const },
  { name: 'tool_search', tier: 1 as const },
  { name: 'tool_search', tier: 2 as const, count: 'azure (46)' },
];

describe('ToolArray (mock 10:227-241)', () => {
  it('renders cm-tool-array with cm-label "Tools" + one chip per tool', () => {
    const { container } = render(<ToolArray tools={mockTools} />);
    const root = container.querySelector('.cm-tool-array');
    expect(root).not.toBeNull();
    expect(root!.querySelector('.cm-label')).toHaveTextContent('Tools');
    expect(root!.querySelectorAll('.cm-tool-chip').length).toBe(4);
  });

  it('puts the correct cm-tier-{n} variant on each chip', () => {
    const { container } = render(<ToolArray tools={mockTools} />);
    const chips = container.querySelectorAll('.cm-tool-chip');
    expect(chips[0]).toHaveClass('cm-tier-1');
    expect(chips[3]).toHaveClass('cm-tier-2');
  });

  it('renders the optional cm-count for chips with a count value', () => {
    const { container } = render(<ToolArray tools={mockTools} />);
    const chips = container.querySelectorAll('.cm-tool-chip');
    expect(chips[0].querySelector('.cm-count')).toBeNull();
    expect(chips[3].querySelector('.cm-count')).toHaveTextContent('azure (46)');
  });

  it('renders cm-tier "T{n}" badges', () => {
    const { container } = render(<ToolArray tools={mockTools} />);
    const tiers = container.querySelectorAll('.cm-tool-chip .cm-tier');
    expect(tiers[0]).toHaveTextContent('T1');
    expect(tiers[3]).toHaveTextContent('T2');
  });

  it('renders nothing when tools is empty', () => {
    const { container } = render(<ToolArray tools={[]} />);
    expect(container.querySelector('.cm-tool-array')).toBeNull();
  });
});
