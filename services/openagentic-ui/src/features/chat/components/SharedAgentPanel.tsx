/**
 * SharedAgentPanel — ONE left slide-out agent drawer shared by the docs
 * agent and the admin agent.
 *
 * Both surfaces (docs assistant + admin assistant) previously had their
 * own bespoke chat UI: the docs panel was an embedded right column using
 * basic ReactMarkdown, the admin agent was a bottom-right dock that
 * ACCUMULATED the full answer before showing it (no live streaming).
 *
 * This component unifies them:
 *   - LEFT slide-out drawer (fixed overlay, Esc-to-close, scrim).
 *   - ASSISTANT messages render through the chat-grade
 *     `SharedMarkdownRenderer` (Shiki / KaTeX / tables / diagrams /
 *     images) — the exact renderer the main chat transcript uses.
 *   - USER messages render plain.
 *   - A unified SSE consumer (generalized from `useDocsChat`) that streams
 *     `content` deltas live and parses `completion_start` / `content` /
 *     `suggestions` / `done` / `error` events.
 *   - Suggestion chips, an input with Enter-to-send, suggestion refresh,
 *     and a stop button while streaming.
 *
 * It is DELIBERATELY OFF the main chat pipeline — it POSTs directly to its
 * own `endpoint` (e.g. `/api/docs/chat` or `/api/admin/ai/ask`), each of
 * which is its own RAG-backed route. It never touches the chat store, the
 * chat stream engine, or the chat session lifecycle.
 *
 * Tokens only (`var(--color-*)` / `var(--glass-*)`) — no hardcoded colors.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import { SharedMarkdownRenderer } from '@/features/chat/components/MessageContent/SharedMarkdownRenderer';
import { useTheme } from '@/contexts/ThemeContext';

export interface SharedAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
}

export interface SharedAgentPanelProps {
  /** Controlled open state. */
  open: boolean;
  /** Open-state setter. */
  onOpenChange: (next: boolean) => void;
  /**
   * The RAG-backed SSE endpoint this panel POSTs to. Already-prefixed
   * (e.g. `/api/docs/chat`, `/api/admin/ai/ask`). The panel hits this
   * directly — it is NOT routed through the main chat pipeline.
   */
  endpoint: string;
  /** Panel title shown in the header. */
  title: string;
  /** Optional starter suggestion chips. */
  suggestions?: string[];
  /**
   * Optional navigation callback. Invoked when the assistant emits an
   * in-app deep link (the docs `docs://domain/section` form, or a bare
   * `#slug` admin anchor). The host decides what the link means.
   */
  onNavigate?: (target: string) => void;
  /** Optional placeholder for the input. */
  placeholder?: string;
  /**
   * Extra fields merged into the POST body. Lets each host pass the
   * route-specific context (e.g. `currentPageId`, `currentSection`).
   * `message`, `sessionId`, and `conversationHistory` are always sent.
   */
  buildContext?: () => Record<string, unknown>;
}

interface StreamHandlers {
  onToken: (token: string) => void;
  onModel: (model: string) => void;
  onSuggestions: (s: string[]) => void;
  onDone: (full: string) => void;
  onError: (msg: string) => void;
}

/**
 * Generalized SSE consumer. Mirrors `useDocsChat`'s event parse exactly —
 * `completion_start` (model), `content` (token delta), `suggestions`,
 * `done`, `error` — but accepts an arbitrary endpoint + body so BOTH the
 * docs and admin routes flow through one code path. Streams `content`
 * deltas live (the admin dock's old accumulate-then-show behavior is gone).
 */
async function streamAgent(
  endpoint: string,
  body: Record<string, unknown>,
  controller: AbortController,
  handlers: StreamHandlers,
): Promise<void> {
  const accumulated = { value: '' };
  let doneHandled = false;
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('No response body');

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
              handlers.onModel(parsed.model);
            } else if (eventType === 'content' && parsed.content) {
              accumulated.value += parsed.content;
              handlers.onToken(parsed.content);
            } else if (eventType === 'suggestions' && parsed.suggestions) {
              handlers.onSuggestions(parsed.suggestions);
            } else if (eventType === 'done') {
              if (!doneHandled) {
                doneHandled = true;
                handlers.onDone(accumulated.value);
              }
            } else if (eventType === 'error') {
              handlers.onError(parsed.message || 'Unknown error');
            }
            // `ping` events are no-ops — they just keep the stream alive.
          } catch {
            // Ignore malformed JSON.
          }
          eventType = '';
        }
      }
    }

    if (!doneHandled && accumulated.value) {
      handlers.onDone(accumulated.value);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return;
    handlers.onError(err instanceof Error ? err.message : 'Connection failed');
  }
}

const DEFAULT_SUGGESTIONS: string[] = [];

export const SharedAgentPanel: React.FC<SharedAgentPanelProps> = ({
  open,
  onOpenChange,
  endpoint,
  title,
  suggestions: initialSuggestions = DEFAULT_SUGGESTIONS,
  onNavigate,
  placeholder = 'Ask a question…',
  buildContext,
}) => {
  const { theme } = useTheme() as { theme?: string };
  const resolvedTheme: 'light' | 'dark' = theme === 'light' ? 'light' : 'dark';

  const [messages, setMessages] = useState<SharedAgentMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(initialSuggestions);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef(nanoid());
  const abortRef = useRef<AbortController | null>(null);
  const currentModelRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the starter suggestions in sync if the host swaps them.
  useEffect(() => {
    if (messages.length === 0) setSuggestions(initialSuggestions);
  }, [initialSuggestions, messages.length]);

  // Esc-to-close + focus the input on open.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  // Abort any in-flight stream when the panel closes.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingContent((cur) => {
      if (cur) {
        setMessages((prev) => [
          ...prev,
          { id: nanoid(), role: 'assistant', content: cur, model: currentModelRef.current || undefined },
        ]);
      }
      return '';
    });
    setIsStreaming(false);
  }, []);

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? inputValue).trim();
      if (!msg || isStreaming) return;

      setInputValue('');
      setError(null);
      setIsStreaming(true);
      setStreamingContent('');
      setCurrentModel(null);
      currentModelRef.current = null;

      setMessages((prev) => [...prev, { id: nanoid(), role: 'user', content: msg }]);

      // Conversation history (last 10) — same window the docs hook used.
      const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      const body: Record<string, unknown> = {
        message: msg,
        sessionId: sessionIdRef.current,
        conversationHistory: history,
        ...(buildContext ? buildContext() : {}),
      };

      await streamAgent(endpoint, body, controller, {
        onToken: (tok) => setStreamingContent((prev) => prev + tok),
        onModel: (model) => {
          setCurrentModel(model);
          currentModelRef.current = model;
        },
        onSuggestions: (s) => setSuggestions(s),
        onDone: (full) => {
          const clean = full.replace(/\[LOCKOUT\]/g, '').trim();
          if (clean) {
            setMessages((prev) => [
              ...prev,
              { id: nanoid(), role: 'assistant', content: clean, model: currentModelRef.current || undefined },
            ]);
          }
          setStreamingContent('');
          setIsStreaming(false);
          abortRef.current = null;
        },
        onError: (errMsg) => {
          setError(errMsg);
          setStreamingContent('');
          setIsStreaming(false);
          abortRef.current = null;
        },
      });
    },
    [inputValue, isStreaming, messages, endpoint, buildContext],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Intercept clicks on in-app deep links inside assistant answers and
  // route them through `onNavigate`. Supports the docs `docs://` form and
  // bare `#slug` admin anchors (both emitted by their respective agents).
  const handleTranscriptClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onNavigate) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const raw = (anchor.getAttribute('href') || '').trim();
      if (!raw) return;
      if (raw.includes('docs://')) {
        e.preventDefault();
        e.stopPropagation();
        onNavigate(raw.replace(/.*docs:\/\//, ''));
        return;
      }
      const bare = raw.match(/^#([a-z][a-z0-9-]*)$/i);
      if (bare) {
        e.preventDefault();
        e.stopPropagation();
        onNavigate(bare[1]);
      }
    },
    [onNavigate],
  );

  const hasConversation = messages.length > 0 || isStreaming || !!streamingContent;
  const visibleSuggestions = useMemo(() => suggestions.slice(0, 4), [suggestions]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => onOpenChange(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'color-mix(in srgb, var(--color-background, #000) 55%, transparent)',
              backdropFilter: 'blur(2px)',
              zIndex: 1200,
            }}
          />

          {/* Right slide-out drawer */}
          <motion.aside
            role="dialog"
            aria-label={title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(460px, 94vw)',
              zIndex: 1201,
              background: 'var(--glass-bg)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              borderLeft: '1px solid var(--glass-border)',
              boxShadow: '24px 0 70px -24px color-mix(in srgb, var(--color-background, #000) 80%, transparent)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--glass-border)' }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--color-success, var(--color-primary))',
                  boxShadow: '0 0 6px var(--color-success, var(--color-primary))',
                }}
              />
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {title}
              </span>
              {isStreaming && (
                <div className="flex gap-1 ml-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: 'var(--color-primary)' }}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
              )}
              <button
                onClick={() => onOpenChange(false)}
                className="ml-auto p-1.5 rounded-md transition-colors hover:bg-[var(--ctl-surf-hover)]"
                style={{ color: 'var(--color-textMuted)' }}
                aria-label="Close (Esc)"
                title="Close (Esc)"
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Transcript */}
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-hide"
              onClickCapture={handleTranscriptClick}
            >
              {!hasConversation && (
                <div className="text-center py-10">
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                    Ask me anything
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                    {title}
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'user' ? (
                    <div
                      className="max-w-[85%] px-3 py-2 text-sm glass-bubble-user"
                      style={{ color: 'var(--color-fg)' }}
                    >
                      {msg.content}
                    </div>
                  ) : (
                    <div
                      className="max-w-[92%] px-3 py-2"
                      style={{
                        backgroundColor: 'var(--ctl-surf)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--color-text)',
                        borderRadius: '16px 16px 16px 5px',
                        boxShadow: '0 1px 0 var(--ctl-edge) inset',
                      }}
                    >
                      {msg.model && (
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: 'var(--color-text-tertiary)',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
                          {msg.model}
                        </div>
                      )}
                      <SharedMarkdownRenderer content={msg.content} theme={resolvedTheme} />
                    </div>
                  )}
                </div>
              ))}

              {/* Live streaming bubble — rendered with the chat-grade renderer. */}
              {(isStreaming || streamingContent) && (
                <div className="flex justify-start">
                  <div
                    className="max-w-[92%] px-3 py-2"
                    style={{
                      backgroundColor: 'var(--ctl-surf)',
                      border: '1px solid var(--glass-border)',
                      color: 'var(--color-text)',
                      borderRadius: '16px 16px 16px 5px',
                      boxShadow: '0 1px 0 var(--ctl-edge) inset',
                    }}
                  >
                    {currentModel && (
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'var(--color-text-tertiary)',
                          marginBottom: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
                        {currentModel}
                      </div>
                    )}
                    {streamingContent ? (
                      <SharedMarkdownRenderer content={streamingContent} theme={resolvedTheme} isStreaming />
                    ) : (
                      <div className="flex gap-1 py-1" aria-label="thinking">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: 'var(--color-textMuted)' }}
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div
                  className="text-xs text-center py-2 px-3 rounded-lg"
                  style={{ backgroundColor: 'var(--color-error)', color: 'var(--color-on-accent, #fff)', opacity: 0.95 }}
                >
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggestion chips */}
            {!isStreaming && visibleSuggestions.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2 flex-shrink-0">
                {visibleSuggestions.map((s, i) => (
                  <button
                    key={`${s}-${i}`}
                    onClick={() => handleSend(s)}
                    className="glass-chip text-xs px-3 py-1.5 rounded-full"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--glass-border)' }}>
              <div className="glass-field flex items-end gap-2 px-3 py-2" style={{ width: 'auto' }}>
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  rows={1}
                  className="flex-1 bg-transparent text-sm resize-none outline-none"
                  style={{ color: 'var(--color-text)', maxHeight: '96px' }}
                />
                {isStreaming ? (
                  <button
                    onClick={stopStreaming}
                    className="p-1.5 rounded-lg transition-colors flex-shrink-0"
                    style={{ color: 'var(--color-error)' }}
                    aria-label="Stop"
                  >
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim()}
                    className="p-1.5 rounded-lg transition-colors flex-shrink-0"
                    style={{ color: inputValue.trim() ? 'var(--color-primary)' : 'var(--color-textMuted)' }}
                    aria-label="Send"
                  >
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

export default SharedAgentPanel;
