/**
 * MemoryPanel - Sidebar section showing AI memory entries
 *
 * Displays what the AI remembers about the user across conversations:
 * - Session memory (current conversation context)
 * - Semantic memory (important facts and learnings)
 * - User memory (long-term preferences and history)
 * - Working memory (temporary context for current task)
 *
 * Features:
 * - Collapsible section with memory count badge
 * - Memory type icons and content preview
 * - Timestamp display
 * - Delete individual memories
 * - Auto-fetches from GET /api/user-memory/entries
 * */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronRight, ChevronDown, Trash2, Database, Loader2, AlertCircle } from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';

interface MemoryEntry {
  id: string;
  content: string;
  type: string; // 'session' | 'semantic' | 'user' | 'working' | 'explicit' | 'contextual' | 'inferred'
  importance: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

interface MemoryPanelProps {
  isExpanded: boolean;
  theme: string;
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  chat: 'Chat',
  manual: 'Manual',
  system: 'System',
  session: 'Session',
  semantic: 'Semantic',
  user: 'User',
  working: 'Working',
  explicit: 'Explicit',
  contextual: 'Context',
  inferred: 'Inferred',
};

const MEMORY_TYPE_COLORS: Record<string, string> = {
  chat: '#0A84FF',
  manual: '#22C55E',
  system: '#F97316',
  session: '#0A84FF',
  semantic: '#A855F7',
  user: '#22C55E',
  working: '#F97316',
  explicit: '#0A84FF',
  contextual: '#A855F7',
  inferred: '#FF375F',
};

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const MemoryPanel: React.FC<MemoryPanelProps> = ({ isExpanded, theme }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { getAccessToken } = useAuth();
  const hasFetchedRef = useRef(false);

  const fetchMemories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let token;
      try {
        token = await getAccessToken(['User.Read']);
      } catch {
        token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
      }

      if (!token) {
        setError('Not authenticated');
        setIsLoading(false);
        return;
      }

      const response = await fetch(apiEndpoint('/user-memory/entries?limit=20'), {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      // API returns { entries, total, limit, offset }
      // Map server field names (source, created_at, topics) to UI field names (type, createdAt, tags)
      const rawEntries: any[] = data.entries || [];
      const mapped: MemoryEntry[] = rawEntries.map((e: any) => ({
        id: e.id,
        content: e.content || '',
        type: e.source || 'user',
        importance: e.importance ?? 0.5,
        createdAt: e.created_at || e.createdAt || new Date().toISOString(),
        updatedAt: e.updated_at || e.updatedAt || e.created_at || new Date().toISOString(),
        tags: e.topics || e.tags || [],
        metadata: e.metadata,
      }));
      setMemories(mapped);
    } catch (err: any) {
      setError(err.message || 'Failed to load memories');
      setMemories([]);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  // Fetch memories when section is expanded for the first time
  useEffect(() => {
    if (!isCollapsed && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchMemories();
    }
  }, [isCollapsed, fetchMemories]);

  const deleteMemory = useCallback(async (memoryId: string) => {
    setDeletingId(memoryId);
    try {
      let token;
      try {
        token = await getAccessToken(['User.Read']);
      } catch {
        token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
      }

      if (!token) return;

      const response = await fetch(apiEndpoint(`/user-memory/entries/${memoryId}`), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setMemories(prev => prev.filter(m => m.id !== memoryId));
      }
    } catch (err) {
      console.error('[MemoryPanel] Failed to delete memory:', err);
    } finally {
      setDeletingId(null);
    }
  }, [getAccessToken]);

  // Don't render when sidebar is collapsed
  if (!isExpanded) return null;

  return (
    <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(prev => !prev)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {isCollapsed ? (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        ) : (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        )}
        <Brain size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
        <span className="text-xs font-medium uppercase tracking-wide flex-1">Memory</span>
        {memories.length > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)',
            }}
          >
            {memories.length}
          </span>
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 max-h-[280px] overflow-y-auto">
              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center justify-center py-4 gap-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Loading memories...
                  </span>
                </div>
              )}

              {/* Error state */}
              {error && !isLoading && (
                <div className="flex items-center gap-2 py-3 px-2">
                  <AlertCircle size={14} style={{ color: 'var(--color-error)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {error}
                  </span>
                  <button
                    onClick={() => {
                      hasFetchedRef.current = false;
                      fetchMemories();
                    }}
                    className="text-xs underline ml-auto"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Empty state */}
              {!isLoading && !error && memories.length === 0 && (
                <div className="flex flex-col items-center py-4 gap-1">
                  <Database size={18} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    No memories yet
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                    The AI will remember important context automatically
                  </span>
                </div>
              )}

              {/* Memory entries */}
              {!isLoading && memories.map(memory => (
                <motion.div
                  key={memory.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="group relative py-2 px-2 rounded-lg mb-1 transition-colors hover:bg-[var(--color-bg-secondary)]"
                >
                  {/* Type badge + content */}
                  <div className="flex items-start gap-2">
                    {/* Type indicator */}
                    <span
                      className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider"
                      style={{
                        background: `${MEMORY_TYPE_COLORS[memory.type] || '#666'}20`,
                        color: MEMORY_TYPE_COLORS[memory.type] || 'var(--color-text-muted)',
                        border: `1px solid ${MEMORY_TYPE_COLORS[memory.type] || '#666'}30`,
                      }}
                    >
                      {MEMORY_TYPE_LABELS[memory.type] || memory.type}
                    </span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs leading-relaxed line-clamp-2"
                        style={{ color: 'var(--color-text-secondary)' }}
                        title={memory.content}
                      >
                        {memory.content.length > 120
                          ? memory.content.substring(0, 120) + '...'
                          : memory.content}
                      </p>
                      <span className="text-[10px] mt-0.5 block" style={{ color: 'var(--color-text-muted)' }}>
                        {formatTimeAgo(memory.createdAt || memory.updatedAt)}
                      </span>
                    </div>

                    {/* Delete button (shown on hover) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMemory(memory.id);
                      }}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded transition-all hover:bg-[var(--color-bg-tertiary)]"
                      style={{ color: 'var(--color-text-muted)' }}
                      title="Delete memory"
                      disabled={deletingId === memory.id}
                    >
                      {deletingId === memory.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </button>
                  </div>

                  {/* Tags */}
                  {memory.tags && memory.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 ml-[42px]">
                      {memory.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="text-[9px] px-1 py-0.5 rounded"
                          style={{
                            background: 'var(--color-bg-tertiary)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Refresh button */}
              {!isLoading && memories.length > 0 && (
                <button
                  onClick={fetchMemories}
                  className="w-full text-center text-[10px] py-1.5 mt-1 rounded transition-colors hover:bg-[var(--color-bg-secondary)]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Refresh
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MemoryPanel;
