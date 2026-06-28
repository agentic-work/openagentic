/**
 * CorrectionCard — sub-agent self-correction strip.
 *
 * Mocks 04, 05, 06. Fires when an agent realizes its own plan breaks a
 * constraint and re-delegates with a revised approach.
 *
 *   <div class="cm-correction-card">
 *     <div class="cm-ico"><svg /></div>
 *     <div class="cm-cc-body">
 *       <div class="cm-title">Self-correction · {short-headline}</div>
 *       <div class="cm-sub">{long-body explaining the rethink}</div>
 *     </div>
 *   </div>
 */

import React from 'react';

export interface CorrectionCardProps {
  title: string;
  body?: React.ReactNode;
  /** Mutes the card once the correction has been integrated downstream. */
  resolved?: boolean;
  /** Override the alert glyph (default: warning circle). */
  icon?: React.ReactNode;
}

const DefaultIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12" y2="16" />
  </svg>
);

export function CorrectionCard({ title, body, resolved, icon }: CorrectionCardProps) {
  return (
    <div
      className={`cm-correction-card${resolved ? ' cm-resolved' : ''}`}
      data-testid="correction-card"
      data-resolved={resolved ? 'true' : 'false'}
    >
      <div className="cm-ico" aria-hidden>
        {icon ?? DefaultIcon}
      </div>
      <div className="cm-cc-body">
        <div className="cm-title">{title}</div>
        {body && <div className="cm-sub">{body}</div>}
      </div>
    </div>
  );
}
