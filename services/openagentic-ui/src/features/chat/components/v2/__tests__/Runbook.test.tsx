/**
 * Phase 21 — Runbook step list (mocks 04, 05, 08).
 *
 * Mock 04 anatomy:
 *   <div class="cm-runbook">
 *     <div class="cm-rb-hdr">
 *       <svg /> <span class="cm-rb-title">{title}</span>
 *       <span class="cm-rb-budget">budget 15m · actual 11m42s</span>
 *     </div>
 *     <div class="cm-rb-step">
 *       <div class="cm-n">T+0</div>
 *       <div class="cm-t">
 *         <strong>{title}</strong>: {body}
 *         <span class="cm-owner">{owner}</span>
 *       </div>
 *       <div class="cm-dur">{duration}</div>
 *     </div>
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Runbook } from '../Runbook';

const sample = {
  title: 'us-east-1 → us-west-2 promotion',
  budget: 'budget 15m · actual 11m42s',
  steps: [
    {
      tag: 'T+0',
      title: 'Detect',
      body: 'Prometheus alert region_health_us_east_1 == 0',
      owner: 'auto · no human required',
      duration: '60s',
    },
    {
      tag: 'T+1',
      title: 'Confirm',
      body: 'health probe from 3 non-affected regions',
      owner: 'sandbox · auto',
      duration: '30s',
    },
    {
      tag: 'T+4',
      title: 'Human gate',
      body: 'SRE on-call confirms promotion',
      owner: 'SRE on-call (human)',
      duration: '120s cap',
      severity: 'warn' as const,
    },
  ],
};

describe('Runbook (mocks 04, 05, 08)', () => {
  it('renders cm-runbook with cm-rb-hdr containing title + budget', () => {
    const { container } = render(<Runbook title={sample.title} budget={sample.budget} steps={sample.steps} />);
    const rb = container.querySelector('.cm-runbook');
    expect(rb).not.toBeNull();
    expect(rb!.querySelector('.cm-rb-title')).toHaveTextContent('us-east-1');
    expect(rb!.querySelector('.cm-rb-budget')).toHaveTextContent('actual 11m42s');
  });

  it('renders one cm-rb-step row per step', () => {
    const { container } = render(<Runbook title="t" steps={sample.steps} />);
    expect(container.querySelectorAll('.cm-rb-step').length).toBe(3);
  });

  it('renders cm-n tag, cm-t title+body, cm-owner, cm-dur per step', () => {
    const { container } = render(<Runbook title="t" steps={sample.steps} />);
    const first = container.querySelectorAll('.cm-rb-step')[0];
    expect(first.querySelector('.cm-n')).toHaveTextContent('T+0');
    expect(first.querySelector('.cm-t')).toHaveTextContent('Detect');
    expect(first.querySelector('.cm-t')).toHaveTextContent('Prometheus alert');
    expect(first.querySelector('.cm-owner')).toHaveTextContent('auto');
    expect(first.querySelector('.cm-dur')).toHaveTextContent('60s');
  });

  it('marks cm-sev-warn when step has severity=warn (e.g. human gate)', () => {
    const { container } = render(<Runbook title="t" steps={sample.steps} />);
    const steps = container.querySelectorAll('.cm-rb-step');
    expect(steps[2]).toHaveClass('cm-sev-warn');
    expect(steps[0]).not.toHaveClass('cm-sev-warn');
  });

  it('omits cm-rb-budget when budget not supplied', () => {
    const { container } = render(<Runbook title="t" steps={sample.steps} />);
    expect(container.querySelector('.cm-rb-budget')).toBeNull();
  });

  it('renders nothing when steps empty', () => {
    const { container } = render(<Runbook title="t" steps={[]} />);
    expect(container.querySelector('.cm-runbook')).toBeNull();
  });
});
