import React, { useEffect, useMemo, useRef, useState } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, Simulation } from 'd3-force';
import { drag as d3Drag } from 'd3-drag';
import { select } from 'd3-selection';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import type { ChartProps } from '../types';

export interface NetworkNode {
  id: string;
  name?: string;
  /** Logical category — color is picked from theme palette per kind. */
  kind?: string;
  /** Visual radius. Default 14. */
  size?: number;
  /** Optional fixed position; when set, the node won't be repositioned by the simulation. */
  fx?: number;
  fy?: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  /** Used for edge width sqrt-scaled. */
  value?: number;
}

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
  /** Optional kind→color overrides. */
  colorByKind?: Record<string, string>;
}

interface SimNode extends NetworkNode {
  x?: number; y?: number;
  vx?: number; vy?: number;
}
interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
  value?: number;
}

/**
 * Force-directed network diagram. Drag nodes to reposition. Hover dims
 * non-connected edges. Pan/zoom + right-click menu via useChartFrame.
 *
 * Replaces ServiceTopologySvg in admin and renders for chatmode via the
 * compose_visual template "network".
 */
export function Network({ data, title, height = 560, disableFrame, wheelZoom, onExpand, className }: ChartProps<NetworkData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const linksGroupRef = useRef<SVGGElement>(null);
  const nodesGroupRef = useRef<SVGGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const tokens = useThemeTokens(svgRef);

  const palette = useMemo(() => {
    const defaults: Record<string, string> = {
      frontend: tokens.accent,
      api: tokens.info,
      mcp: tokens.ok,
      workflow: tokens.warn,
      datastore: tokens.err,
      external: tokens.fg3,
    };
    return { ...defaults, ...(data.colorByKind ?? {}) };
  }, [tokens, data.colorByKind]);

  const width = 1180;

  useEffect(() => {
    const svgEl = svgRef.current;
    const linksGroup = linksGroupRef.current;
    const nodesGroup = nodesGroupRef.current;
    if (!svgEl || !linksGroup || !nodesGroup) return;

    const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const simLinks: SimLink[] = data.links.map((l) => ({ ...l }));

    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance((d) => 90 + 120 / Math.max(1, (d as any).value ?? 1)))
      .force('charge', forceManyBody().strength(-340))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collision', forceCollide<SimNode>().radius((d) => (d.size ?? 14) + 8))
      .alphaDecay(0.04);

    simRef.current = sim;

    const linksSel = select(linksGroup).selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks).join('line')
      .attr('stroke', tokens.fg3).attr('stroke-opacity', 0.4)
      .attr('stroke-width', (d) => Math.max(1, Math.sqrt((d as any).value ?? 1)));

    const nodeSel = select(nodesGroup).selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d: any) => d.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'node').style('cursor', 'pointer');
        g.append('circle')
          .attr('r', (d) => d.size ?? 14)
          .attr('fill', (d) => palette[d.kind ?? 'external'] ?? tokens.fg3)
          .attr('fill-opacity', 0.95)
          .attr('stroke', tokens.bg0).attr('stroke-width', 2);
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', (d) => (d.size ?? 14) + 14)
          .attr('fill', tokens.fg0).attr('font-size', 11).attr('font-weight', 600).style('pointer-events', 'none')
          .text((d) => d.name ?? d.id);
        g.append('text').attr('class', 'sub')
          .attr('text-anchor', 'middle')
          .attr('dy', (d) => (d.size ?? 14) + 26)
          .attr('fill', tokens.fg3).attr('font-size', 10).attr('font-family', tokens.fontMono).style('pointer-events', 'none')
          .text((d) => d.kind ?? '');
        return g;
      });

    // Drag
    const drag = d3Drag<SVGGElement, SimNode>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null as any; d.fy = null as any; });
    nodeSel.call(drag as any);

    // Hover dim
    nodeSel.on('mouseover', (_, d) => setHoveredId(d.id));
    nodeSel.on('mouseout', () => setHoveredId(null));

    sim.on('tick', () => {
      linksSel
        .attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [data, palette, tokens, height, width]);

  // Hover dim — applied each render, independent of sim cycle
  useEffect(() => {
    const linksGroup = linksGroupRef.current;
    if (!linksGroup) return;
    select(linksGroup).selectAll<SVGLineElement, SimLink>('line')
      .attr('stroke-opacity', (l: any) => {
        if (!hoveredId) return 0.4;
        return l.source.id === hoveredId || l.target.id === hoveredId ? 0.85 : 0.08;
      });
  }, [hoveredId]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'network', disabled: disableFrame, wheelZoom, onExpand });

  if (data.nodes.length === 0) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no nodes</div>;
  }

  return (
    <div className={className} data-aw-chart-frame style={{ width: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'grab' }}
      >
        <g ref={contentRef}>
          <g ref={linksGroupRef} />
          <g ref={nodesGroupRef} />
        </g>
      </svg>
    </div>
  );
}
