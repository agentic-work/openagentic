/**
 * Inline Thinking Block Component
 * Displays LLM thinking blocks in a clean, natural-flowing UI
 *
 * Two variants:
 * - "boxed": Traditional boxed container with border/background
 * - "natural": Clean inline display that flows with message content
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from '@/shared/icons';

// Tiny circle spinner for thinking indicator
const TinySpinner: React.FC<{ size?: number; animate?: boolean }> = ({ size = 12, animate = true }) => (
  <div
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: '50%',
      border: `2px solid var(--color-border)`,
      borderTopColor: animate ? 'var(--color-primary)' : 'var(--color-textMuted)',
      animation: animate ? 'spin 0.8s linear infinite' : 'none',
    }}
  />
);

interface InlineThinkingBlockProps {
  content: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  variant?: 'boxed' | 'natural';
  isStreaming?: boolean;
}

export const InlineThinkingBlock: React.FC<InlineThinkingBlockProps> = ({
  content,
  isExpanded: externalIsExpanded,
  onToggle: externalOnToggle,
  variant = 'natural', // Default to natural (non-boxed)
  isStreaming = false,
}) => {
  const [internalIsExpanded, setInternalIsExpanded] = useState(false);

  // Use external state if provided, otherwise use internal state
  const isExpanded = externalIsExpanded !== undefined ? externalIsExpanded : internalIsExpanded;
  const handleToggle = externalOnToggle || (() => setInternalIsExpanded(!internalIsExpanded));

  // Natural (non-boxed) variant - clean, inline display
  if (variant === 'natural') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="inline-thinking-natural"
        style={{
          marginBottom: '8px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header - minimal, clickable */}
        <button
          onClick={handleToggle}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 0',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--color-textMuted)',
          }}
        >
          <TinySpinner size={12} animate={isStreaming || !isExpanded} />
          <span style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--color-textSecondary)',
          }}>
            {isStreaming ? 'Thinking...' : 'Thought process'}
          </span>
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <ChevronDown size={14} />
          </motion.span>
        </button>

        {/* Collapsible content - flows naturally */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{
                paddingLeft: '22px',
                paddingTop: '4px',
                paddingBottom: '8px',
                fontSize: '13px',
                color: 'var(--color-textSecondary)',
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.5',
                borderLeft: '2px solid var(--color-border)',
                marginLeft: '8px',
              }}>
                {content}
                {isStreaming && (
                  <motion.span
                    className="inline-block w-1.5 h-3.5 bg-[var(--color-primary)] rounded-sm ml-1"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    style={{ verticalAlign: 'text-bottom' }}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  // Boxed variant - traditional container style
  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      className="inline-thinking-block"
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '8px',
        backgroundColor: 'var(--color-surfaceHover)',
        border: '1px solid var(--color-border)',
        marginBottom: '12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}
    >
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 14px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left'
        }}
      >
        {/* Thinking icon with pulse animation */}
        <TinySpinner size={16} animate={isStreaming} />

        {/* Status text */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--color-text)'
          }}>
            LLM Thinking
          </div>
          <div style={{
            fontSize: '11px',
            color: 'var(--color-textSecondary)'
          }}>
            {isExpanded ? 'Click to collapse' : 'Click to expand'}
          </div>
        </div>

        {/* Expand/collapse icon */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-textSecondary)'
          }}
        >
          <ChevronDown size={18} />
        </motion.div>
      </button>

      {/* Collapsible content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              overflow: 'hidden'
            }}
          >
            <div style={{
              padding: '12px 14px',
              borderTop: '1px solid var(--color-border)',
              fontSize: '12px',
              color: 'var(--color-textSecondary)',
              fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.6',
              maxHeight: '400px',
              overflowY: 'auto'
            }}>
              {content}
              {isStreaming && (
                <motion.span
                  className="inline-block w-2 h-4 bg-[var(--color-primary)] rounded-sm ml-1"
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default InlineThinkingBlock;
