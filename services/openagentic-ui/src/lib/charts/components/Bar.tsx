import React, { useMemo, useRef, useState } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { stack as d3Stack, stackOrderNone, stackOffsetNone } from 'd3-shape';
import { max as d3Max } from 'd3-array';
import { axisLeft, axisBottom } from 'd3-axis';
import { select } from 'd3-selection';
import { format as d3Format } from 'd3-format';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip, type TooltipRow } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface BarData {
  /** Category axis labels — one per group. */
  categories: string[];
  /** One series per stack segment. Each value array has one entry per category, same length as `categories`. */
  series: Array<{ name: string; color?: string; values: number[] }>;
  /** Y-axis tick format spec, default '~s'. */
  yFormat?: string;
  /** Render mode: stacked (default) or grouped (side-by-side). */
  mode?: 'stacked' | 'grouped';
  /** Show total label above each bar (stacked mode only). */
  showTotals?: boolean;
}

export function Bar({ data, title, height = 460, disableFrame, wheelZoom, onExpand, className }: ChartProps<BarData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const mode = data.mode ?? 'stacked';

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 24, right: 24, bottom: 90, left: 70 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    if (data.categories.length === 0 || data.series.length === 0) {
      return { width, height, margin, innerW, innerH, x: null as any, y: null as any, stacked: null as any };
    }

    const x = scaleBand<string>().domain(data.categories).range([0, innerW]).padding(0.22);

    if (mode === 'stacked') {
      const rows = data.categories.map((cat, i) => {
        const row: Record<string, number | string> = { cat };
        data.series.forEach((s) => { row[s.name] = s.values[i] ?? 0; });
        return row;
      });
      const stackGen = d3Stack<Record<string, number | string>>()
        .keys(data.series.map((s) => s.name))
        .order(stackOrderNone)
        .offset(stackOffsetNone);
      const stacked = stackGen(rows);
      const totals = data.categories.map((_, i) => data.series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
      const y = scaleLinear().domain([0, (d3Max(totals) ?? 1) * 1.08]).range([innerH, 0]).nice();
      return { width, height, margin, innerW, innerH, x, y, stacked, totals };
    } else {
      // grouped mode — each series gets its own sub-band
      const flat = data.series.flatMap((s) => s.values);
      const y = scaleLinear().domain([0, (d3Max(flat) ?? 1) * 1.08]).range([innerH, 0]).nice();
      const sub = scaleBand<string>().domain(data.series.map((s) => s.name)).range([0, x.bandwidth()]).padding(0.08);
      return { width, height, margin, innerW, innerH, x, y, sub, stacked: null, totals: null };
    }
  }, [data, height, mode]);

  useMemo(() => {
    if (!xAxisRef.current || !yAxisRef.current || !layout.x || !layout.y) return;
    const fmt = data.yFormat ?? '~s';
    select(yAxisRef.current)
      .call(axisLeft(layout.y).ticks(6).tickFormat(d3Format(fmt)).tickSize(0).tickPadding(8) as any)
      .call((g: any) => g.select('.domain').remove())
      .selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    select(xAxisRef.current)
      .call(axisBottom(layout.x as any).tickSize(0).tickPadding(10) as any)
      .selectAll('text').attr('transform', 'rotate(-22)').attr('text-anchor', 'end').attr('fill', tokens.fg3)
      .attr('font-family', tokens.fontMono).attr('font-size', 10);
    select(xAxisRef.current).selectAll('path,line').attr('stroke', tokens.line2);
  }, [layout, tokens, data.yFormat]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'bar', disabled: disableFrame, wheelZoom, onExpand });

  if (!layout.x || !layout.y) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no data</div>;
  }

  const palette = [tokens.accent, tokens.info, tokens.warn, tokens.ok, tokens.err, tokens.capThinking, tokens.capStreaming, tokens.capTools];
  const fmtV = d3Format(data.yFormat ?? '~s');

  // Hover tooltip — tracks the category currently under the cursor and
  // shows all series values (stacked) or the single value (grouped).
  const [hover, setHover] = useState<{ catIdx: number; x: number; y: number } | null>(null);
  const tooltipRows: TooltipRow[] = useMemo(() => {
    if (!hover) return [];
    return data.series.map((s, i) => ({
      color: s.color ?? palette[i % palette.length],
      name: s.name,
      value: fmtV(s.values[hover.catIdx] ?? 0),
    }));
  }, [hover, data.series, palette, fmtV]);

  const colWidth = layout.x ? layout.x.bandwidth() + (layout.innerW / data.categories.length) * 0.22 : 0;
  const colStep = data.categories.length > 0 ? layout.innerW / data.categories.length : 0;

  return (
    <div className={className} data-aw-chart-frame style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'grab' }}
        onMouseMove={(e) => {
          const svgEl = svgRef.current; if (!svgEl) return;
          const rect = svgEl.getBoundingClientRect();
          const xInSvg = ((e.clientX - rect.left) / rect.width) * layout.width;
          const xInner = xInSvg - layout.margin.left;
          if (xInner < 0 || xInner > layout.innerW) { setHover(null); return; }
          const catIdx = Math.max(0, Math.min(data.categories.length - 1, Math.floor(xInner / colStep)));
          setHover({ catIdx, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
        onMouseLeave={() => setHover(null)}
      >
        <g ref={contentRef}>
          <g transform={`translate(${layout.margin.left},${layout.margin.top})`}>
            {/* Y grid */}
            {layout.y.ticks(6).map((t: number) => (
              <line key={t} x1={0} x2={layout.innerW} y1={layout.y(t)} y2={layout.y(t)} stroke={tokens.line2} strokeDasharray="2 3" strokeOpacity={0.5} />
            ))}
            <g ref={yAxisRef} />
            <g ref={xAxisRef} transform={`translate(0,${layout.innerH})`} />

            {/* Bars */}
            {mode === 'stacked' && layout.stacked && (
              <g>
                {layout.stacked.map((series: any, sIdx: number) => (
                  <g key={data.series[sIdx].name} fill={data.series[sIdx].color ?? palette[sIdx % palette.length]}>
                    {series.map((d: any, i: number) => {
                      const cat = data.categories[i];
                      const cx = layout.x(cat);
                      if (cx == null) return null;
                      return (
                        <rect
                          key={cat}
                          x={cx}
                          y={layout.y(d[1])}
                          width={layout.x.bandwidth()}
                          height={layout.y(d[0]) - layout.y(d[1])}
                          rx={1}
                        />
                      );
                    })}
                  </g>
                ))}
                {data.showTotals && layout.totals && data.categories.map((cat, i) => {
                  const cx = layout.x(cat);
                  if (cx == null) return null;
                  const tot = layout.totals[i];
                  return (
                    <text
                      key={cat}
                      x={cx + layout.x.bandwidth() / 2}
                      y={layout.y(tot) - 6}
                      textAnchor="middle"
                      style={{ fill: tokens.fg0, fontSize: 10, fontFamily: tokens.fontMono, fontWeight: 500 }}
                    >
                      {fmtV(tot)}
                    </text>
                  );
                })}
              </g>
            )}

            {mode === 'grouped' && (
              <g>
                {data.series.map((s, sIdx) => (
                  <g key={s.name} fill={s.color ?? palette[sIdx % palette.length]}>
                    {s.values.map((v, i) => {
                      const cat = data.categories[i];
                      const cx = layout.x(cat);
                      const subX = (layout as any).sub(s.name);
                      if (cx == null || subX == null) return null;
                      return (
                        <rect
                          key={cat}
                          x={cx + subX}
                          y={layout.y(v)}
                          width={(layout as any).sub.bandwidth()}
                          height={layout.innerH - layout.y(v)}
                          rx={1}
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
            )}
            {/* Hover highlight band */}
            {hover && (() => {
              const cat = data.categories[hover.catIdx];
              const cx = layout.x(cat);
              if (cx == null) return null;
              return (
                <rect
                  x={cx - 4}
                  y={0}
                  width={layout.x.bandwidth() + 8}
                  height={layout.innerH}
                  fill={tokens.fg0}
                  fillOpacity={0.05}
                  pointerEvents="none"
                />
              );
            })()}
          </g>
        </g>
      </svg>
      <ChartTooltip
        title={hover ? data.categories[hover.catIdx] : ''}
        rows={tooltipRows}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        anchor={svgRef.current}
        visible={!!hover}
      />
    </div>
  );
}
