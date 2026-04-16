/**
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React from 'react';
import { motion } from 'framer-motion';

interface SkeletonLoaderProps {
  type?: 'text' | 'code' | 'table' | 'image' | 'chart';
  lines?: number;
  height?: string;
}

// =============================================================================
// SKELETON CONFIGURATION
// Named constants for skeleton patterns - makes the purpose clear
// =============================================================================

/** Text line widths - varied to simulate natural paragraph flow */
const TEXT_LINE_WIDTHS = ['100%', '95%', '88%', '92%', '100%', '85%'] as const;

/** Code line widths - varied to simulate typical code indentation patterns */
const CODE_LINE_WIDTHS = ['85%', '100%', '70%', '95%', '60%', '90%', '100%', '75%'] as const;

/** Table column width distribution (percentages that sum to ~90% with gaps) */
const TABLE_COLUMN_WIDTHS = [40, 30, 20] as const;

/** Chart bar heights - normalized 0-1 values for visual variety */
const CHART_BAR_HEIGHTS = [0.3, 0.7, 0.5, 0.9, 0.4, 0.8, 0.6] as const;

/**
 * Skeleton Loader Component
 *
 * Professional content-aware skeleton loaders that match final layout
 * Reduces perceived latency and eliminates layout shift
 */
const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  type = 'text',
  lines = 3,
  height = '200px'
}) => {
  // Using CSS variables for theme-aware skeleton colors
  const baseColor = 'color-mix(in srgb, var(--color-text) 5%, transparent)';
  const highlightColor = 'color-mix(in srgb, var(--color-text) 10%, transparent)';
  const borderColor = 'color-mix(in srgb, var(--color-text) 10%, transparent)';

  const shimmerAnimation = {
    animate: {
      backgroundPosition: ['200% 0', '-200% 0'],
    },
    transition: {
      duration: 2,
      ease: 'linear',
      repeat: Infinity,
    }
  };

  const shimmerStyle = {
    background: `linear-gradient(90deg, ${baseColor} 0%, ${highlightColor} 50%, ${baseColor} 100%)`,
    backgroundSize: '200% 100%',
  };

  // Text skeleton with realistic line lengths
  if (type === 'text') {
    return (
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <motion.div
            key={i}
            {...shimmerAnimation}
            className="h-4 rounded"
            style={{
              width: TEXT_LINE_WIDTHS[i % TEXT_LINE_WIDTHS.length],
              ...shimmerStyle,
            }}
          />
        ))}
      </div>
    );
  }

  // Code block skeleton with syntax-like shimmer
  if (type === 'code') {
    return (
      <div
        className="rounded-lg border p-4 space-y-2.5"
        style={{
          backgroundColor: baseColor,
          borderColor: borderColor,
        }}
      >
        {/* Code header */}
        <div className="flex items-center justify-between mb-4">
          <motion.div
            {...shimmerAnimation}
            className="h-5 w-24 rounded"
            style={shimmerStyle}
          />
          <motion.div
            {...shimmerAnimation}
            className="h-8 w-20 rounded"
            style={shimmerStyle}
          />
        </div>

        {/* Code lines */}
        {Array.from({ length: Math.min(lines, 8) }).map((_, i) => (
          <div key={i} className="flex items-center space-x-3">
            {/* Line number */}
            <motion.div
              {...shimmerAnimation}
              className="h-3 w-6 rounded"
              style={shimmerStyle}
            />
            {/* Code content */}
            <motion.div
              {...shimmerAnimation}
              className="h-3 rounded"
              style={{
                width: CODE_LINE_WIDTHS[i % CODE_LINE_WIDTHS.length],
                ...shimmerStyle,
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  // Table skeleton with ChatGPT-style rows
  if (type === 'table') {
    return (
      <div
        className="rounded-lg border overflow-hidden"
        style={{
          borderColor: borderColor,
        }}
      >
        {/* Table header */}
        <div
          className="flex items-center gap-4 p-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
          }}
        >
          {TABLE_COLUMN_WIDTHS.map((width, i) => (
            <motion.div
              key={i}
              {...shimmerAnimation}
              className="h-4 rounded"
              style={{ width: `${width}%`, ...shimmerStyle }}
            />
          ))}
        </div>

        {/* Table rows */}
        {Array.from({ length: Math.min(lines, 5) }).map((_, rowIndex) => (
          <motion.div
            key={rowIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: rowIndex * 0.1 }}
            className="flex items-center gap-4 p-3 border-t"
            style={{
              borderColor: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
            }}
          >
            {TABLE_COLUMN_WIDTHS.map((width, i) => (
              <motion.div
                key={i}
                {...shimmerAnimation}
                className="h-3 rounded"
                style={{ width: `${width}%`, ...shimmerStyle }}
              />
            ))}
          </motion.div>
        ))}
      </div>
    );
  }

  // Image skeleton with blur-up effect
  if (type === 'image') {
    return (
      <div
        className="rounded-lg overflow-hidden"
        style={{ height }}
      >
        <motion.div
          {...shimmerAnimation}
          className="w-full h-full"
          style={shimmerStyle}
        />
      </div>
    );
  }

  // Chart skeleton
  if (type === 'chart') {
    return (
      <div
        className="rounded-lg border p-6"
        style={{
          height,
          backgroundColor: baseColor,
          borderColor: borderColor,
        }}
      >
        {/* Chart title */}
        <motion.div
          {...shimmerAnimation}
          className="h-6 w-48 rounded mb-6"
          style={shimmerStyle}
        />

        {/* Chart bars/lines */}
        <div className="flex items-end justify-between h-full space-x-2">
          {CHART_BAR_HEIGHTS.map((barHeight, i) => (
            <motion.div
              key={i}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: i * 0.1, duration: 0.3 }}
              className="flex-1 rounded-t"
              style={{
                height: `${barHeight * 100}%`,
                ...shimmerStyle,
                transformOrigin: 'bottom',
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
};

export default SkeletonLoader;
