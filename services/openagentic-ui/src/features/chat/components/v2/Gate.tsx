/**
 * Gate — rollback / decision gate (mock 06 lines 699-728).
 *
 *   <div class="cm-gate gate {status}">
 *     <div class="g-ico">G1</div>
 *     <div class="g-body">
 *       <div class="title">{title}</div>
 *       <div class="sub">{sub}</div>
 *     </div>
 *     <div class="g-meta">day 14<br/>owner: SRE</div>
 *   </div>
 *
 * Status drives the g-ico + outline tint:
 *   pending (accent) | passed (ok) | failed (err)
 *
 * outputTemplate slug: `gate`.
 *
 * the design notes
 *       Phase 11, Task 11.2.
 */

import React from 'react';

export type GateStatus = 'pending' | 'passed' | 'failed';

export interface GateProps {
  /** Short tag rendered in the icon bubble (e.g. "G1"). */
  tag: string;
  /** Bold title — typically "Wave N gate · {criterion}". */
  title: string;
  /** Sub-text describing the gate criteria + rollback path. */
  sub: React.ReactNode;
  /** Right-rail meta lines (date, owner, …). Each entry renders on its own line. */
  meta?: ReadonlyArray<string>;
  /** Status drives the visual tone. */
  status: GateStatus;
  /** ARIA label override. */
  ariaLabel?: string;
}

export function Gate({ tag, title, sub, meta, status, ariaLabel }: GateProps) {
  return (
    <div
      className={`cm-gate gate ${status}`}
      data-testid="gate"
      data-status={status}
      role="group"
      aria-label={ariaLabel ?? `gate ${tag}: ${title}`}
    >
      <div className="g-ico" aria-hidden>
        {tag}
      </div>
      <div className="g-body">
        <div className="title">{title}</div>
        <div className="sub">{sub}</div>
      </div>
      {meta && meta.length > 0 && (
        <div className="g-meta">
          {meta.map((line, i) => (
            <React.Fragment key={`gate-meta-${i}`}>
              {i > 0 && <br />}
              {line}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
