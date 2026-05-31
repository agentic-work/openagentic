/**
 * Synth Indicator Component
 *
 * A small toolbar button for ChatInputToolbar that surfaces OAT (On-demand
 * Agentic Tooling) / tool synthesis status. Shows a pulsing glow when
 * approvals are pending, and a dropdown on click with synth status, pending
 * count, and a link to pending approvals.
 *
 * Designed to sit alongside the MCP / Plus buttons in the toolbar.
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SynthIndicatorProps {
  /** Number of pending tool synthesis approvals */
  pendingCount: number;
  /** Whether OAT / synth mode is currently enabled */
  enabled: boolean;
  /** Toggle synth mode on/off */
  onToggle?: () => void;
  /** Click handler (e.g. open pending approvals list) */
  onClick?: () => void;
}

// ---------------------------------------------------------------------------
// Inline SVG Icons
// ---------------------------------------------------------------------------

/** Beaker / flask icon for tool synthesis */
const BeakerIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* Flask shape */}
    <path d="M9 3h6" />
    <path d="M10 3v6.5L4.5 18.5a1.5 1.5 0 001.3 2.2h12.4a1.5 1.5 0 001.3-2.2L14 9.5V3" />
    {/* Liquid line inside flask */}
    <path d="M7.5 15h9" />
  </svg>
);

/** Small sparkle accent for the dropdown header */
const SparkleAccent: React.FC<{ size?: number; color?: string }> = ({
  size = 12,
  color = 'currentColor',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    stroke="none"
    aria-hidden="true"
  >
    <path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SynthIndicator: React.FC<SynthIndicatorProps> = ({
  pendingCount,
  enabled,
  onToggle,
  onClick,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const hasPending = pendingCount > 0;

  return (
    <div ref={containerRef} className="relative synth-indicator-container">
      {/* Main button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => {
          if (onClick) {
            onClick();
          } else {
            setDropdownOpen(!dropdownOpen);
          }
        }}
        aria-label={`Tool Synthesis${hasPending ? ` (${pendingCount} pending)` : ''}`}
        aria-expanded={dropdownOpen}
        aria-haspopup="menu"
        className={clsx(
          'relative p-2 rounded-lg transition-colors',
          enabled ? 'hover:bg-accent-primary/20' : 'hover:bg-white/5',
          dropdownOpen && (enabled ? 'bg-accent-primary/20' : 'bg-white/5'),
        )}
        style={{
          color: enabled ? 'var(--cm-accent)' : 'var(--color-textMuted)',
        }}
      >
        <BeakerIcon size={18} />

        {/* Pending count badge */}
        {hasPending && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold leading-none"
            style={{
              backgroundColor: 'var(--cm-accent)',
              color: 'var(--cm-bg)',
              boxShadow: '0 0 8px color-mix(in srgb, var(--cm-accent) 50%, transparent)',
            }}
          >
            {pendingCount > 9 ? '9+' : pendingCount}
          </motion.span>
        )}

        {/* Pulsing glow ring when pending approvals exist */}
        {hasPending && (
          <span
            className="absolute inset-0 rounded-lg pointer-events-none"
            style={{
              animation: 'synth-pulse 2s ease-in-out infinite',
              border: '1px solid color-mix(in srgb, var(--cm-accent) 30%, transparent)',
            }}
          />
        )}
      </motion.button>

      {/* Dropdown */}
      <AnimatePresence>
        {dropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380 }}
            className="absolute bottom-full mb-2 left-0 z-50 min-w-[240px] rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--color-surface)',
              backdropFilter: 'blur(16px) saturate(180%)',
              WebkitBackdropFilter: 'blur(16px) saturate(180%)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 12px 40px color-mix(in srgb, var(--cm-text) 40%, transparent), 0 0 0 1px color-mix(in srgb, var(--cm-text) 5%, transparent)',
            }}
          >
            {/* Dropdown header */}
            <div
              className="px-4 py-3"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-2">
                <SparkleAccent size={14} color="var(--cm-accent)" />
                <span
                  className="text-sm font-semibold"
                  style={{ color: 'var(--color-text)' }}
                >
                  Tool Synthesis (OAT)
                </span>
              </div>
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--color-textMuted)' }}
              >
                On-demand agentic tool creation
              </p>
            </div>

            {/* Status row */}
            <div className="px-4 py-3 space-y-3">
              {/* Enabled/disabled toggle */}
              {onToggle && (
                <div className="flex items-center justify-between">
                  <div>
                    <div
                      className="text-xs font-medium"
                      style={{ color: 'var(--color-text)' }}
                    >
                      Synth Mode
                    </div>
                    <div
                      className="text-xs mt-0.5"
                      style={{ color: 'var(--color-textMuted)' }}
                    >
                      {enabled
                        ? 'LLM can propose new tools'
                        : 'Tool synthesis disabled'}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle();
                    }}
                    role="switch"
                    aria-checked={enabled}
                    aria-label="Toggle tool synthesis"
                    className="relative w-11 h-6 rounded-full transition-colors"
                    style={{
                      backgroundColor: enabled
                        ? 'color-mix(in srgb, var(--cm-accent) 30%, transparent)'
                        : 'color-mix(in srgb, var(--cm-text-muted) 30%, transparent)',
                      border: `1px solid ${enabled ? 'color-mix(in srgb, var(--cm-accent) 50%, transparent)' : 'color-mix(in srgb, var(--cm-text-muted) 50%, transparent)'}`,
                    }}
                  >
                    <motion.div
                      animate={{ x: enabled ? 20 : 2 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-1 w-4 h-4 rounded-full shadow"
                      style={{
                        backgroundColor: enabled
                          ? 'var(--cm-accent)'
                          : 'var(--cm-text-muted)',
                      }}
                    />
                  </button>
                </div>
              )}

              {/* Pending approvals */}
              <div
                className="flex items-center justify-between p-2.5 rounded-lg"
                style={{
                  backgroundColor: hasPending
                    ? 'color-mix(in srgb, var(--cm-accent) 8%, transparent)'
                    : 'var(--color-surfaceSecondary)',
                  border: hasPending
                    ? '1px solid color-mix(in srgb, var(--cm-accent) 20%, transparent)'
                    : '1px solid var(--color-border)',
                }}
              >
                <div className="flex items-center gap-2">
                  {hasPending ? (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: 'var(--cm-accent)',
                        boxShadow: '0 0 6px color-mix(in srgb, var(--cm-accent) 60%, transparent)',
                      }}
                    />
                  ) : (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: 'var(--color-textMuted)' }}
                    />
                  )}
                  <span
                    className="text-xs font-medium"
                    style={{
                      color: hasPending ? 'var(--cm-accent)' : 'var(--color-textSecondary)',
                    }}
                  >
                    {hasPending
                      ? `${pendingCount} pending approval${pendingCount !== 1 ? 's' : ''}`
                      : 'No pending approvals'}
                  </span>
                </div>
                {hasPending && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--cm-accent) 20%, transparent)',
                      color: 'var(--cm-accent)',
                    }}
                  >
                    Action Required
                  </span>
                )}
              </div>

              {/* Info row when disabled */}
              {!enabled && (
                <p
                  className="text-[11px] leading-relaxed"
                  style={{ color: 'var(--color-textMuted)' }}
                >
                  Enable synth mode to allow the LLM to create and execute custom
                  tools on-the-fly. You will be prompted to approve each tool
                  before execution.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyframe animation for pulsing glow */}
      <style>{`
        @keyframes synth-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--cm-accent) 0%, transparent);
            opacity: 1;
          }
          50% {
            box-shadow: 0 0 12px 2px color-mix(in srgb, var(--cm-accent) 25%, transparent);
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  );
};

export default SynthIndicator;
