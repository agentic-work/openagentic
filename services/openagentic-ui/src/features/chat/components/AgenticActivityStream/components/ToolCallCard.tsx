/**
 * ToolCallCard - MCP Tool Call Visualization
 *
 * Displays tool/MCP calls with:
 * - Tool name and status indicator
 * - Collapsible input/output sections
 * - Duration timing (live elapsed timer when calling)
 * - Error state handling
 * - Abandoned state for stream-death recovery
 * - Progress heartbeat display
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
} from '@/shared/icons';

import type { ToolCallCardProps, ToolCallStatus } from '../types/activity.types';
import { ToolResultSummary } from './ToolResultSummary';

// Format tool name for display
const formatToolName = (name: string): string => {
  // Convert snake_case or kebab-case to Title Case
  return name
    .replace(/[_-]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

// Format duration
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
};

// Format live elapsed time (counting up)
const formatElapsed = (ms: number): string => {
  if (ms < 1000) return '0s';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

// Truncate long values for preview
const truncateValue = (value: unknown, maxLength = 100): string => {
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
};

// Status indicator component
const StatusIndicator: React.FC<{ status: ToolCallStatus }> = ({ status }) => {
  switch (status) {
    case 'success':
      return (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />
        </motion.div>
      );
    case 'error':
      return <XCircle className="w-4 h-4 text-[var(--color-error)]" />;
    case 'abandoned':
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    case 'calling':
    default:
      return <Loader2 className="w-4 h-4 text-[var(--color-primary)] animate-spin" />;
  }
};

// JSON viewer for input/output
const JsonViewer: React.FC<{
  data: unknown;
  label: string;
  isCollapsed?: boolean;
  onToggle?: () => void;
}> = ({ data, label, isCollapsed = true, onToggle }) => {
  const formattedData = useMemo(() => {
    if (typeof data === 'string') return data;
    return JSON.stringify(data, null, 2);
  }, [data]);

  const preview = useMemo(() => truncateValue(data, 50), [data]);
  const lineCount = formattedData.split('\n').length;

  return (
    <div className="border-t border-[var(--color-border)]/20">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-surfaceHover)]/30 transition-colors"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3 text-[var(--color-textMuted)]" />
        ) : (
          <ChevronDown className="w-3 h-3 text-[var(--color-textMuted)]" />
        )}
        <span className="text-xs font-medium text-[var(--color-textSecondary)]">
          {label}
        </span>
        {isCollapsed && (
          <span className="text-xs text-[var(--color-textMuted)] truncate flex-1">
            {preview}
          </span>
        )}
        {!isCollapsed && lineCount > 1 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {lineCount} lines
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <pre className="px-3 pb-2 text-xs font-mono text-[var(--color-textSecondary)] whitespace-pre-wrap break-all max-h-[200px] overflow-auto">
              {formattedData}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  displayName,
  toolInput,
  toolOutput,
  status,
  duration,
  startTime,
  progressMessage,
  collapsible = true,
  isCollapsed = false,
  onToggle,
  theme = 'dark',
  className = '',
}) => {
  const [inputCollapsed, setInputCollapsed] = React.useState(true);
  const [outputCollapsed, setOutputCollapsed] = React.useState(true);
  const [elapsed, setElapsed] = useState(0);

  const formattedName = displayName || formatToolName(toolName);

  // Live elapsed timer when status is 'calling'
  useEffect(() => {
    if (status !== 'calling' || !startTime) {
      setElapsed(0);
      return;
    }
    // Set initial elapsed
    setElapsed(Date.now() - startTime);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [status, startTime]);

  const handleToggle = useCallback(() => {
    if (collapsible) {
      onToggle?.();
    }
  }, [collapsible, onToggle]);

  const statusClass = useMemo(() => {
    switch (status) {
      case 'success':
        return 'border-[var(--color-success)]/30';
      case 'error':
        return 'border-[var(--color-error)]/30';
      case 'abandoned':
        return 'border-amber-500/30';
      default:
        return 'border-[var(--color-primary)]/30';
    }
  }, [status]);

  return (
    <div
      className={`
        tool-call-card
        bg-[var(--color-surfaceSecondary)]/30
        backdrop-blur-sm
        border ${statusClass}
        rounded-lg
        overflow-hidden
        ${className}
      `}
      data-theme={theme}
    >
      {/* Header */}
      <button
        onClick={handleToggle}
        disabled={!collapsible}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2
          ${collapsible ? 'hover:bg-[var(--color-surfaceHover)]/50 cursor-pointer' : 'cursor-default'}
          transition-colors text-left
        `}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="w-4 h-4 text-[var(--color-textMuted)] flex-shrink-0" />
          <span className="text-sm font-medium text-[var(--color-text)] truncate">
            {formattedName}
          </span>
          {/* Progress message from heartbeat */}
          {status === 'calling' && progressMessage && (
            <span className="text-xs text-[var(--color-textMuted)] truncate">
              {progressMessage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Live elapsed timer when calling */}
          {status === 'calling' && startTime && elapsed > 0 && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-textMuted)] tabular-nums">
              <Clock size={10} />
              {formatElapsed(elapsed)}...
            </span>
          )}

          {/* Final duration when complete */}
          {duration && status !== 'calling' && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-textMuted)]">
              <Clock size={10} />
              {formatDuration(duration)}
            </span>
          )}

          {/* Status indicator */}
          <StatusIndicator status={status} />

          {/* Collapse indicator */}
          {collapsible && (
            isCollapsed ? (
              <ChevronRight className="w-4 h-4 text-[var(--color-textMuted)]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--color-textMuted)]" />
            )
          )}
        </div>
      </button>

      {/* Abandoned state message */}
      {status === 'abandoned' && (
        <div className="px-3 py-1.5 border-t border-amber-500/20 bg-amber-500/5">
          <span className="text-xs text-amber-500">
            Stream ended — result unknown
          </span>
        </div>
      )}

      {/* Smart result summary for Azure ARM tools */}
      {toolOutput && status !== 'calling' && (
        <ToolResultSummary toolName={toolName} output={toolOutput} />
      )}

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {/* Input */}
            {toolInput && (
              <JsonViewer
                data={toolInput}
                label="Input"
                isCollapsed={inputCollapsed}
                onToggle={() => setInputCollapsed(!inputCollapsed)}
              />
            )}

            {/* Output */}
            {toolOutput && (
              <JsonViewer
                data={toolOutput}
                label="Output"
                isCollapsed={outputCollapsed}
                onToggle={() => setOutputCollapsed(!outputCollapsed)}
              />
            )}

            {/* Error message */}
            {status === 'error' && !toolOutput && (
              <div className="px-3 py-2 border-t border-[var(--color-border)]/20">
                <span className="text-xs text-[var(--color-error)]">
                  Tool call failed
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ToolCallCard;
