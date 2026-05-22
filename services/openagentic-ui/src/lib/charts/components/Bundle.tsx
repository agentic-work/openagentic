import React, { useMemo, useRef, useState } from 'react';
import { hierarchy, cluster as d3Cluster } from 'd3-hierarchy';
import { lineRadial, curveBundle } from 'd3-shape';
import { ascending } from 'd3-array';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface BundleNode {
  name: string;
  children?: BundleNode[];
  /** Array of leaf names this leaf imports/calls. */
  imports?: string[];
}

export interface BundleData {
  root: BundleNode;
  /** Tension parameter for curveBundle, 0..1. Default 0.85. */
  beta?: number;
}

interface LeafLite {
  name: string;
  x: number;
  y: number;
  path: (other: LeafLite) => LeafLite[];
}

/**
 * Hierarchical edge bundling — leaves on a circle, edges bundled along the
 * hierarchy spine. Hovering a leaf highlights inbound (target) and outbound
 * (source) edges. Replaces "ad-hoc cross-references" panels with a clear,
 * decongested view of who calls whom across a hierarchy.
 */
export function Bundle({ data, title, height = 720, disableFrame, wheelZoom, onExpand, className }: ChartProps<BundleData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [hoverName, setHoverName] = useState<string | null>(null);

  const layout = useMemo(() => {
    const width = 1180;
    const radius = Math.min(width, height) / 2 - 110;
    const root = hierarchy(data.root).sort((a, b) =>
      ascending(a.height, b.height) || ascending(a.data.name, b.data.name),
    );
    const tree = d3Cluster<BundleNode>().size([2 * Math.PI, radius])(root);
    const leaves = tree.leaves();
    const byName = new Map(leaves.map((l) => [l.data.name, l]));
    const links: Array<[typeof leaves[number], typeof leaves[number]]> = [];
    leaves.forEach((leaf) => {
      (leaf.data.imports ?? []).forEach((name) => {
        const tgt = byName.get(name);
        if (tgt) links.push([leaf, tgt]);
      });
    });
    const line = lineRadial<typeof leaves[number]>()
      .curve(curveBundle.beta(data.beta ?? 0.85))
      .radius((d) => d.y)
      .angle((d) => d.x);
    return { width, height, radius, leaves, links, line };
  }, [data, height]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'bundle', disabled: disableFrame, wheelZoom, onExpand });

  // d3-hierarchy considers a childless root as 1 leaf. Treat "only the root,
  // no children" as the empty case for a more useful message.
  const hasChildren = (data.root.children ?? []).length > 0;
  if (!hasChildren || layout.leaves.length === 0) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no leaves</div>;
  }

  const isHovered = (name: string): { isIncoming: boolean; isOutgoing: boolean } => {
    if (!hoverName) return { isIncoming: false, isOutgoing: false };
    const incoming = layout.links.some(([s, t]) => s.data.name === hoverName && t.data.name === name);
    const outgoing = layout.links.some(([s, t]) => t.data.name === hoverName && s.data.name === name);
    return { isIncoming: incoming, isOutgoing: outgoing };
  };

  const hoveredCounts = useMemo(() => {
    if (!hoverName) return null;
    const incoming = layout.links.filter(([s, t]) => t.data.name === hoverName).length;
    const outgoing = layout.links.filter(([s, t]) => s.data.name === hoverName).length;
    return { incoming, outgoing };
  }, [hoverName, layout.links]);

  return (
    <div className={className} data-aw-chart-frame style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'grab' }}
      >
        <g ref={contentRef}>
          <g transform={`translate(${layout.width / 2},${layout.height / 2})`}>
            {/* Bundled links */}
            <g>
              {layout.links.map(([source, target], i) => {
                let stroke = tokens.fg3;
                let opacity = 0.18;
                let width = 1;
                if (hoverName) {
                  if (target.data.name === hoverName) { stroke = tokens.ok; opacity = 0.85; width = 1.6; }
                  else if (source.data.name === hoverName) { stroke = tokens.warn; opacity = 0.85; width = 1.6; }
                  else { opacity = 0.04; }
                }
                return (
                  <path
                    key={i}
                    d={layout.line(source.path(target)) ?? ''}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={opacity}
                    strokeWidth={width}
                    style={{ transition: 'stroke-opacity 120ms' }}
                  />
                );
              })}
            </g>
            {/* Leaves */}
            <g>
              {layout.leaves.map((leaf) => {
                const angle = leaf.x;
                const x = leaf.y;
                const flip = angle >= Math.PI;
                const dir = isHovered(leaf.data.name);
                const fill = leaf.data.name === hoverName
                  ? tokens.accent
                  : dir.isIncoming ? tokens.warn  // this leaf is a TARGET of hoverName
                  : dir.isOutgoing ? tokens.ok    // this leaf is a SOURCE for hoverName
                  : tokens.fg1;
                return (
                  <g
                    key={leaf.data.name}
                    transform={`rotate(${angle * 180 / Math.PI - 90}) translate(${x},0)`}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoverName(leaf.data.name)}
                    onMouseLeave={() => setHoverName(null)}
                  >
                    <text
                      dy="0.31em"
                      x={flip ? -6 : 6}
                      textAnchor={flip ? 'end' : 'start'}
                      transform={flip ? 'rotate(180)' : undefined}
                      style={{
                        fill,
                        fontFamily: tokens.fontMono,
                        fontSize: 10,
                        fontWeight: leaf.data.name === hoverName ? 600 : 400,
                        transition: 'fill 80ms',
                      }}
                    >
                      {leaf.data.name.split('.').pop()}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </g>
      </svg>
      <ChartTooltip
        title={hoverName ?? ''}
        rows={hoverName && hoveredCounts ? [
          { color: tokens.warn, name: 'outbound', value: String(hoveredCounts.outgoing) },
          { color: tokens.ok, name: 'inbound', value: String(hoveredCounts.incoming) },
        ] : []}
        x={0} y={0}
        anchor={svgRef.current}
        visible={false /* TODO: track cursor; for now legend-style display via leaf-fill colors does the work */}
      />
    </div>
  );
}
