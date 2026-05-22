import React, { useRef, useEffect, useState } from 'react';
import { useThemeTokens } from '../hooks/useThemeTokens';

export interface TooltipRow {
  /** Color dot. */
  color: string;
  /** Series / category / model name. */
  name: string;
  /** Pre-formatted value to display. */
  value: string;
}

export interface ChartTooltipProps {
  /** Title line (e.g. category label or time bucket). */
  title?: string;
  /** Visible rows. */
  rows: TooltipRow[];
  /** Cursor X (page coords, relative to anchor). */
  x: number;
  /** Cursor Y (page coords, relative to anchor). */
  y: number;
  /** Anchor element — tooltip positions relative to its bounding box. */
  anchor: HTMLElement | SVGElement | null;
  /** Show or hide. */
  visible: boolean;
}

/**
 * Shared floating tooltip used by every chart. Positions itself near the
 * cursor and auto-flips to the left when it would overflow the anchor's
 * right edge. Driven by useThemeTokens so its background + text colors
 * track the surface's theme.
 *
 * Render position is page-fixed; anchor is only used for overflow math.
 */
export function ChartTooltip({ title, rows, x, y, anchor, visible }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tokens = useThemeTokens();
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!visible || !anchor || !ref.current) return;
    const rect = anchor.getBoundingClientRect();
    const tw = ref.current.offsetWidth;
    const th = ref.current.offsetHeight;
    // x/y are in anchor-local coords. Convert to page coords.
    let px = rect.left + x + 12;
    let py = rect.top + y + 12;
    // Flip to the left when overflowing right edge.
    if (px + tw > rect.right) px = rect.left + x - tw - 12;
    // Clamp y to stay inside the anchor vertically.
    if (py + th > rect.bottom) py = rect.bottom - th - 4;
    if (py < rect.top) py = rect.top + 4;
    setPos({ x: px, y: py });
  }, [x, y, anchor, visible, rows.length]);

  if (!visible || rows.length === 0) return null;

  return (
    <div
      ref={ref}
      role="tooltip"
      data-aw-chart-tooltip
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        pointerEvents: 'none',
        background: tokens.bg1,
        border: `1px solid ${tokens.line2}`,
        borderRadius: 6,
        padding: '8px 10px',
        fontFamily: tokens.fontMono,
        fontSize: 11,
        color: tokens.fg1,
        zIndex: 100,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        minWidth: 160,
        maxWidth: 320,
      }}
    >
      {title && (
        <div style={{
          marginBottom: 6,
          color: tokens.fg0,
          fontWeight: 600,
          letterSpacing: 0.2,
          fontSize: 11,
          borderBottom: `1px solid ${tokens.line1}`,
          paddingBottom: 4,
        }}>
          {title}
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />
          <span style={{ color: tokens.fg2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          <span style={{ color: tokens.fg0, fontWeight: 500 }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
