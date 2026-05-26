/**
 * CLIThinkingDisplay - Openagentic CLI Style Thinking Block
 *
 * Renders thinking with ThinkingSphere animation:
 * - Uses consistent ThinkingSphere across chat and code modes
 * - Collapsed preview of thinking content
 * - Compact terminal aesthetic
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ThinkingSphere } from '@/shared/components/ThinkingSphere';

interface CLIThinkingDisplayProps {
  isThinking: boolean;
  thinkingContent?: string;
  isCompleted?: boolean;
  elapsedMs?: number;
}

export const CLIThinkingDisplay: React.FC<CLIThinkingDisplayProps> = ({
  isThinking,
  thinkingContent,
  isCompleted = false,
  elapsedMs = 0,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-collapse when thinking completes
  useEffect(() => {
    if (isCompleted && !isThinking) {
      setIsExpanded(false);
    }
  }, [isCompleted, isThinking]);

  // Don't render if no content and not thinking
  if (!thinkingContent && !isThinking) {
    return null;
  }

  // Format elapsed time
  const formatTime = (ms: number): string => {
    if (ms < 1000) return '0s';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Estimate tokens (rough: ~4 chars per token)
  const estimatedTokens = Math.ceil((thinkingContent?.length || 0) / 4);

  // Get content lines for display
  const contentLines = (thinkingContent || '').split('\n').filter(l => l.trim());

  return (
    <div className="font-mono text-[11px] leading-[1.5] mb-1.5">
      {/* Header: ThinkingSphere + Thinking or Thought for Xs */}
      <div
        className="flex items-center gap-1.5 cursor-pointer hover:opacity-80"
        onClick={() => !isThinking && setIsExpanded(!isExpanded)}
      >
        <ThinkingSphere state={isThinking ? 'thinking' : 'hidden'} size={10} />
        {isThinking ? (
          <span className="text-[#d4a574]">Thinking...</span>
        ) : (
          <>
            <span className="text-[#8b949e]">Thought for {formatTime(elapsedMs)}</span>
            {estimatedTokens > 0 && (
              <span className="text-[#6e7681] ml-1 text-[11px]">
                (~{estimatedTokens} tokens)
              </span>
            )}
          </>
        )}
      </div>

      {/* Content - show when thinking or expanded */}
      {(isThinking || isExpanded) && thinkingContent && (
        <div className="ml-5 mt-1">
          {contentLines.map((line, i) => (
            <div key={i} className="text-[#8b949e] text-[11px] leading-relaxed">
              {line.slice(0, 120)}{line.length > 120 ? '...' : ''}
            </div>
          ))}
          {isThinking && (
            <motion.span
              className="inline-block w-1 h-3 bg-[#d4a574] ml-0.5"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          )}
        </div>
      )}

      {/* Collapsed state - just show expand hint */}
      {!isThinking && !isExpanded && thinkingContent && (
        <div
          className="ml-5 cursor-pointer hover:opacity-80 text-[#6e7681] text-[10px] flex items-center gap-1"
          onClick={() => setIsExpanded(true)}
        >
          <span>▸</span>
          <span>Click to expand ({contentLines.length} lines)</span>
        </div>
      )}
    </div>
  );
};

export default CLIThinkingDisplay;
