/**
 * StreamingActivityIndicator - Inline Thinking Indicator
 *
 * Uses ThinkingSphere for consistent thinking animation.
 * Displays fun CLI-style messages during thinking/processing.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ActivityState } from '@/stores/useCodeModeStore';
import { ThinkingSphere } from '@/shared/components/ThinkingSphere';

// =============================================================================
// Types
// =============================================================================

interface StreamingActivityIndicatorProps {
  state: ActivityState;
  streamingText?: string;
  customMessage?: string;
  showCursor?: boolean;
  /** Use CLI style (∴ ∵ ⁘ ⁙ spinner + fun messages) instead of emoji */
  cliMode?: boolean;
}

// =============================================================================
// Professional Activity Messages
// =============================================================================

const THINKING_MESSAGES = [
  'Analyzing request',
  'Processing',
  'Evaluating options',
  'Reviewing context',
  'Formulating response',
  'Considering approach',
  'Assessing requirements',
];

// CLI-style messages - simple, professional labels
const CLI_THINKING_MESSAGES = [
  'Thinking',
];

const WORKING_MESSAGES = [
  'Working',
  'Processing',
  'Generating',
  'Building',
  'Preparing',
];

const STREAMING_MESSAGES = [
  'Writing',
  'Composing',
  'Generating',
];

const TOOL_MESSAGES = [
  'Executing',
  'Running',
  'Processing',
  'Fetching',
];

const getMessagesForState = (state: ActivityState): string[] => {
  switch (state) {
    case 'thinking':
      return THINKING_MESSAGES;
    case 'streaming':
      return STREAMING_MESSAGES;
    case 'tool_calling':
    case 'tool_executing':
      return TOOL_MESSAGES;
    default:
      return WORKING_MESSAGES;
  }
};

// =============================================================================
// Blinking Cursor Component (for streaming text)
// =============================================================================

const BlinkingCursor: React.FC = () => (
  <motion.span
    initial={{ opacity: 1 }}
    animate={{ opacity: [1, 0, 1] }}
    transition={{
      duration: 1,
      repeat: Infinity,
      ease: 'steps(2)',
    }}
    className="inline-block w-[8px] h-[14px] bg-[var(--color-primary)] ml-0.5 align-middle"
    style={{ marginBottom: '2px' }}
  />
);

// =============================================================================
// Animated Dots
// =============================================================================

const AnimatedDots: React.FC = () => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return <span className="inline-block w-[18px] text-left">{dots}</span>;
};

// =============================================================================
// Main Component - Inline with emoji and professional message
// =============================================================================

export const StreamingActivityIndicator: React.FC<StreamingActivityIndicatorProps> = ({
  state,
  customMessage,
  cliMode = true, // Default to CLI mode for CodeMode
}) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = useMemo(() =>
    cliMode && state === 'thinking' ? CLI_THINKING_MESSAGES : getMessagesForState(state),
    [state, cliMode]
  );

  // Rotate through messages every few seconds
  useEffect(() => {
    if (state === 'idle' || state === 'complete') return;

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [state, messages.length]);

  // Reset message index when state changes
  useEffect(() => {
    setMessageIndex(Math.floor(Math.random() * messages.length));
  }, [state, messages.length]);

  // Don't show for idle/complete states
  if (state === 'idle' || state === 'complete') {
    return null;
  }

  const displayMessage = customMessage || messages[messageIndex];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.2 }}
        className="flex items-center gap-1.5 py-1"
      >
        {/* ThinkingSphere - beautiful canvas animation */}
        <ThinkingSphere state="thinking" size={12} />

        {/* Message with animated dots - smaller text */}
        <span
          style={{
            fontSize: '12px',
            color: 'var(--color-textMuted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <motion.span
            key={displayMessage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {displayMessage}
          </motion.span>
          <AnimatedDots />
        </span>
      </motion.div>
    </AnimatePresence>
  );
};

// =============================================================================
// Compact Inline Version (for showing at end of streaming text)
// =============================================================================

export const InlineStreamingCursor: React.FC<{
  isVisible: boolean;
}> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="inline-block"
    >
      <BlinkingCursor />
    </motion.span>
  );
};

// =============================================================================
// Status Pill Version (for headers)
// =============================================================================

export const ActivityStatusPill: React.FC<{
  state: ActivityState;
  message?: string;
}> = ({ state, message }) => {
  if (state === 'idle' || state === 'complete') return null;

  const messages = getMessagesForState(state);
  const displayMessage = message || messages[0];

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium"
      style={{
        background: 'rgba(139, 92, 246, 0.15)',
        color: 'var(--color-text-secondary)',
      }}
    >
      {/* Thinking emoji rocks */}
      <motion.span
        animate={{
          rotate: [-5, 5, -5],
        }}
        transition={{
          duration: 1,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{ fontSize: '12px' }}
      >
        🤔
      </motion.span>

      <span>{displayMessage}</span>
    </motion.div>
  );
};

export default StreamingActivityIndicator;
