import React, { useMemo, useRef, useState } from 'react';
import { scaleTime, scaleLinear, scalePoint } from 'd3-scale';
import { extent, max, bisector } from 'd3-array';
import { line as d3Line, curveMonotoneX } from 'd3-shape';
import { axisLeft, axisBottom } from 'd3-axis';
import { select } from 'd3-selection';
import { format as d3Format } from 'd3-format';
import { utcFormat } from 'd3-time-format';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import type { ChartProps } from '../types';

export interface LineSeries {
  name: string;
  /** Optional color override; falls back to theme-token palette by index. */
  color?: string;
  data: Array<{ t: Date | string | number; v: number }>;
}

export interface LineData {
  series: LineSeries[];
  /** Y-axis tick format spec, default '~s' (SI suffix). */
  yFormat?: string;
  /** Label suffix appended to tooltip values. */
  unit?: string;
}

export function Line({ data, title, height = 400, disableFrame, wheelZoom, onExpand, className }: ChartProps<LineData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [hoverIdx, setHoverIdx] = useState<{ s: number; i: number } | null>(null);

  // Detect whether this is time-series or categorical data. If t is a Date
  // or an ISO/epoch-ms string/number, treat as time. Otherwise (admin uses
  // labels like "10:00", "Jan 1") keep as string and use a band scale.
  const isIsoDateStr = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);
  const isCategorical = useMemo(() => {
    const first = data.series[0]?.data?.[0]?.t;
    if (first instanceof Date) return false;
    if (typeof first === 'string') return !isIsoDateStr(first);
    if (typeof first === 'number') return first < 1_000_000_000;
    return false;
  }, [data]);

  const normalized = useMemo(() => {
    return data.series.map((s) => ({
      ...s,
      data: isCategorical
        ? s.data.map((p) => ({ t: p.t, v: p.v }))
        : s.data
            .map((p) => ({
              t: p.t instanceof Date
                ? p.t
                : (typeof p.t === 'string' && isIsoDateStr(p.t)) || (typeof p.t === 'number' && p.t > 1_000_000_000)
                  ? new Date(p.t)
                  : p.t,
              v: p.v,
            }))
            .sort((a, b) => +(a.t as Date) - +(b.t as Date)),
    }));
  }, [data, isCategorical]);

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 24, right: 24, bottom: 36, left: 70 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const allPoints = normalized.flatMap((s) => s.data);
    if (allPoints.length === 0) {
      return { width, height, margin, innerW, innerH, x: null as any, y: null as any };
    }
    const vMax = max(allPoints, (d) => d.v) ?? 1;
    const y = scaleLinear().domain([0, vMax * 1.08]).range([innerH, 0]).nice();
    let x: any;
    if (isCategorical) {
      // Categorical xLabels — use scalePoint over the first series' t domain.
      const domain = normalized[0].data.map((d) => String(d.t));
      x = scalePoint<string>().domain(domain).range([0, innerW]).padding(0.05);
    } else {
      const [tMin, tMax] = extent(allPoints, (d) => d.t as Date);
      x = scaleTime().domain([tMin!, tMax!]).range([0, innerW]);
    }
    return { width, height, margin, innerW, innerH, x, y, isCategorical };
  }, [normalized, height, isCategorical]);

  // Apply d3 axes to the refs
  useMemo(() => {
    if (!xAxisRef.current || !yAxisRef.current || !layout.x || !layout.y) return;
    const fmt = data.yFormat ?? '~s';
    select(yAxisRef.current).call(axisLeft(layout.y).ticks(6).tickFormat(d3Format(fmt)).tickSize(0).tickPadding(8) as any)
      .call((g: any) => g.select('.domain').remove())
      .selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    // Categorical axis prints labels verbatim; time axis prints HH:MM.
    const xAxisCall = layout.isCategorical
      ? axisBottom(layout.x).tickSize(0).tickPadding(10)
      : axisBottom(layout.x).ticks(8).tickFormat(utcFormat('%H:%M') as any).tickSize(0).tickPadding(10);
    select(xAxisRef.current).call(xAxisCall as any)
      .selectAll('text').attr('fill', tokens.fg3).attr('font-family', tokens.fontMono).attr('font-size', 10);
    select(xAxisRef.current).selectAll('path,line').attr('stroke', tokens.line2);
  }, [layout, tokens, data.yFormat]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'line', disabled: disableFrame, wheelZoom, onExpand });

  if (!layout.x || !layout.y) {
    return (
      <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>
        no time-series data
      </div>
    );
  }

  const palette = [tokens.accent, tokens.info, tokens.ok, tokens.warn, tokens.err, tokens.capStreaming, tokens.capThinking, tokens.capTools];
  // .defined() filters BOTH non-finite v AND points whose t isn't in the
  // x-scale's domain (scalePoint('unknown') → undefined → NaN in path).
  // Live bug 2026-05-14 part 3: admin's TPOT panel passes xLabels from
  // an aggregated time-bucket union, but individual series only have data
  // for buckets where their model was actually used. The missing buckets
  // were rendering with d.t = something not in the scale's domain,
  // producing NaN bezier control points → invisible line.
  const xAt = (d: { t: any; v: number }) =>
    layout.x(layout.isCategorical ? String(d.t) : d.t);
  const ld = d3Line<{ t: any; v: number }>()
    .defined((d) => {
      if (!Number.isFinite(d.v)) return false;
      const x = xAt(d);
      return typeof x === 'number' && Number.isFinite(x);
    })
    .x(xAt)
    .y((d) => layout.y(d.v))
    .curve(curveMonotoneX);

  // Tooltip: snap to the nearest x-bucket across all series.
  // Two scale paths because layout.x is either scalePoint (categorical) or
  // scaleTime (continuous). scalePoint has no .invert(), so we find the
  // nearest point by comparing the cursor's inner-x to each bucket's mapped
  // pixel position (cheap — at most 24h buckets in practice).
  const bisect = bisector((d: { t: Date; v: number }) => d.t).left;
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const mxInSvg = ((e.clientX - rect.left) / rect.width) * layout.width - layout.margin.left;
    if (mxInSvg < 0 || mxInSvg > layout.innerW) {
      setHoverIdx(null);
      return;
    }
    if (normalized[0].data.length === 0) return;
    if (layout.isCategorical) {
      // Walk the first series and find the bucket whose mapped x is closest
      // to the cursor.
      const xs = normalized[0].data;
      let best = 0;
      let bestDist = Infinity;
      for (let j = 0; j < xs.length; j++) {
        const px = (layout.x as any)(String(xs[j].t));
        if (typeof px !== 'number') continue;
        const d = Math.abs(px - mxInSvg);
        if (d < bestDist) { bestDist = d; best = j; }
      }
      setHoverIdx({ s: 0, i: best });
      return;
    }
    const tHover = (layout.x as any).invert(mxInSvg);
    const i = bisect(normalized[0].data as any, tHover, 1);
    const a = normalized[0].data[i - 1];
    const b = normalized[0].data[i] ?? a;
    const idx = (b && Math.abs(+(tHover as any) - +(b.t as any)) < Math.abs(+(tHover as any) - +(a.t as any))) ? i : i - 1;
    setHoverIdx({ s: 0, i: idx });
  };

  return (
    <div className={className} data-aw-chart-frame style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <g ref={contentRef}>
          <g transform={`translate(${layout.margin.left},${layout.margin.top})`}>
            {/* Y grid */}
            {layout.y.ticks(6).map((tick: number) => (
              <line
                key={tick}
                x1={0} x2={layout.innerW}
                y1={layout.y(tick)} y2={layout.y(tick)}
                stroke={tokens.line2} strokeDasharray="2 3" strokeOpacity={0.5}
              />
            ))}
            <g ref={yAxisRef} />
            <g ref={xAxisRef} transform={`translate(0,${layout.innerH})`} />

            {/* Series lines */}
            {normalized.map((s, i) => (
              <path
                key={s.name}
                d={ld(s.data as Array<{ t: Date; v: number }>) ?? ''}
                fill="none"
                stroke={s.color ?? palette[i % palette.length]}
                strokeWidth={2}
              />
            ))}

            {/* Hover crosshair + dots */}
            {hoverIdx && (() => {
              const pt = normalized[0].data[hoverIdx.i];
              if (!pt) return null;
              const cx = layout.x(pt.t);
              return (
                <g pointerEvents="none">
                  <line x1={cx} x2={cx} y1={0} y2={layout.innerH} stroke={tokens.fg0} strokeWidth={1} strokeDasharray="2 3" />
                  {normalized.map((s, i) => {
                    const p = s.data[hoverIdx.i];
                    if (!p) return null;
                    return <circle key={s.name} cx={cx} cy={layout.y(p.v)} r={4} fill={s.color ?? palette[i % palette.length]} stroke={tokens.bg1} strokeWidth={2} />;
                  })}
                </g>
              );
            })()}
          </g>
        </g>

        {/* Tooltip overlay */}
        {hoverIdx && (() => {
          const pt = normalized[0].data[hoverIdx.i];
          if (!pt) return null;
          const cx = layout.margin.left + layout.x(pt.t);
          const flip = cx > layout.width - 220;
          const tipX = flip ? cx - 200 : cx + 12;
          const tipY = layout.margin.top + 6;
          const fmtV = d3Format(data.yFormat ?? '~s');
          return (
            <g pointerEvents="none">
              <rect x={tipX} y={tipY} width={190} height={20 + normalized.length * 16} rx={4} fill={tokens.bg1} stroke={tokens.line2} />
              <text x={tipX + 10} y={tipY + 16} style={{ fill: tokens.fg0, fontSize: 11, fontFamily: tokens.fontMono, fontWeight: 600 }}>
                {utcFormat('%H:%M UTC')(new Date(pt.t))}
              </text>
              {normalized.map((s, i) => {
                const p = s.data[hoverIdx.i];
                if (!p) return null;
                return (
                  <g key={s.name} transform={`translate(${tipX + 10},${tipY + 36 + i * 16})`}>
                    <rect width={8} height={8} y={-8} rx={1} fill={s.color ?? palette[i % palette.length]} />
                    <text x={14} style={{ fill: tokens.fg1, fontSize: 11, fontFamily: tokens.fontMono }}>
                      {s.name}: {fmtV(p.v)}{data.unit ?? ''}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
