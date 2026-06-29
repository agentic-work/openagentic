/**
 * DcMap — datacenter consolidation grid (mock 06).
 *
 * Mock 06 lines 590-595 anatomy:
 *   <div class="dc-map">
 *     <div class="dc keep">
 *       <div class="code">dc-ash</div>
 *       <div class="role">Primary · ours</div>
 *       <div class="stats"><span>78 VMs</span><span>vSphere 8</span></div>
 *       <div class="action">KEEP · target</div>
 *     </div>
 *     <div class="dc migrate">...</div>
 *     <div class="dc retire">...</div>
 *   </div>
 *
 * The status class drives a 2px top border tone: keep (green ok),
 * migrate (amber warn), retire (red err). Used when an agent emits a
 * datacenter-consolidation plan; rendered inline below the planning
 * sub-agent's output in chatmode.
 *
 * outputTemplate slug: `dc_map`.
 *
 * the design notes
 *       Phase 11, Task 11.1.
 */

import React from 'react';

export type DcStatus = 'keep' | 'migrate' | 'retire';

export interface DcCenter {
  /** Stable id for React key. */
  id: string;
  /** Short code (mono-font). */
  code: string;
  /** Role / sub-label rendered uppercase. */
  role: string;
  /** Mono-font stat lines (e.g. ["78 VMs", "vSphere 8"]). */
  stats: ReadonlyArray<string>;
  /** Action chip text (KEEP / MIGRATE / RETIRE …). */
  action: string;
  /** Status drives top-bar tone + action chip color. */
  status: DcStatus;
}

export interface DcMapProps {
  centers: ReadonlyArray<DcCenter>;
  /** ARIA label for the group. */
  ariaLabel?: string;
}

export function DcMap({ centers, ariaLabel }: DcMapProps) {
  if (!centers || centers.length === 0) return null;
  return (
    <div
      className="cm-dc-map dc-map"
      data-testid="dc-map"
      role="group"
      aria-label={ariaLabel ?? 'datacenter map'}
    >
      {centers.map((c) => (
        <div key={c.id} className={`dc ${c.status}`} data-status={c.status}>
          <div className="code">{c.code}</div>
          <div className="role">{c.role}</div>
          <div className="stats">
            {c.stats.map((s, i) => (
              <span key={`${c.id}-stat-${i}`}>{s}</span>
            ))}
          </div>
          <div className="action">{c.action}</div>
        </div>
      ))}
    </div>
  );
}
