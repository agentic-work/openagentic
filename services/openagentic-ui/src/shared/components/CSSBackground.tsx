/**
 * CSSBackground - Liquid Glass Effect
 *
 * A lightweight CSS-only alternative to WebGLBackground.
 * Uses layered gradients with animations for a premium glass effect.
 * ~1-2% CPU vs ~15-30% for WebGL
 */

import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';

export default function CSSBackground() {
  const { resolvedTheme } = useTheme();
  const isLightTheme = resolvedTheme === 'light';

  return (
    <div className="css-background">
      {/* Base layer - softer background color */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isLightTheme
            ? '#f5f5f7'  // Soft off-white instead of pure white
            : '#0a0a0f', // Soft dark instead of pure black
        }}
      />

      {/* Deep layer - very subtle accent blobs for depth */}
      <div
        className="layer-deep"
        style={{
          position: 'absolute',
          inset: '-30%',
          background: `
            radial-gradient(ellipse 80% 80% at 10% 90%, var(--lava-color-1), transparent 70%),
            radial-gradient(ellipse 70% 70% at 90% 10%, var(--lava-color-2), transparent 70%),
            radial-gradient(ellipse 60% 60% at 50% 50%, var(--user-accent-color), transparent 60%)
          `,
          filter: 'blur(120px) saturate(50%)',
          opacity: isLightTheme ? 0.08 : 0.12,
          animation: 'liquid-deep 60s ease-in-out infinite alternate',
        }}
      />

      {/* Mid layer - corners only, very subtle */}
      <div
        className="layer-mid"
        style={{
          position: 'absolute',
          inset: '-20%',
          background: `
            radial-gradient(circle at 5% 5%, var(--user-accent-color), transparent 40%),
            radial-gradient(circle at 95% 95%, var(--lava-color-1), transparent 40%),
            radial-gradient(circle at 95% 5%, var(--lava-color-2), transparent 35%),
            radial-gradient(circle at 5% 95%, var(--lava-color-1), transparent 35%)
          `,
          filter: 'blur(100px) saturate(40%)',
          opacity: isLightTheme ? 0.06 : 0.1,
          animation: 'liquid-mid 45s ease-in-out infinite alternate-reverse',
        }}
      />

      {/* Edge glow layer - barely visible hints at edges */}
      <div
        className="layer-pulse"
        style={{
          position: 'absolute',
          inset: '0',
          background: `
            radial-gradient(ellipse 60% 40% at 50% 100%, var(--lava-color-2), transparent 70%),
            radial-gradient(ellipse 40% 60% at 0% 50%, var(--lava-color-1), transparent 60%),
            radial-gradient(ellipse 40% 60% at 100% 50%, var(--lava-color-2), transparent 60%),
            radial-gradient(ellipse 60% 40% at 50% 0%, var(--user-accent-color), transparent 70%)
          `,
          filter: 'blur(100px) saturate(40%)',
          opacity: isLightTheme ? 0.05 : 0.08,
          animation: 'liquid-pulse 30s ease-in-out infinite',
        }}
      />

      {/* Glass overlay - frosted effect, more opaque for clarity */}
      <div
        className="glass-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          background: isLightTheme
            ? 'rgba(248, 248, 250, 0.92)'  // More opaque for clean look
            : 'rgba(10, 10, 15, 0.88)',     // Darker, cleaner overlay
          backdropFilter: 'blur(80px) saturate(100%)',
          WebkitBackdropFilter: 'blur(80px) saturate(100%)',
        }}
      >
        {/* Noise texture for glass depth - very subtle */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: isLightTheme ? 0.04 : 0.06,
            mixBlendMode: 'overlay',
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '128px 128px',
            filter: 'contrast(110%) brightness(110%)',
          }}
        />

        {/* Surface highlights - barely visible light reflections */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              radial-gradient(circle at 10% 10%, rgba(255, 255, 255, ${isLightTheme ? '0.15' : '0.02'}) 0%, transparent 30%),
              radial-gradient(circle at 90% 90%, rgba(255, 255, 255, ${isLightTheme ? '0.1' : '0.015'}) 0%, transparent 30%),
              linear-gradient(135deg,
                rgba(255,255,255,${isLightTheme ? '0.05' : '0.01'}) 0%,
                transparent 40%,
                transparent 60%,
                rgba(255,255,255,${isLightTheme ? '0.025' : '0.005'}) 100%)
            `,
            animation: 'liquid-surface 30s ease-in-out infinite alternate',
            pointerEvents: 'none',
          }}
        />

        {/* Accent glow at edges - extremely subtle hint */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              linear-gradient(to right,
                color-mix(in srgb, var(--lava-color-1) ${isLightTheme ? '1%' : '2%'}, transparent) 0%,
                transparent 10%,
                transparent 90%,
                color-mix(in srgb, var(--lava-color-2) ${isLightTheme ? '1%' : '2%'}, transparent) 100%),
              linear-gradient(to bottom,
                transparent 0%,
                transparent 95%,
                color-mix(in srgb, var(--user-accent-color) ${isLightTheme ? '1%' : '2%'}, transparent) 100%)
            `,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Vignette for depth - very subtle */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isLightTheme
            ? 'radial-gradient(ellipse at center, transparent 0%, transparent 70%, rgba(0,0,0,0.02) 100%)'
            : 'radial-gradient(ellipse at center, transparent 0%, transparent 60%, rgba(0,0,0,0.15) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* CSS Keyframes */}
      <style>{`
        .css-background {
          position: fixed;
          inset: 0;
          z-index: -1;
          overflow: hidden;
          background: var(--bg-primary);
        }

        @keyframes liquid-deep {
          0% {
            transform: translate(0, 0) scale(1) rotate(0deg);
          }
          50% {
            transform: translate(3%, -3%) scale(1.05) rotate(2deg);
          }
          100% {
            transform: translate(-2%, 4%) scale(1.1) rotate(-1deg);
          }
        }

        @keyframes liquid-mid {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: inherit;
          }
          33% {
            transform: translate(-2%, 2%) rotate(3deg);
          }
          66% {
            transform: translate(2%, -1%) rotate(-2deg);
          }
          100% {
            transform: translate(-1%, 3%) rotate(4deg);
          }
        }

        @keyframes liquid-pulse {
          0%, 100% {
            opacity: inherit;
            transform: scale(1);
          }
          50% {
            opacity: calc(inherit * 1.3);
            transform: scale(1.05);
          }
        }

        @keyframes liquid-surface {
          0% {
            opacity: 0.8;
          }
          100% {
            opacity: 1;
          }
        }

        /* Reduce motion for accessibility */
        @media (prefers-reduced-motion: reduce) {
          .css-background * {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
