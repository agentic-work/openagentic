import React, { useState } from 'react';
import { ChartExpandModal, type TimeRange } from './ChartExpandModal';

export interface ExpandableChartRenderProps {
  /** Pass this to the chart's wheelZoom prop. */
  wheelZoom: 'modifier' | 'always' | 'off';
  /** Pass this to the chart's height prop. */
  height: number;
  /** Pass this to the chart's onExpand prop (only set when in inline mode). */
  onExpand?: () => void;
  /** True when the chart is rendering in the expand modal. */
  expanded: boolean;
}

export interface ExpandableChartProps {
  /** Modal title (chart's display name). */
  title: string;
  /** Modal subtitle (window info, units, etc). */
  subtitle?: string;
  /** Inline chart height; expanded mode uses min(900px, 90vh) - chrome. */
  inlineHeight?: number;
  /** Expanded chart height; overrides the default of 720px when present. */
  expandedHeight?: number;
  /** Time-range chip strip in the modal header. Omit for charts without time. */
  range?: TimeRange;
  onRangeChange?: (range: TimeRange) => void;
  /**
   * Render the chart. Called twice: once for inline (in dashboard panel)
   * and once for modal (in expand overlay). Use the passed props to switch
   * sizing / wheel-zoom / onExpand wiring without duplicating code.
   */
  renderChart: (props: ExpandableChartRenderProps) => React.ReactNode;
}

/**
 * Wraps any chart with a dblclick → expand modal pattern.
 *
 *   <ExpandableChartPanel
 *     title="TTFT p95 by model"
 *     subtitle="last 24h · ms"
 *     renderChart={({ wheelZoom, height, onExpand }) => (
 *       <Line data={...} height={height} wheelZoom={wheelZoom} onExpand={onExpand} />
 *     )}
 *   />
 *
 * In inline mode the chart receives `onExpand` (opens the modal). In
 * expanded mode the chart receives `wheelZoom="always"`, a larger height,
 * and no `onExpand` (dblclick resets zoom — useful in the modal).
 */
export function ExpandableChart({
  title,
  subtitle,
  inlineHeight = 220,
  expandedHeight = 720,
  range,
  onRangeChange,
  renderChart,
}: ExpandableChartProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {renderChart({
        wheelZoom: 'modifier',
        height: inlineHeight,
        onExpand: () => setOpen(true),
        expanded: false,
      })}
      <ChartExpandModal
        title={title}
        subtitle={subtitle}
        open={open}
        onClose={() => setOpen(false)}
        range={range}
        onRangeChange={onRangeChange}
      >
        {renderChart({
          wheelZoom: 'always',
          height: expandedHeight,
          // No onExpand in modal — dblclick resets zoom (the useChartFrame default).
          expanded: true,
        })}
      </ChartExpandModal>
    </>
  );
}
