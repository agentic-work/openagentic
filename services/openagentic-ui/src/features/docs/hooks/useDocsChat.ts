/**
 * Docs Chat SSE Hook
 *
 * Lightweight SSE streaming hook for the documentation assistant.
 * Sends questions to /api/docs/chat and streams responses token-by-token.
 */

import { useCallback, useRef } from 'react';
import { apiEndpoint } from '@/utils/api';
import { nanoid } from 'nanoid';

interface UseDocsChatOptions {
  onToken: (token: string) => void;
  onDone: (fullContent: string) => void;
  onSuggestions: (suggestions: string[]) => void;
  onError: (error: string) => void;
  onModel?: (model: string) => void;
}

interface SendMessageParams {
  message: string;
  sessionId: string;
  currentPageId: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function useDocsChat({ onToken, onDone, onSuggestions, onError, onModel }: UseDocsChatOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const accumulatedRef = useRef('');

  const sendMessage = useCallback(async (params: SendMessageParams) => {
    // Abort any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    accumulatedRef.current = '';
    let doneHandled = false;

    const token = localStorage.getItem('auth_token');
    const url = apiEndpoint('/docs/chat');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete last line

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);

              if (eventType === 'completion_start' && parsed.model) {
                onModel?.(parsed.model);
              } else if (eventType === 'content' && parsed.content) {
                accumulatedRef.current += parsed.content;
                onToken(parsed.content);
              } else if (eventType === 'suggestions' && parsed.suggestions) {
                onSuggestions(parsed.suggestions);
              } else if (eventType === 'done') {
                if (!doneHandled) {
                  doneHandled = true;
                  onDone(accumulatedRef.current);
                }
              } else if (eventType === 'error') {
                onError(parsed.message || 'Unknown error');
              }
            } catch {
              // Ignore malformed JSON
            }
            eventType = '';
          }
        }
      }

      // Stream ended — finalize only if done event wasn't received
      if (!doneHandled && accumulatedRef.current) {
        onDone(accumulatedRef.current);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      onError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [onToken, onDone, onSuggestions, onError, onModel]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (accumulatedRef.current) {
      onDone(accumulatedRef.current);
    }
  }, [onDone]);

  return { sendMessage, stopStreaming };
}
