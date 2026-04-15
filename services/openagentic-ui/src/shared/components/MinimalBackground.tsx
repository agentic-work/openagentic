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
  const primaryColor = accentColor?.primary || '#1E40AF';

  return (
    <div
      className="minimal-background"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        // Solid background - no GPU compositing
        background: isLightTheme ? '#FAFAFA' : '#0D0D0F',
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
            ? 'linear-gradient(to top, rgba(0,0,0,0.02), transparent)'
            : 'linear-gradient(to top, rgba(0,0,0,0.3), transparent)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
