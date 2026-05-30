import React, { useState, useEffect, useRef } from 'react';
// Basic UI icons from lucide
import { X, ExternalLink } from '@/shared/icons';
// Custom badass OpenAgentic icons
import { Activity, RefreshCw } from '../Shared/AdminIcons';
import { useAuth } from '@/app/providers/AuthContext';

interface MCPInspectorViewProps {
  theme: string;
  onClose?: () => void;
  isFullPage?: boolean;
}

export const MCPInspectorView: React.FC<MCPInspectorViewProps> = ({
  theme,
  onClose,
  isFullPage = false
}) => {
  const inspectorUrl = '/api/admin/mcp-inspector/';
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { getAccessToken } = useAuth();

  // Fetch the inspector HTML with authentication
  const fetchInspectorContent = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(inspectorUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/html',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required. Please log in again.');
        } else if (response.status === 403) {
          throw new Error('Access denied. Admin privileges required.');
        }
        throw new Error(`Failed to load MCP Inspector: ${response.status}`);
      }

      const html = await response.text();
      setHtmlContent(html);
    } catch (err) {
      console.error('Failed to fetch MCP Inspector:', err);
      setError(err instanceof Error ? err.message : 'Failed to load MCP Inspector');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInspectorContent();
  }, []);

  // Write HTML content to iframe when it's ready
  useEffect(() => {
    if (htmlContent && iframeRef.current) {
      const iframe = iframeRef.current;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(htmlContent);
        doc.close();
      }
    }
  }, [htmlContent]);

  const handleRefresh = () => {
    fetchInspectorContent();
  };

  // If not full page, render embedded version
  if (!isFullPage) {
    return (
      <div className="h-full flex flex-col">
        {/* Header with actions */}
        <div className="flex items-center justify-between mb-4 px-4 py-3 bg-theme-bg-secondary rounded-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary-500/10">
              <Activity className="w-5 h-5 text-primary-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">
                MCP Inspector
              </h2>
              <p className="text-sm text-text-secondary">
                Debug and inspect MCP server connections, tools, and prompts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg transition-all hover:bg-white/10"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-text-secondary">Loading MCP Inspector...</p>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && !isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8 bg-error-500/10 rounded-lg max-w-md">
              <p className="ap-text-error mb-4">{error}</p>
              <button
                onClick={handleRefresh}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Embedded iframe with fetched content */}
        {!isLoading && !error && htmlContent && (
          <div className="flex-1 rounded-lg overflow-hidden border border-theme-border">
            <iframe
              ref={iframeRef}
              className="w-full h-full"
              style={{
                minHeight: '600px',
                border: 'none',
                backgroundColor: 'white',
              }}
              title="MCP Inspector"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            />
          </div>
        )}
      </div>
    );
  }

  // Full page view with close button
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{
        backgroundColor: 'var(--color-background)'
      }}
    >
      {/* Header bar with close button */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary-500/20">
            <Activity className="w-5 h-5 text-primary-500" />
          </div>
          <div>
            <h1
              className="text-lg font-bold"
              style={{ color: 'var(--color-text)' }}
            >
              MCP Inspector
            </h1>
            <p
              className="text-xs"
              style={{ color: 'var(--color-textSecondary)' }}
            >
              Debug and inspect MCP server connections
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg transition-all hover:bg-white/10"
            style={{ color: 'var(--color-text)' }}
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-all hover:bg-error-500/20 hover:ap-text-error"
              style={{ color: 'var(--color-text)' }}
              title="Close"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        {/* Loading indicator */}
        {isLoading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
              <p style={{ color: 'var(--color-textSecondary)' }}>
                Loading MCP Inspector...
              </p>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && !isLoading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center p-8 bg-error-500/10 rounded-lg max-w-md mx-4">
              <p className="ap-text-error mb-4 text-lg">{error}</p>
              <button
                onClick={handleRefresh}
                className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Full page iframe with fetched content */}
        {!isLoading && !error && htmlContent && (
          <iframe
            ref={iframeRef}
            className="w-full h-full"
            style={{
              border: 'none',
              backgroundColor: 'white',
            }}
            title="MCP Inspector"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          />
        )}
      </div>
    </div>
  );
};
