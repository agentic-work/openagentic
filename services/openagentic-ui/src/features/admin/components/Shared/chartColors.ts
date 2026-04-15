/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Centralized chart color palette for all admin Recharts graphs.
 * Resolves from CSS variables at runtime with hex fallbacks for SSR/tests.
 *
 * Usage:
 *   import { getChartColors, CHART_COLOR_FALLBACKS } from '../Shared/chartColors';
 *   const colors = getChartColors();  // resolved from theme
 */

/** Hex fallbacks -- only used when CSS vars can't be read (SSR, tests) */
export const CHART_COLOR_FALLBACKS = [
  '#6366f1', // primary (indigo)
  '#00D26A', // success (green)
  '#f59e0b', // warning (amber)
  '#ef4444', // error (red)
  '#06b6d4', // info (cyan)
  '#a855f7', // secondary (purple)
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#8b5cf6', // violet
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
