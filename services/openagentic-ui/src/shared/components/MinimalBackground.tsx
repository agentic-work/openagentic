/**
 * MinimalBackground - Zero GPU, Maximum Performance
 *
 * A completely static, GPU-free background inspired by Linear, Notion, and Slack.
 * Uses only solid colors with optional static gradients.
 *
 * Performance: 0% GPU, ~0% CPU overhead
 *
 * No:
 * - WebGL/Canvas
 * - backdrop-filter (GPU-accelerated blur)
 * - CSS animations
 * - transform/opacity animations
 * - Multiple compositing layers
 */

import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';

export default function MinimalBackground() {
  const { resolvedTheme, accentColor } = useTheme();
  const isLightTheme = resolvedTheme === 'light';

  // Get accent colors with fallbacks
  // theme-allow: fallback matches the default accent token (signal orange) and
  // MUST be a raw hex because it is concatenated with hex-alpha suffixes
  // (`${primaryColor}08`) for the subtle corner glows below.
  const primaryColor = accentColor?.primary || '#FF5722';

  return (
    <div
      className="minimal-background"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        // Solid background — flips with the theme via the SOT token.
        background: 'var(--color-bg)',
      }}
    >
      {/* Optional: Very subtle static corner accents (no animation, no blur) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          // Static gradients - rendered once, no GPU
          background: isLightTheme
            ? `
              radial-gradient(ellipse 50% 50% at 0% 0%, ${primaryColor}08, transparent 50%),
              radial-gradient(ellipse 50% 50% at 100% 100%, ${primaryColor}06, transparent 50%)
            `
            : `
              radial-gradient(ellipse 50% 50% at 0% 0%, ${primaryColor}10, transparent 50%),
              radial-gradient(ellipse 50% 50% at 100% 100%, ${primaryColor}08, transparent 50%)
            `,
          pointerEvents: 'none',
        }}
      />

      {/* Subtle bottom edge gradient for depth (static, no blur) */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '30%',
          background: isLightTheme
            ? 'linear-gradient(to top, color-mix(in srgb, var(--color-shadow) 2%, transparent), transparent)'
            : 'linear-gradient(to top, color-mix(in srgb, var(--color-shadow) 30%, transparent), transparent)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
