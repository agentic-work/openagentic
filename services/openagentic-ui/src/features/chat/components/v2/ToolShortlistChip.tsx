import React, { useEffect, useRef, useState } from 'react';

/**
 * ToolShortlistChip — Wave 3 (#525) per-message tool-shortlist pill.
 *
 * Driven by the server-emitted `tool_shortlist` NDJSON frame (Wave 2 of
 * /home/trent/.claude/plans/sprightly-percolating-brook.md):
 *
 *   {
 *     type: 'tool_shortlist',
 *     total_available: number,   // pool size (e.g. 276 across all MCPs)
 *     count: number,             // how many were ranked-and-kept this turn
 *     intent: string,            // resolved intent label (e.g. "cloud-list")
 *     kept: string[],            // first ≤5 ranked tool names (preview)
 *   }
 *
 * UX: a single chip "<count> / <total_available> tools (<intent>)" rendered
 * in the assistant message header. Click opens a popover listing `kept`
 * (top 5) with "...and N more" when count exceeds kept.length. ESC closes
 * the popover.
 *
 * Plan ref: /home/trent/.claude/plans/sprightly-percolating-brook.md.
 */

export interface ToolShortlistChipProps {
  /** Pool size — total tools available before ranking. 0 → render null. */
  totalAvailable: number;
  /** How many tools survived the rank-and-keep step this turn. */
  count: number;
  /** Resolved intent label (e.g. "cloud-list", "code-edit", "broad"). */
  intent: string;
  /** First ≤5 ranked tool names for the popover preview. */
  kept: string[];
}

export function ToolShortlistChip({
  totalAvailable,
  count,
  intent,
  kept,
}: ToolShortlistChipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Defensive — render nothing when the frame is missing or pool is empty.
  // (Wave 2 backend skips emit when total_available is 0; this guards the
  // local render path against partial state during session resume.)
  // The early return MUST come AFTER hooks above so React's hook ordering
  // stays stable across re-renders.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!totalAvailable || totalAvailable <= 0) return null;

  const safeKept = Array.isArray(kept) ? kept : [];
  const overflow = Math.max(0, count - safeKept.length);
  const safeIntent = (intent || '').trim() || 'general';
  const tooltip = `Ranked ${count} of ${totalAvailable} available tools for intent: ${safeIntent}.`;

  return (
    <div
      ref={containerRef}
      className="cm-tool-shortlist-chip"
      data-testid="tool-shortlist-chip"
      data-intent={safeIntent}
      data-count={String(count)}
      data-total={String(totalAvailable)}
    >
      <button
        type="button"
        className="cm-tool-shortlist-chip-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Tool shortlist info"
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="dialog"
        title={tooltip}
      >
        <span className="cm-tool-shortlist-chip-count">
          {count} / {totalAvailable}
        </span>
        <span className="cm-tool-shortlist-chip-label"> tools </span>
        <span className="cm-tool-shortlist-chip-intent">({safeIntent})</span>
      </button>
      {open && (
        <div
          className="cm-tool-shortlist-popover"
          data-testid="tool-shortlist-popover"
          role="dialog"
          aria-label="Shortlisted tools"
        >
          <div className="cm-tool-shortlist-popover-head">
            Top {safeKept.length} of {count} ranked tools
          </div>
          <ul className="cm-tool-shortlist-popover-list">
            {safeKept.map((name, i) => (
              <li key={`${name}-${i}`} className="cm-tool-shortlist-popover-item">
                <code>{name}</code>
              </li>
            ))}
          </ul>
          {overflow > 0 && (
            <div className="cm-tool-shortlist-popover-more">
              ...and {overflow} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
