import React from 'react';

/**
 * CloudBadge — 2-line pill component that paints a per-cloud accent
 * (mocks/UX/AI/Chatmode/end-state-07-tri-cloud-cost-spikes.html lines
 * 111-113). Used inside streaming-table Cloud-cells and any other
 * inline place we want to colour-tag a row by provider.
 *
 * Colour mapping (mock-07 §11):
 *   aws   → --cm-fs    (orange — filesystem-shared hue)
 *   azure → --cm-cloud (info blue)
 *   gcp   → --cm-k8s   (violet — shares k8s hue so they read distinct in
 *                       monochrome screenshots)
 *
 * All colours land via tokens; the inline `data-cloud` attribute drives
 * the CSS selectors in chatmode-v2.css. No hex / rgb literals here.
 */

export interface CloudBadgeProps {
  cloud: 'aws' | 'azure' | 'gcp';
  /** Optional override label. Defaults to the cloud key in lower-case. */
  label?: string;
}

export function CloudBadge({ cloud, label }: CloudBadgeProps) {
  return (
    <span
      data-testid="cloud-badge"
      data-cloud={cloud}
      className="cm-cloud-badge"
    >
      {label ?? cloud}
    </span>
  );
}

export default CloudBadge;
