/**
 * Theme utility functions for consistent color handling
 * 
 * This module provides utilities to replace hardcoded RGBA values
 * with CSS variable-based color mixing for theme-aware styling.
 * 
 * @example
 * // Instead of hardcoded colors:
 * style={{ background: 'rgba(124, 58, 237, 0.1)' }}
 * 
 * // Use theme utilities:
 * style={{ background: theme.bgPrimary(0.1) }}
 */

/**
 * Creates a color-mix expression for applying opacity to a CSS variable
 * Uses CSS color-mix() function which is supported in all modern browsers
 * 
 * @param cssVar - CSS variable name (with or without --)
 * @param opacity - Opacity value from 0 to 1
 * @returns CSS color-mix expression string
 * 
 * @example
 * alpha('--color-primary', 0.1)
 * // Returns: "color-mix(in srgb, var(--color-primary) 10%, transparent)"
 */
export const alpha = (cssVar: string, opacity: number): string => {
  const varName = cssVar.startsWith('--') ? cssVar : `--${cssVar}`;
  const percentage = Math.round(Math.max(0, Math.min(1, opacity)) * 100);
  return `color-mix(in srgb, var(${varName}) ${percentage}%, transparent)`;
};

/**
 * Semantic theme utilities for common color operations
 * These provide consistent opacity presets for backgrounds, borders, and text
 */
export const theme = {
  // Background colors with opacity
  bgPrimary: (opacity = 0.1) => alpha('--color-primary', opacity),
  bgSecondary: (opacity = 0.1) => alpha('--color-secondary', opacity),
  bgSuccess: (opacity = 0.1) => alpha('--color-success', opacity),
  bgWarning: (opacity = 0.1) => alpha('--color-warning', opacity),
  bgError: (opacity = 0.1) => alpha('--color-error', opacity),
  bgInfo: (opacity = 0.1) => alpha('--color-info', opacity),
  bgSurface: (opacity = 1) => alpha('--color-surface', opacity),
  bgSurfaceSecondary: (opacity = 1) => alpha('--color-surfaceSecondary', opacity),

  // Border colors with opacity
  borderPrimary: (opacity = 0.2) => alpha('--color-primary', opacity),
  borderSecondary: (opacity = 0.2) => alpha('--color-secondary', opacity),
  borderDefault: (opacity = 1) => alpha('--color-border', opacity),
  borderSuccess: (opacity = 0.2) => alpha('--color-success', opacity),
  borderWarning: (opacity = 0.2) => alpha('--color-warning', opacity),
  borderError: (opacity = 0.2) => alpha('--color-error', opacity),

  // Text colors with opacity
  textPrimary: (opacity = 1) => alpha('--color-text', opacity),
  textSecondary: (opacity = 1) => alpha('--color-textSecondary', opacity),
  textMuted: (opacity = 1) => alpha('--color-textMuted', opacity),

  // Gradient helpers
  gradient: {
    /** Primary brand gradient */
    primary: 'var(--color-gradientPrimary)',
    
    /** Secondary brand gradient */
    secondary: 'var(--color-gradientSecondary)',
    
    /**
     * Creates a subtle gradient between two CSS variables
     * @param from - Starting color CSS variable
     * @param to - Ending color CSS variable  
     * @param opacity - Base opacity (end opacity is half)
     */
    subtle: (from: string, to: string, opacity = 0.1) =>
      `linear-gradient(135deg, ${alpha(from, opacity)} 0%, ${alpha(to, opacity * 0.5)} 100%)`,

    /**
     * Creates a radial gradient from a CSS variable
     * @param cssVar - Center color CSS variable
     * @param opacity - Center opacity (edge fades to transparent)
     */
    radial: (cssVar: string, opacity = 0.15) =>
      `radial-gradient(circle at center, ${alpha(cssVar, opacity)} 0%, transparent 70%)`,

    /**
     * Creates a directional gradient for accents
     * @param direction - CSS gradient direction (e.g., 'to right', '135deg')
     * @param from - Starting color CSS variable
     * @param to - Ending color CSS variable
     * @param fromOpacity - Starting opacity
     * @param toOpacity - Ending opacity
     */
    directional: (
      direction: string,
      from: string,
      to: string,
      fromOpacity = 0.1,
      toOpacity = 0.05
    ) => `linear-gradient(${direction}, ${alpha(from, fromOpacity)} 0%, ${alpha(to, toOpacity)} 100%)`,
  },

  // Shadow helpers using theme colors
  shadow: {
    /**
     * Creates a subtle glow shadow using primary color
     * @param opacity - Shadow opacity
     * @param blur - Shadow blur radius in pixels
     */
    glow: (opacity = 0.15, blur = 20) =>
      `0 0 ${blur}px ${alpha('--color-primary', opacity)}`,

    /**
     * Creates an elevated shadow for floating elements
     * @param opacity - Shadow opacity
     */
    elevated: (opacity = 0.1) =>
      `0 4px 12px ${alpha('--color-primary', opacity)}, 0 2px 4px rgba(0, 0, 0, 0.05)`,
  },
} as const;

/**
 * Direct CSS variable references for use in inline styles
 * Prefer Tailwind classes when available, use these for dynamic values
 */
export const cssVar = {
  // Brand colors
  primary: 'var(--color-primary)',
  primaryLight: 'var(--color-primaryLight)',
  primaryDark: 'var(--color-primaryDark)',
  secondary: 'var(--color-secondary)',
  accent: 'var(--color-accent)',

  // Semantic colors
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  info: 'var(--color-info)',

  // Text colors
  text: 'var(--color-text)',
  textSecondary: 'var(--color-textSecondary)',
  textMuted: 'var(--color-textMuted)',
  textInverse: 'var(--color-textInverse)',

  // Surface colors
  surface: 'var(--color-surface)',
  surfaceSecondary: 'var(--color-surfaceSecondary)',
  surfaceTertiary: 'var(--color-surfaceTertiary)',
  background: 'var(--color-background)',
  border: 'var(--color-border)',
  borderLight: 'var(--color-borderLight)',

  // Gradients
  gradientPrimary: 'var(--color-gradientPrimary)',
  gradientSecondary: 'var(--color-gradientSecondary)',
} as const;

/**
 * Type definitions for theme-aware styling
 */
export type ThemeColor = keyof typeof cssVar;
export type ThemeOpacity = number;

/**
 * Helper to check if color-mix is supported (for SSR or older browsers)
 * All modern browsers (Chrome 111+, Firefox 113+, Safari 16.4+) support it
 */
export const supportsColorMix = (): boolean => {
  if (typeof window === 'undefined') return true; // Assume support in SSR
  return CSS.supports('color', 'color-mix(in srgb, red 50%, blue)');
};
