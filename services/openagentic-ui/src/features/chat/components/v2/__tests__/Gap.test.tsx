/**
 * Phase 11 — Gap (mock 05 SOC2 gap analysis, lines 660-678).
 *
 * Mock 05 anatomy: a tabular gap list with control / cloud / detail /
 * design-or-operating / severity / ticket. Each row tagged with severity.
 *
 *   <table class="cm-gap-list">
 *     <thead><tr><th>Control</th><th>Cloud</th><th>Detail</th><th>Kind</th><th>Sev</th><th>Ticket</th></tr></thead>
 *     <tbody>
 *       <tr data-severity="critical"><td>CC6.1</td><td>AWS</td><td>2 S3 buckets w/o SSE-KMS</td><td>operating</td><td><span class="sev sev-err">critical</span></td><td>SOC2-101</td></tr>
 *       ...
 *     </tbody>
 *   </table>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Gap } from '../Gap';

const sample = [
  { id: 'g1', control: 'CC6.1', cloud: 'AWS', detail: '2 S3 buckets w/o SSE-KMS', kind: 'operating' as const, severity: 'critical' as const, ticket: 'SOC2-101' },
  { id: 'g2', control: 'CC6.6', cloud: 'Azure', detail: '2 conditional-access policies in report-only', kind: 'operating' as const, severity: 'high' as const, ticket: 'SOC2-104' },
  { id: 'g3', control: 'A1.2', cloud: 'AWS', detail: 'Backup Vault retention not enforced', kind: 'design' as const, severity: 'med' as const, ticket: 'SOC2-110' },
];

describe('Gap (mock 05)', () => {
  it('renders cm-gap-list table with one row per gap', () => {
    const { container } = render(<Gap gaps={sample} />);
    expect(container.querySelector('table.cm-gap-list')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('emits column cells per gap (control / cloud / detail / kind / severity / ticket)', () => {
    const { container } = render(<Gap gaps={sample} />);
    const firstRow = container.querySelector('tbody tr');
    const cells = firstRow?.querySelectorAll('td');
    expect(cells?.[0]).toHaveTextContent('CC6.1');
    expect(cells?.[1]).toHaveTextContent('AWS');
    expect(cells?.[2]).toHaveTextContent('2 S3 buckets');
    expect(cells?.[3]).toHaveTextContent('operating');
    expect(cells?.[4]).toHaveTextContent('critical');
    expect(cells?.[5]).toHaveTextContent('SOC2-101');
  });

  it('tags row + severity span by severity class', () => {
    const { container } = render(<Gap gaps={sample} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].getAttribute('data-severity')).toBe('critical');
    expect(rows[0].querySelector('.sev')?.classList.contains('sev-err')).toBe(true);
    expect(rows[1].querySelector('.sev')?.classList.contains('sev-warn')).toBe(true);
    expect(rows[2].querySelector('.sev')?.classList.contains('sev-info')).toBe(true);
  });

  it('renders header thead with all columns', () => {
    const { container } = render(<Gap gaps={sample} />);
    const headers = container.querySelectorAll('thead th');
    expect(headers.length).toBeGreaterThanOrEqual(6);
    expect(headers[0]).toHaveTextContent(/control/i);
    expect(headers[4]).toHaveTextContent(/sev/i);
  });

  it('renders nothing when gaps empty', () => {
    const { container } = render(<Gap gaps={[]} />);
    expect(container.querySelector('table.cm-gap-list')).toBeNull();
  });
});
