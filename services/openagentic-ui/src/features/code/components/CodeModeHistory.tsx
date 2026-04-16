/**
 * Code Mode History - Git-based timeline for workspace changes
 *
 * Fetches git log from the exec pod via code-manager proxy and renders
 * a vertical timeline. Supports expanding commits and reverting.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitCommit, RotateCcw, ChevronRight, Clock, Loader2, RefreshCw } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

interface CodeModeHistoryProps {
  sessionId?: string;
  theme?: 'light' | 'dark';
  onSendMessage?: (message: string) => void;
}

interface CommitEntry {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
  filesChanged?: number;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const CodeModeHistory: React.FC<CodeModeHistoryProps> = ({
  sessionId,
  theme = 'dark',
  onSendMessage,
}) => {
  const { getAuthHeaders } = useAuth();
  const isDark = theme === 'dark';

  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState<string | null>(null);
  const [revertingHash, setRevertingHash] = useState<string | null>(null);

  const execCommand = useCallback(async (command: string): Promise<string | null> => {
    if (!sessionId) return null;
    try {
      const response = await fetch(apiEndpoint(`/code/sessions/${sessionId}/exec`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ command }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.output ?? data.stdout ?? null;
    } catch {
      return null;
    }
  }, [sessionId, getAuthHeaders]);

  const fetchHistory = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);

    const output = await execCommand(
      "git log --oneline --format='%H|%s|%ai|%an' -50 2>/dev/null || echo 'NO_GIT'"
    );

    if (!output || output.trim() === 'NO_GIT' || output.trim() === '') {
      setCommits([]);
      setIsLoading(false);
      return;
    }

    const parsed: CommitEntry[] = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, message, date, author] = line.split('|');
        return {
          hash: hash?.trim() || '',
          shortHash: (hash?.trim() || '').slice(0, 7),
          message: message?.trim() || '(no message)',
          date: date?.trim() || '',
          author: author?.trim() || '',
        };
      })
      .filter((c) => c.hash.length > 0);

    setCommits(parsed);
    setIsLoading(false);
  }, [sessionId, execCommand]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleExpand = useCallback(async (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
      return;
    }
    setExpandedHash(hash);

    const entry = commits.find((c) => c.hash === hash);
    if (entry && entry.filesChanged === undefined) {
      setLoadingFiles(hash);
      const output = await execCommand(
        `git diff-tree --no-commit-id --name-only -r ${hash} 2>/dev/null | wc -l`
      );
      const count = parseInt(output?.trim() || '0', 10);
      setCommits((prev) =>
        prev.map((c) => (c.hash === hash ? { ...c, filesChanged: count } : c))
      );
      setLoadingFiles(null);
    }
  }, [expandedHash, commits, execCommand]);

  const handleRevert = useCallback((hash: string) => {
    if (!onSendMessage) return;
    setRevertingHash(hash);
    onSendMessage(`git checkout ${hash} -- .`);
    setTimeout(() => setRevertingHash(null), 2000);
  }, [onSendMessage]);

  const textPrimary = isDark ? 'text-[#e6edf3]' : 'text-gray-900';
  const textSecondary = isDark ? 'text-[#8b949e]' : 'text-gray-500';
  const textMuted = isDark ? 'text-[#6e7681]' : 'text-gray-400';
  const borderColor = isDark ? 'border-[#30363d]' : 'border-gray-200';
  const hoverBg = isDark ? 'hover:bg-[#21262d]' : 'hover:bg-gray-50';

  if (!sessionId) {
    return (
      <div className={`text-center py-8 px-4 ${textMuted}`}>
        <Clock size={24} className="mx-auto mb-2 opacity-50" />
        <p className="text-xs font-medium">No active session</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-12 ${textSecondary}`}>
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      {/* Header */}
      <div className={`flex items-center justify-between pb-2 ${textSecondary}`}>
        <span className="text-xs font-medium uppercase tracking-wider">Git History</span>
        <button
          onClick={fetchHistory}
          className={`p-1 rounded transition-colors ${hoverBg}`}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {error && (
        <div className={`text-xs p-2 mb-2 rounded ${isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600'}`}>
          {error}
        </div>
      )}

      {commits.length === 0 ? (
        <div className={`text-center py-8 ${textMuted}`}>
          <GitCommit size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-xs font-medium">No git history yet</p>
          <p className="text-[10px] mt-1 opacity-75">Commits will appear here once the workspace has a git repo</p>
          {onSendMessage && (
            <button
              onClick={() => onSendMessage('cd ~/workspace && git init && git add -A && git commit -m "Initial commit"')}
              className={`
                mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors
                ${isDark
                  ? 'bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d] border border-[#30363d]'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
                }
              `}
            >
              <GitCommit size={12} />
              Initialize Git
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div
            className={`absolute left-[9px] top-3 bottom-3 w-px ${isDark ? 'bg-[#30363d]' : 'bg-gray-200'}`}
          />

          {/* Current workspace marker */}
          <div className="relative flex items-center gap-3 pb-3">
            <div className="relative z-10 w-[18px] h-[18px] rounded-full bg-[#3fb950] flex items-center justify-center flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-white" />
            </div>
            <span className={`text-xs font-medium ${textPrimary}`}>Current workspace</span>
          </div>

          {/* Commit entries */}
          <div className="space-y-0.5">
            {commits.map((commit) => {
              const isExpanded = expandedHash === commit.hash;
              const isReverting = revertingHash === commit.hash;

              return (
                <div key={commit.hash} className="relative">
                  <motion.button
                    onClick={() => handleExpand(commit.hash)}
                    className={`
                      w-full flex items-start gap-3 py-2 px-0 rounded text-left transition-colors
                      ${hoverBg}
                    `}
                  >
                    {/* Node */}
                    <div className={`
                      relative z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
                      ${isDark ? 'bg-[#161b22] border border-[#30363d]' : 'bg-white border border-gray-300'}
                    `}>
                      <GitCommit size={10} className={textMuted} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className={`text-[11px] font-mono ${isDark ? 'text-[#58a6ff]' : 'text-blue-600'}`}>
                          {commit.shortHash}
                        </code>
                        <span className={`text-[10px] ${textMuted}`}>{relativeTime(commit.date)}</span>
                      </div>
                      <p className={`text-xs truncate mt-0.5 ${textPrimary}`}>{commit.message}</p>
                    </div>

                    {/* Expand indicator */}
                    <motion.div
                      animate={{ rotate: isExpanded ? 90 : 0 }}
                      transition={{ duration: 0.15 }}
                      className={`mt-1 flex-shrink-0 ${textMuted}`}
                    >
                      <ChevronRight size={12} />
                    </motion.div>
                  </motion.button>

                  {/* Expanded details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className={`ml-[30px] mb-2 p-2 rounded-lg border text-xs ${isDark ? 'bg-[#0d1117] border-[#21262d]' : 'bg-gray-50 border-gray-100'}`}>
                          <div className={`flex items-center gap-3 ${textSecondary}`}>
                            <span>by {commit.author}</span>
                            <span>
                              {loadingFiles === commit.hash
                                ? 'loading...'
                                : commit.filesChanged !== undefined
                                  ? `${commit.filesChanged} file${commit.filesChanged !== 1 ? 's' : ''} changed`
                                  : ''}
                            </span>
                          </div>
                          {onSendMessage && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRevert(commit.hash); }}
                              disabled={isReverting}
                              className={`
                                mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors
                                ${isReverting
                                  ? isDark ? 'bg-[#238636]/30 text-[#3fb950]' : 'bg-green-100 text-green-700'
                                  : isDark ? 'bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }
                              `}
                            >
                              <RotateCcw size={11} />
                              {isReverting ? 'Sent!' : 'Revert to this commit'}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CodeModeHistory;
