/**
 * Crumbs — topbar breadcrumb chain.
 *
 * Mock anatomy: mocks/UX/01-cloud-ops.html:144 + chatmode-v2.css `.cm-crumbs`.
 *
 *   <nav class="cm-crumbs">
 *     <span class="cm-crumb">Chat</span>
 *     <span class="cm-sep">/</span>
 *     <span class="cm-crumb cm-active">VM right-sizing audit</span>
 *   </nav>
 *
 * Last item is marked `.cm-active` so theme can highlight the current node.
 * Empty trail renders nothing — caller controls visibility.
 */

import React from 'react';

export interface CrumbsProps {
  /** Ordered breadcrumb labels, root → leaf. */
  trail: string[];
}

export function Crumbs({ trail }: CrumbsProps) {
  if (!trail || trail.length === 0) return null;
  return (
    <nav className="cm-crumbs" aria-label="Breadcrumb">
      {trail.map((label, idx) => {
        const isLast = idx === trail.length - 1;
        return (
          <React.Fragment key={`${idx}-${label}`}>
            <span className={`cm-crumb${isLast ? ' cm-active' : ''}`}>{label}</span>
            {!isLast && (
              <span className="cm-sep" aria-hidden>
                /
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
