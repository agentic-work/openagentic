/**
 * ErrorDisplay Component
 * Displays chat pipeline errors with different views for admins vs regular users
 * Admins see technical details and recommendations, users see friendly messages
 */

import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Copy, CheckCircle } from '@/shared/icons';

/**
 * Error data structure from backend
 */
export interface ChatError {
  code: string;
  message: string;
  retryable: boolean;
  isAdmin?: boolean;
  stage?: string;
  technicalDetails?: string;
  recommendations?: string[];
  timestamp?: string;
}

interface ErrorDisplayProps {
  error: ChatError | string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Parse error from various formats
 */
function parseError(error: ChatError | string): ChatError {
  if (typeof error === 'string') {
    return {
      code: 'UNKNOWN_ERROR',
      message: error,
      retryable: true
    };
  }
  return error;
}

/**
 * User-facing error display - clean and simple
 */
function UserErrorDisplay({ error, onRetry, className }: { error: ChatError; onRetry?: () => void; className?: string }) {
  return (
    <div className={`flex items-start gap-3 p-4 bg-error/10 border border-error/20 rounded-lg ${className || ''}`}>
      <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-primary text-sm">{error.message}</p>
        {error.retryable && onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 flex items-center gap-1.5 text-xs text-info hover:text-info/80 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Admin-facing error display - detailed with recommendations
 */
function AdminErrorDisplay({ error, onRetry, className }: { error: ChatError; onRetry?: () => void; className?: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyDetails = async () => {
    const details = `Error Code: ${error.code}
Stage: ${error.stage || 'unknown'}
Message: ${error.message}
Technical Details: ${error.technicalDetails || 'N/A'}
Timestamp: ${error.timestamp || new Date().toISOString()}`;

    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  return (
    <div className={`bg-error/10 border border-error/30 rounded-lg overflow-hidden ${className || ''}`}>
      {/* Header */}
      <div className="flex items-start gap-3 p-4 border-b border-error/20">
        <AlertTriangle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-error">Pipeline Error</span>
            <span className="px-1.5 py-0.5 text-xs bg-error/20 text-error rounded">{error.code}</span>
            {error.stage && (
              <span className="px-1.5 py-0.5 text-xs bg-warning/20 text-warning rounded">Stage: {error.stage}</span>
            )}
          </div>
          <p className="text-primary text-sm mt-1">{error.message}</p>
        </div>
      </div>

      {/* Recommendations */}
      {error.recommendations && error.recommendations.length > 0 && (
        <div className="p-4 border-b border-error/20 bg-warning/5">
          <h4 className="text-xs font-medium text-warning uppercase tracking-wide mb-2">Suggested Actions</h4>
          <ul className="space-y-1">
            {error.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-secondary">
                <span className="text-warning">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Technical Details (Collapsible) */}
      {error.technicalDetails && (
        <div className="border-b border-error/20">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between p-3 text-xs text-secondary hover:bg-error/5 transition-colors"
          >
            <span className="font-medium">Technical Details</span>
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showDetails && (
            <div className="px-3 pb-3">
              <pre className="text-xs bg-secondary/50 p-3 rounded overflow-x-auto text-secondary whitespace-pre-wrap break-words">
                {error.technicalDetails}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between p-3 bg-secondary/30">
        <div className="flex items-center gap-2">
          {error.retryable && onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-info hover:bg-info/90 theme-text-inverse rounded transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}
          <button
            onClick={handleCopyDetails}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-tertiary hover:bg-tertiary/80 text-primary rounded transition-colors"
          >
            {copied ? <CheckCircle className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy Details'}
          </button>
        </div>
        {error.timestamp && (
          <span className="text-xs text-muted">
            {new Date(error.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Main ErrorDisplay component - automatically shows admin or user view
 */
export function ErrorDisplay({ error, onRetry, className }: ErrorDisplayProps) {
  const parsedError = parseError(error);

  // Show admin view if error has admin flag, otherwise show user view
  if (parsedError.isAdmin) {
    return <AdminErrorDisplay error={parsedError} onRetry={onRetry} className={className} />;
  }

  return <UserErrorDisplay error={parsedError} onRetry={onRetry} className={className} />;
}

export default ErrorDisplay;
