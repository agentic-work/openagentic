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
 * EditorPanel - Embedded VS Code (code-server) Panel
 *
 * Provides a full VS Code experience within Openagentic:
 * - Embedded code-server iframe
 * - File preview/editing
 * - Integrated terminal
 * - Extensions support
 *
 * The code-server instance is managed per-user by openagentic-manager.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Code2,
  Eye,
  EyeOff,
  FileCode,
  Loader2,
  RefreshCw,
  ExternalLink,
  X,
  Maximize2,
  Minimize2,
  Play,
  AlertCircle,
  Lock,
  Monitor as MonitorPlay,
} from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

export type EditorPanelTab = 'editor' | 'terminal' | 'preview';

export interface EditorPanelProps {
  sessionId: string | null;
  workspacePath: string;
  selectedFile?: string;
  onFileSelect?: (path: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenExternal?: () => void;
  className?: string;
}

interface CodeServerStatus {
  status: 'not_started' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'available';
  url: string | null;
  port?: number;
  password?: string;
  error?: string;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  sessionId,
  workspacePath,
  selectedFile,
  onFileSelect,
  isCollapsed = false,
  onToggleCollapse,
  onOpenExternal,
  className = '',
}) => {
  const { getAuthHeaders } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [activeTab, setActiveTab] = useState<EditorPanelTab>('editor');
  const [codeServerStatus, setCodeServerStatus] = useState<CodeServerStatus>({
    status: 'not_started',
    url: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const maxRefreshAttempts = 3;
  const refreshDelays = [200, 500, 1000]; // Progressive delays in ms
  const [startRetryCount, setStartRetryCount] = useState(0);
  const maxStartRetries = 3;

  // Subscribe to WebSocket reconnection events for VSCode refresh
  const lastReconnectedAt = useCodeModeStore((state) => state.lastReconnectedAt);

  // Fetch code-server status
  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;

    try {
      const response = await fetch(
        apiEndpoint(`/openagentic/sessions/${sessionId}/code-server`),
        { headers: getAuthHeaders() }
      );

      if (response.ok) {
        const data = await response.json();
        setCodeServerStatus(data);
      }
    } catch (err) {
      console.error('[EditorPanel] Failed to fetch code-server status:', err);
    }
  }, [sessionId, getAuthHeaders]);

  // Start code-server
  const startCodeServer = useCallback(async () => {
    if (!sessionId) return;

    setIsLoading(true);
    setCodeServerStatus(prev => ({ ...prev, status: 'starting' }));

    try {
      const response = await fetch(
        apiEndpoint(`/openagentic/sessions/${sessionId}/code-server`),
        {
          method: 'POST',
          headers: getAuthHeaders(),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setCodeServerStatus({
          status: 'running',
          url: data.url,
          port: data.port,
          password: data.password,
        });
      } else {
        const error = await response.json();
        setCodeServerStatus({
          status: 'error',
          url: null,
          error: error.message || 'Failed to start code-server',
        });
      }
    } catch (err: any) {
      setCodeServerStatus({
        status: 'error',
        url: null,
        error: err.message || 'Failed to start code-server',
      });
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, getAuthHeaders]);

  // Stop code-server
  const stopCodeServer = useCallback(async () => {
    if (!sessionId) return;

    try {
      await fetch(
        apiEndpoint(`/openagentic/sessions/${sessionId}/code-server`),
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        }
      );
      setCodeServerStatus({ status: 'stopped', url: null });
    } catch (err) {
      console.error('[EditorPanel] Failed to stop code-server:', err);
    }
  }, [sessionId, getAuthHeaders]);

  // Poll status when starting
  useEffect(() => {
    if (sessionId) {
      fetchStatus();
    }
  }, [sessionId, fetchStatus]);

  // Auto-start code-server when session is available and not already running
  // Includes 'available' status which indicates code-server exists but isn't running
  useEffect(() => {
    if (
      sessionId &&
      !isCollapsed &&
      !isLoading &&
      (codeServerStatus.status === 'not_started' ||
       codeServerStatus.status === 'stopped' ||
       codeServerStatus.status === 'available')
    ) {
      // Auto-start after a brief delay to allow status fetch to complete
      setStartRetryCount(0);
      const timer = setTimeout(() => {
        console.log('[EditorPanel] Auto-starting VS Code, status:', codeServerStatus.status);
        startCodeServer();
      }, 300); // Reduced delay for faster startup
      return () => clearTimeout(timer);
    }
  }, [sessionId, isCollapsed, isLoading, codeServerStatus.status, startCodeServer]);

  // Auto-retry on error with exponential backoff (up to maxStartRetries)
  useEffect(() => {
    if (
      sessionId &&
      !isCollapsed &&
      !isLoading &&
      codeServerStatus.status === 'error' &&
      startRetryCount < maxStartRetries
    ) {
      const delay = Math.min(2000 * Math.pow(2, startRetryCount), 10000); // 2s, 4s, 8s
      console.log(`[EditorPanel] Auto-retry code-server start (attempt ${startRetryCount + 1}/${maxStartRetries}) in ${delay}ms`);
      const timer = setTimeout(() => {
        setStartRetryCount(prev => prev + 1);
        startCodeServer();
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [sessionId, isCollapsed, isLoading, codeServerStatus.status, startRetryCount, startCodeServer]);

  // Construct iframe URL with folder path
  const getIframeUrl = useCallback(() => {
    if (!codeServerStatus.url) return null;

    // The URL from the manager already includes the correct folder path
    // e.g., /code-server/?folder=%2Fworkspaces%2F{userId}%2F{sessionId}
    let url = codeServerStatus.url;

    // If a specific file is selected, append to the URL
    if (selectedFile) {
      // Decode existing folder path to build file path
      const urlObj = new URL(url, window.location.origin);
      const folder = urlObj.searchParams.get('folder') || '/workspaces';
      urlObj.searchParams.set('file', `${folder}/${selectedFile}`);
      url = urlObj.pathname + urlObj.search;
    }

    return url;
  }, [codeServerStatus.url, selectedFile]);

  // Handle iframe load
  const handleIframeLoad = () => {
    setIframeLoaded(true);
  };

  // Open in new window
  const handleOpenExternal = () => {
    if (codeServerStatus.url) {
      window.open(getIframeUrl() || codeServerStatus.url, '_blank');
    }
    onOpenExternal?.();
  };

  // Refresh iframe
  const handleRefresh = () => {
    if (iframeRef.current) {
      setIframeLoaded(false);
      iframeRef.current.src = getIframeUrl() || '';
    }
  };

  // Track previous collapsed state to detect expand transitions
  const prevIsCollapsed = useRef(isCollapsed);

  // Reset iframe loaded state when session changes
  useEffect(() => {
    setIframeLoaded(false);
    setRefreshAttempt(0);
    setStartRetryCount(0);
  }, [sessionId]);

  // Trigger refresh when panel expands while code-server is running
  useEffect(() => {
    const wasCollapsed = prevIsCollapsed.current;
    prevIsCollapsed.current = isCollapsed;

    // Only trigger when transitioning from collapsed to expanded
    if (wasCollapsed && !isCollapsed && codeServerStatus.status === 'running') {
      console.log('[EditorPanel] Panel expanded - starting VSCode refresh sequence');
      setIframeLoaded(false);
      setRefreshAttempt(1); // Start retry sequence
    }
  }, [isCollapsed, codeServerStatus.status]);

  // Retry mechanism for VSCode refresh with progressive delays
  useEffect(() => {
    if (refreshAttempt > 0 && refreshAttempt <= maxRefreshAttempts &&
        !isCollapsed && codeServerStatus.status === 'running' && !iframeLoaded) {
      const delay = refreshDelays[refreshAttempt - 1] || 1000;
      const timer = setTimeout(() => {
        console.log(`[EditorPanel] VSCode refresh attempt ${refreshAttempt}/${maxRefreshAttempts}`);
        handleRefresh();
        if (!iframeLoaded && refreshAttempt < maxRefreshAttempts) {
          setRefreshAttempt(prev => prev + 1);
        }
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [refreshAttempt, isCollapsed, codeServerStatus.status, iframeLoaded]);

  // Status polling when code-server is running - detect crashes/restarts
  useEffect(() => {
    if (!sessionId || codeServerStatus.status !== 'running') return;

    const pollInterval = setInterval(() => {
      console.log('[EditorPanel] Polling code-server status');
      fetchStatus();
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(pollInterval);
  }, [sessionId, codeServerStatus.status, fetchStatus]);

  // Refresh VSCode iframe when WebSocket reconnects
  useEffect(() => {
    if (lastReconnectedAt && codeServerStatus.status === 'running' && !isCollapsed) {
      console.log('[EditorPanel] WebSocket reconnected, refreshing VSCode iframe');
      setIframeLoaded(false);
      setRefreshAttempt(1); // Start retry sequence
    }
  }, [lastReconnectedAt, codeServerStatus.status, isCollapsed]);

  // Panel tabs
  const tabs: { id: EditorPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'editor', label: 'Editor', icon: <FileCode size={14} /> },
  ];

  if (isCollapsed) {
    return (
      <div
        className={`w-10 bg-[var(--cm-bg-secondary)] border-l border-[var(--cm-border)] flex flex-col items-center py-2 ${className}`}
      >
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
          title="Expand Editor Panel"
        >
          <Code2 size={18} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col w-full h-full bg-[var(--cm-bg)] border-l border-[var(--cm-border)] ${
        isMaximized ? 'fixed inset-0 z-[1200]' : ''
      } ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--cm-border)] bg-[var(--cm-bg-secondary)]">
        <div className="flex items-center gap-2">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[var(--cm-bg-tertiary)] text-[var(--cm-text)]'
                    : 'text-[var(--cm-text-secondary)] hover:text-[var(--cm-text)] hover:bg-[var(--cm-bg-tertiary)]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {codeServerStatus.status === 'running' && (
            <>
              <button
                onClick={handleRefresh}
                className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
                title="Refresh"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={handleOpenExternal}
                className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
                title="Open in New Window"
              >
                <ExternalLink size={14} />
              </button>
            </>
          )}
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
            title="Collapse Panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center overflow-hidden min-h-[300px]" style={{ backgroundColor: 'var(--color-background)' }}>
        {/* Not Started / Stopped / Available State */}
        {activeTab === 'editor' && (codeServerStatus.status === 'not_started' || codeServerStatus.status === 'stopped' || codeServerStatus.status === 'available') && (
          <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="p-4 rounded-full bg-[var(--color-surfaceSecondary)]">
              <Code2 size={32} className="text-[var(--color-textMuted)]" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-[var(--color-text)]">VS Code Web IDE</h3>
              <p className="text-sm mt-1 text-[var(--color-textMuted)]">
                Start your personal VS Code instance to edit files
              </p>
            </div>
            <button
              onClick={startCodeServer}
              disabled={isLoading || !sessionId}
              data-testid="start-vscode-btn"
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 bg-[var(--color-success)] text-white hover:opacity-90"
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              <span>Start VS Code</span>
            </button>
            {!sessionId && (
              <p className="text-xs text-[var(--color-textMuted)]">
                Connect to a session first
              </p>
            )}
          </div>
        )}

        {/* Starting State */}
        {activeTab === 'editor' && codeServerStatus.status === 'starting' && (
          <div className="flex flex-col items-center justify-center gap-4 p-6">
            <Loader2 size={32} className="animate-spin text-[var(--color-success)]" />
            <div className="text-center">
              <p className="text-[var(--cm-text)]">Starting VS Code...</p>
              <p className="text-sm text-[var(--cm-text-secondary)] mt-1">
                This may take a few seconds
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {activeTab === 'editor' && codeServerStatus.status === 'error' && (
          <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="p-4 rounded-full bg-red-500/10">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-[var(--cm-text)]">Failed to Start</h3>
              <p className="text-sm text-red-400 mt-1">
                {codeServerStatus.error || 'Unknown error'}
              </p>
            </div>
            <button
              onClick={startCodeServer}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--cm-bg-tertiary)] hover:bg-[var(--cm-bg-secondary)] text-[var(--cm-text)] transition-colors"
            >
              <RefreshCw size={16} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Running - Show iframe */}
        {activeTab === 'editor' && codeServerStatus.status === 'running' && codeServerStatus.url && (
          <>
            {/* Loading overlay with progress */}
            {!iframeLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)] z-10 gap-4">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 size={32} className="animate-spin text-[var(--color-success)]" />
                  <div className="text-center">
                    <p className="text-[var(--cm-text)] font-medium">Loading VS Code...</p>
                    <p className="text-sm text-[var(--cm-text-secondary)] mt-1">
                      Connecting to your workspace
                    </p>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-48 h-1 bg-[var(--cm-bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-success)] rounded-full animate-pulse"
                    style={{ width: '60%', animation: 'pulse 1.5s ease-in-out infinite' }}
                  />
                </div>
              </div>
            )}

            {/* Password hint */}
            {codeServerStatus.password && (
              <div className="absolute top-2 right-2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--cm-bg-tertiary)] border border-[var(--cm-border)] text-xs">
                <Lock size={12} className="text-[var(--cm-text-secondary)]" />
                <span className="text-[var(--cm-text-secondary)]">Password:</span>
                <code className="font-mono text-[var(--cm-text)]">
                  {codeServerStatus.password}
                </code>
              </div>
            )}

            {/* VS Code iframe */}
            <iframe
              ref={iframeRef}
              src={getIframeUrl() || ''}
              className="w-full h-full border-0"
              data-testid="vscode-iframe"
              onLoad={handleIframeLoad}
              allow="clipboard-read; clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
          </>
        )}
      </div>

      {/* Status Bar */}
      {codeServerStatus.status === 'running' && (
        <div className="flex items-center justify-between px-3 py-1 border-t border-[var(--cm-border)] bg-[var(--cm-bg-secondary)] text-xs">
          <div className="flex items-center gap-2 text-[var(--cm-text-secondary)]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
              Connected
            </span>
            <span>Port: {codeServerStatus.port}</span>
          </div>
          <button
            onClick={stopCodeServer}
            className="text-red-400 hover:text-red-300 transition-colors"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
};

export default EditorPanel;
