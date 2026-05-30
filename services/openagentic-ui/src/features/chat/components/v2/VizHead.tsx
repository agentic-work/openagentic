/**
 * VizHead — banner header for compose_visual / inline-widget output (mock 10).
 *
 *   <div class="cm-viz-head viz-head">
 *     <div class="ico">📊</div>
 *     <span class="name">visualize.show_widget</span>
 *     <span class="badge">cost_sankey_6mo</span>
 *     <span class="timer">streaming…</span>   (or "2.41s" when final)
 *   </div>
 *
 * Renders above the iframe/SVG widget body. The badge typically carries
 * the widget id; the timer toggles between mid-stream "streaming…" pulse
 * and final "Ns" elapsed wall-time once the widget settles.
 *
 * outputTemplate slug: `viz_head`.
 *
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 11, Task 11.5.
 */

import React from 'react';

export interface VizHeadProps {
  /** Tool / handler name (e.g. "visualize.show_widget"). */
  name: string;
  /** Optional emoji or short string rendered in the icon bubble. */
  ico?: React.ReactNode;
  /** Optional widget id / slug (e.g. "cost_sankey_6mo"). */
  badge?: string;
  /** Optional timer ("streaming…" or "2.41s"). */
  timer?: string;
}

export function VizHead({ name, ico, badge, timer }: VizHeadProps) {
  return (
    <div
      className="cm-viz-head viz-head"
      data-testid="viz-head"
      role="heading"
      aria-level={3}
    >
      {ico !== undefined && <div className="ico" aria-hidden>{ico}</div>}
      <span className="name">{name}</span>
      {badge && <span className="badge">{badge}</span>}
      {timer && <span className="timer">{timer}</span>}
    </div>
  );
}
