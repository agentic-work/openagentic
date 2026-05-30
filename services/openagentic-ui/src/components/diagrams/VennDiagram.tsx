/**
 * VennDiagram Component
 *
 * Renders 2-3 circle Venn diagrams with labels and intersection areas.
 * Uses SVG for crisp rendering at any size.
 */

import React, { useMemo, useEffect, useState } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface VennSet {
  id: string;
  label: string;
  items?: string[];
  color?: string;
}

export interface VennIntersection {
  sets: string[]; // IDs of sets that intersect
  label?: string;
  items?: string[];
}

export interface VennDefinition {
  title?: string;
  description?: string;
  sets: VennSet[];
  intersections?: VennIntersection[];
  theme?: 'light' | 'dark';
}

interface VennDiagramProps {
  venn: VennDefinition;
  className?: string;
  height?: number;
  width?: number;
}

// =============================================================================
// THEME DETECTION
// =============================================================================

const useThemeDetection = () => {
  const [isDark, setIsDark] = useState(true);
  // eslint-disable-next-line no-restricted-syntax -- Fallback color for initial state
  const [accentColor, setAccentColor] = useState('#0A84FF');

  useEffect(() => {
    const detectTheme = () => {
      const dataTheme = document.documentElement.getAttribute('data-theme');
      const hasLightClass = document.body.classList.contains('light-theme');
      setIsDark(dataTheme !== 'light' && !hasLightClass);

      const computedStyle = getComputedStyle(document.documentElement);
      const accent =
        computedStyle.getPropertyValue('--user-accent-primary').trim() ||
        computedStyle.getPropertyValue('--color-primary').trim() ||
        // eslint-disable-next-line no-restricted-syntax -- Fallback color
        '#0A84FF';
      setAccentColor(accent);
    };

    detectTheme();
    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return { isDark, accentColor };
};

// =============================================================================
// COLOR UTILITIES
// =============================================================================

// eslint-disable-next-line no-restricted-syntax -- Chart visualization colors are intentional design choices
const DEFAULT_COLORS = [
  '#0A84FF', // Apple Blue
  '#3B82F6', // Blue
  '#00D26A', // Green
  '#f59e0b', // Orange
  '#ef4444', // Red
  '#ec4899', // Pink
];

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const cleanHex = hex.replace('#', '');
  const fullHex = cleanHex.length === 3
    ? cleanHex.split('').map(c => c + c).join('')
    : cleanHex;
  return {
    r: parseInt(fullHex.substring(0, 2), 16) || 0,
    g: parseInt(fullHex.substring(2, 4), 16) || 0,
    b: parseInt(fullHex.substring(4, 6), 16) || 0,
  };
};

// =============================================================================
// VENN DIAGRAM COMPONENT
// =============================================================================

export const VennDiagram: React.FC<VennDiagramProps> = ({
  venn,
  className = '',
  height = 400,
  width,
}) => {
  const { isDark: detectedIsDark, accentColor } = useThemeDetection();
  const isDark = venn.theme === 'light' ? false : venn.theme === 'dark' ? true : detectedIsDark;

  const svgWidth = width || 600;
  const svgHeight = height - 60; // Account for title
  const centerX = svgWidth / 2;
  const centerY = svgHeight / 2;

  // Calculate circle positions based on number of sets
  const circles = useMemo(() => {
    const numSets = venn.sets.length;
    const radius = Math.min(svgWidth, svgHeight) * 0.28;
    const overlap = radius * 0.5; // How much circles overlap

    if (numSets === 1) {
      return [{
        ...venn.sets[0],
        cx: centerX,
        cy: centerY,
        r: radius * 1.2,
        color: venn.sets[0].color || DEFAULT_COLORS[0],
      }];
    }

    if (numSets === 2) {
      return venn.sets.map((set, i) => ({
        ...set,
        cx: centerX + (i === 0 ? -overlap : overlap),
        cy: centerY,
        r: radius,
        color: set.color || DEFAULT_COLORS[i],
      }));
    }

    // 3 sets - triangle arrangement
    const angleOffset = -Math.PI / 2; // Start from top
    return venn.sets.map((set, i) => {
      const angle = angleOffset + (i * 2 * Math.PI) / 3;
      return {
        ...set,
        cx: centerX + Math.cos(angle) * overlap * 0.8,
        cy: centerY + Math.sin(angle) * overlap * 0.8,
        r: radius * 0.85,
        color: set.color || DEFAULT_COLORS[i],
      };
    });
  }, [venn.sets, svgWidth, svgHeight, centerX, centerY]);

  // Find intersection info
  const getIntersectionLabel = (setIds: string[]): string | undefined => {
    const intersection = venn.intersections?.find(
      (int) => int.sets.length === setIds.length && setIds.every((id) => int.sets.includes(id))
    );
    return intersection?.label;
  };

  const rgb = hexToRgb(accentColor);
  const accentRgba = (opacity: number) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;

  return (
    <div
      className={`venn-diagram ${className}`}
      style={{
        height,
        width: '100%',
        borderRadius: '16px',
        border: `1px solid ${accentRgba(0.2)}`,
        background: isDark
          ? `linear-gradient(180deg, ${accentRgba(0.05)} 0%, transparent 100%), rgba(30, 30, 46, 0.8)`
          : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(20px)',
        boxShadow: isDark
          ? `0 0 40px ${accentRgba(0.15)}, 0 20px 60px rgba(0, 0, 0, 0.3)`
          : '0 4px 20px rgba(0, 0, 0, 0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      {venn.title && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${accentRgba(0.15)}`,
            background: accentRgba(0.05),
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: accentColor,
              boxShadow: `0 0 12px ${accentRgba(0.6)}`,
            }}
          />
          <span style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#f8fafc' : '#1e293b' }}>
            {venn.title}
          </span>
          {venn.description && (
            <span style={{ fontSize: '12px', opacity: 0.6, color: isDark ? '#94a3b8' : '#64748b' }}>
              — {venn.description}
            </span>
          )}
        </div>
      )}

      {/* SVG Diagram */}
      <svg
        width="100%"
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ display: 'block' }}
      >
        {/* Definitions for gradients and filters */}
        <defs>
          {circles.map((circle, i) => {
            const rgb = hexToRgb(circle.color);
            return (
              <React.Fragment key={`defs-${circle.id}`}>
                <radialGradient id={`gradient-${circle.id}`} cx="30%" cy="30%">
                  <stop offset="0%" stopColor={`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`} />
                  <stop offset="100%" stopColor={`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`} />
                </radialGradient>
                <filter id={`glow-${circle.id}`} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="8" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </React.Fragment>
            );
          })}
        </defs>

        {/* Draw circles */}
        {circles.map((circle) => {
          const rgb = hexToRgb(circle.color);
          return (
            <g key={circle.id}>
              {/* Glow effect */}
              <circle
                cx={circle.cx}
                cy={circle.cy}
                r={circle.r}
                fill="none"
                stroke={circle.color}
                strokeWidth="2"
                opacity="0.3"
                filter={`url(#glow-${circle.id})`}
              />
              {/* Main circle */}
              <circle
                cx={circle.cx}
                cy={circle.cy}
                r={circle.r}
                fill={`url(#gradient-${circle.id})`}
                stroke={circle.color}
                strokeWidth="2"
                style={{ mixBlendMode: 'normal' }}
              />
            </g>
          );
        })}

        {/* Labels for each set */}
        {circles.map((circle, i) => {
          // Position label outside the circle
          const numSets = circles.length;
          let labelX = circle.cx;
          let labelY = circle.cy;

          if (numSets === 2) {
            labelX = i === 0 ? circle.cx - circle.r * 0.5 : circle.cx + circle.r * 0.5;
          } else if (numSets === 3) {
            const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
            labelX = circle.cx + Math.cos(angle) * circle.r * 0.5;
            labelY = circle.cy + Math.sin(angle) * circle.r * 0.5;
          }

          return (
            <g key={`label-${circle.id}`}>
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isDark ? '#f8fafc' : '#1e293b'}
                fontSize="14"
                fontWeight="600"
                fontFamily="Inter, -apple-system, sans-serif"
              >
                {circle.label}
              </text>
              {/* Items list */}
              {circle.items && circle.items.length > 0 && (
                <text
                  x={labelX}
                  y={labelY + 20}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={isDark ? '#94a3b8' : '#64748b'}
                  fontSize="11"
                  fontFamily="Inter, -apple-system, sans-serif"
                >
                  {circle.items.slice(0, 3).join(', ')}
                  {circle.items.length > 3 && '...'}
                </text>
              )}
            </g>
          );
        })}

        {/* Center intersection label (for 2-3 sets) */}
        {circles.length >= 2 && (
          <text
            x={centerX}
            y={centerY}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={isDark ? '#f8fafc' : '#1e293b'}
            fontSize="12"
            fontWeight="500"
            fontFamily="Inter, -apple-system, sans-serif"
          >
            {getIntersectionLabel(venn.sets.map((s) => s.id)) || ''}
          </text>
        )}
      </svg>
    </div>
  );
};

// =============================================================================
// JSON PARSER
// =============================================================================

export const parseVennJson = (json: string): VennDefinition | null => {
  const trimmed = json.trim();
  if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) return null;

  try {
    const parsed = JSON.parse(json);
    if (!parsed.sets || !Array.isArray(parsed.sets)) return null;

    return {
      title: parsed.title,
      description: parsed.description,
      sets: parsed.sets.map((s: any, i: number) => ({
        id: s.id || `set-${i}`,
        label: s.label || `Set ${i + 1}`,
        items: s.items,
        color: s.color,
      })),
      intersections: parsed.intersections,
      theme: parsed.theme,
    };
  } catch {
    return null;
  }
};

export default VennDiagram;
