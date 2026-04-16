/**
 * CompanyLogo Component
 *
 * Professional SVG logo for OpenAgentic with:
 * - 3D raised/embossed effect
 * - Theme-aware colors (adapts to light/dark mode)
 * - Uses CSS custom properties for accent colors
 * - Scalable vector graphics
 */
/* eslint-disable no-restricted-syntax -- Logo colors use CSS variables with fallbacks for older browsers */

import React from 'react';

interface CompanyLogoProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  variant?: 'full' | 'compact' | 'icon';
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({
  className = '',
  width = 280,
  height = 48,
  variant = 'full'
}) => {
  // For compact variant, adjust dimensions
  const actualWidth = variant === 'icon' ? 48 : variant === 'compact' ? 200 : width;
  const actualHeight = height;

  if (variant === 'icon') {
    // Just the "A" icon version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        width={actualWidth}
        height={actualHeight}
        className={className}
        aria-label="OpenAgentic"
      >
        <defs>
          <linearGradient id="iconGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--user-accent-primary, #0A84FF)"/>
            <stop offset="100%" stopColor="var(--user-accent-secondary, #5AC8FA)"/>
          </linearGradient>
          <filter id="iconShadow">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(0,0,0,0.3)"/>
          </filter>
        </defs>
        <rect x="4" y="4" width="40" height="40" rx="10"
              fill="var(--color-surface, rgba(30,30,40,0.7))"
              filter="url(#iconShadow)"/>
        <text x="24" y="34"
              fontFamily="'Google Sans', 'SF Pro Display', sans-serif"
              fontSize="28" fontWeight="700"
              fill="url(#iconGradient)"
              textAnchor="middle">
          A
        </text>
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 280 48"
      width={actualWidth}
      height={actualHeight}
      className={className}
      aria-label="OpenAgentic"
    >
      <defs>
        {/* Gradient for "[openagentic]" - uses primary accent color */}
        <linearGradient id="agenticGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--user-accent-primary, #0A84FF)"/>
          <stop offset="100%" stopColor="var(--user-accent-secondary, #5AC8FA)"/>
        </linearGradient>

        {/* 3D Shadow effect for depth */}
        <filter id="shadow3d" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1" floodColor="rgba(0,0,0,0.3)"/>
          <feDropShadow dx="0" dy="4" stdDeviation="2" floodColor="rgba(0,0,0,0.15)"/>
        </filter>

        {/* Highlight gradient for 3D raised look */}
        <linearGradient id="highlightGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.3)"/>
          <stop offset="40%" stopColor="rgba(255,255,255,0.05)"/>
          <stop offset="100%" stopColor="rgba(0,0,0,0.1)"/>
        </linearGradient>

        {/* Glow effect for hover states */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Subtle background glow */}
      <ellipse
        cx="140" cy="24" rx="130" ry="20"
        fill="url(#agenticGradient)"
        opacity="0.06"
      />

      <g filter="url(#shadow3d)">
        {/* "[openagentic]" text with gradient */}
        <text
          x="8" y="35"
          fontFamily="'Google Sans', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          fontSize="28"
          fontWeight="700"
          fill="url(#agenticGradient)"
          letterSpacing="-0.5"
        >
          [openagentic]
        </text>

        {/* Highlight overlay for 3D raised effect */}
        <text
          x="8" y="35"
          fontFamily="'Google Sans', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          fontSize="28"
          fontWeight="700"
          fill="url(#highlightGradient)"
          letterSpacing="-0.5"
          opacity="0.6"
        >
          [openagentic]
        </text>
      </g>

      {/* Subtle top reflection line for extra 3D pop */}
      <line
        x1="12" y1="12" x2="220" y2="12"
        stroke="url(#agenticGradient)"
        strokeWidth="0.5"
        opacity="0.2"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default CompanyLogo;
