/**
 * Smooth Streaming Hook
 * Creates typewriter effect for smooth, natural text appearance
 * Character by character reveal for natural text appearance
 */

import { useState, useEffect, useRef } from 'react';

interface UseSmoothStreamingOptions {
  enabled?: boolean;
  charsPerFrame?: number; // How many characters to reveal per frame
  frameDelay?: number; // Milliseconds between reveals
}

export const useSmoothStreaming = (
  incomingContent: string,
  options: UseSmoothStreamingOptions = {}
) => {
  const {
    enabled = true,
    charsPerFrame = 3, // Reveal 3 chars at a time for smooth feel
    frameDelay = 16 // ~60fps
  } = options;

  const [displayedContent, setDisplayedContent] = useState('');
  const targetContentRef = useRef(incomingContent);
  const currentIndexRef = useRef(0);
  const animationFrameRef = useRef<number>();
  const lastUpdateTimeRef = useRef(0);

  // Update target when incoming content changes
  useEffect(() => {
    targetContentRef.current = incomingContent;

    // If new content is shorter (rare case), reset immediately
    if (incomingContent.length < currentIndexRef.current) {
      currentIndexRef.current = 0;
      setDisplayedContent(incomingContent);
      return;
    }

    // If disabled, show immediately
    if (!enabled) {
      setDisplayedContent(incomingContent);
      currentIndexRef.current = incomingContent.length;
      return;
    }

    // Start smooth reveal animation with adaptive speed
    const reveal = (timestamp: number) => {
      const target = targetContentRef.current;
      const currentIndex = currentIndexRef.current;

      // Check if enough time has passed
      if (timestamp - lastUpdateTimeRef.current < frameDelay) {
        animationFrameRef.current = requestAnimationFrame(reveal);
        return;
      }

      lastUpdateTimeRef.current = timestamp;

      // If we haven't reached the target yet, reveal more characters
      if (currentIndex < target.length) {
        // Adaptive speed: if we're far behind, reveal more chars per frame
        const remainingChars = target.length - currentIndex;
        const adaptiveCharsPerFrame = remainingChars > 500
          ? Math.min(charsPerFrame * 3, 50) // 3x speed if more than 500 chars behind
          : remainingChars > 200
          ? Math.min(charsPerFrame * 2, 30) // 2x speed if more than 200 chars behind
          : charsPerFrame; // Normal speed otherwise

        const nextIndex = Math.min(currentIndex + adaptiveCharsPerFrame, target.length);
        currentIndexRef.current = nextIndex;
        setDisplayedContent(target.substring(0, nextIndex));
        animationFrameRef.current = requestAnimationFrame(reveal);
      }
    };

    // Start the animation if there's content to reveal
    if (currentIndexRef.current < incomingContent.length) {
      animationFrameRef.current = requestAnimationFrame(reveal);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [incomingContent, enabled, charsPerFrame, frameDelay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return displayedContent;
};
