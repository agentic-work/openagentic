/**
 * Smooth Streaming Text — typewriter-style char reveal for streaming chat.
 *
 * Pacing is delegated to `useTextPacer` (#503). The previous implementation
 * revealed 4 chars per 66ms tick (15fps), which looked like janky bursts.
 * The pacer enforces single-char reveal at the requested cadence to match
 * the natural-printout reference in mocks/UX/mock.html.
 *
 * @see hooks/useTextPacer.ts
 */

import React from 'react';
import { motion } from 'framer-motion';
import { SharedMarkdownRenderer } from './MessageContent/SharedMarkdownRenderer';
import { useTextPacer } from '../hooks/useTextPacer';

interface SmoothStreamingTextProps {
  content: string;
  className?: string;
  /** Characters per second. Default 67 → 15ms/char (mock.html prose default). */
  typingSpeed?: number;
  enableAnimation?: boolean;
  theme?: 'light' | 'dark';
}

export const SmoothStreamingText: React.FC<SmoothStreamingTextProps> = ({
  content,
  className = '',
  typingSpeed = 67,
  enableAnimation = true,
  theme = 'dark',
}) => {
  const intervalMs = Math.max(1, Math.round(1000 / Math.max(1, typingSpeed)));
  const { displayed, done } = useTextPacer(content, {
    intervalMs,
    enabled: enableAnimation,
  });
  const isTyping = enableAnimation && !done;

  return (
    <div className={`relative ${className}`}>
      <SharedMarkdownRenderer
        content={displayed}
        theme={theme}
        isStreaming={isTyping}
      />
      {isTyping && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
          className="inline-block w-0.5 h-4 bg-current ml-0.5"
        />
      )}
    </div>
  );
};
