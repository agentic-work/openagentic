import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface SequenceEvent {
  /** Stable id. */
  id: string;
  /** Display label (e.g. tool call signature). */
  name: string;
  /** Wall-clock time relative to start of sequence, in ms. */
  ms: number;
  /** Kind drives color (theme-token palette). */
  kind?: string;
  /** Optional sublabel for tooltip. */
  sub?: string;
}

export interface SequenceArc {
  /** Source event id. */
  src: string;
  /** Target event id. */
  tgt: string;
  /** Optional label for the arc (rendered in tooltip on hover). */
  label?: string;
}

export interface SequenceData {
  events: SequenceEvent[];
  arcs: SequenceArc[];
  /** kind → color override. */
  colorByKind?: Record<string, string>;
}

/**
 * Arc diagram — events on a horizontal timeline with causal handoff arcs
 * curving above. Inspired by gantt-arc visualizations of chat-turn / agent
 * sequences. Each event is colored by its kind.
 */
export function Sequence({ data, title, height = 380, disableFrame, wheelZoom, onExpand, className }: ChartProps<SequenceData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const width = 1180;
    const margin = { top: 30, right: 60, bottom: 110, left: 60 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const idToIdx = new Map(data.events.map((e, i) => [e.id, i] as const));
    const x = scaleLinear().domain([0, Math.max(1, data.events.length - 1)]).range([margin.left, margin.left + innerW]);
    return { width, height, margin, innerW, innerH, x, baseline: margin.top + innerH, idToIdx };
  }, [data, height]);

  const palette = useMemo(() => {
    const defaults: Record<string, string> = {
      user: tokens.accent,
      tool_search: tokens.ok,
      mcp_call: tokens.warn,
      synthesis: tokens.info,
      error: tokens.err,
      default: tokens.fg2,
    };
    return { ...defaults, ...(data.colorByKind ?? {}) };
  }, [tokens, data.colorByKind]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'sequence', disabled: disableFrame, wheelZoom, onExpand });

  if (data.events.length === 0) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no events</div>;
  }

  const colorOf = (kind?: string) => palette[kind ?? 'default'] ?? palette.default;
  const hoveredEvent = hover ? data.events[hover.idx] : null;

  return (
    <div className={className} data-aw-chart-frame style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height, cursor: disableFrame ? 'default' : 'grab' }}
      >
        <g ref={contentRef}>
          {/* Baseline + tick marks */}
          <line
            x1={layout.margin.left} y1={layout.baseline}
            x2={layout.width - layout.margin.right} y2={layout.baseline}
            stroke={tokens.line2}
          />
          {data.events.map((_, i) => (
            <line
              key={`tick-${i}`}
              x1={layout.x(i)} x2={layout.x(i)}
              y1={layout.baseline - 4} y2={layout.baseline + 4}
              stroke={tokens.line2}
            />
          ))}

          {/* Arcs (curved up from baseline) */}
          <g>
            {data.arcs.map((arc, ai) => {
              const sIdx = layout.idToIdx.get(arc.src);
              const tIdx = layout.idToIdx.get(arc.tgt);
              if (sIdx == null || tIdx == null) return null;
              const x1 = layout.x(sIdx);
              const x2 = layout.x(tIdx);
              const r = Math.abs(x2 - x1) / 2;
              const targetKind = data.events[tIdx]?.kind;
              const sweep = x2 >= x1 ? 1 : 0;
              return (
                <path
                  key={ai}
                  d={`M ${x1} ${layout.baseline} A ${r} ${r} 0 0 ${sweep} ${x2} ${layout.baseline}`}
                  fill="none"
                  stroke={colorOf(targetKind)}
                  strokeOpacity={0.55}
                  strokeWidth={1 + Math.log10(Math.abs(tIdx - sIdx) + 1) * 1.5}
                />
              );
            })}
          </g>

          {/* Events (circles on baseline) */}
          <g>
            {data.events.map((e, i) => {
              const isHovered = hover?.idx === i;
              return (
                <g key={e.id} transform={`translate(${layout.x(i)},${layout.baseline})`}>
                  <circle
                    r={isHovered ? 8 : 6}
                    fill={colorOf(e.kind)}
                    stroke={isHovered ? tokens.fg0 : 'none'}
                    strokeWidth={1.5}
                    style={{ cursor: 'pointer', transition: 'r 80ms' }}
                    onMouseMove={(ev) => {
                      const svgEl = svgRef.current; if (!svgEl) return;
                      const rect = svgEl.getBoundingClientRect();
                      setHover({ idx: i, x: ev.clientX - rect.left, y: ev.clientY - rect.top });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                  <text
                    transform="rotate(35)"
                    x={12} y={4}
                    style={{ fill: tokens.fg1, fontFamily: tokens.fontMono, fontSize: 11, pointerEvents: 'none' }}
                  >
                    {e.name}
                  </text>
                  <text
                    transform="rotate(35)"
                    x={12} y={18}
                    style={{ fill: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 9, pointerEvents: 'none' }}
                  >
                    {e.ms.toLocaleString()}ms
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <ChartTooltip
        title={hoveredEvent?.name}
        rows={hoveredEvent ? [
          { color: colorOf(hoveredEvent.kind), name: 'kind', value: hoveredEvent.kind ?? '—' },
          { color: tokens.fg3, name: 'ms', value: hoveredEvent.ms.toLocaleString() },
          ...(hoveredEvent.sub ? [{ color: tokens.fg3, name: 'sub', value: hoveredEvent.sub }] : []),
        ] : []}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        anchor={svgRef.current}
        visible={!!hover}
      />
    </div>
  );
}
