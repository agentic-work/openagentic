/**
 * Gap — compliance gap list (mock 05 SOC 2 gap analysis).
 *
 *   <table class="cm-gap-list">
 *     <thead>
 *       <tr><th>Control</th><th>Cloud</th><th>Detail</th>
 *           <th>Kind</th><th>Sev</th><th>Ticket</th></tr>
 *     </thead>
 *     <tbody>
 *       <tr data-severity="critical">
 *         <td class="mono">CC6.1</td>
 *         <td class="mono">AWS</td>
 *         <td>2 S3 buckets w/o SSE-KMS</td>
 *         <td class="mono">operating</td>
 *         <td><span class="sev sev-err">critical</span></td>
 *         <td class="mono">SOC2-101</td>
 *       </tr>
 *     </tbody>
 *   </table>
 *
 * Severity → sev-* class:
 *   critical → sev-err   (red)
 *   high     → sev-warn  (orange)
 *   med      → sev-info  (amber)
 *   low      → sev-ok    (green)
 *
 * outputTemplate slug: `gap_list`.
 *
 * the design notes
 *       Phase 11, Task 11.3.
 */

import React from 'react';

export type GapSeverity = 'critical' | 'high' | 'med' | 'low';
export type GapKind = 'design' | 'operating';

export interface GapItem {
  id: string;
  control: string;
  cloud: string;
  detail: React.ReactNode;
  kind: GapKind;
  severity: GapSeverity;
  ticket?: string;
  owner?: string;
}

export interface GapProps {
  gaps: ReadonlyArray<GapItem>;
  /** ARIA label for the table. */
  ariaLabel?: string;
}

const SEV_CLASS: Record<GapSeverity, string> = {
  critical: 'sev-err',
  high: 'sev-warn',
  med: 'sev-info',
  low: 'sev-ok',
};

export function Gap({ gaps, ariaLabel }: GapProps) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <table className="cm-gap-list" data-testid="gap-list" aria-label={ariaLabel ?? 'compliance gap list'}>
      <thead>
        <tr>
          <th scope="col">Control</th>
          <th scope="col">Cloud</th>
          <th scope="col">Detail</th>
          <th scope="col">Kind</th>
          <th scope="col">Sev</th>
          <th scope="col">Ticket</th>
        </tr>
      </thead>
      <tbody>
        {gaps.map((g) => (
          <tr key={g.id} data-severity={g.severity}>
            <td className="mono">{g.control}</td>
            <td className="mono">{g.cloud}</td>
            <td>{g.detail}</td>
            <td className="mono">{g.kind}</td>
            <td>
              <span className={`sev ${SEV_CLASS[g.severity]}`}>{g.severity}</span>
            </td>
            <td className="mono">{g.ticket ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
