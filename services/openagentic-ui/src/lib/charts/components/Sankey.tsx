import React, { useMemo, useRef } from 'react';
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey';
import { format as d3Format } from 'd3-format';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import type { ChartProps } from '../types';

export interface SankeyNode {
  /** Unique node id. */
  id: string;
  /** Display label. */
  label?: string;
  /** Kind/lane — left column ('source') or right column ('sink'); used for coloring. */
  kind?: 'source' | 'sink';
  /** Optional palette key — when present, picks color from `colorBySource[id]`. */
  source?: string;
}

export interface SankeyLink {
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Flow value (token count, request count — any positive number). */
  value: number;
  /** Optional source-id used for gradient coloring (defaults to source node id). */
  sourceId?: string;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Optional per-source-id color overrides. */
  colorBySource?: Record<string, string>;
}

interface InternalNode {
  id: string;
  label: string;
  kind: 'source' | 'sink';
  source?: string;
  index: number;
  x0?: number; x1?: number; y0?: number; y1?: number;
  value?: number;
}
interface InternalLink {
  source: number | InternalNode;
  target: number | InternalNode;
  value: number;
  sourceId: string;
  width?: number;
}

/**
 * Provider→Model Sankey. Layout via d3-sankey, render via React.
 *
 * Data contract is decoupled from any specific domain (LLM, costs, etc) so
 * the same component renders for admin dashboards (OTel/SQL data) and
 * chatmode's compose_visual T1 tool (model-generated payloads).
 *
 * The hosting page is responsible for putting this in a sized container —
 * Sankey fills width and uses `height` (default 460) for vertical space.
 */
export function Sankey({ data, title, height = 460, disableFrame, wheelZoom, onExpand, className }: ChartProps<SankeyData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  // Resolve theme tokens scoped to the chart's host element so chatmode's
  // .cm-v2-scoped --cm-* vars win when the chart renders inside the
  // transcript. Admin renders are unaffected (admin defines vars on :root).
  const tokens = useThemeTokens(svgRef);

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 20, right: 200, bottom: 28, left: 180 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const idToIdx = new Map<string, number>();
    const internalNodes: InternalNode[] = data.nodes.map((n, i) => {
      idToIdx.set(n.id, i);
      return {
        id: n.id,
        label: n.label ?? n.id,
        kind: n.kind ?? 'sink',
        source: n.source,
        index: i,
      };
    });
    const internalLinks: InternalLink[] = [];
    for (const l of data.links) {
      const s = idToIdx.get(l.source);
      const t = idToIdx.get(l.target);
      if (s == null || t == null) continue;
      const v = Math.max(0, l.value);
      if (v <= 0) continue;
      internalLinks.push({ source: s, target: t, value: v, sourceId: l.sourceId ?? l.source });
    }

    if (internalLinks.length === 0) {
      return { width, height, nodes: [], links: [], margin };
    }

    const gen = sankey<InternalNode, InternalLink>()
      .nodeWidth(14)
      .nodePadding(18)
      .nodeAlign(sankeyJustify)
      .nodeId((n) => n.index)
      .extent([[margin.left, margin.top], [margin.left + innerW, margin.top + innerH]]);

    const graph = gen({
      nodes: internalNodes.map((n) => ({ ...n })),
      links: internalLinks.map((l) => ({ ...l })),
    });

    return { width, height, nodes: graph.nodes, links: graph.links, margin };
  }, [data, height]);

  // Default palette: use theme tokens for source colors (cycled), neutral slate for sink
  const sourceColors = useMemo(() => {
    return [tokens.accent, tokens.info, tokens.ok, tokens.warn, tokens.err, tokens.capThinking, tokens.capStreaming, tokens.capTools];
  }, [tokens]);
  const sinkColor = tokens.fg3; // neutral sink node color (theme-driven)

  const colorBySource = useMemo(() => {
    const out: Record<string, string> = {};
    const sourceIds = [...new Set(data.links.map((l) => l.sourceId ?? l.source))];
    sourceIds.forEach((id, i) => {
      out[id] = data.colorBySource?.[id] ?? sourceColors[i % sourceColors.length];
    });
    return out;
  }, [data.links, data.colorBySource, sourceColors]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'sankey', disabled: disableFrame, wheelZoom, onExpand });

  const fmt = d3Format(',.2~s');
  const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (layout.links.length === 0) {
    return (
      <div className={className} data-aw-chart-frame style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>
        no flow data — fire a request to see traffic
      </div>
    );
  }

  return (
    <div
      data-aw-chart-frame
      className={className}
      style={{ width: '100%', position: 'relative' }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'grab' }}
      >
        <defs>
          {Object.entries(colorBySource).map(([id, color]) => (
            <linearGradient key={id} id={`aw-sankey-g-${safeId(id)}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity={0.65} />
              <stop offset="100%" stopColor={sinkColor} stopOpacity={0.25} />
            </linearGradient>
          ))}
        </defs>

        <g ref={contentRef}>
          {/* Axis labels */}
          <text
            x={layout.margin.left}
            y={layout.height - 8}
            style={{ fill: tokens.fg3, fontSize: 10, fontFamily: tokens.fontMono, letterSpacing: 0.5, textTransform: 'uppercase' }}
          >
            SOURCE
          </text>
          <text
            x={layout.width - layout.margin.right}
            y={layout.height - 8}
            textAnchor="end"
            style={{ fill: tokens.fg3, fontSize: 10, fontFamily: tokens.fontMono, letterSpacing: 0.5, textTransform: 'uppercase' }}
          >
            TARGET
          </text>

          {/* Links */}
          <g>
            {layout.links.map((link: any, i: number) => {
              const d = sankeyLinkHorizontal()(link as any) as string;
              return (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={`url(#aw-sankey-g-${safeId(link.sourceId)})`}
                  strokeWidth={Math.max(1, link.width ?? 1)}
                  strokeOpacity={0.9}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {layout.nodes.map((node: any) => {
              const isSource = node.kind === 'source';
              const nodeColor = isSource
                ? (colorBySource[node.id] ?? sourceColors[node.index % sourceColors.length])
                : sinkColor;
              return (
                <g key={node.id}>
                  <rect
                    x={node.x0}
                    y={node.y0}
                    width={(node.x1 ?? 0) - (node.x0 ?? 0)}
                    height={Math.max(2, (node.y1 ?? 0) - (node.y0 ?? 0))}
                    rx={3}
                    fill={nodeColor}
                    opacity={isSource ? 0.95 : 0.85}
                  />
                  <text
                    x={isSource ? (node.x0 ?? 0) - 10 : (node.x1 ?? 0) + 10}
                    y={((node.y0 ?? 0) + (node.y1 ?? 0)) / 2 - 3}
                    textAnchor={isSource ? 'end' : 'start'}
                    style={{ fill: tokens.fg0, fontSize: 12, fontFamily: tokens.fontUi, fontWeight: 600 }}
                  >
                    {node.label}
                  </text>
                  <text
                    x={isSource ? (node.x0 ?? 0) - 10 : (node.x1 ?? 0) + 10}
                    y={((node.y0 ?? 0) + (node.y1 ?? 0)) / 2 + 11}
                    textAnchor={isSource ? 'end' : 'start'}
                    style={{ fill: tokens.fg3, fontSize: 10, fontFamily: tokens.fontMono }}
                  >
                    {fmt(node.value ?? 0)}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}
