/**
 * CLIActivitySpinner - OpenAgentic CLI Style Activity Indicator
 *
 * Unique spinner characters that rotate: ∴ ∵ ⁘ ⁙
 * Simple, professional activity labels.
 *
 * Clean, terminal-like aesthetic matching the OpenAgentic CLI.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ActivityState } from '@/stores/useCodeModeStore';

// =============================================================================
// Spinner Characters - CLI Style
// =============================================================================

// The unique spinner characters from OpenAgentic CLI
const SPINNER_CHARS = ['∴', '∵', '⁘', '⁙'];

// Alternative spinner for different states
const THINKING_SPINNER = ['◐', '◓', '◑', '◒'];
const DOT_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// =============================================================================
// Activity Messages - Professional Labels
// =============================================================================

// Simple thinking labels - no cycling fun messages
const THINKING_MESSAGES = [
  'Thinking',
];

// Working messages
const WORKING_MESSAGES = [
  'Working',
  'Processing',
  'Building',
  'Crafting',
  'Assembling',
];

// Tool messages
const TOOL_MESSAGES = [
  'Executing',
  'Running',
  'Fetching',
  'Searching',
  'Analyzing',
];

// Streaming messages
const STREAMING_MESSAGES = [
  'Writing',
  'Composing',
  'Generating',
  'Crafting',
];

// =============================================================================
// Types
// =============================================================================

interface CLIActivitySpinnerProps {
  state: ActivityState;
  message?: string;
  showMessage?: boolean;
  size?: 'sm' | 'md' | 'lg';
  spinnerType?: 'cli' | 'thinking' | 'dot';
}

// =============================================================================
// Helper Functions
// =============================================================================

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

const getSpinnerForState = (state: ActivityState, type?: string): string[] => {
  if (type === 'thinking') return THINKING_SPINNER;
  if (type === 'dot') return DOT_SPINNER;
  // Default to CLI spinner for most states
  return SPINNER_CHARS;
};

const getColorForState = (state: ActivityState): string => {
  switch (state) {
    case 'thinking':
      return '#39c5cf'; // Cyan
    case 'streaming':
      return '#22C55E'; // Green
    case 'tool_calling':
    case 'tool_executing':
      return '#d29922'; // Yellow
    case 'error':
      return '#ff7b72'; // Red
    default:
      return '#8b949e'; // Gray
  }
};

const getSizeClasses = (size: 'sm' | 'md' | 'lg') => {
  switch (size) {
    case 'sm':
      return { spinner: 'text-[12px]', text: 'text-[10px]' };
    case 'lg':
      return { spinner: 'text-[16px]', text: 'text-[12px]' };
    default:
      return { spinner: 'text-[14px]', text: 'text-[11px]' };
  }
};

// =============================================================================
// Main Component
// =============================================================================

export const CLIActivitySpinner: React.FC<CLIActivitySpinnerProps> = ({
  state,
  message,
  showMessage = true,
  size = 'md',
  spinnerType = 'cli',
}) => {
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  const spinnerChars = useMemo(() => getSpinnerForState(state, spinnerType), [state, spinnerType]);
  const messages = useMemo(() => getMessagesForState(state), [state]);
  const color = useMemo(() => getColorForState(state), [state]);
  const sizes = useMemo(() => getSizeClasses(size), [size]);

  // Rotate spinner character
  useEffect(() => {
    if (state === 'idle' || state === 'complete') return;

    const interval = setInterval(() => {
      setSpinnerIndex((prev) => (prev + 1) % spinnerChars.length);
    }, 150); // Fast rotation like CLI

    return () => clearInterval(interval);
  }, [state, spinnerChars.length]);

  // Rotate messages (slower)
  useEffect(() => {
    if (state === 'idle' || state === 'complete' || !showMessage) return;

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [state, messages.length, showMessage]);

  // Reset on state change
  useEffect(() => {
    setMessageIndex(Math.floor(Math.random() * messages.length));
  }, [state, messages.length]);

  // Don't render for idle/complete
  if (state === 'idle' || state === 'complete') {
    return null;
  }

  const displayMessage = message || messages[messageIndex];

  return (
    <div className="flex items-center gap-2 font-mono">
      {/* Spinner character */}
      <motion.span
        key={spinnerIndex}
        initial={{ opacity: 0.5 }}
        animate={{ opacity: 1 }}
        className={`${sizes.spinner} select-none`}
        style={{ color }}
      >
        {spinnerChars[spinnerIndex]}
      </motion.span>

      {/* Activity message */}
      {showMessage && (
        <AnimatePresence mode="wait">
          <motion.span
            key={displayMessage}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 5 }}
            transition={{ duration: 0.2 }}
            className={sizes.text}
            style={{ color }}
          >
            {displayMessage}...
          </motion.span>
        </AnimatePresence>
      )}
    </div>
  );
};

// =============================================================================
// Compact Inline Spinner (no message)
// =============================================================================

export const InlineCLISpinner: React.FC<{
  state: ActivityState;
  size?: 'sm' | 'md' | 'lg';
}> = ({ state, size = 'sm' }) => {
  const [index, setIndex] = useState(0);
  const color = useMemo(() => getColorForState(state), [state]);
  const sizes = useMemo(() => getSizeClasses(size), [size]);

  useEffect(() => {
    if (state === 'idle' || state === 'complete') return;
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % SPINNER_CHARS.length);
    }, 150);
    return () => clearInterval(interval);
  }, [state]);

  if (state === 'idle' || state === 'complete') return null;

  return (
    <span className={`${sizes.spinner} select-none`} style={{ color }}>
      {SPINNER_CHARS[index]}
    </span>
  );
};

// =============================================================================
// Status Line Spinner (for status bar)
// =============================================================================

export const StatusLineSpinner: React.FC<{
  state: ActivityState;
  message?: string;
}> = ({ state, message }) => {
  const [index, setIndex] = useState(0);
  const messages = useMemo(() => getMessagesForState(state), [state]);
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (state === 'idle' || state === 'complete') return;
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % SPINNER_CHARS.length);
    }, 150);
    return () => clearInterval(interval);
  }, [state]);

  useEffect(() => {
    if (state === 'idle' || state === 'complete') return;
    const interval = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % messages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [state, messages.length]);

  if (state === 'idle' || state === 'complete') {
    return (
      <span className="text-[#22C55E] text-xs font-mono flex items-center gap-1">
        <span>●</span>
        <span>Ready</span>
      </span>
    );
  }

  const displayMsg = message || messages[msgIndex];
  const color = getColorForState(state);

  return (
    <span className="text-xs font-mono flex items-center gap-1.5" style={{ color }}>
      <span>{SPINNER_CHARS[index]}</span>
      <span>{displayMsg}</span>
    </span>
  );
};

export default CLIActivitySpinner;
