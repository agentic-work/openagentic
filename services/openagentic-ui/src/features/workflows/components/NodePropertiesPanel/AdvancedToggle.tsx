/**
 * AdvancedToggle — collapsible "Show / Hide Advanced" wrapper used by many
 * config groups. The shared open/closed state lives in the main panel and is
 * threaded in via `show` / `onToggle` so a single toggle is reused across all
 * node types (preserving the pre-split shared-state behaviour).
 */

import React from 'react';
import { ChevronDown } from '@/shared/icons';

export const AdvancedToggle: React.FC<{
  show: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ show, onToggle, children }) => (
  <div>
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 text-xs font-medium mt-2 mb-3 transition-colors hover:opacity-80"
      style={{ color: 'var(--color-text-tertiary)' }}
    >
      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${show ? 'rotate-180' : ''}`} />
      {show ? 'Hide Advanced' : 'Show Advanced'}
    </button>
    {show && <div className="space-y-4">{children}</div>}
  </div>
);
