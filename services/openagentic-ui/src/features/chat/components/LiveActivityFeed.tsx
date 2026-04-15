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
 * LiveActivityFeed - Real-time action display
 * Shows currently executing tools/operations in a compact, minimal list
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Activity item representing a single executing operation
export interface ActivityItem {
  id: string;
  type: 'tool' | 'mcp' | 'thinking' | 'streaming';
  name: string;
  target?: string; // e.g., file path, API endpoint, search query
  status: 'executing' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
  result?: string;
  error?: string;
}

export interface LiveActivityFeedProps {
  activities: ActivityItem[];
  isStreaming?: boolean;
  isThinking?: boolean;
  compact?: boolean;
  maxVisible?: number;
  className?: string;
}

// Extract target from tool arguments
const extractTarget = (name: string, args: any): string | undefined => {
  if (!args) return undefined;

  // Common patterns for different tool types
  if (args.path || args.file_path || args.filePath) {
    return args.path || args.file_path || args.filePath;
  }
  if (args.url) return args.url;
  if (args.query) return `"${args.query}"`;
  if (args.pattern) return args.pattern;
  if (args.command) return args.command.substring(0, 50) + (args.command.length > 50 ? '...' : '');
  if (args.text && args.text.length < 40) return `"${args.text}"`;

  return undefined;
};

// Format tool name for display
const formatToolName = (name: string): string => {
  // Remove common prefixes
  const cleaned = name
    .replace(/^(openagentic-|mcp-|tool_)/, '')
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

// Single activity line component
const ActivityLine: React.FC<{
  activity: ActivityItem;
  compact?: boolean;
}> = React.memo(({ activity, compact }) => {
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time for executing items
  useEffect(() => {
    if (activity.status !== 'executing') {
      if (activity.endTime) {
        setElapsed(activity.endTime - activity.startTime);
      }
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - activity.startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [activity.status, activity.startTime, activity.endTime]);

  const displayName = useMemo(() => formatToolName(activity.name), [activity.name]);

  const statusIcon = useMemo(() => {
    switch (activity.status) {
      case 'executing':
        return (
          <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
        );
      case 'complete':
        return <span className="text-emerald-500">✓</span>;
      case 'error':
        return <span className="text-red-500">✗</span>;
    }
  }, [activity.status]);

  const elapsedDisplay = elapsed > 0 ? `${(elapsed / 1000).toFixed(1)}s` : '';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.15 }}
      className={`flex items-center gap-2 font-mono text-xs ${
        compact ? 'py-0.5' : 'py-1'
      } ${
        activity.status === 'executing'
          ? 'text-slate-200'
          : activity.status === 'error'
          ? 'text-red-400'
          : 'text-slate-400'
      }`}
    >
      {/* Status indicator */}
      <span className="w-4 flex-shrink-0 flex justify-center">
        {statusIcon}
      </span>

      {/* Tool name */}
      <span className={`${activity.status === 'executing' ? 'text-blue-400' : ''}`}>
        {displayName}
      </span>

      {/* Target (if any) */}
      {activity.target && (
        <span className="text-slate-500 truncate max-w-[200px]">
          {activity.target}
        </span>
      )}

      {/* Elapsed time */}
      {elapsedDisplay && (
        <span className="text-slate-600 ml-auto tabular-nums">
          {elapsedDisplay}
        </span>
      )}
    </motion.div>
  );
});

ActivityLine.displayName = 'ActivityLine';

// Main LiveActivityFeed component
export const LiveActivityFeed: React.FC<LiveActivityFeedProps> = ({
  activities,
  isStreaming = false,
  isThinking = false,
  compact = false,
  maxVisible = 5,
  className = ''
}) => {
  // Filter to show only executing items, plus recent completions
  const visibleActivities = useMemo(() => {
    const executing = activities.filter(a => a.status === 'executing');
    const recentComplete = activities
      .filter(a => a.status !== 'executing' && a.endTime && Date.now() - a.endTime < 2000)
      .slice(-2);

    return [...executing, ...recentComplete].slice(0, maxVisible);
  }, [activities, maxVisible]);

  // Don't render if nothing to show
  if (visibleActivities.length === 0 && !isStreaming && !isThinking) {
    return null;
  }

  return (
    <div
      className={`bg-slate-900 border border-slate-700/50 rounded-lg ${
        compact ? 'px-2 py-1' : 'px-3 py-2'
      } ${className}`}
    >
      {/* Activity list */}
      <AnimatePresence mode="popLayout">
        {visibleActivities.map(activity => (
          <ActivityLine
            key={activity.id}
            activity={activity}
            compact={compact}
          />
        ))}

        {/* Streaming indicator (when no specific tool is executing) */}
        {isStreaming && visibleActivities.length === 0 && (
          <motion.div
            key="streaming"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 font-mono text-xs py-1 text-slate-400"
          >
            <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span>Generating response...</span>
          </motion.div>
        )}

        {/* Thinking indicator */}
        {isThinking && (
          <motion.div
            key="thinking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 font-mono text-xs py-1 text-blue-400"
          >
            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span>Thinking...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overflow indicator */}
      {activities.filter(a => a.status === 'executing').length > maxVisible && (
        <div className="text-xs text-slate-500 mt-1 font-mono">
          +{activities.filter(a => a.status === 'executing').length - maxVisible} more...
        </div>
      )}
    </div>
  );
};

// Hook to manage activity state from SSE events
export const useActivityFeed = () => {
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // Handle tool execution events from SSE
  const handleToolExecution = useCallback((event: any) => {
    switch (event.type) {
      case 'start':
        // Batch start - mark all tools as starting
        if (event.tools && Array.isArray(event.tools)) {
          const newActivities = event.tools.map((tool: any, idx: number) => ({
            id: `${Date.now()}-${idx}`,
            type: 'tool' as const,
            name: tool.name || 'Unknown Tool',
            target: extractTarget(tool.name, tool.arguments),
            status: 'executing' as const,
            startTime: Date.now()
          }));
          setActivities(prev => [...prev, ...newActivities]);
        }
        break;

      case 'executing':
        // Single tool executing
        setActivities(prev => {
          // Check if already exists
          const exists = prev.some(a =>
            a.name === event.name && a.status === 'executing'
          );
          if (exists) return prev;

          return [...prev, {
            id: `${Date.now()}-${event.name}`,
            type: 'tool',
            name: event.name,
            target: extractTarget(event.name, event.arguments),
            status: 'executing',
            startTime: Date.now()
          }];
        });
        break;

      case 'result':
        // Tool completed successfully
        setActivities(prev => prev.map(a =>
          a.name === event.name && a.status === 'executing'
            ? { ...a, status: 'complete' as const, endTime: Date.now(), result: event.result }
            : a
        ));
        break;

      case 'error':
        // Tool failed
        setActivities(prev => prev.map(a =>
          a.name === event.name && a.status === 'executing'
            ? { ...a, status: 'error' as const, endTime: Date.now(), error: event.error }
            : a
        ));
        break;

      case 'complete':
        // Batch complete - mark all executing as complete
        setActivities(prev => prev.map(a =>
          a.status === 'executing'
            ? { ...a, status: 'complete' as const, endTime: Date.now() }
            : a
        ));
        break;

      case 'mcp_calls_data':
        // MCP calls data - add each call as an activity
        if (event.calls && Array.isArray(event.calls)) {
          const newActivities = event.calls.map((call: any, idx: number) => ({
            id: `mcp-${Date.now()}-${idx}`,
            type: 'mcp' as const,
            name: call.name || call.toolName || 'MCP Call',
            target: call.serverName || extractTarget(call.name, call.arguments),
            status: call.status === 'completed' ? 'complete' as const : 'executing' as const,
            startTime: Date.now(),
            endTime: call.status === 'completed' ? Date.now() : undefined
          }));
          setActivities(prev => [...prev, ...newActivities]);
        }
        break;

      case 'clear_all':
        setActivities([]);
        break;
    }
  }, []);

  // Clear completed activities after delay
  useEffect(() => {
    const interval = setInterval(() => {
      setActivities(prev =>
        prev.filter(a =>
          a.status === 'executing' ||
          (a.endTime && Date.now() - a.endTime < 5000)
        )
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Clear all activities
  const clearActivities = useCallback(() => {
    setActivities([]);
  }, []);

  return {
    activities,
    handleToolExecution,
    clearActivities
  };
};

export default LiveActivityFeed;
