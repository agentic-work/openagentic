import React, { useMemo, useRef, useState } from 'react';
import { scaleBand, scaleSequential } from 'd3-scale';
import { interpolateInferno } from 'd3-scale-chromatic';
import { axisLeft, axisBottom } from 'd3-axis';
import { select } from 'd3-selection';
import { format as d3Format } from 'd3-format';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface HeatmapCell {
  row: string;
  col: string | number;
  value: number;
}

export interface HeatmapData {
  rows: string[];
  cols: Array<string | number>;
  cells: HeatmapCell[];
  /** Optional override of the diverging colorscale; defaults to inferno. */
  interpolator?: (t: number) => string;
  /** Legend label, e.g. "req/hr". */
  legendLabel?: string;
}

export function Heatmap({ data, title, height = 460, disableFrame, wheelZoom, onExpand, className }: ChartProps<HeatmapData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [hover, setHover] = useState<{ cellIdx: number; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 24, right: 140, bottom: 28, left: 130 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const x = scaleBand<string | number>().domain(data.cols).range([0, innerW]).padding(0.04);
    const y = scaleBand<string>().domain(data.rows).range([0, innerH]).padding(0.06);
    const maxV = Math.max(...data.cells.map((c) => c.value), 1);
    const color = scaleSequential([0, maxV], data.interpolator ?? interpolateInferno);
    return { width, height, margin, innerW, innerH, x, y, color, maxV };
  }, [data, height]);

  useMemo(() => {
    if (!xAxisRef.current || !yAxisRef.current) return;
    select(yAxisRef.current).call(axisLeft(layout.y).tickSize(0).tickPadding(10) as any)
      .selectAll('.domain').remove();
    select(yAxisRef.current).selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    select(xAxisRef.current).call(axisBottom(layout.x).tickFormat((d) => (typeof d === 'number' ? d + ':00' : String(d))).tickSize(0).tickPadding(8) as any)
      .selectAll('.domain').remove();
    select(xAxisRef.current).selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
  }, [layout, tokens]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'heatmap', disabled: disableFrame, wheelZoom, onExpand });

  if (data.cells.length === 0) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no cells</div>;
  }

  const fmtV = d3Format('~s');
  const hoveredCell = hover ? data.cells[hover.cellIdx] : null;

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
            <g ref={xAxisRef} transform={`translate(0,${layout.innerH})`} />
            <g ref={yAxisRef} />
            <g>
              {data.cells.map((c, i) => {
                const cx = layout.x(c.col);
                const cy = layout.y(c.row);
                if (cx == null || cy == null) return null;
                const showLabel = c.value > layout.maxV * 0.65;
                return (
                  <g key={i}>
                    <rect
                      x={cx} y={cy}
                      width={layout.x.bandwidth()}
                      height={layout.y.bandwidth()}
                      rx={2}
                      fill={layout.color(c.value)}
                      stroke={hover?.cellIdx === i ? tokens.fg0 : tokens.bg1}
                      strokeWidth={hover?.cellIdx === i ? 1.5 : 1}
                      onMouseMove={(e) => {
                        const svgEl = svgRef.current; if (!svgEl) return;
                        const rect = svgEl.getBoundingClientRect();
                        setHover({ cellIdx: i, x: e.clientX - rect.left, y: e.clientY - rect.top });
                      }}
                      onMouseLeave={() => setHover(null)}
                      style={{ cursor: 'pointer' }}
                    />
                    {showLabel && (
                      <text
                        x={cx + layout.x.bandwidth() / 2}
                        y={cy + layout.y.bandwidth() / 2 + 3}
                        textAnchor="middle"
                        style={{ fill: c.value > layout.maxV * 0.5 ? tokens.bg0 : tokens.fg0, fontFamily: tokens.fontMono, fontSize: 9, pointerEvents: 'none' }}
                      >
                        {Math.round(c.value)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>

          {/* Legend on right */}
          <g transform={`translate(${layout.width - layout.margin.right + 30},${layout.margin.top + 20})`}>
            <defs>
              <linearGradient id="aw-heat-legend" x1="0" y1="1" x2="0" y2="0">
                {Array.from({ length: 11 }, (_, i) => (
                  <stop key={i} offset={`${i * 10}%`} stopColor={layout.color(layout.maxV * i / 10)} />
                ))}
              </linearGradient>
            </defs>
            <rect width={14} height={200} fill="url(#aw-heat-legend)" rx={2} />
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <text
                key={t}
                x={20} y={200 - t * 200 + 4}
                style={{ fill: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 10 }}
              >
                {Math.round(layout.maxV * t)}
              </text>
            ))}
            {data.legendLabel && (
              <text x={0} y={-8} style={{ fill: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 10 }}>
                {data.legendLabel}
              </text>
            )}
          </g>
        </g>
      </svg>
      <ChartTooltip
        title={hoveredCell ? `${hoveredCell.row} · ${hoveredCell.col}` : ''}
        rows={hoveredCell ? [{
          color: layout.color(hoveredCell.value),
          name: data.legendLabel ?? 'value',
          value: fmtV(hoveredCell.value),
        }] : []}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        anchor={svgRef.current}
        visible={!!hover}
      />
    </div>
  );
}
