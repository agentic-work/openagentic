/**
 * ActivityOrb - Floating pulsing sphere that indicates AI activity
 * Visible during all model work: thinking, streaming, tool execution
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type OrbState = 'idle' | 'thinking' | 'streaming' | 'tools' | 'error';

export interface ActivityOrbProps {
  state: OrbState;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  position?: 'fixed' | 'relative';
  onClick?: () => void;
}

// Color schemes for different states
const orbColors: Record<OrbState, { primary: string; secondary: string; glow: string }> = {
  idle: {
    primary: 'bg-slate-600',
    secondary: 'bg-slate-500',
    glow: 'shadow-slate-500/20'
  },
  thinking: {
    primary: 'bg-blue-500',
    secondary: 'bg-blue-400',
    glow: 'shadow-blue-500/50'
  },
  streaming: {
    primary: 'bg-emerald-500',
    secondary: 'bg-emerald-400',
    glow: 'shadow-emerald-500/50'
  },
  tools: {
    primary: 'bg-blue-500',
    secondary: 'bg-blue-400',
    glow: 'shadow-blue-500/50'
  },
  error: {
    primary: 'bg-red-500',
    secondary: 'bg-red-400',
    glow: 'shadow-red-500/50'
  }
};

// Labels for different states
const orbLabels: Record<OrbState, string> = {
  idle: '',
  thinking: 'Thinking...',
  streaming: 'Generating...',
  tools: 'Running tools...',
  error: 'Error'
};

// Size configurations
const sizeConfig = {
  sm: { orb: 'w-3 h-3', container: 'w-6 h-6' },
  md: { orb: 'w-4 h-4', container: 'w-8 h-8' },
  lg: { orb: 'w-6 h-6', container: 'w-12 h-12' }
};

export const ActivityOrb: React.FC<ActivityOrbProps> = ({
  state,
  className = '',
  size = 'md',
  showLabel = false,
  position = 'relative',
  onClick
}) => {
  const isActive = state !== 'idle';
  const colors = orbColors[state];
  const label = orbLabels[state];
  const { orb, container } = sizeConfig[size];

  // Animation variants
  const pulseVariants = useMemo(() => ({
    idle: {
      scale: 1,
      opacity: 0.5
    },
    active: {
      scale: [1, 1.2, 1],
      opacity: [0.7, 1, 0.7],
      transition: {
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeInOut'
      }
    }
  }), []);

  const glowVariants = useMemo(() => ({
    idle: {
      scale: 1,
      opacity: 0
    },
    active: {
      scale: [1, 1.8, 1],
      opacity: [0, 0.4, 0],
      transition: {
        duration: 2,
        repeat: Infinity,
        ease: 'easeOut'
      }
    }
  }), []);

  const containerClasses = position === 'fixed'
    ? 'fixed bottom-6 right-6 z-50'
    : 'relative';

  return (
    <AnimatePresence>
      {(isActive || state === 'idle') && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
          className={`${containerClasses} flex items-center gap-2 ${className}`}
          onClick={onClick}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : undefined}
        >
          {/* Orb container with glow effect */}
          <div className={`${container} relative flex items-center justify-center`}>
            {/* Glow layer (behind) */}
            {isActive && (
              <motion.div
                className={`absolute inset-0 ${colors.secondary} rounded-full blur-md ${colors.glow}`}
                variants={glowVariants}
                animate="active"
              />
            )}

            {/* Secondary pulse ring */}
            {isActive && (
              <motion.div
                className={`absolute ${orb} ${colors.secondary} rounded-full opacity-50`}
                animate={{
                  scale: [1, 2, 1],
                  opacity: [0.5, 0, 0.5]
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeOut',
                  delay: 0.5
                }}
              />
            )}

            {/* Main orb */}
            <motion.div
              className={`${orb} ${colors.primary} rounded-full shadow-lg ${colors.glow} ${
                onClick ? 'cursor-pointer hover:brightness-110' : ''
              }`}
              variants={pulseVariants}
              animate={isActive ? 'active' : 'idle'}
            />
          </div>

          {/* Label */}
          {showLabel && label && (
            <motion.span
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -5 }}
              className={`text-xs font-medium ${
                state === 'error' ? 'text-red-400' : 'text-slate-400'
              }`}
            >
              {label}
            </motion.span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Inline variant for use within messages or toolbars
export const InlineActivityOrb: React.FC<{
  isActive: boolean;
  type?: 'thinking' | 'streaming' | 'tools';
  className?: string;
}> = ({ isActive, type = 'streaming', className = '' }) => {
  if (!isActive) return null;

  const state: OrbState = type;
  const colors = orbColors[state];

  return (
    <span className={`inline-flex items-center ${className}`}>
      <motion.span
        className={`inline-block w-2 h-2 ${colors.primary} rounded-full`}
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.7, 1, 0.7]
        }}
        transition={{
          duration: 1,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
      />
    </span>
  );
};

// Hook to derive orb state from component state
export const useOrbState = (options: {
  isThinking?: boolean;
  isStreaming?: boolean;
  isToolExecuting?: boolean;
  hasError?: boolean;
}): OrbState => {
  const { isThinking, isStreaming, isToolExecuting, hasError } = options;

  if (hasError) return 'error';
  if (isToolExecuting) return 'tools';
  if (isThinking) return 'thinking';
  if (isStreaming) return 'streaming';
  return 'idle';
};

export default ActivityOrb;
