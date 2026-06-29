/**
 * AgenticActivityStream — thinking-block display components.
 *
 * Extracted verbatim from AgenticActivityStream.tsx (behavior-preserving):
 * the animated ThinkingGlobeIndicator, the legacy InlineThinking / ThinkingBlock
 * renderers, and the ThinkingBudgetBadge (the live one used by the stream).
 */
import React, { useState, useMemo, memo } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { ChevronRight, ChevronDown, Zap } from '@/shared/icons';
import { ThinkingSphere } from '@/shared/components/ThinkingSphere';
import { formatDuration } from './activityUtils';
import type { ThinkingProgress } from './types/activity.types';

// ============================================================================
// Inline Thinking Display
// ============================================================================

interface InlineThinkingProps {
  content: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  thinkingProgress?: ThinkingProgress;
}

export const ThinkingGlobeIndicator: React.FC<{
  isAnimating: boolean;
  size?: number;
  progress?: number;
  phase?: 'thinking' | 'tools' | 'generating';
  layoutId?: string;
}> = ({ isAnimating, size = 16, progress, phase = 'thinking', layoutId }) => {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = progress !== undefined
    ? circumference - (progress / 100) * circumference
    : circumference;

  const phaseColors = {
    thinking: { primary: 'var(--cm-thinking)', glow: 'var(--cm-thinking-glow)' },
    tools: { primary: 'var(--cm-info)', glow: 'var(--cm-info-glow)' },
    generating: { primary: 'var(--cm-ok)', glow: 'var(--cm-ok-glow)' },
  };
  const colors = phaseColors[phase];

  const containerStyle = { width: size, height: size, position: 'relative' as const, flexShrink: 0 };

  const content = (
    <>
      <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={strokeWidth} />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={colors.primary} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={progress !== undefined ? progressOffset : 0}
          style={{
            transition: progress !== undefined ? 'stroke-dashoffset 0.3s ease-out' : 'none',
            filter: isAnimating ? `drop-shadow(0 0 2px ${colors.glow})` : 'none',
            animation: isAnimating && progress === undefined ? 'thinking-spin 2s linear infinite' : 'none',
          }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: size * 0.5,
        height: size * 0.5,
      }}>
        {/* 2026-05-07 — was a static `/think.svg` square that pulse-scaled.
            User asked to swap for the existing canvas-based ThinkingSphere
            (sparkles + rotating arcs) so the inline thinking indicator
            matches the rest of the app's animated aesthetic. */}
        <ThinkingSphere state={isAnimating ? 'thinking' : 'hidden'} size={size * 0.5} />
      </div>
      <style>{`
        @keyframes thinking-spin { from { stroke-dashoffset: 0; } to { stroke-dashoffset: ${circumference}; } }
      `}</style>
    </>
  );

  if (layoutId) {
    return (
      <motion.div
        layoutId={layoutId}
        style={containerStyle}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {content}
      </motion.div>
    );
  }

  return <div style={containerStyle}>{content}</div>;
};

export const InlineThinking: React.FC<InlineThinkingProps> = memo(({
  content,
  isStreaming,
  isComplete,
  thinkingProgress,
}) => {
  const [showFull, setShowFull] = useState(false);
  const layoutId = useMemo(() => `thinking-globe-${Math.random().toString(36).slice(2, 9)}`, []);

  if (!content) return null;

  const shouldShowContent = isStreaming || showFull;
  const preview = content.split('\n')[0].substring(0, 100) + (content.length > 100 ? '...' : '');

  return (
    <LayoutGroup>
      <div
        className="cm-thinking inline-thinking-natural"
        style={{
          marginBottom: 8,
          opacity: isComplete && !showFull ? 0.6 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        {!shouldShowContent && (
          <button
            onClick={() => setShowFull(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 12,
              width: '100%',
              textAlign: 'left',
            }}
          >
            <ChevronRight size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <ThinkingGlobeIndicator
              isAnimating={false}
              size={12}
              phase="thinking"
              layoutId={layoutId}
            />
            <span style={{
              fontStyle: 'italic',
              flex: 1,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              lineHeight: '1.4',
              fontSize: 12,
              color: 'var(--color-text-secondary)',
            }}>
              {(() => {
                // Extract first meaningful sentence from thinking content
                // Skip internal reasoning like tool signatures, JSON, code
                const lines = content.split('\n').filter(l => l.trim().length > 10);
                const meaningful = lines.find(l =>
                  !l.includes('signature') && !l.includes('function(') &&
                  !l.includes('{') && !l.includes('args:') && !l.includes('::') &&
                  /[A-Z]/.test(l.charAt(0))
                ) || lines[0] || content.substring(0, 150);
                return meaningful.substring(0, 150) + (meaningful.length > 150 ? '...' : '');
              })()}
            </span>
            {thinkingProgress && (
              <span style={{ flexShrink: 0, fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>
                ~{(thinkingProgress.tokensUsed / 1000).toFixed(1)}k tokens
              </span>
            )}
          </button>
        )}

        {shouldShowContent && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              padding: '10px 14px',
              background: 'var(--thinking-bg, color-mix(in srgb, var(--cm-thinking) 6%, transparent))',
              border: '1px solid var(--thinking-border, color-mix(in srgb, var(--cm-thinking) 20%, transparent))',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 8,
            }}>
              <ThinkingGlobeIndicator
                isAnimating={!!isStreaming}
                size={18}
                progress={thinkingProgress?.percentage}
                phase={thinkingProgress?.phase || 'thinking'}
                layoutId={layoutId}
              />

              <span style={{
                fontWeight: 500,
                fontSize: 13,
                color: isStreaming ? 'var(--cm-thinking)' : 'var(--cm-fg-2)',
              }}>
                {isStreaming ? 'Thinking...' : 'Thought process'}
              </span>

              {isStreaming && thinkingProgress && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--color-primary, var(--user-accent-primary))',
                  fontWeight: 500,
                }}>
                  {thinkingProgress.percentage.toFixed(0)}%
                </span>
              )}

              {thinkingProgress && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                }}>
                  {thinkingProgress.tokensUsed.toLocaleString()} tokens
                </span>
              )}

              {!isStreaming && (
                <button
                  onClick={() => setShowFull(false)}
                  style={{
                    marginLeft: thinkingProgress ? 8 : 'auto',
                    padding: 2,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <ChevronDown size={14} />
                </button>
              )}
            </div>

            <pre style={{
              margin: 0,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              fontStyle: 'italic',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: isStreaming ? 200 : 150,
              overflowY: 'auto',
              lineHeight: 1.6,
              borderLeft: '2px solid var(--thinking-accent, color-mix(in srgb, var(--cm-thinking) 30%, transparent))',
              paddingLeft: 12,
              opacity: 0.85,
            }}>
              {content}
              {isStreaming && (
                <span className="thinking-cursor" style={{
                  color: 'var(--color-primary, var(--user-accent-primary))',
                  animation: 'blink 1s infinite',
                  marginLeft: 2,
                }}>|</span>
              )}
            </pre>
            <style>{`
              @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
            `}</style>
          </motion.div>
        )}
      </div>
    </LayoutGroup>
  );
});

InlineThinking.displayName = 'InlineThinking';

// Legacy ThinkingBlock kept for non-interleaved mode (backward compat)
interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  duration?: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = memo(({
  content,
  isStreaming,
  duration,
  isExpanded,
  onToggle
}) => {
  if (!content) return null;

  return (
    <div style={{ marginBottom: 12 }} className="thinking-block-container">
      <button
        onClick={onToggle}
        className="thinking-block-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: isExpanded ? '8px 8px 0 0' : 8,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
        <ThinkingGlobeIndicator isAnimating={!!isStreaming} size={14} phase="thinking" />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {isStreaming ? 'Reasoning...' : 'Thought process'}
        </span>
        <span style={{ flex: 1 }} />
        {duration && !isStreaming ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {formatDuration(duration)}
          </span>
        ) : null}
      </button>

      {isExpanded && (
        <div
          className="thinking-block-content"
          style={{
            padding: '12px 16px',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
          }}
        >
          <pre style={{
            margin: 0,
            fontSize: 13,
            fontFamily: 'var(--font-body)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
            lineHeight: 1.6,
          }}>
            {content}
            {isStreaming && (
              <span className="animate-pulse" style={{
                display: 'inline-block',
                width: 2,
                height: 14,
                marginLeft: 2,
                backgroundColor: 'var(--color-primary)',
                verticalAlign: 'text-bottom',
              }} />
            )}
          </pre>
        </div>
      )}
    </div>
  );
});

ThinkingBlock.displayName = 'ThinkingBlock';

// ============================================================================
// Thinking Budget Utilization Badge
// ============================================================================

interface ThinkingBudgetBadgeProps {
  tokensUsed: number;
  tokenBudget: number;
  isStreaming: boolean;
}

export const ThinkingBudgetBadge: React.FC<ThinkingBudgetBadgeProps> = memo(({
  tokensUsed,
  tokenBudget,
  isStreaming,
}) => {
  if (isStreaming || tokenBudget <= 0) return null;

  const percentage = Math.min(100, Math.round((tokensUsed / tokenBudget) * 100));
  const formattedUsed = tokensUsed >= 1000
    ? `${(tokensUsed / 1000).toFixed(1)}K`
    : String(tokensUsed);
  const formattedBudget = tokenBudget >= 1000
    ? `${(tokenBudget / 1000).toFixed(0)}K`
    : String(tokenBudget);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <Zap size={10} style={{ color: percentage > 75 ? 'var(--color-warning)' : 'var(--color-text-muted)' }} />
      <span>{formattedUsed}/{formattedBudget} thinking tokens</span>
      <span style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>({percentage}%)</span>
    </motion.div>
  );
});

ThinkingBudgetBadge.displayName = 'ThinkingBudgetBadge';
