/**
 * Admin AI SSE hook — drives the in-product help bar (#73).
 *
 * Mirror of useDocsChat but scoped to the admin console:
 *   - POSTs to /api/admin/ai/ask with { message, sessionId, currentSection, conversationHistory }
 *   - Parses SSE: completion_start (model), content (token), suggestions, done
 *   - Calls onModel/onToken/onSuggestions/onDone/onError
 *   - stopStreaming() aborts and finalizes accumulated content
 */

import { useCallback, useRef } from 'react';
import { apiEndpoint } from '@/utils/api';

interface UseAdminAiOptions {
  onToken: (token: string) => void;
  onDone: (fullContent: string) => void;
  onSuggestions: (suggestions: string[]) => void;
  onError: (error: string) => void;
  onModel?: (model: string) => void;
}

interface SendMessageParams {
  message: string;
  sessionId: string;
  currentSection: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function useAdminAi({ onToken, onDone, onSuggestions, onError, onModel }: UseAdminAiOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const accumulatedRef = useRef('');

  const sendMessage = useCallback(async (params: SendMessageParams) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    accumulatedRef.current = '';
    let doneHandled = false;

    const token = localStorage.getItem('auth_token');
    const url = apiEndpoint('/admin/ai/ask');

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
        const text = await response.text().catch(() => '');
        onError(text || `HTTP ${response.status}`);
        return;
      }
      if (!response.body) {
        onError('No response body');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

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
                onError(parsed.message || 'stream error');
              }
            } catch {
              /* ignore malformed JSON */
            }
            eventType = '';
          }
        }
      }

      // Stream ended without an explicit `done` event — finalize anyway.
      if (!doneHandled) {
        doneHandled = true;
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
