/**
 * DocsChatPanel — Right panel of the documentation viewer
 *
 * Embedded AI chat assistant that answers questions about OpenAgentic
 * using the documentation content as context. Features:
 * - SSE streaming responses
 * - Context-aware (knows current doc page)
 * - Quick suggestion chips
 * - Deep links to doc sections (docs:// protocol)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDocsChat } from '../hooks/useDocsChat';
import { nanoid } from 'nanoid';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** URL transform for ReactMarkdown — allows docs:// protocol for in-app navigation */
const urlTransform = (url: string): string => {
  if (url.startsWith('docs://')) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) return url;
  if (url.startsWith('data:')) return url;
  return '';
};

interface DocsChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
}

interface DocsChatPanelProps {
  currentDomain: string | null;
  currentSectionId: string | null;
  onNavigate: (domain: string, sectionId?: string) => void;
}

const DocsChatPanel: React.FC<DocsChatPanelProps> = ({
  currentDomain,
  currentSectionId,
  onNavigate,
}) => {
  const [messages, setMessages] = useState<DocsChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([
    'What can OpenAgentic do?',
    'How do agents work?',
    'What MCP tools are available?',
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const currentModelRef = useRef<string | null>(null);
  const sessionIdRef = useRef(nanoid());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, stopStreaming } = useDocsChat({
    onToken: useCallback((token: string) => {
      setStreamingContent(prev => prev + token);
    }, []),
    onModel: useCallback((model: string) => {
      setCurrentModel(model);
      currentModelRef.current = model;
    }, []),
    onDone: useCallback((fullContent: string) => {
      // Check for lockout signal from the agent
      const hasLockout = fullContent.includes('[LOCKOUT]');
      const cleanContent = fullContent.replace(/\[LOCKOUT\]/g, '').trim();

      setMessages(prev => [...prev, {
        id: nanoid(),
        role: 'assistant',
        content: cleanContent,
        model: currentModelRef.current || undefined,
      }]);
      setStreamingContent('');
      setIsStreaming(false);

      if (hasLockout) {
        // Delay the lockout so the user can read the message
        setTimeout(() => setIsLockedOut(true), 3000);
      }
    }, []),
    onSuggestions: useCallback((newSuggestions: string[]) => {
      setSuggestions(newSuggestions);
    }, []),
    onError: useCallback((errMsg: string) => {
      setError(errMsg);
      setIsStreaming(false);
      setStreamingContent('');
    }, []),
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = useCallback(async (text?: string) => {
    const msg = text || inputValue.trim();
    if (!msg || isStreaming || isLockedOut) return;

    setInputValue('');
    setError(null);
    setIsStreaming(true);
    setStreamingContent('');

    // Add user message
    setMessages(prev => [...prev, {
      id: nanoid(),
      role: 'user',
      content: msg,
    }]);

    // Build conversation history (last 10 messages)
    const history = messages.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
    }));

    await sendMessage({
      message: msg,
      sessionId: sessionIdRef.current,
      currentPageId: currentDomain || 'overview',
      conversationHistory: history,
    });
  }, [inputValue, isStreaming, messages, currentDomain, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Custom link renderer — handles docs:// navigation links and external URLs
  const renderLink = ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    // Handle docs:// protocol links (internal navigation)
    if (href && (href.startsWith('docs://') || href.includes('docs://'))) {
      const docsPath = href.replace(/.*docs:\/\//, '');
      const parts = docsPath.split('/');
      const domain = parts[0];
      const sectionId = parts[1];
      return (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onNavigate(domain, sectionId);
          }}
          style={{
            color: 'var(--color-primary)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontWeight: 500,
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            display: 'inline',
            fontSize: 'inherit',
            fontFamily: 'inherit',
          }}
        >
          {children}
        </button>
      );
    }
    // External links
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{ color: 'var(--color-primary)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
      >
        {children}
      </a>
    );
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        borderLeft: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-background)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="docsChatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--color-primary)" />
              <stop offset="100%" stopColor="var(--user-accent-secondary)" />
            </linearGradient>
          </defs>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="url(#docsChatGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Docs Assistant
        </span>
        {isStreaming && (
          <div className="ml-auto flex gap-1">
            {[0, 1, 2].map(i => (
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
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-hide">
        {messages.length === 0 && !streamingContent && (
          <div className="text-center py-8">
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none" className="mx-auto mb-3">
              <defs>
                <linearGradient id="docsWelcomeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--color-primary)" />
                  <stop offset="100%" stopColor="var(--user-accent-secondary)" />
                </linearGradient>
              </defs>
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" stroke="url(#docsWelcomeGrad)" strokeWidth="2" />
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" stroke="url(#docsWelcomeGrad)" strokeWidth="2" />
            </svg>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Ask me anything
            </p>
            <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
              about OpenAgentic
            </p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {messages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className="max-w-[85%] rounded-xl px-3 py-2 text-sm"
                style={
                  msg.role === 'user'
                    ? {
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        borderBottomRightRadius: '4px',
                      }
                    : {
                        backgroundColor: 'var(--color-surfaceSecondary)',
                        color: 'var(--color-text)',
                        borderBottomLeftRadius: '4px',
                      }
                }
              >
                {msg.role === 'assistant' && msg.model && (
                  <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                    {msg.model}
                  </div>
                )}
                {msg.role === 'assistant' ? (
                  <div className="docs-chat-md max-w-none text-[13px] leading-relaxed" style={{ color: 'var(--color-text)' }}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      urlTransform={urlTransform}
                      components={{
                        a: renderLink as any,
                        p: ({ children }) => <p style={{ margin: '0.4em 0' }}>{children}</p>,
                        ul: ({ children }) => <ul style={{ margin: '0.4em 0', paddingLeft: '1.2em' }}>{children}</ul>,
                        ol: ({ children }) => <ol style={{ margin: '0.4em 0', paddingLeft: '1.2em' }}>{children}</ol>,
                        li: ({ children }) => <li style={{ margin: '0.2em 0' }}>{children}</li>,
                        strong: ({ children }) => <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{children}</strong>,
                        code: ({ children, className }) => className ? (
                          <code className={className} style={{ fontSize: '12px', padding: '2px 4px', borderRadius: '4px', backgroundColor: 'var(--color-surfaceSecondary)' }}>{children}</code>
                        ) : (
                          <code style={{ fontSize: '12px', padding: '1px 4px', borderRadius: '3px', backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-primary)' }}>{children}</code>
                        ),
                        h3: ({ children }) => <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0.8em 0 0.3em', color: 'var(--color-text)' }}>{children}</h3>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Streaming content */}
        {streamingContent && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div
              className="max-w-[85%] rounded-xl px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                color: 'var(--color-text)',
                borderBottomLeftRadius: '4px',
              }}
            >
              {currentModel && (
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                  {currentModel}
                </div>
              )}
              <div className="docs-chat-md max-w-none text-[13px] leading-relaxed" style={{ color: 'var(--color-text)' }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={urlTransform}
                  components={{
                    a: renderLink as any,
                    p: ({ children }) => <p style={{ margin: '0.4em 0' }}>{children}</p>,
                    strong: ({ children }) => <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{children}</strong>,
                    code: ({ children }) => <code style={{ fontSize: '12px', padding: '1px 4px', borderRadius: '3px', backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-primary)' }}>{children}</code>,
                  }}
                >
                  {streamingContent}
                </ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}

        {/* Error */}
        {error && (
          <div
            className="text-xs text-center py-2 px-3 rounded-lg"
            style={{ backgroundColor: 'var(--color-error)', color: 'white', opacity: 0.9 }}
          >
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion Chips */}
      {messages.length === 0 && !isStreaming && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {suggestions.map((s, i) => (
            <motion.button
              key={i}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => handleSend(s)}
              className="text-xs px-3 py-1.5 rounded-full transition-colors"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                color: 'var(--color-textSecondary)',
                border: '1px solid var(--color-border)',
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {s}
            </motion.button>
          ))}
        </div>
      )}

      {/* Post-response suggestions */}
      {messages.length > 0 && !isStreaming && suggestions.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {suggestions.slice(0, 3).map((s, i) => (
            <button
              key={i}
              onClick={() => handleSend(s)}
              className="text-xs px-3 py-1.5 rounded-full transition-colors"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                color: 'var(--color-textSecondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div
        className="px-4 py-3 flex-shrink-0"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        {isLockedOut ? (
          <div
            className="text-center py-2 px-3 rounded-xl text-xs"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              color: 'var(--color-textMuted)',
              border: '1px solid var(--color-border)',
            }}
          >
            Assistant paused. Refresh to try again.
          </div>
        ) : (
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about OpenAgentic..."
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none"
            style={{
              color: 'var(--color-text)',
              maxHeight: '80px',
            }}
          />
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="p-1.5 rounded-lg transition-colors flex-shrink-0"
              style={{ color: 'var(--color-error)' }}
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
              style={{
                color: inputValue.trim() ? 'var(--color-primary)' : 'var(--color-textMuted)',
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

export default DocsChatPanel;
