/**
 * useGoToLatestChip
 *
 * "Go to latest" floating-chip state extracted verbatim from ChatContainer.
 * Tracks whether the chat scroll container is near its bottom (so the chip can
 * be shown when the user scrolls up) and exposes a smooth scroll-to-bottom
 * action. Reads/writes only the DOM `#chat-messages-container` element — no
 * store, no streaming state. Re-binds the scroll listener on session/messages
 * change so it attaches to the right element after re-renders.
 */
import { useState, useEffect, useCallback } from 'react';

export interface GoToLatestChip {
  isAtBottom: boolean;
  scrollToLatest: () => void;
}

export function useGoToLatestChip(
  activeSessionId: string | null,
  messagesLength: number,
): GoToLatestChip {
  // "Go to latest" floating chip — shown when the user scrolls up away from the
  // bottom of the chat. Click scrolls back smoothly. Mirrors the openagentic UX.
  const [isAtBottom, setIsAtBottom] = useState(true);
  useEffect(() => {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    const onScroll = () => {
      // Within 120px of the bottom counts as "at bottom" — gives a comfortable
      // dead zone so the chip doesn't flicker on and off when the user is
      // mostly-but-not-quite at the latest message.
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsAtBottom(distFromBottom < 120);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // initial state
    return () => container.removeEventListener('scroll', onScroll);
    // Re-bind on session/messages change so the listener attaches to the
    // right element after re-renders.
  }, [activeSessionId, messagesLength]);

  const scrollToLatest = useCallback(() => {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, []);

  return { isAtBottom, scrollToLatest };
}
