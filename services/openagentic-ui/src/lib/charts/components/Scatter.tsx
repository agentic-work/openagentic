import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog, scaleSqrt } from 'd3-scale';
import { extent, max as d3Max } from 'd3-array';
import { axisLeft, axisBottom } from 'd3-axis';
import { select } from 'd3-selection';
import { format as d3Format } from 'd3-format';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface ScatterPoint {
  /** Point's x value. */
  x: number;
  /** Point's y value. */
  y: number;
  /** Optional size (drives radius via sqrt scale). */
  size?: number;
  /** Category drives color; falls back to series palette index. */
  category?: string;
  /** Optional rich label for the tooltip (default = category). */
  label?: string;
}

export interface ScatterData {
  points: ScatterPoint[];
  /** Axis scale type for x/y. Default 'linear'. */
  xScale?: 'linear' | 'log';
  yScale?: 'linear' | 'log';
  xLabel?: string;
  yLabel?: string;
  /** Optional category → color override. */
  colorByCategory?: Record<string, string>;
}

export function Scatter({ data, title, height = 480, disableFrame, wheelZoom, onExpand, className }: ChartProps<ScatterData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 24, right: 24, bottom: 50, left: 80 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    if (data.points.length === 0) return { width, height, margin, innerW, innerH, x: null as any, y: null as any, r: null as any };
    const [xMin, xMax] = extent(data.points, (p) => p.x);
    const [yMin, yMax] = extent(data.points, (p) => p.y);
    const xLo = data.xScale === 'log' ? Math.max(0.1, xMin ?? 1) : (xMin ?? 0);
    const yLo = data.yScale === 'log' ? Math.max(0.1, yMin ?? 1) : (yMin ?? 0);
    const x = (data.xScale === 'log' ? scaleLog() : scaleLinear())
      .domain([xLo, (xMax ?? 1) * 1.1]).range([0, innerW]).nice();
    const y = (data.yScale === 'log' ? scaleLog() : scaleLinear())
      .domain([yLo, (yMax ?? 1) * 1.1]).range([innerH, 0]).nice();
    const r = scaleSqrt().domain([0, d3Max(data.points, (p) => p.size ?? 0) ?? 1]).range([3, 18]);
    return { width, height, margin, innerW, innerH, x, y, r };
  }, [data, height]);

  useMemo(() => {
    if (!xAxisRef.current || !yAxisRef.current || !layout.x || !layout.y) return;
    select(yAxisRef.current)
      .call(axisLeft(layout.y).ticks(6, '~s').tickSize(0).tickPadding(8) as any)
      .call((g: any) => g.select('.domain').remove())
      .selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    select(xAxisRef.current)
      .call(axisBottom(layout.x).ticks(7, '~s').tickSize(0).tickPadding(10) as any)
      .selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    select(xAxisRef.current).selectAll('path,line').attr('stroke', tokens.line2);
  }, [layout, tokens]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'scatter', disabled: disableFrame, wheelZoom, onExpand });

  if (!layout.x || !layout.y) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no points</div>;
  }

  const palette = [tokens.accent, tokens.info, tokens.ok, tokens.warn, tokens.err, tokens.capStreaming, tokens.capThinking, tokens.capTools];
  const cats = [...new Set(data.points.map((p) => p.category ?? 'default'))];
  const colorFor = (cat: string): string => {
    if (data.colorByCategory?.[cat]) return data.colorByCategory[cat];
    const idx = cats.indexOf(cat);
    return palette[(idx >= 0 ? idx : 0) % palette.length];
  };
  const fmt = d3Format('~s');

  const hovered = hover ? data.points[hover.idx] : null;

  return (
    <div className={className} data-aw-chart-frame style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'grab' }}
      >
        <g ref={contentRef}>
          <g transform={`translate(${layout.margin.left},${layout.margin.top})`}>
            {layout.y.ticks(6).map((t: number) => (
              <line key={t} x1={0} x2={layout.innerW} y1={layout.y(t)} y2={layout.y(t)} stroke={tokens.line2} strokeDasharray="2 3" strokeOpacity={0.5} />
            ))}
            <g ref={yAxisRef} />
            <g ref={xAxisRef} transform={`translate(0,${layout.innerH})`} />

            {data.xLabel && (
              <text x={layout.innerW / 2} y={layout.innerH + 36} textAnchor="middle" style={{ fill: tokens.fg2, fontFamily: tokens.fontMono, fontSize: 11 }}>
                {data.xLabel}
              </text>
            )}
            {data.yLabel && (
              <text transform={`translate(-60,${layout.innerH / 2}) rotate(-90)`} textAnchor="middle" style={{ fill: tokens.fg2, fontFamily: tokens.fontMono, fontSize: 11 }}>
                {data.yLabel}
              </text>
            )}

            <g>
              {data.points.map((p, i) => {
                const cat = p.category ?? 'default';
                const radius = p.size != null ? layout.r(p.size) : 4;
                return (
                  <circle
                    key={i}
                    cx={layout.x(p.x)}
                    cy={layout.y(p.y)}
                    r={radius}
                    fill={colorFor(cat)}
                    fillOpacity={0.75}
                    stroke={hover?.idx === i ? tokens.fg0 : tokens.bg1}
                    strokeWidth={hover?.idx === i ? 1.5 : 1}
                    style={{ cursor: 'pointer' }}
                    onMouseMove={(e) => {
                      const svgEl = svgRef.current; if (!svgEl) return;
                      const rect = svgEl.getBoundingClientRect();
                      setHover({ idx: i, x: e.clientX - rect.left, y: e.clientY - rect.top });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
          </g>
        </g>
      </svg>
      <ChartTooltip
        title={hovered?.label ?? hovered?.category ?? ''}
        rows={hovered ? [
          { color: colorFor(hovered.category ?? 'default'), name: data.xLabel ?? 'x', value: fmt(hovered.x) },
          { color: tokens.fg3, name: data.yLabel ?? 'y', value: fmt(hovered.y) },
          ...(hovered.size != null ? [{ color: tokens.fg3, name: 'size', value: fmt(hovered.size) }] : []),
        ] : []}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        anchor={svgRef.current}
        visible={!!hover}
      />
    </div>
  );
}
