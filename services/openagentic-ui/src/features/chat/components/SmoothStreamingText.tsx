/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Smooth Streaming Text Component
 * Provides typewriter-style animation for streaming chat messages
 * Features: Configurable typing speed, smooth character-by-character display, animation controls
 * Uses SharedMarkdownRenderer for visual consistency with finished messages
 * @see docs/chat/text-animation.md
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { SharedMarkdownRenderer } from './MessageContent/SharedMarkdownRenderer';

interface SmoothStreamingTextProps {
  content: string;
  className?: string;
  typingSpeed?: number; // Characters per second
  enableAnimation?: boolean;
  theme?: 'light' | 'dark'; // Required for code block styling
}

export const SmoothStreamingText: React.FC<SmoothStreamingTextProps> = ({
  content,
  className = '',
  typingSpeed = 60, // 60 chars per second - faster, more responsive (ChatGPT-like)
  enableAnimation = true,
  theme = 'dark'
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const contentRef = useRef(content);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // If animation is disabled, just show the content
    if (!enableAnimation) {
      setDisplayedContent(content);
      return;
    }

    // CRITICAL FIX: If content is empty, immediately clear and stop typing
    if (content.length === 0) {
      indexRef.current = 0;
      setDisplayedContent('');
      setIsTyping(false);
      return;
    }

    // If content is longer than what we're displaying, continue typing
    if (content.length > indexRef.current) {
      setIsTyping(true);
      // Don't reset the typing animation, just continue from where we are
      if (!timeoutRef.current) {
        typeNextCharacters();
      }
    }
    // If content is exactly what we've displayed, we're done
    else if (content.length === indexRef.current) {
      setIsTyping(false);
    }
    // If content is shorter (shouldn't happen in streaming), reset
    else if (content.length < indexRef.current) {
      indexRef.current = 0;
      setDisplayedContent('');
      setIsTyping(false); // FIX: Don't start typing empty content
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, enableAnimation]);

  const typeNextCharacters = () => {
    // PERFORMANCE OPTIMIZATION:
    // Reduced update frequency from 30fps to 15fps to reduce React re-renders
    // Increased chars per step to maintain perceived typing speed
    const charsPerStep = Math.max(2, Math.floor(typingSpeed / 15)); // 15 steps per second (was 30)
    const delay = 1000 / 15; // ~66ms between updates (was 33ms)

    const nextIndex = Math.min(indexRef.current + charsPerStep, content.length);
    const nextContent = content.slice(0, nextIndex);

    setDisplayedContent(nextContent);
    indexRef.current = nextIndex;

    if (nextIndex < content.length) {
      timeoutRef.current = setTimeout(typeNextCharacters, delay);
    } else {
      setIsTyping(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <SharedMarkdownRenderer
        content={displayedContent}
        theme={theme}
        isStreaming={isTyping}
      />
      {isTyping && enableAnimation && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
          className="inline-block w-0.5 h-4 bg-current ml-0.5"
        />
      )}
    </div>
  );
};