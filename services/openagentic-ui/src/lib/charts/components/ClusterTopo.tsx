import React, { useMemo, useRef, useState } from 'react';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip, type TooltipRow } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface ClusterTopoNode {
  id: string;
  label: string;
  /** Tier / category — drives column placement and column label. */
  tier: string;
  /** Status drives node color. */
  status?: 'ok' | 'warn' | 'err' | 'unknown';
  /** Free-form sublabel rendered on the side panel when selected. */
  sub?: string;
  /** Tag rendered as a small chip (e.g. image version). */
  tag?: string;
  /** Replicas summary (ready / desired) — rendered on side panel. */
  replicas?: { ready: number; desired: number };
}

export interface ClusterTopoLink {
  source: string;
  target: string;
}

export interface ClusterTopoData {
  /** Ordered list of tier ids; defines the column order left → right. */
  tiers: string[];
  /** Optional pretty labels for each tier (defaults to tier id uppercased). */
  tierLabels?: Record<string, string>;
  nodes: ClusterTopoNode[];
  links: ClusterTopoLink[];
}

/**
 * Drillable cluster topology — tier-grid layout, click-to-isolate, side panel
 * with the selected node's metadata. Replaces the force-directed `<Network>`
 * for admin's service topology where structured information (which tier a
 * service belongs to) is more important than ad-hoc connectivity.
 *
 * Click a node:
 *   - That node is selected, all unconnected nodes + links dim
 *   - A right-side panel shows status / replicas / tag / sub
 *   - Click the same node again (or anywhere else on the canvas) to unselect
 *
 * Click a tier column header:
 *   - Filters all nodes to that tier; non-tier links dim
 *
 * Layout:
 *   - Columns are evenly spaced left → right by `tiers`
 *   - Rows within each column are evenly spaced top → bottom
 *   - Edges are smooth horizontal Bezier curves between columns
 */
export function ClusterTopo({ data, title, height = 460, disableFrame, wheelZoom, onExpand, className }: ChartProps<ClusterTopoData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 36, right: 24, bottom: 24, left: 24 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const colW = innerW / data.tiers.length;

    const tierIndex = new Map(data.tiers.map((t, i) => [t, i]));
    const byTier = new Map<string, ClusterTopoNode[]>();
    for (const t of data.tiers) byTier.set(t, []);
    for (const n of data.nodes) {
      const t = byTier.has(n.tier) ? n.tier : data.tiers[data.tiers.length - 1] ?? n.tier;
      byTier.get(t)?.push(n);
    }

    const positions = new Map<string, { x: number; y: number; node: ClusterTopoNode }>();
    for (const [tier, ns] of byTier.entries()) {
      const ci = tierIndex.get(tier) ?? data.tiers.length - 1;
      const x = margin.left + colW * ci + colW / 2;
      const rowH = ns.length > 0 ? innerH / ns.length : innerH;
      ns.forEach((n, ri) => {
        const y = margin.top + ri * rowH + rowH / 2;
        positions.set(n.id, { x, y, node: n });
      });
    }

    return { width, height, margin, innerW, innerH, colW, positions, tierIndex };
  }, [data, height]);

  const relatedIds = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const l of data.links) {
      if (l.source === selectedId) set.add(l.target);
      if (l.target === selectedId) set.add(l.source);
    }
    return set;
  }, [selectedId, data.links]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'cluster-topo', disabled: disableFrame, wheelZoom, onExpand });

  if (data.nodes.length === 0) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no services</div>;
  }

  const statusColor = (s?: ClusterTopoNode['status']): string => {
    switch (s) {
      case 'ok': return tokens.ok;
      case 'warn': return tokens.warn;
      case 'err': return tokens.err;
      default: return tokens.fg3;
    }
  };
  const tierLabel = (t: string) => data.tierLabels?.[t] ?? t.toUpperCase();
  const selectedNode = selectedId ? layout.positions.get(selectedId)?.node ?? null : null;

  return (
    <div
      className={className}
      data-aw-chart-frame
      style={{ display: 'grid', gridTemplateColumns: selectedNode ? '1fr 260px' : '1fr', gap: 12, width: '100%' }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'grab' }}
        onClick={(e) => {
          // Clicking blank canvas clears selection
          if (e.target === e.currentTarget) {
            setSelectedId(null);
            setTierFilter(null);
          }
        }}
      >
        <g ref={contentRef}>
          {/* Column dividers + clickable headers */}
          {data.tiers.map((tier, ci) => {
            const x0 = layout.margin.left + layout.colW * ci;
            const isFilteredOut = tierFilter !== null && tierFilter !== tier;
            return (
              <g key={tier} opacity={isFilteredOut ? 0.4 : 1} style={{ transition: 'opacity 120ms' }}>
                {ci > 0 && (
                  <line
                    x1={x0} y1={layout.margin.top - 12}
                    x2={x0} y2={layout.height - layout.margin.bottom}
                    stroke={tokens.line1} strokeDasharray="2 4"
                  />
                )}
                <rect
                  x={x0} y={4} width={layout.colW} height={28}
                  fill="transparent" style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTierFilter((cur) => (cur === tier ? null : tier));
                    setSelectedId(null);
                  }}
                />
                <text
                  x={x0 + layout.colW / 2} y={20}
                  textAnchor="middle"
                  style={{
                    fill: tierFilter === tier ? tokens.accent : tokens.fg3,
                    fontFamily: tokens.fontMono, fontSize: 10, letterSpacing: '0.16em',
                    textTransform: 'uppercase', pointerEvents: 'none', userSelect: 'none',
                  }}
                >
                  {tierLabel(tier)}
                </text>
              </g>
            );
          })}

          {/* Edges (bezier curves) */}
          {data.links.map((l, i) => {
            const from = layout.positions.get(l.source);
            const to = layout.positions.get(l.target);
            if (!from || !to) return null;
            const dim =
              (selectedId !== null && relatedIds && !(relatedIds.has(l.source) && relatedIds.has(l.target))) ||
              (tierFilter !== null && from.node.tier !== tierFilter && to.node.tier !== tierFilter);
            const dx = to.x - from.x;
            const c1x = from.x + dx * 0.5;
            const c2x = to.x - dx * 0.5;
            return (
              <path
                key={i}
                d={`M${from.x},${from.y} C${c1x},${from.y} ${c2x},${to.y} ${to.x},${to.y}`}
                fill="none"
                stroke={tokens.accent}
                strokeOpacity={dim ? 0.06 : 0.4}
                strokeWidth={1.2}
                style={{ transition: 'stroke-opacity 120ms' }}
              />
            );
          })}

          {/* Nodes */}
          {[...layout.positions.entries()].map(([id, p]) => {
            const isSelected = selectedId === id;
            const isRelated = relatedIds?.has(id) ?? true;
            const tierMatch = tierFilter === null || tierFilter === p.node.tier;
            const dim = !isRelated || !tierMatch;
            const r = isSelected ? 11 : 8;
            const fill = statusColor(p.node.status);
            return (
              <g
                key={id}
                opacity={dim ? 0.35 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 120ms' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId((cur) => (cur === id ? null : id));
                }}
                onMouseEnter={(e) => {
                  const svgEl = svgRef.current; if (!svgEl) return;
                  const rect = svgEl.getBoundingClientRect();
                  setHover({ id, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseMove={(e) => {
                  const svgEl = svgRef.current; if (!svgEl) return;
                  const rect = svgEl.getBoundingClientRect();
                  setHover({ id, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => setHover(null)}
              >
                <circle cx={p.x} cy={p.y} r={r + 4} fill={fill} opacity={0.14} />
                <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={tokens.bg0} strokeWidth={1.5} />
                <text
                  x={p.x} y={p.y + r + 14}
                  textAnchor="middle"
                  style={{
                    fill: tokens.fg1, fontFamily: tokens.fontMono, fontSize: 10,
                    pointerEvents: 'none', userSelect: 'none',
                  }}
                >
                  {p.node.label.slice(0, 22)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Side panel — appears when a node is selected */}
      {selectedNode && (
        <aside
          style={{
            background: tokens.bg1,
            border: `1px solid ${tokens.line2}`,
            borderRadius: 6,
            padding: 14,
            fontFamily: tokens.fontMono,
            fontSize: 11,
            color: tokens.fg1,
            height: 'fit-content',
            position: 'sticky',
            top: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor(selectedNode.status) }} />
            <strong style={{ color: tokens.fg0, fontSize: 13, fontWeight: 600 }}>{selectedNode.label}</strong>
          </div>
          <div style={{ color: tokens.fg3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {tierLabel(selectedNode.tier)}
          </div>
          {selectedNode.replicas && (
            <div style={{ marginTop: 10, color: tokens.fg2 }}>
              <span style={{ color: tokens.fg3 }}>replicas: </span>
              <span style={{ color: tokens.fg0 }}>{selectedNode.replicas.ready}</span>
              <span style={{ color: tokens.fg3 }}> / {selectedNode.replicas.desired}</span>
            </div>
          )}
          {selectedNode.tag && (
            <div style={{
              marginTop: 8, display: 'inline-block',
              padding: '2px 6px', borderRadius: 3,
              background: tokens.bg2, color: tokens.fg2,
              fontSize: 10,
            }}>{selectedNode.tag}</div>
          )}
          {selectedNode.sub && (
            <div style={{ marginTop: 10, color: tokens.fg2, lineHeight: 1.5 }}>{selectedNode.sub}</div>
          )}
          <button
            onClick={() => setSelectedId(null)}
            style={{
              marginTop: 12,
              background: 'transparent', border: `1px solid ${tokens.line2}`,
              color: tokens.fg2, fontFamily: tokens.fontMono, fontSize: 10,
              padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
            }}
          >
            close
          </button>
        </aside>
      )}
      {(() => {
        if (!hover) return null;
        const node = layout.positions.get(hover.id)?.node;
        if (!node) return null;
        const rows: TooltipRow[] = [
          { color: statusColor(node.status), name: 'status', value: node.status ?? '—' },
          ...(node.replicas
            ? [{ color: tokens.fg3, name: 'replicas', value: `${node.replicas.ready} / ${node.replicas.desired}` }]
            : []),
          ...(node.tag ? [{ color: tokens.fg3, name: 'tag', value: node.tag }] : []),
        ];
        return (
          <ChartTooltip
            title={node.label}
            rows={rows}
            x={hover.x}
            y={hover.y}
            anchor={svgRef.current}
            visible={true}
          />
        );
      })()}
    </div>
  );
}
