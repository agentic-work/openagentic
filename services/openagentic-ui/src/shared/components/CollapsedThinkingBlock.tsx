/**
 * CollapsedThinkingBlock - Unified thinking block component
 *
 * Used by BOTH Chat Mode and Code Mode for consistent thinking display.
 * Follows Claude Code CLI style:
 * - During streaming: Shows minimal "Thinking..." with animated indicator
 * - After completion: Shows collapsed "Thought for Xs (~N tokens)"
 * - Content is HIDDEN by default
 * - User can click to expand
 *
 * This replaces both InlineThinking (chat) and CLIThinkingDisplay (code)
 * to ensure consistent behavior across the application.
 * */

import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown } from '@/shared/icons';
import { ThinkingSphere } from './ThinkingSphere';

interface CollapsedThinkingBlockProps {
  /** The thinking content to display */
  content: string;
  /** Whether thinking is currently streaming */
  isStreaming?: boolean;
  /** Whether thinking is complete */
  isComplete?: boolean;
  /** Elapsed time in milliseconds */
  elapsedMs?: number;
  /** Token count (if available from API) */
  tokenCount?: number;
  /** Progress information for streaming display */
  progress?: {
    percentage: number;
    tokensUsed: number;
    phase?: 'thinking' | 'processing' | 'complete';
  };
  /** Visual variant */
  variant?: 'minimal' | 'standard';
  /** Theme for styling */
  theme?: 'light' | 'dark';
}

/**
 * Format elapsed time for display
 */
const formatTime = (ms: number): string => {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

/**
 * Estimate token count from content length (rough: ~4 chars per token)
 */
const estimateTokens = (content: string): number => {
  return Math.ceil((content?.length || 0) / 4);
};

/**
 * CollapsedThinkingBlock Component
 *
 * Renders thinking blocks in Claude Code CLI style:
 * - Collapsed by default after completion
 * - Shows time and token count
 * - User can expand to see full content
 */
export const CollapsedThinkingBlock: React.FC<CollapsedThinkingBlockProps> = ({
  content,
  isStreaming = false,
  isComplete = false,
  elapsedMs = 0,
  tokenCount,
  progress,
  variant = 'standard',
  theme = 'dark',
}) => {
  // Track whether user has manually expanded
  // Claude Code style: EXPANDED during streaming so user sees live CoT text
  const [isExpanded, setIsExpanded] = useState(isStreaming);

  // Track elapsed time during streaming
  const [streamingElapsed, setStreamingElapsed] = useState(0);
  const streamingStartRef = React.useRef<number | null>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Start/stop elapsed time tracking
  useEffect(() => {
    if (isStreaming && !isComplete) {
      if (!streamingStartRef.current) {
        streamingStartRef.current = Date.now();
      }
      const interval = setInterval(() => {
        setStreamingElapsed(Date.now() - (streamingStartRef.current || Date.now()));
      }, 100);
      return () => clearInterval(interval);
    } else if (isComplete && streamingStartRef.current) {
      // Capture final elapsed time
      setStreamingElapsed(Date.now() - streamingStartRef.current);
    }
  }, [isStreaming, isComplete]);

  // Auto-scroll thinking content during streaming
  useEffect(() => {
    if (isStreaming && contentScrollRef.current) {
      contentScrollRef.current.scrollTop = contentScrollRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  // Auto-expand when streaming starts (Claude Code style: show live CoT)
  useEffect(() => {
    if (isStreaming && !isComplete) {
      setIsExpanded(true);
    }
  }, [isStreaming, isComplete]);

  // Auto-collapse when thinking completes — collapses to a preview line with "..."
  useEffect(() => {
    if (isComplete && !isStreaming) {
      setIsExpanded(false);
    }
  }, [isComplete, isStreaming]);

  // Always render the thinking block header — even with empty content,
  // show "Thought for Xs" so thinking blocks persist after streaming ends
  // (Claude Code style: thinking blocks never disappear)

  // Calculate display values
  const displayElapsed = elapsedMs || streamingElapsed;
  const displayTokens = tokenCount || progress?.tokensUsed || estimateTokens(content);
  // During streaming: streaming div below handles the live view (with blinking cursor).
  // The expanded content div is for the toggled view after completion.
  const shouldShowContent = isExpanded && !isStreaming;

  // First line preview shown in collapsed completed state
  const previewText = content
    ? content.replace(/\s+/g, ' ').trim().slice(0, 80)
    : '';

  // Format token count for display: 2100 → "~2.1k", 500 → "~500"
  const formatTokens = (count: number): string => {
    if (count >= 1000) return `~${(count / 1000).toFixed(1)}k tokens`;
    return `~${count} tokens`;
  };

  return (
    <div
      className="collapsed-thinking-block"
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: variant === 'minimal' ? 11 : 12,
        lineHeight: 1.4,
        marginBottom: variant === 'minimal' ? 4 : 6,
        borderLeft: `2px solid ${isStreaming ? 'var(--cm-accent, rgba(139, 92, 246, 0.6))' : 'rgba(139, 92, 246, 0.3)'}`,
        paddingLeft: 8,
        padding: '4px 8px',
        background: isStreaming ? 'var(--cm-surface, rgba(139, 92, 246, 0.05))' : 'rgba(139, 92, 246, 0.04)',
        borderRadius: '0 4px 4px 0',
        transition: 'border-color 0.3s ease',
      }}
    >
      {/* Header Row - Always visible */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          padding: '2px 0',
          opacity: isComplete && !isExpanded ? 0.8 : 1,
          transition: 'opacity 0.2s ease',
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* Chevron toggle (▶/▼) + optional streaming indicator */}
        <span style={{
          color: 'var(--cm-muted, #6e7681)',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          transition: 'transform 0.15s ease',
          gap: 4,
        }}>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isStreaming && (
            <ThinkingSphere
              state="thinking"
              size={variant === 'minimal' ? 10 : 12}
            />
          )}
        </span>

        {/* Status text */}
        {isStreaming ? (
          <span style={{ color: 'var(--cm-accent, #d4a574)' }}>
            Thinking
            {displayElapsed > 0 && (
              <span style={{
                marginLeft: 8,
                color: 'var(--cm-muted, #8b949e)',
                fontSize: variant === 'minimal' ? 10 : 11,
              }}>
                {formatTime(displayElapsed)}
              </span>
            )}
          </span>
        ) : (
          <>
            <span style={{ color: 'var(--cm-muted, #8b949e)', flexShrink: 0 }}>
              Thought for {formatTime(displayElapsed)}
            </span>
            {displayTokens > 0 && (
              <span style={{
                color: 'var(--cm-muted, #6e7681)',
                fontSize: variant === 'minimal' ? 10 : 11,
                marginLeft: 4,
                flexShrink: 0,
                opacity: 0.7,
              }}>
                ({formatTokens(displayTokens)})
              </span>
            )}
            {/* Content preview — shown when collapsed, hidden when expanded */}
            {!isExpanded && previewText && (
              <span style={{
                color: 'var(--cm-muted, #6e7681)',
                fontSize: variant === 'minimal' ? 10 : 11,
                marginLeft: 8,
                opacity: 0.6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }}>
                — {previewText}{content.length > 80 ? '…' : ''}
              </span>
            )}
          </>
        )}
      </div>

      {/* Expanded content — CSS max-height transition (no Framer Motion) */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: shouldShowContent && content ? 400 : 0,
          opacity: shouldShowContent && content ? 1 : 0,
          transition: 'max-height 0.2s ease, opacity 0.15s ease',
        }}
      >
        <div
          ref={contentScrollRef}
          style={{
            marginLeft: variant === 'minimal' ? 16 : 20,
            marginTop: 4,
            padding: '6px 10px',
            background: 'transparent',
            borderLeft: '2px solid var(--cm-accent, rgba(139, 92, 246, 0.4))',
            borderRadius: 0,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: variant === 'minimal' ? 11 : 12,
              fontFamily: 'inherit',
              fontStyle: 'italic',
              color: 'var(--cm-muted, #8b949e)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
            }}
          >
            {content}
          </pre>

        </div>
      </div>

      {/* Streaming content — CSS-only animation (no Framer Motion) */}
      {isStreaming && content && (
        <div
          style={{
            marginLeft: variant === 'minimal' ? 16 : 20,
            marginTop: 8,
            padding: '8px 12px',
            background: 'var(--cm-surface, rgba(212, 165, 116, 0.08))',
            borderLeft: '2px solid var(--cm-accent, rgba(139, 92, 246, 0.4))',
            borderRadius: 0,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: variant === 'minimal' ? 11 : 12,
              fontFamily: 'inherit',
              fontStyle: 'italic',
              color: 'var(--cm-muted, #d4a574)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
            }}
          >
            {content}
            <span
              className="thinking-cursor-blink"
              style={{
                display: 'inline-block',
                width: 6,
                height: 14,
                background: 'var(--cm-accent, #d4a574)',
                borderRadius: 1,
                marginLeft: 2,
                verticalAlign: 'text-bottom',
              }}
            />
          </pre>
          <style>{`
            @keyframes thinking-blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0; }
            }
            .thinking-cursor-blink {
              animation: thinking-blink 0.8s infinite;
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default CollapsedThinkingBlock;
