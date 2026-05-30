import React, { useMemo, useRef, useState } from 'react';
import { scaleTime, scaleLinear, scalePoint } from 'd3-scale';
import { stack as d3Stack, stackOrderNone, stackOffsetNone, area as d3Area, curveMonotoneX } from 'd3-shape';
import { extent, max as d3Max } from 'd3-array';
import { axisLeft, axisBottom } from 'd3-axis';
import { select } from 'd3-selection';
import { format as d3Format } from 'd3-format';
import { utcFormat } from 'd3-time-format';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip, type TooltipRow } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface AreaSeries {
  name: string;
  color?: string;
  data: Array<{ t: Date | string | number; v: number }>;
}

export interface AreaData {
  series: AreaSeries[];
  /** stacked (default) renders d3-stack of all series; overlay renders each as its own area on the same axes. */
  mode?: 'stacked' | 'overlay';
  /** Y-axis tick format spec; default '~s'. */
  yFormat?: string;
  /** Optional x-tick labels — when the t-domain is categorical instead of time. */
  xLabels?: string[];
}

export function Area({ data, title, height = 460, disableFrame, wheelZoom, onExpand, className }: ChartProps<AreaData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const mode = data.mode ?? 'stacked';
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const normalized = useMemo(() => {
    // Preserve t types: Date stays Date; string stays string (categorical xLabels
    // like "10:00" / "Jan 1" / "M01" would otherwise become Invalid Date and
    // crash the stacked-area layout). Only convert ISO date strings and epoch-ms
    // numbers to real Date — those are the cases scaleTime expects.
    const isIsoDateStr = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);
    return data.series.map((s) => ({
      ...s,
      data: s.data.map((p) => {
        if (p.t instanceof Date) return { t: p.t, v: p.v };
        if (typeof p.t === 'string' && isIsoDateStr(p.t)) return { t: new Date(p.t), v: p.v };
        if (typeof p.t === 'number' && p.t > 1_000_000_000) return { t: new Date(p.t), v: p.v };
        return { t: p.t, v: p.v };
      }),
    }));
  }, [data]);

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 24, right: 24, bottom: 36, left: 70 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    if (normalized.length === 0 || normalized[0].data.length === 0) {
      return { width, height, margin, innerW, innerH, x: null as any, y: null as any, series: null as any, stacked: null as any };
    }

    const firstSeries = normalized[0];
    const useCategorical = !!data.xLabels && data.xLabels.length > 0;
    let x: any;
    if (useCategorical) {
      x = scalePoint<string>().domain(data.xLabels!).range([0, innerW]).padding(0.1);
    } else {
      const ts = firstSeries.data.map((d) => d.t as Date);
      const [tMin, tMax] = extent(ts as Date[]);
      x = scaleTime().domain([tMin!, tMax!]).range([0, innerW]);
    }

    if (mode === 'stacked') {
      const keys = normalized.map((s) => s.name);
      // Coalesce null/undefined/NaN to 0 — otherwise d3-stack returns NaN
      // accumulator values which propagate to NaN coords in the path.
      const safeNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      const rows = firstSeries.data.map((_, i) => {
        const row: Record<string, number | Date> = { t: firstSeries.data[i].t as Date };
        normalized.forEach((s) => { row[s.name] = safeNum(s.data[i]?.v); });
        return row;
      });
      const stackGen = d3Stack<Record<string, number | Date>>()
        .keys(keys).order(stackOrderNone).offset(stackOffsetNone);
      const stacked = stackGen(rows);
      const vMax = d3Max(stacked.flat(), (d: any) => d[1]) ?? 1;
      const y = scaleLinear().domain([0, vMax * 1.05]).range([innerH, 0]).nice();
      return { width, height, margin, innerW, innerH, x, y, series: normalized, stacked, useCategorical };
    } else {
      const all = normalized.flatMap((s) => s.data);
      const vMax = d3Max(all, (d) => d.v) ?? 1;
      const y = scaleLinear().domain([0, vMax * 1.08]).range([innerH, 0]).nice();
      return { width, height, margin, innerW, innerH, x, y, series: normalized, stacked: null, useCategorical };
    }
  }, [normalized, height, mode, data.xLabels]);

  useMemo(() => {
    if (!xAxisRef.current || !yAxisRef.current || !layout.x || !layout.y) return;
    const fmt = data.yFormat ?? '~s';
    select(yAxisRef.current)
      .call(axisLeft(layout.y).ticks(6).tickFormat(d3Format(fmt)).tickSize(0).tickPadding(8) as any)
      .call((g: any) => g.select('.domain').remove())
      .selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    const xAxis = layout.useCategorical
      ? axisBottom(layout.x).tickSize(0).tickPadding(10)
      : axisBottom(layout.x).ticks(8).tickFormat(utcFormat('%H:%M') as any).tickSize(0).tickPadding(10);
    select(xAxisRef.current).call(xAxis as any)
      .selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    select(xAxisRef.current).selectAll('path,line').attr('stroke', tokens.line2);
  }, [layout, tokens, data.yFormat]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'area', disabled: disableFrame, wheelZoom, onExpand });

  if (!layout.x || !layout.y || !layout.series) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no time-series data</div>;
  }

  const palette = [tokens.accent, tokens.info, tokens.ok, tokens.warn, tokens.err, tokens.capStreaming, tokens.capThinking, tokens.capTools];

  const fmtV = d3Format(data.yFormat ?? '~s');

  // Hover: snap to nearest x-bucket. firstSeries.data carries the bucket
  // sequence — we use its index as the canonical x position so all stacks
  // align.
  const firstSeriesData = normalized[0]?.data ?? [];
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgEl = svgRef.current; if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    // jsdom returns rect.width=0 (no layout). Fall back to viewBox-scale so
    // tests still exercise hover state. In a real browser rect.width is
    // always > 0.
    const cssToViewBox = rect.width > 0 ? layout.width / rect.width : 1;
    const xInSvg = (e.clientX - rect.left) * cssToViewBox;
    const xInner = xInSvg - layout.margin.left;
    if (firstSeriesData.length === 0) { setHover(null); return; }
    if (xInner < 0 || xInner > layout.innerW) {
      // Out-of-bounds clears hover. But in jsdom the math above can land in
      // bounds for the synthetic clientX=600 test (1:1 fallback) which is what
      // the contract tests expect.
      setHover(null);
      return;
    }
    const step = layout.innerW / Math.max(1, firstSeriesData.length - 1);
    const idx = Math.max(0, Math.min(firstSeriesData.length - 1, Math.round(xInner / step)));
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Build tooltip rows from each series' value at the hovered bucket
  const tooltipRows: TooltipRow[] = hover
    ? normalized.map((s, i) => ({
        color: s.color ?? palette[i % palette.length],
        name: s.name,
        value: fmtV(s.data[hover.idx]?.v ?? 0),
      }))
    : [];

  const tooltipTitle = (() => {
    if (!hover) return '';
    const t = firstSeriesData[hover.idx]?.t;
    if (t instanceof Date) return utcFormat('%H:%M UTC')(t);
    return String(t);
  })();

  // Crosshair x-position
  const crosshairX = hover && firstSeriesData[hover.idx]
    ? layout.x(firstSeriesData[hover.idx].t as Date)
    : null;

  return (
    <div className={className} data-aw-chart-frame style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <g ref={contentRef}>
          <g transform={`translate(${layout.margin.left},${layout.margin.top})`}>
            {layout.y.ticks(6).map((t: number) => (
              <line key={t} x1={0} x2={layout.innerW} y1={layout.y(t)} y2={layout.y(t)} stroke={tokens.line2} strokeDasharray="2 3" strokeOpacity={0.5} />
            ))}
            <g ref={yAxisRef} />
            <g ref={xAxisRef} transform={`translate(0,${layout.innerH})`} />

            {mode === 'stacked' && layout.stacked && (
              <g>
                {layout.stacked.map((series: any, i: number) => {
                  const ag = d3Area<any>()
                    .defined((d) => {
                      if (!Number.isFinite(d[0]) || !Number.isFinite(d[1])) return false;
                      const xv = layout.x(d.data.t as Date);
                      return typeof xv === 'number' && Number.isFinite(xv);
                    })
                    .x((d) => layout.x(d.data.t as Date))
                    .y0((d) => layout.y(d[0]))
                    .y1((d) => layout.y(d[1]))
                    .curve(curveMonotoneX);
                  const color = layout.series[i].color ?? palette[i % palette.length];
                  return <path key={series.key} d={ag(series) ?? ''} fill={color} fillOpacity={0.7} stroke={color} strokeWidth={1} />;
                })}
              </g>
            )}

            {/* Crosshair + per-bucket dots when hovered */}
            {crosshairX != null && (
              <g pointerEvents="none">
                <line
                  data-aw-area-crosshair
                  x1={crosshairX}
                  x2={crosshairX}
                  y1={0}
                  y2={layout.innerH}
                  stroke={tokens.fg0}
                  strokeOpacity={0.6}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
              </g>
            )}

            {mode === 'overlay' && (
              <g>
                {layout.series.map((s: AreaSeries, i: number) => {
                  const ag = d3Area<{ t: Date; v: number }>()
                    .defined((d) => {
                      if (!Number.isFinite(d.v)) return false;
                      const xv = layout.x(d.t as Date);
                      return typeof xv === 'number' && Number.isFinite(xv);
                    })
                    .x((d) => layout.x(d.t as Date))
                    .y0(layout.innerH)
                    .y1((d) => layout.y(d.v))
                    .curve(curveMonotoneX);
                  const color = s.color ?? palette[i % palette.length];
                  return <path key={s.name} d={ag(s.data as Array<{ t: Date; v: number }>) ?? ''} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1.5} />;
                })}
              </g>
            )}
          </g>
        </g>
      </svg>
      <ChartTooltip
        title={tooltipTitle}
        rows={tooltipRows}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        anchor={svgRef.current}
        visible={!!hover}
      />
    </div>
  );
}
