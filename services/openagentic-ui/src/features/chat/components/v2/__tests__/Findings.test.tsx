/**
 * Phase 14 of universal-anatomy parity — Findings primitive.
 *
 * Mock anatomy: mocks 03, 07, 08, 09 — numbered findings list with
 * severity variants. Used for security/audit/SOC reviews.
 *
 *   <div class="cm-findings">
 *     <div class="cm-finding cm-sev-med">
 *       <div class="cm-f-head">
 *         <span class="cm-ord">1</span>
 *         <span class="cm-title">ClickHouse JDBC URL uses HTTP</span>
 *         <span class="cm-sev">med</span>
 *       </div>
 *       <div class="cm-f-body">...</div>
 *     </div>
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Findings } from '../Findings';

const sample = [
  {
    id: '1',
    title: 'ClickHouse JDBC URL uses HTTP, not HTTPS',
    severity: 'med' as const,
    body: 'plaintext credentials over Flink → ClickHouse hop',
  },
  {
    id: '2',
    title: 'Kafka SASL password read from env, but env not gated',
    severity: 'high' as const,
    body: 'fails-silent with null password',
  },
  {
    id: '3',
    title: 'RLS policy missing on SubscriptionItem table',
    severity: 'critical' as const,
    body: 'cross-tenant read possible',
  },
];

describe('Findings (mocks 03, 07, 08, 09)', () => {
  it('renders cm-findings with one cm-finding per item', () => {
    const { container } = render(<Findings items={sample} />);
    const root = container.querySelector('.cm-findings');
    expect(root).not.toBeNull();
    expect(root!.querySelectorAll('.cm-finding').length).toBe(3);
  });

  it('emits cm-sev-{severity} variant on each finding', () => {
    const { container } = render(<Findings items={sample} />);
    const finds = container.querySelectorAll('.cm-finding');
    expect(finds[0]).toHaveClass('cm-sev-med');
    expect(finds[1]).toHaveClass('cm-sev-high');
    expect(finds[2]).toHaveClass('cm-sev-critical');
  });

  it('renders cm-ord ordinal + cm-title + cm-sev label per finding', () => {
    const { container } = render(<Findings items={sample} />);
    const heads = container.querySelectorAll('.cm-f-head');
    expect(heads[0].querySelector('.cm-ord')).toHaveTextContent('1');
    expect(heads[0].querySelector('.cm-title')).toHaveTextContent('ClickHouse');
    expect(heads[0].querySelector('.cm-sev')).toHaveTextContent('med');
  });

  it('renders cm-f-body when body is supplied', () => {
    const { container } = render(<Findings items={sample} />);
    const bodies = container.querySelectorAll('.cm-f-body');
    expect(bodies.length).toBe(3);
    expect(bodies[0]).toHaveTextContent('plaintext');
  });

  it('omits cm-f-body when body is missing', () => {
    const { container } = render(
      <Findings items={[{ id: 'x', title: 'no body', severity: 'low' }]} />,
    );
    expect(container.querySelector('.cm-f-body')).toBeNull();
  });

  it('renders nothing when items empty', () => {
    const { container } = render(<Findings items={[]} />);
    expect(container.querySelector('.cm-findings')).toBeNull();
  });
});
