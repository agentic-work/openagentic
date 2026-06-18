import React, { useMemo, useRef, useState } from 'react';
import { chordDirected, ribbonArrow } from 'd3-chord';
import { arc as d3Arc } from 'd3-shape';
import { descending } from 'd3-array';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface ChordData {
  /** Node names — order drives placement around the circle. */
  names: string[];
  /** N×N matrix: matrix[i][j] = flow from i → j. */
  matrix: number[][];
  /** Optional per-name color override. */
  colorByName?: Record<string, string>;
}

/**
 * Directional chord diagram — flows between N peers laid out on a circle.
 * Hover an arc (group) → dim non-related ribbons; hover a ribbon → tooltip
 * with source/target and value.
 */
export function Chord({ data, title, height = 620, disableFrame, wheelZoom, onExpand, className }: ChartProps<ChordData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);
  const [hover, setHover] = useState<{ source: number; target: number; value: number; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const width = 1180;
    const outerR = Math.min(width, height) / 2 - 80;
    const innerR = outerR - 14;
    const chord = chordDirected().padAngle(0.035).sortSubgroups(descending).sortChords(descending);
    const arc = d3Arc().innerRadius(innerR).outerRadius(outerR);
    const ribbon = ribbonArrow().radius(innerR - 2);
    const chords = chord(data.matrix);
    return { width, height, outerR, innerR, chord, arc, ribbon, chords };
  }, [data.matrix, height]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'chord', disabled: disableFrame, wheelZoom, onExpand });

  if (data.names.length === 0 || data.matrix.length === 0) {
    return <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no flows</div>;
  }

  const palette = [tokens.accent, tokens.info, tokens.ok, tokens.warn, tokens.err, tokens.capStreaming, tokens.capThinking, tokens.capTools];
  const colorOf = (i: number) =>
    data.colorByName?.[data.names[i]] ?? palette[i % palette.length];

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
            {/* Group arcs */}
            <g>
              {layout.chords.groups.map((g, i) => (
                <g
                  key={i}
                  onMouseEnter={() => setHoveredGroup(i)}
                  onMouseLeave={() => setHoveredGroup(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <path
                    d={layout.arc(g as any) ?? ''}
                    fill={colorOf(i)}
                    fillOpacity={0.95}
                  />
                  {(() => {
                    const angle = (g.startAngle + g.endAngle) / 2;
                    const x = Math.cos(angle - Math.PI / 2) * (layout.outerR + 12);
                    const y = Math.sin(angle - Math.PI / 2) * (layout.outerR + 12);
                    return (
                      <text
                        x={x} y={y}
                        textAnchor={angle > Math.PI ? 'end' : null as any}
                        dominantBaseline="middle"
                        style={{ fill: tokens.fg0, fontFamily: tokens.fontMono, fontSize: 11, pointerEvents: 'none' }}
                        transform={angle > Math.PI ? `rotate(180,${x},${y})` : undefined}
                      >
                        {data.names[i]}
                      </text>
                    );
                  })()}
                </g>
              ))}
            </g>

            {/* Ribbons */}
            <g fillOpacity={0.7}>
              {layout.chords.map((c, i) => {
                const dim = hoveredGroup !== null && c.source.index !== hoveredGroup && c.target.index !== hoveredGroup;
                return (
                  <path
                    key={i}
                    d={(layout.ribbon(c as any) as unknown as string | undefined) ?? ''}
                    fill={colorOf(c.source.index)}
                    fillOpacity={dim ? 0.05 : 0.7}
                    stroke={colorOf(c.source.index)}
                    strokeOpacity={dim ? 0.05 : 0.4}
                    style={{ cursor: 'pointer', transition: 'fill-opacity 120ms' }}
                    onMouseMove={(ev) => {
                      const svgEl = svgRef.current; if (!svgEl) return;
                      const rect = svgEl.getBoundingClientRect();
                      setHover({
                        source: c.source.index,
                        target: c.target.index,
                        value: c.source.value,
                        x: ev.clientX - rect.left,
                        y: ev.clientY - rect.top,
                      });
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
        title={hover ? `${data.names[hover.source]} → ${data.names[hover.target]}` : ''}
        rows={hover ? [
          { color: colorOf(hover.source), name: 'value', value: hover.value.toLocaleString() },
        ] : []}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        anchor={svgRef.current}
        visible={!!hover}
      />
    </div>
  );
}
