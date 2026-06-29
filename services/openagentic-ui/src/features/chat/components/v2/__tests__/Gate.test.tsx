/**
 * Phase 11 — Gate (mock 06 rollback gates, lines 699-728).
 *
 * Mock 06 anatomy:
 *   <div class="gate">
 *     <div class="g-ico">G1</div>
 *     <div class="g-body">
 *       <div class="title">Wave 1 gate · retirement confirmed</div>
 *       <div class="sub">All 34 VMs powered off for 7 days; ...</div>
 *     </div>
 *     <div class="g-meta">day 14<br/>owner: SRE</div>
 *   </div>
 *
 * Status drives the g-ico tint — pending (accent), passed (ok), failed (err).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Gate } from '../Gate';

describe('Gate (mock 06)', () => {
  it('renders cm-gate root with g-ico / g-body (title + sub) / g-meta', () => {
    const { container } = render(
      <Gate
        tag="G1"
        title="Wave 1 gate · retirement confirmed"
        sub="All 34 VMs powered off for 7 days."
        meta={['day 14', 'owner: SRE']}
        status="pending"
      />
    );
    expect(container.querySelector('.cm-gate')).not.toBeNull();
    expect(container.querySelector('.g-ico')).toHaveTextContent('G1');
    expect(container.querySelector('.g-body .title')).toHaveTextContent('Wave 1 gate');
    expect(container.querySelector('.g-body .sub')).toHaveTextContent('powered off for 7 days');
    expect(container.querySelector('.g-meta')).toHaveTextContent('day 14');
    expect(container.querySelector('.g-meta')).toHaveTextContent('owner: SRE');
  });

  it('applies status class (pending / passed / failed)', () => {
    const { container, rerender } = render(
      <Gate tag="G2" title="t" sub="s" status="passed" />
    );
    expect(container.querySelector('.cm-gate.passed')).not.toBeNull();
    rerender(<Gate tag="G2" title="t" sub="s" status="failed" />);
    expect(container.querySelector('.cm-gate.failed')).not.toBeNull();
    rerender(<Gate tag="G2" title="t" sub="s" status="pending" />);
    expect(container.querySelector('.cm-gate.pending')).not.toBeNull();
  });

  it('omits g-meta when meta is undefined / empty', () => {
    const { container } = render(
      <Gate tag="G3" title="x" sub="y" status="pending" />
    );
    expect(container.querySelector('.g-meta')).toBeNull();
  });

  it('exposes role=group + aria-label', () => {
    const { container } = render(
      <Gate
        tag="G4"
        title="cutover gate"
        sub="approval req"
        status="pending"
        ariaLabel="Wave 4 cutover gate"
      />
    );
    const root = container.querySelector('.cm-gate');
    expect(root?.getAttribute('role')).toBe('group');
    expect(root?.getAttribute('aria-label')).toBe('Wave 4 cutover gate');
  });
});
