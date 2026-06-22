/**
 * Centralized chart color palette for all admin Recharts graphs.
 * Resolves from CSS variables at runtime with hex fallbacks for SSR/tests.
 *
 * Usage:
 *   import { getChartColors, CHART_COLOR_FALLBACKS } from '../Shared/chartColors';
 *   const colors = getChartColors();  // resolved from theme
 */

/** Hex fallbacks -- only used when CSS vars can't be read (SSR, tests) */
// Teal #14b8a6 below is an explicit chart-palette slot (extended series #8) —
// no semantic --ap-* equivalent. Chart palettes are non-themeable by design.
// eslint-disable-next-line admin-tokens/no-hardcoded-admin-color
export const CHART_COLOR_FALLBACKS = [
  'var(--ap-accent)', // primary (indigo)
  'var(--ap-ok)', // success (green)
  'var(--ap-warn)', // warning (amber)
  'var(--ap-err)', // error (red)
  'var(--ap-info)', // info (cyan)
  'var(--ap-accent)', // secondary (purple)
  'var(--ap-accent)', // pink
  // eslint-disable-next-line admin-tokens/no-hardcoded-admin-color
  '#14b8a6', // teal
  'var(--ap-warn)', // orange
  'var(--ap-accent)', // violet
];

/** Resolve chart colors from the CSS variable theme system with fallbacks. */
export function getChartColors(): string[] {
  if (typeof document === 'undefined') return CHART_COLOR_FALLBACKS;
  const style = getComputedStyle(document.documentElement);
  return [
    style.getPropertyValue('--color-primary').trim() || CHART_COLOR_FALLBACKS[0],
    style.getPropertyValue('--color-success').trim() || CHART_COLOR_FALLBACKS[1],
    style.getPropertyValue('--color-warning').trim() || CHART_COLOR_FALLBACKS[2],
    style.getPropertyValue('--color-error').trim() || CHART_COLOR_FALLBACKS[3],
    style.getPropertyValue('--accent-info').trim() || CHART_COLOR_FALLBACKS[4],
    style.getPropertyValue('--color-secondary').trim() || CHART_COLOR_FALLBACKS[5],
    // Extended palette -- no CSS var, use static fallbacks
    CHART_COLOR_FALLBACKS[6],
    CHART_COLOR_FALLBACKS[7],
    CHART_COLOR_FALLBACKS[8],
    CHART_COLOR_FALLBACKS[9],
  ];
}

/** Pre-resolved colors -- import this for simple cases. Recalculates on import. */
export const CHART_COLORS: string[] =
  typeof document !== 'undefined' ? getChartColors() : CHART_COLOR_FALLBACKS;
