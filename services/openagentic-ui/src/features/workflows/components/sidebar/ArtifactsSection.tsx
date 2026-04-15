/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * ArtifactsSection - Browse workflow-generated artifacts stored in Milvus
 * Shows recent artifacts from workflow executions with preview and search.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Eye,
  FileText,
  Clock,
  X,
  Copy,
  Check,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { SharedMarkdownRenderer } from '@/features/chat/components/MessageContent/SharedMarkdownRenderer';

interface WorkflowArtifact {
  id: string;
  title: string;
  content: string;
  format?: 'markdown' | 'html' | 'json' | 'table';
  metadata?: {
    source?: string;
    workflowId?: string;
    executionId?: string;
    nodeId?: string;
    format?: string;
  };
  created_at?: string;
  score?: number;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const ArtifactsSection: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchArtifacts = useCallback(async (query?: string) => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      params.set('source', 'workflow');
      params.set('limit', '20');

      const res = await fetch(`/api/knowledge/search?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const items = (data.results || data.artifacts || []).map((item: any) => ({
          id: item.id || item.artifact_id || `artifact-${Math.random()}`,
          title: item.title || item.metadata?.title || 'Untitled',
          content: item.content || item.text || '',
          format: item.metadata?.format || item.format || 'json',
          metadata: item.metadata || {},
          created_at: item.created_at || item.metadata?.created_at,
          score: item.score,
        }));
        setArtifacts(items);
      }
    } catch {
      // Silently handle — artifacts feature may not be available
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  const handleSearch = useCallback(() => {
    if (searchQuery.trim()) {
      fetchArtifacts(searchQuery.trim());
    } else {
      fetchArtifacts();
    }
  }, [searchQuery, fetchArtifacts]);

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="px-2 pb-2">
      {/* Search bar */}
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3"
            style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search artifacts..."
            className="w-full pl-7 pr-2 py-1 text-[11px] rounded-md border focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
        </div>
        <button
          onClick={() => fetchArtifacts()}
          className="p-1 rounded-md transition-colors hover:bg-[var(--color-surface)]"
          style={{ color: 'var(--color-text-tertiary)' }}
          title="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Artifacts list */}
      {loading && artifacts.length === 0 && (
        <div className="text-xs px-2 py-3 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
          Loading artifacts…
        </div>
      )}

      {!loading && artifacts.length === 0 && (
        <div className="text-xs px-2 py-3 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
          No workflow artifacts yet. Run a workflow with output to see artifacts here.
        </div>
      )}

      {artifacts.map(artifact => {
        const isExpanded = expandedId === artifact.id;
        return (
          <div key={artifact.id} className="mb-1">
            <button
              onClick={() => setExpandedId(isExpanded ? null : artifact.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-[var(--color-surface)]"
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#58a6ff' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {artifact.title}
                </div>
                <div className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                  {artifact.format || 'json'}
                  {artifact.created_at && ` · ${timeAgo(artifact.created_at)}`}
                </div>
              </div>
              <span className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                {isExpanded
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />
                }
              </span>
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="px-2 pb-2">
                    {/* Action buttons */}
                    <div className="flex items-center gap-1 mb-1.5">
                      <button
                        onClick={() => handleCopy(artifact.content, artifact.id)}
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border transition-colors"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: copied === artifact.id ? '#2ea043' : 'var(--color-text-secondary)',
                        }}
                      >
                        {copied === artifact.id ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                        {copied === artifact.id ? 'Copied' : 'Copy'}
                      </button>
                      {artifact.metadata?.executionId && (
                        <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                          exec: {artifact.metadata.executionId.slice(0, 8)}
                        </span>
                      )}
                    </div>

                    {/* Content preview */}
                    <div
                      className="rounded-md border overflow-auto"
                      style={{
                        borderColor: 'var(--color-border)',
                        backgroundColor: 'var(--color-bg-secondary)',
                        maxHeight: 200,
                        padding: '6px 8px',
                        fontSize: 11,
                      }}
                    >
                      {artifact.format === 'markdown' ? (
                        <SharedMarkdownRenderer content={artifact.content.substring(0, 2000)} theme="dark" />
                      ) : (
                        <pre style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          margin: 0,
                          color: 'var(--color-text)',
                          fontSize: 10,
                        }}>
                          {artifact.content.substring(0, 2000)}
                        </pre>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};
