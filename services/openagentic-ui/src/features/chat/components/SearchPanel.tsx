/**
 * AI-Powered Search Panel
 * Gemini-style search interface for chat sessions
 * Features: AI summaries, highlighted snippets, semantic search
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Clock, MessageSquare, Loader2, Sparkles } from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';
import { loggers } from '@/utils/logger';

interface SearchResult {
  sessionId: string;
  title: string;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
  summary?: string; // AI-generated summary
  snippets?: Array<{
    content: string;
    messageRole: 'user' | 'assistant';
    timestamp: string;
    highlights: string[]; // Highlighted portions
  }>;
  relevanceScore?: number;
}

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect: (sessionId: string) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  isOpen,
  onClose,
  onSessionSelect
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGeneratingSummaries, setIsGeneratingSummaries] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { getAuthHeaders } = useAuth();

  // Focus search input when panel opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Clear results when panel closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setResults([]);
    }
  }, [isOpen]);

  /**
   * Format timestamp for display
   */
  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffMs < 60000) return 'Just now';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
    if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  /**
   * Highlight search terms in text
   */
  const highlightText = (text: string, highlights: string[]): JSX.Element => {
    if (!highlights || highlights.length === 0) {
      return <span>{text}</span>;
    }

    // Create a regex pattern for all highlights
    const pattern = highlights.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`(${pattern})`, 'gi');

    const parts = text.split(regex);

    return (
      <>
        {parts.map((part, index) => {
          const isHighlight = highlights.some(h =>
            part.toLowerCase() === h.toLowerCase()
          );

          return isHighlight ? (
            <mark
              key={index}
              className="px-1 rounded"
              style={{
                backgroundColor: 'var(--user-accent-primary)',
                color: 'var(--color-text)',
                opacity: 0.9
              }}
            >
              {part}
            </mark>
          ) : (
            <span key={index}>{part}</span>
          );
        })}
      </>
    );
  };

  /**
   * Perform search with AI summaries
   */
  const performSearch = useCallback(async (query: string) => {
    if (!query || query.trim().length === 0) {
      setResults([]);
      return;
    }

    setIsSearching(true);

    try {
      const authHeaders = await getAuthHeaders();

      // Step 1: Fast keyword search
      const searchResponse = await fetch(
        apiEndpoint(`/chat/sessions/search?q=${encodeURIComponent(query.trim())}&limit=10`),
        {
          headers: authHeaders
        }
      );

      if (!searchResponse.ok) {
        throw new Error('Search failed');
      }

      const searchData = await searchResponse.json();
      const sessions = searchData.sessions || [];

      // Display initial results without summaries
      const initialResults: SearchResult[] = sessions.map((session: any) => ({
        sessionId: session.id,
        title: session.title || 'Untitled Chat',
        messageCount: session.messageCount || 0,
        updatedAt: session.updatedAt || session.updated_at,
        createdAt: session.createdAt || session.created_at,
        relevanceScore: 1.0
      }));

      setResults(initialResults);
      setIsSearching(false);

      // Step 2: Generate AI summaries in the background
      if (sessions.length > 0) {
        setIsGeneratingSummaries(true);

        // Generate summaries for each session (in parallel, limit to 5 at a time)
        const summariesPromises = sessions.slice(0, 5).map(async (session: any) => {
          try {
            // Fetch session details with messages
            const sessionResponse = await fetch(
              apiEndpoint(`/chat/sessions/${session.id}`),
              { headers: authHeaders }
            );

            if (!sessionResponse.ok) return null;

            const sessionData = await sessionResponse.json();
            const messages = sessionData.session?.messages || [];

            // Generate summary using AI
            const summaryResponse = await fetch(
              apiEndpoint('/chat/streaming'),
              {
                method: 'POST',
                headers: {
                  ...authHeaders,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  messages: [
                    {
                      role: 'system',
                      content: 'You are a helpful assistant that creates concise summaries of conversations. Summarize the following conversation in 1-2 sentences, focusing on the main topic and key points discussed.'
                    },
                    {
                      role: 'user',
                      content: `Summarize this conversation:\n\n${messages.slice(0, 10).map((m: any) => `${m.role}: ${m.content}`).join('\n')}`
                    }
                  ],
                  sessionId: `search_summary_${Date.now()}`,
                  stream: false
                })
              }
            );

            if (!summaryResponse.ok) return null;

            const summaryData = await summaryResponse.json();
            const summary = summaryData.message?.content || '';

            // Find snippets containing search term
            const searchTermLower = query.toLowerCase();
            const snippets = messages
              .filter((m: any) =>
                m.content && m.content.toLowerCase().includes(searchTermLower)
              )
              .slice(0, 2)
              .map((m: any) => {
                const content = m.content.substring(0, 200);
                return {
                  content,
                  messageRole: m.role,
                  timestamp: m.timestamp || m.created_at,
                  highlights: [query.trim()]
                };
              });

            return {
              sessionId: session.id,
              summary,
              snippets
            };

          } catch (error) {
            loggers.chat.error('Failed to generate summary', { error, sessionId: session.id });
            return null;
          }
        });

        const summaries = await Promise.all(summariesPromises);

        // Update results with summaries
        setResults(prevResults =>
          prevResults.map(result => {
            const summaryData = summaries.find(s => s?.sessionId === result.sessionId);
            if (summaryData) {
              return {
                ...result,
                summary: summaryData.summary,
                snippets: summaryData.snippets
              };
            }
            return result;
          })
        );

        setIsGeneratingSummaries(false);
      }

    } catch (error) {
      loggers.chat.error('Search error', { error, query });
      setIsSearching(false);
      setIsGeneratingSummaries(false);
    }
  }, [getAuthHeaders]);

  /**
   * Handle search input with debounce
   */
  const handleSearchInput = (value: string) => {
    setSearchQuery(value);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(value);
    }, 500);
  };

  /**
   * Handle session selection
   */
  const handleSessionClick = (sessionId: string) => {
    onSessionSelect(sessionId);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[2000]"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--cm-text) 50%, transparent)',
              backdropFilter: 'blur(4px)'
            }}
          />

          {/* Search Panel */}
          <motion.div
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -400, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-0 top-0 h-full z-[2001] w-[450px] flex flex-col"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderRight: '1px solid var(--color-border)',
              boxShadow: '4px 0 24px color-mix(in srgb, var(--cm-text) 30%, transparent)'
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-6 py-4 border-b"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <Search size={24} style={{ color: 'var(--user-accent-primary)' }} />
              <h2
                className="text-lg font-semibold flex-1"
                style={{ color: 'var(--color-text)' }}
              >
                Search Conversations
              </h2>
              <motion.button
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-opacity-10"
                style={{ color: 'var(--color-textSecondary)' }}
              >
                <X size={20} />
              </motion.button>
            </div>

            {/* Search Input */}
            <div className="px-6 py-4">
              <div className="relative">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 transform -translate-y-1/2"
                  style={{ color: 'var(--color-textMuted)' }}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder="Search across all your conversations..."
                  className="w-full pl-10 pr-4 py-3 text-sm rounded-xl transition-all focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text)',
                    borderColor: 'var(--color-border)',
                    border: '1px solid'
                  }}
                />
                {isSearching && (
                  <Loader2
                    size={18}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 animate-spin"
                    style={{ color: 'var(--user-accent-primary)' }}
                  />
                )}
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {searchQuery && results.length === 0 && !isSearching && (
                <div className="text-center py-12">
                  <Search size={48} className="mx-auto mb-4 opacity-30" />
                  <p style={{ color: 'var(--color-textSecondary)' }}>
                    No conversations found
                  </p>
                </div>
              )}

              {isGeneratingSummaries && results.length > 0 && (
                <div
                  className="flex items-center gap-2 px-4 py-2 rounded-lg mb-4"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)'
                  }}
                >
                  <Sparkles size={16} style={{ color: 'var(--user-accent-primary)' }} />
                  <span
                    className="text-sm flex-1"
                    style={{ color: 'var(--color-textSecondary)' }}
                  >
                    Generating AI summaries...
                  </span>
                  <Loader2
                    size={16}
                    className="animate-spin"
                    style={{ color: 'var(--user-accent-primary)' }}
                  />
                </div>
              )}

              <div className="space-y-3">
                {results.map((result, index) => (
                  <motion.div
                    key={result.sessionId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ scale: 1.02 }}
                    onClick={() => handleSessionClick(result.sessionId)}
                    className="p-4 rounded-xl cursor-pointer transition-all"
                    style={{
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      boxShadow: '0 2px 8px color-mix(in srgb, var(--cm-text) 10%, transparent)'
                    }}
                  >
                    {/* Title */}
                    <h3
                      className="font-semibold mb-2"
                      style={{ color: 'var(--color-text)' }}
                    >
                      {highlightText(result.title, [searchQuery.trim()])}
                    </h3>

                    {/* AI Summary */}
                    {result.summary && (
                      <div className="flex items-start gap-2 mb-3">
                        <Sparkles
                          size={14}
                          className="mt-1 flex-shrink-0"
                          style={{ color: 'var(--user-accent-primary)' }}
                        />
                        <p
                          className="text-sm leading-relaxed"
                          style={{ color: 'var(--color-textSecondary)' }}
                        >
                          {result.summary}
                        </p>
                      </div>
                    )}

                    {/* Snippets */}
                    {result.snippets && result.snippets.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {result.snippets.map((snippet, idx) => (
                          <div
                            key={idx}
                            className="text-xs p-2 rounded-lg"
                            style={{
                              backgroundColor: 'var(--color-surface)',
                              border: '1px solid var(--color-border)',
                              color: 'var(--color-textSecondary)'
                            }}
                          >
                            <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                              {snippet.messageRole === 'user' ? 'You' : 'AI'}:
                            </span>{' '}
                            {highlightText(snippet.content, snippet.highlights)}
                            {snippet.content.length >= 200 && '...'}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Metadata */}
                    <div
                      className="flex items-center gap-4 text-xs"
                      style={{ color: 'var(--color-textMuted)' }}
                    >
                      <span className="flex items-center gap-1">
                        <MessageSquare size={12} />
                        {result.messageCount} {result.messageCount === 1 ? 'message' : 'messages'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatTimestamp(result.updatedAt)}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default SearchPanel;
