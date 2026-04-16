/**
 * Optimized Chat Hook
 *
 * Uses Redis-backed caching and optimized state management
 * to prevent excessive re-renders and improve UI performance
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { ChatMessage } from '@/types/index';
import { messageCache } from '@/services/cache/MessageCacheService';

interface UseOptimizedChatOptions {
  sessionId: string;
  enableCache?: boolean;
  cacheTimeout?: number;
  onNewMessage?: (message: ChatMessage) => void;
  onUpdateMessage?: (messageId: string, updates: Partial<ChatMessage>) => void;
}

interface OptimizedChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  streamingContent: string;
  error: Error | null;
}

export function useOptimizedChat(options: UseOptimizedChatOptions) {
  const {
    sessionId,
    enableCache = true,
    cacheTimeout = 300,
    onNewMessage,
    onUpdateMessage
  } = options;

  // Use refs to prevent unnecessary re-renders
  const messagesRef = useRef<ChatMessage[]>([]);
  const streamingRef = useRef<string>('');
  const renderVersion = useRef(0);

  // State for triggering re-renders only when necessary
  const [state, setState] = useState<OptimizedChatState>({
    messages: [],
    isLoading: false,
    streamingContent: '',
    error: null
  });

  // Batch update flag to prevent multiple renders
  const batchUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdates = useRef<Partial<OptimizedChatState>>({});

  /**
   * Batch state updates to prevent excessive re-renders
   */
  const batchUpdate = useCallback((updates: Partial<OptimizedChatState>) => {
    Object.assign(pendingUpdates.current, updates);

    if (batchUpdateTimer.current) {
      clearTimeout(batchUpdateTimer.current);
    }

    batchUpdateTimer.current = setTimeout(() => {
      setState(prev => ({
        ...prev,
        ...pendingUpdates.current
      }));
      pendingUpdates.current = {};
      batchUpdateTimer.current = null;
    }, 16); // ~60fps
  }, []);

  /**
   * Add a new message with caching
   */
  const addMessage = useCallback((message: ChatMessage) => {
    // Update cache if enabled
    if (enableCache && message.id) {
      messageCache.set(message.id, message);
    }

    // Update ref immediately
    messagesRef.current = [...messagesRef.current, message];

    // Batch the state update
    batchUpdate({
      messages: messagesRef.current
    });

    // Callback
    onNewMessage?.(message);
  }, [enableCache, batchUpdate, onNewMessage]);

  /**
   * Update an existing message with caching
   */
  const updateMessage = useCallback((messageId: string, updates: Partial<ChatMessage>) => {
    // Update cache if enabled
    if (enableCache) {
      messageCache.update(messageId, updates);
    }

    // Update ref immediately
    const messageIndex = messagesRef.current.findIndex(m => m.id === messageId);
    if (messageIndex >= 0) {
      messagesRef.current = [
        ...messagesRef.current.slice(0, messageIndex),
        { ...messagesRef.current[messageIndex], ...updates },
        ...messagesRef.current.slice(messageIndex + 1)
      ];

      // Batch the state update
      batchUpdate({
        messages: messagesRef.current
      });
    }

    // Callback
    onUpdateMessage?.(messageId, updates);
  }, [enableCache, batchUpdate, onUpdateMessage]);

  /**
   * Update streaming content without re-rendering entire message list
   */
  const updateStreaming = useCallback((content: string) => {
    streamingRef.current = content;

    // Only update streaming content in state, not messages
    batchUpdate({
      streamingContent: content
    });
  }, [batchUpdate]);

  /**
   * Clear streaming content
   */
  const clearStreaming = useCallback(() => {
    streamingRef.current = '';
    batchUpdate({
      streamingContent: ''
    });
  }, [batchUpdate]);

  /**
   * Set loading state
   */
  const setLoading = useCallback((loading: boolean) => {
    batchUpdate({
      isLoading: loading
    });
  }, [batchUpdate]);

  /**
   * Load messages from cache
   */
  const loadFromCache = useCallback((messageIds: string[]) => {
    if (!enableCache) return [];

    const cached: ChatMessage[] = [];
    for (const id of messageIds) {
      const message = messageCache.get(id);
      if (message) {
        cached.push(message);
      }
    }
    return cached;
  }, [enableCache]);

  /**
   * Clear all messages and cache
   */
  const clearMessages = useCallback(() => {
    messagesRef.current = [];
    streamingRef.current = '';

    if (enableCache) {
      messageCache.clear();
    }

    setState({
      messages: [],
      isLoading: false,
      streamingContent: '',
      error: null
    });
  }, [enableCache]);

  /**
   * Prune expired cache entries periodically
   */
  useEffect(() => {
    if (!enableCache) return;

    const interval = setInterval(() => {
      const pruned = messageCache.pruneExpired();
      if (pruned > 0) {
        // console.debug(`Pruned ${pruned} expired messages from cache`);
      }
    }, 60000); // Every minute

    return () => clearInterval(interval);
  }, [enableCache]);

  /**
   * Memoized message list to prevent unnecessary re-renders
   */
  const memoizedMessages = useMemo(
    () => state.messages,
    [state.messages]
  );

  /**
   * Get cache statistics
   */
  const getCacheStats = useCallback(() => {
    if (!enableCache) return null;
    return messageCache.getStats();
  }, [enableCache]);

  return {
    messages: memoizedMessages,
    isLoading: state.isLoading,
    streamingContent: state.streamingContent,
    error: state.error,
    addMessage,
    updateMessage,
    updateStreaming,
    clearStreaming,
    setLoading,
    clearMessages,
    loadFromCache,
    getCacheStats
  };
}