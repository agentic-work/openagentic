/**
 * PreviewPanel Component
 *
 * Shows a preview iframe for dev servers detected in terminal output.
 * Automatically detects URLs from common dev servers (Vite, Next.js, etc.)
 * and displays them in a sandboxed iframe.
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, ExternalLink, RefreshCw, Maximize2, Minimize2, AlertCircle } from '@/shared/icons';

interface PreviewPanelProps {
  url: string | null;
  onClose: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  theme?: 'light' | 'dark';
}

/**
 * Detect dev server URLs from terminal output
 * Returns the first valid URL found, or null
 */
export function detectDevServerUrl(output: string): string | null {
  // Common patterns for dev server URLs
  const patterns = [
    // Vite: Local:   http://localhost:5173/
    /Local:\s+(https?:\/\/localhost:\d+\/?)/i,
    // Next.js: - ready started server on 0.0.0.0:3000, url: http://localhost:3000
    /url:\s+(https?:\/\/localhost:\d+\/?)/i,
    // Generic: Server running at http://localhost:xxxx
    /Server\s+(?:running|started|listening)\s+(?:at|on)\s+(https?:\/\/localhost:\d+\/?)/i,
    // Webpack dev server: Project is running at http://localhost:xxxx
    /Project is running at\s+(https?:\/\/localhost:\d+\/?)/i,
    // React scripts: Local:            http://localhost:3000
    /^\s*Local:\s+(https?:\/\/localhost:\d+\/?)/im,
    // Express/Node: Listening on port xxxx
    /Listening on (?:port\s+)?(\d+)/i,
    // Generic localhost URL with port
    /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      // Handle the "Listening on port xxxx" case
      if (pattern.toString().includes('Listening on')) {
        return `http://localhost:${match[1]}`;
      }
      return match[1];
    }
  }

  return null;
}

/**
 * PreviewPanel - Shows an iframe preview of a running dev server
 */
export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  url,
  onClose,
  isMaximized = false,
  onToggleMaximize,
  theme = 'dark',
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset loading/error state when URL changes
  useEffect(() => {
    if (url) {
      setIsLoading(true);
      setHasError(false);
    }
  }, [url, refreshKey]);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    setIsLoading(true);
    setHasError(false);
  };

  const handleOpenExternal = () => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  if (!url) {
    return null;
  }

  const isDark = theme === 'dark';
  const bgColor = isDark ? 'bg-[#1e1e1e]' : 'bg-white';
  const textColor = isDark ? 'text-gray-300' : 'text-gray-700';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-300';
  const hoverBg = isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100';

  return (
    <div className={`flex flex-col h-full ${bgColor} ${borderColor} border-l`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 ${borderColor} border-b`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${textColor}`}>Preview</span>
          <span className="text-xs text-gray-500 truncate max-w-[200px]" title={url}>
            {url}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className={`p-1.5 rounded ${hoverBg} ${textColor}`}
            title="Refresh preview"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenExternal}
            className={`p-1.5 rounded ${hoverBg} ${textColor}`}
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className={`p-1.5 rounded ${hoverBg} ${textColor}`}
              title={isMaximized ? 'Minimize' : 'Maximize'}
            >
              {isMaximized ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className={`p-1.5 rounded ${hoverBg} text-gray-500 hover:text-red-500`}
            title="Close preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-400">Loading preview...</span>
            </div>
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
            <div className="flex flex-col items-center gap-3 p-6">
              <AlertCircle className="w-12 h-12 text-orange-500" />
              <span className="text-sm text-gray-300">Failed to load preview</span>
              <p className="text-xs text-gray-500 text-center max-w-xs">
                The dev server might still be starting, or CORS policies may be blocking the preview.
              </p>
              <button
                onClick={handleRefresh}
                className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <iframe
          key={refreshKey}
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
          title="Preview"
        />
      </div>
    </div>
  );
};

export default PreviewPanel;
