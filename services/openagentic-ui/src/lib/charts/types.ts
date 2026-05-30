/**
 * Shared types for the openagentic chart library.
 *
 * Every chart component in this library:
 *   1. Reads colors from CSS theme tokens (--accent, --ok, --warn, --info, --err, --cap-*)
 *   2. Uses useChartFrame() for pan/zoom/right-click menu
 *   3. Re-computes layout on prop change (d3 layout in a useMemo)
 *   4. Renders SVG via React (no imperative DOM manipulation)
 *   5. Accepts the same `ChartProps<TData>` envelope so the chatmode
 *      compose_visual T1 tool can render any of them by template name +
 *      data payload, and the admin console can render the same charts
 *      with OTel/Prometheus/SQL-sourced data.
 */

export interface ChartProps<TData = unknown> {
  /** Data payload, shape-specific to each chart template. */
  data: TData;
  /** Optional title rendered in the frame header. */
  title?: string;
  /** Optional one-line caption rendered next to the title. */
  caption?: string;
  /** Optional explicit width; defaults to 100% container. */
  width?: number;
  /** Optional explicit height; component supplies a sensible default. */
  height?: number;
  /** Disables pan/zoom/context-menu chrome — useful for tiny inline charts (sparkstrip). */
  disableFrame?: boolean;
  /**
   * Wheel-zoom policy. Default 'modifier' = wheel zooms only when Ctrl/Cmd
   * is held, so plain wheel scrolls the parent page (dashboard-friendly).
   * Use 'always' in fullscreen / modal views. 'off' disables wheel zoom
   * entirely but keeps drag-pan + context menu.
   */
  wheelZoom?: 'modifier' | 'always' | 'off';
  /**
   * When provided, the chart becomes "expandable":
   *   - double-click anywhere on the chart fires onExpand
   *   - a ↗ button is rendered in the top-right corner
   * Caller wires onExpand to its own modal state (see ChartExpandModal).
   */
  onExpand?: () => void;
  /** Forward className for outer wrapper. */
  className?: string;
}

/** Resolved theme tokens, lifted from CSS at render time. */
export interface ResolvedThemeTokens {
  accent: string;
  ok: string;
  warn: string;
  err: string;
  info: string;
  fg0: string;
  fg1: string;
  fg2: string;
  fg3: string;
  bg0: string;
  bg1: string;
  bg2: string;
  line1: string;
  line2: string;
  /** Per-capability tints used in chatmode (--cap-thinking, --cap-streaming, --cap-tools). */
  capThinking: string;
  capStreaming: string;
  capTools: string;
  /** Font stacks. */
  fontUi: string;
  fontMono: string;
}

/** A multi-source palette used when one chart needs many distinct colors (e.g. per-provider). */
export interface ChartPalette {
  /** Ordered array of N distinct colors. Cycles when N exceeded. */
  series: string[];
  /** Color for "neutral" / sink nodes (right column of a sankey). */
  neutral: string;
  /** Color used for hover/active state. */
  active: string;
}

/** Template names registered with the library; chatmode compose_visual uses these. */
export type ChartTemplate =
  | 'sankey'
  | 'sankey3'
  | 'chord'
  | 'bundle'
  | 'network'
  | 'sequence'
  | 'line'
  | 'area'
  | 'sparkstrip'
  | 'bar'
  | 'donut'
  | 'gauge'
  | 'heatmap'
  | 'scatter'
  | 'arch_diagram';
