/**
 * Phase 11 — DcMap (mock 06 datacenter consolidation).
 *
 * Mock 06 anatomy (lines 590-595):
 *   <div class="dc-map">
 *     <div class="dc keep">
 *       <div class="code">dc-ash</div>
 *       <div class="role">Primary · ours</div>
 *       <div class="stats"><span>78 VMs</span><span>vSphere 8</span></div>
 *       <div class="action">KEEP · target</div>
 *     </div>
 *     ...
 *   </div>
 *
 * status drives the top-bar tone:
 *   keep (green) | migrate (amber) | retire (red)
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DcMap } from '../DcMap';

const centers = [
  { id: 'dc-ash', code: 'dc-ash', role: 'Primary · ours', stats: ['78 VMs', 'vSphere 8'], action: 'KEEP · target', status: 'keep' as const },
  { id: 'dc-sjc', code: 'dc-sjc', role: 'Secondary · ours', stats: ['42 VMs', 'vSphere 8'], action: 'KEEP · DR', status: 'keep' as const },
  { id: 'dc-chi', code: 'dc-chi', role: 'Theirs · primary', stats: ['64 VMs', 'Nutanix'], action: 'MIGRATE', status: 'migrate' as const },
  { id: 'dc-lon', code: 'dc-lon', role: 'Theirs · tertiary', stats: ['34 VMs', 'vSphere 6.7'], action: 'RETIRE (EU)', status: 'retire' as const },
];

describe('DcMap (mock 06)', () => {
  it('renders cm-dc-map root with one .dc cell per center', () => {
    const { container } = render(<DcMap centers={centers} />);
    expect(container.querySelector('.cm-dc-map')).not.toBeNull();
    expect(container.querySelectorAll('.cm-dc-map .dc').length).toBe(4);
  });

  it('applies status class (keep / migrate / retire) to each cell', () => {
    const { container } = render(<DcMap centers={centers} />);
    expect(container.querySelector('.dc.keep')).not.toBeNull();
    expect(container.querySelector('.dc.migrate')).not.toBeNull();
    expect(container.querySelector('.dc.retire')).not.toBeNull();
  });

  it('renders code / role / stats / action per cell', () => {
    const { container } = render(<DcMap centers={centers} />);
    const first = container.querySelector('.cm-dc-map .dc');
    expect(first?.querySelector('.code')).toHaveTextContent('dc-ash');
    expect(first?.querySelector('.role')).toHaveTextContent('Primary · ours');
    expect(first?.querySelector('.stats')).toHaveTextContent('78 VMs');
    expect(first?.querySelector('.stats')).toHaveTextContent('vSphere 8');
    expect(first?.querySelector('.action')).toHaveTextContent('KEEP · target');
  });

  it('renders nothing when centers empty', () => {
    const { container } = render(<DcMap centers={[]} />);
    expect(container.querySelector('.cm-dc-map')).toBeNull();
  });

  it('exposes role=group + aria-label for a11y', () => {
    const { container } = render(<DcMap centers={centers} ariaLabel="datacenter consolidation map" />);
    const root = container.querySelector('.cm-dc-map');
    expect(root?.getAttribute('role')).toBe('group');
    expect(root?.getAttribute('aria-label')).toBe('datacenter consolidation map');
  });
});
