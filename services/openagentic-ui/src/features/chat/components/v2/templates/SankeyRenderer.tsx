/**
 * SankeyRenderer — compose_visual:sankey template (mock 01 / 05 / 06).
 *
 * Renders a 3-column sankey of subjects → groups → aggregates, sized by
 * `value`. Bezier flow paths between columns are tone-tinted via the
 * `--cm-tone-*` palette (see chatmode-v2.css `cm-seg.cm-tone-{a..f}` etc).
 *
 * Mock anatomy (lifted from
 * mocks/UX/AI/Chatmode/end-state-01-azure-subs-rgs.html:368-418):
 *
 *   <svg class="cm-sankey-svg" viewBox="0 0 800 380">
 *     <rect class="cm-sankey-node" ... />
 *     <text class="cm-sankey-label">{label}</text>
 *     <text class="cm-sankey-sub">{sub}</text>
 *     <path class="cm-sankey-flow" d="..." />
 *     <text class="cm-sankey-legend">{column.label}</text>
 *   </svg>
 *
 * Theme tokens drive all colors. NO hardcoded hex anywhere in the
 * component — fills + strokes come from the cm-tone palette and the
 * runtime accent variable.
 *
 * the design notes
 *       §Phase 2.2.3 — A2 UI render pipeline.
 */

import React from 'react';

export type SankeyTone = 'ok' | 'warn' | 'err' | 'info' | 'a' | 'b' | 'c' | 'd';

export interface SankeyNode {
  /** Stable id used to wire flows to nodes. */
  id: string;
  /** Bold label rendered next to the node bar. */
  label: string;
  /** Optional muted sub-line under the label. */
  sub?: string;
  /** Numeric weight — drives bar height + relative ordering. */
  value: number;
  /** Tone drives bar fill + flow gradient. */
  tone: SankeyTone;
}

export interface SankeyColumn {
  /** Stable id used as a node-key prefix. */
  id: string;
  /** Column-foot legend label ("Subscription", "Resource Group", …). */
  label: string;
  /** Nodes in render order; height is proportional to value. */
  nodes: ReadonlyArray<SankeyNode>;
}

export interface SankeyFlow {
  /** Source node id (must match a node in column N). */
  from: string;
  /** Target node id (must match a node in column N+1). */
  to: string;
  /** Flow weight — drives ribbon thickness. */
  value: number;
  /** Tone drives the gradient color. */
  tone: SankeyTone;
}

export interface SankeyRendererProps {
  /** Caption rendered as the SVG aria-label + screen-reader title. */
  title: string;
  /** Ordered columns, left → right. Empty array renders nothing. */
  columns: ReadonlyArray<SankeyColumn>;
  /** Ribbons between adjacent columns. Empty array renders no flows. */
  flows: ReadonlyArray<SankeyFlow>;
}

// Layout constants — kept inside the component to avoid magic numbers.
const VIEWBOX_W = 800;
const VIEWBOX_H = 380;
const NODE_W = 18;
const TOP_PAD = 30;
const BOTTOM_PAD = 50;
const COL_GAP = 12;

interface ResolvedNode {
  id: string;
  colIdx: number;
  label: string;
  sub?: string;
  tone: SankeyTone;
  x: number;
  y: number;
  height: number;
}

function laidOut(columns: ReadonlyArray<SankeyColumn>): {
  nodes: Map<string, ResolvedNode>;
  colX: number[];
} {
  const nodes = new Map<string, ResolvedNode>();
  if (columns.length === 0) return { nodes, colX: [] };
  const usable = VIEWBOX_H - TOP_PAD - BOTTOM_PAD;
  // Column x positions: first col aligns at left margin, last col at right.
  const colX: number[] = [];
  if (columns.length === 1) {
    colX.push(VIEWBOX_W / 2 - NODE_W / 2);
  } else {
    const left = 20;
    const right = VIEWBOX_W - 20 - NODE_W;
    for (let i = 0; i < columns.length; i++) {
      colX.push(left + ((right - left) * i) / (columns.length - 1));
    }
  }
  // Per-column: total value drives height-per-unit.
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci];
    const totalValue = col.nodes.reduce((s, n) => s + Math.max(0, n.value), 0);
    const totalGap = COL_GAP * Math.max(0, col.nodes.length - 1);
    const unit = totalValue > 0 ? (usable - totalGap) / totalValue : 0;
    let cursor = TOP_PAD;
    for (const n of col.nodes) {
      const h = Math.max(2, n.value * unit);
      nodes.set(n.id, {
        id: n.id,
        colIdx: ci,
        label: n.label,
        sub: n.sub,
        tone: n.tone,
        x: colX[ci],
        y: cursor,
        height: h,
      });
      cursor += h + COL_GAP;
    }
  }
  return { nodes, colX };
}

function flowPath(from: ResolvedNode, to: ResolvedNode): string {
  // Bezier between right edge of `from` and left edge of `to`. Spans the
  // full node height on each side so visually heavier nodes feed wider
  // ribbons.
  const x1 = from.x + NODE_W;
  const x2 = to.x;
  const y1Top = from.y;
  const y1Bot = from.y + from.height;
  const y2Top = to.y;
  const y2Bot = to.y + to.height;
  const mid = (x1 + x2) / 2;
  return (
    `M ${x1} ${y1Top} ` +
    `C ${mid} ${y1Top}, ${mid} ${y2Top}, ${x2} ${y2Top} ` +
    `L ${x2} ${y2Bot} ` +
    `C ${mid} ${y2Bot}, ${mid} ${y1Bot}, ${x1} ${y1Bot} Z`
  );
}

/**
 * Token-driven fill for a tone. Returns a CSS var() — never a hex literal.
 * Falls back to the runtime accent for `a` / unknown tones so accent-picker
 * mutations re-paint without code changes.
 */
function toneFill(tone: SankeyTone): string {
  switch (tone) {
    case 'ok':
      return 'var(--cm-ok, currentColor)';
    case 'warn':
      return 'var(--cm-warn, currentColor)';
    case 'err':
      return 'var(--cm-err, currentColor)';
    case 'info':
      return 'var(--cm-info, currentColor)';
    case 'a':
    case 'b':
    case 'c':
    case 'd':
    default:
      return 'var(--cm-accent, currentColor)';
  }
}

export function SankeyRenderer({ title, columns, flows }: SankeyRendererProps) {
  if (!columns || columns.length === 0) return null;
  const totalNodes = columns.reduce((s, c) => s + c.nodes.length, 0);
  if (totalNodes === 0 && (!flows || flows.length === 0)) return null;

  const { nodes } = laidOut(columns);

  // Pre-compute unique flow gradient ids per tone so paths reference
  // them instead of inlining gradients.
  const tones = Array.from(
    new Set(flows.map((f) => f.tone).concat(columns.flatMap((c) => c.nodes.map((n) => n.tone)))),
  );

  return (
    <div className="cm-sankey" data-testid="sankey-renderer">
      <svg
        className="cm-sankey-svg"
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={title}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          background: 'var(--cm-bg-1, transparent)',
          color: 'var(--cm-fg-1)',
        }}
      >
        <title>{title}</title>
        <defs>
          {tones.map((tone) => (
            <linearGradient
              key={`grad-${tone}`}
              id={`cm-sankey-grad-${tone}`}
              x1="0"
              x2="1"
              y1="0"
              y2="0"
            >
              <stop offset="0" stopColor={toneFill(tone)} stopOpacity={0.55} />
              <stop offset="1" stopColor={toneFill(tone)} stopOpacity={0.20} />
            </linearGradient>
          ))}
        </defs>

        {/* Flow ribbons rendered first so node rects + labels stack on top. */}
        {flows.map((f, idx) => {
          const from = nodes.get(f.from);
          const to = nodes.get(f.to);
          if (!from || !to) return null;
          return (
            <path
              key={`flow-${idx}-${f.from}-${f.to}`}
              className={`cm-sankey-flow cm-sankey-flow-${f.tone}`}
              d={flowPath(from, to)}
              fill={`url(#cm-sankey-grad-${f.tone})`}
              data-from={f.from}
              data-to={f.to}
            />
          );
        })}

        {/* Node bars + labels. Labels render to the right of the bar on
            left/middle columns, and left of the bar on the rightmost
            column so they don't fall off the canvas. */}
        {Array.from(nodes.values()).map((n) => {
          const isLast = n.colIdx === columns.length - 1;
          const labelX = isLast ? n.x - 8 : n.x + NODE_W + 8;
          const anchor = isLast ? 'end' : 'start';
          return (
            <g key={`node-${n.id}`} data-node-id={n.id}>
              <rect
                className={`cm-sankey-node cm-sankey-node-${n.tone}`}
                x={n.x}
                y={n.y}
                width={NODE_W}
                height={n.height}
                rx={3}
                fill={toneFill(n.tone)}
                data-tone={n.tone}
              />
              <text
                className="cm-sankey-label"
                x={labelX}
                y={n.y + Math.min(14, n.height / 2 + 4)}
                textAnchor={anchor}
                fontSize={12}
                fontWeight={600}
                fill="var(--cm-fg-0)"
              >
                {n.label}
              </text>
              {n.sub && (
                <text
                  className="cm-sankey-sub"
                  x={labelX}
                  y={n.y + Math.min(28, n.height / 2 + 18)}
                  textAnchor={anchor}
                  fontSize={10.5}
                  fill="var(--cm-fg-2)"
                  style={{ fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {n.sub}
                </text>
              )}
            </g>
          );
        })}

        {/* Column legend at the bottom. */}
        {columns.map((c, i) => {
          const lastNode = c.nodes[c.nodes.length - 1];
          const resolved = lastNode ? nodes.get(lastNode.id) : undefined;
          const x = resolved ? resolved.x + (i === columns.length - 1 ? NODE_W : 0) : 0;
          const isLast = i === columns.length - 1;
          return (
            <text
              key={`legend-${c.id}`}
              className="cm-sankey-legend"
              x={x}
              y={VIEWBOX_H - 8}
              textAnchor={isLast ? 'end' : 'start'}
              fontSize={11}
              fill="var(--cm-fg-3)"
              style={{ fontFamily: 'JetBrains Mono, monospace' }}
            >
              {c.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default SankeyRenderer;
