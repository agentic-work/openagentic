/**
 * useMessageHandling - Hook for managing message sending and streaming
 * Encapsulates message creation, file handling, and SSE communication
 */

import { useCallback, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useChatStore, type Message } from '@/stores/useChatStore';
import { uploadFilesToApi, type UploadedFileRef } from './uploadFilesToApi';

// Use the store's Message type for compatibility
type ChatMessage = Message;

interface SendMessageOptions {
  model?: string;
  enabledTools?: string[];
  // Accepts either:
  //   - {id} refs (persisted uploads — backend hydrates bytes from MinIO), or
  //   - {name,type,content} inline base64 (legacy path, still honored by the
  //     backend for small files / tests).
  files?: Array<
    | { id: string; name?: string; type?: string; size?: number }
    | { name: string; type: string; content: string }
  >;
  promptTechniques?: string[];
}

export interface UseMessageHandlingOptions {
  activeSessionId: string | null;
  isStreaming: boolean;
  sendSSEMessage: (message: string, options?: SendMessageOptions) => Promise<any>;
  createNewSession: () => Promise<string>;
  onMessageSent?: () => void;
}

export const useMessageHandling = (options: UseMessageHandlingOptions) => {
  const {
    activeSessionId,
    isStreaming,
    sendSSEMessage,
    createNewSession,
    onMessageSent
  } = options;

  const { addMessage, finishStreamingMessage, updateMessage } = useChatStore();

  // Track streaming placeholder
  const streamingPlaceholderIdRef = useRef<string | null>(null);
  const lastMessageSentRef = useRef<number>(0);

  // Streaming state
  const [streamingStatus, setStreamingStatus] = useState<'idle' | 'streaming' | 'error'>('idle');

  // 2026-04-24: switched from FileReader → base64-inline-in-chat-body to a
  // pre-upload flow. The UI now POSTs each dropped File to
  // /api/files/upload *before* /api/chat/stream; the chat request only
  // carries {id} refs and the backend hydrates bytes from MinIO per turn.
  // convertFilesToBase64 is kept as a small-file escape hatch (tests,
  // or when the upload endpoint is unreachable and we want the old path).
  const convertFilesToBase64 = useCallback(async (files: File[]) => {
    if (files.length === 0) return [];
    return Promise.all(
      files.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        return {
          name: file.name,
          type: file.type,
          content: base64.split(',')[1] // strip data:image/jpeg;base64, prefix
        };
      })
    );
  }, []);

  // Clear streaming state
  const clearStreamingState = useCallback((sessionId: string | null) => {
    const oldPlaceholderId = streamingPlaceholderIdRef.current;
    if (oldPlaceholderId && sessionId) {
      finishStreamingMessage(sessionId, oldPlaceholderId);
    }
    streamingPlaceholderIdRef.current = null;
    setStreamingStatus('idle');
  }, [finishStreamingMessage]);

  // Create user message
  const createUserMessage = useCallback((content: string, timestamp: number): ChatMessage => ({
    id: nanoid(),
    role: 'user',
    content,
    timestamp: new Date(timestamp).toISOString(),
    status: 'sending'
  }), []);

  // Create assistant placeholder
  const createAssistantPlaceholder = useCallback((timestamp: number): ChatMessage => ({
    id: `assistant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role: 'assistant',
    content: '',
    timestamp: new Date(timestamp + 1).toISOString(),
    status: 'streaming'
  }), []);

  // Send message
  const sendMessage = useCallback(async (
    messageContent: string,
    files: File[] = [],
    sendOptions: Omit<SendMessageOptions, 'files'> = {}
  ) => {
    if (!messageContent.trim() || isStreaming) {
      return { success: false, reason: 'empty or streaming' };
    }

    // Ensure we have a session
    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        sessionId = await createNewSession();
      } catch (error) {
        console.error('[useMessageHandling] Failed to create session:', error);
        return { success: false, reason: 'session creation failed', error };
      }
    }

    // Create timestamp for message ordering
    const baseTimestamp = Date.now();

    // Create and add user message
    const userMessage = createUserMessage(messageContent, baseTimestamp);
    addMessage(sessionId, userMessage);

    // Scroll to show user message
    requestAnimationFrame(() => {
      const container = document.getElementById('chat-messages-container');
      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    });

    // Upload files to MinIO first, then reference them by id in the chat
    // payload. If the upload endpoint is unreachable, fall back to the inline
    // base64 path so the user still gets a response (at the cost of no
    // persistence for that turn). Surface upload errors to the caller.
    let fileRefs: SendMessageOptions['files'];
    if (files.length > 0) {
      try {
        const uploaded = await uploadFilesToApi(files);
        fileRefs = uploaded.map((u: UploadedFileRef) => ({
          id: u.id, name: u.name, type: u.type, size: u.size,
        }));
      } catch (uploadErr) {
        console.warn('[useMessageHandling] Upload failed, falling back to inline base64', uploadErr);
        fileRefs = await convertFilesToBase64(files);
      }
    }

    // Clear old streaming state
    clearStreamingState(sessionId);

    // Create assistant placeholder
    const assistantPlaceholder = createAssistantPlaceholder(baseTimestamp);
    addMessage(sessionId, assistantPlaceholder);
    streamingPlaceholderIdRef.current = assistantPlaceholder.id;

    // Track when message was sent
    lastMessageSentRef.current = Date.now();

    // Notify callback
    onMessageSent?.();

    // Send via SSE
    try {
      setStreamingStatus('streaming');
      const result = await sendSSEMessage(messageContent, {
        ...sendOptions,
        files: fileRefs && fileRefs.length > 0 ? fileRefs : undefined
      });
      return { success: true, result };
    } catch (error) {
      console.error('[useMessageHandling] Failed to send message:', error);
      setStreamingStatus('error');
      return { success: false, reason: 'send failed', error };
    }
  }, [
    activeSessionId,
    isStreaming,
    sendSSEMessage,
    createNewSession,
    addMessage,
    createUserMessage,
    createAssistantPlaceholder,
    convertFilesToBase64,
    clearStreamingState,
    onMessageSent
  ]);

  // Update streaming placeholder with content
  const updateStreamingPlaceholder = useCallback((content: string, mcpCalls?: any[], metadata?: any, model?: string) => {
    if (!activeSessionId || !streamingPlaceholderIdRef.current) return;

    updateMessage(
      activeSessionId,
      streamingPlaceholderIdRef.current,
      content,
      mcpCalls,
      metadata,
      model
    );
  }, [activeSessionId, updateMessage]);

  // Finalize streaming placeholder
  const finalizeStreamingMessage = useCallback(() => {
    if (!activeSessionId || !streamingPlaceholderIdRef.current) return;

    finishStreamingMessage(activeSessionId, streamingPlaceholderIdRef.current);
    streamingPlaceholderIdRef.current = null;
    setStreamingStatus('idle');
  }, [activeSessionId, finishStreamingMessage]);

  // Get current placeholder ID
  const getStreamingPlaceholderId = useCallback(() => {
    return streamingPlaceholderIdRef.current;
  }, []);

  return {
    // State
    streamingStatus,
    streamingPlaceholderIdRef,
    lastMessageSentRef,

    // Actions
    sendMessage,
    updateStreamingPlaceholder,
    finalizeStreamingMessage,
    clearStreamingState,
    getStreamingPlaceholderId,
    setStreamingStatus,

    // Utilities
    convertFilesToBase64,
    createUserMessage,
    createAssistantPlaceholder
  };
};

export default useMessageHandling;
