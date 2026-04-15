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
 * AgentExecutionTimeline - Shows parallel agent execution progress
 *
 * Renders inside a ToolCallCard when the tool is `delegate_to_agents`.
 * Displays a mini-timeline of all spawned agents with their individual
 * status, elapsed time, and current tool call.
 */

import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
} from '@/shared/icons';

export interface AgentTimelineEntry {
  agentId: string;
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  elapsed?: number; // seconds
  currentTool?: string;
  output?: string;
}

interface AgentExecutionTimelineProps {
  agents: AgentTimelineEntry[];
  orchestration: string;
  totalAgents: number;
  className?: string;
}

const StatusIcon: React.FC<{ status: AgentTimelineEntry['status'] }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success)]" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-[var(--color-error)]" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-[var(--color-primary)] animate-spin" />;
    default:
      return <div className="w-3.5 h-3.5 rounded-full border border-[var(--color-textMuted)]" />;
  }
};

const formatElapsed = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
};

export const AgentExecutionTimeline: React.FC<AgentExecutionTimelineProps> = ({
  agents,
  orchestration,
  totalAgents,
  className = '',
}) => {
  // Collapsed by default — Claude Code style: show summary, expand for details
  const [expanded, setExpanded] = useState(false);
  const completedCount = agents.filter(a => a.status === 'completed').length;
  const failedCount = agents.filter(a => a.status === 'failed').length;
  const runningCount = agents.filter(a => a.status === 'running').length;

  return (
    <div className={`border-t border-[var(--color-border)]/20 ${className}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-surfaceHover)]/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-[var(--color-textMuted)]" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[var(--color-textMuted)]" />
        )}
        <span className="text-xs font-medium text-[var(--color-textSecondary)]">
          Agents — {totalAgents} {orchestration}
        </span>
        <span className="text-xs text-[var(--color-textMuted)] ml-auto">
          {runningCount > 0 ? (
            <span className="text-[var(--color-primary)]">{runningCount} running</span>
          ) : (
            <>{completedCount} done{failedCount > 0 && <span className="text-[var(--color-error)] ml-1"> · {failedCount} failed</span>}</>
          )}
        </span>
      </button>

      {/* Agent list */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {agents.map((agent) => (
            <div key={agent.agentId} className="flex items-center gap-2 py-0.5">
              {/* Tree connector */}
              <span className="text-[var(--color-textMuted)] text-xs font-mono w-3 text-center">
                {agent === agents[agents.length - 1] ? '\u2514' : '\u251C'}
              </span>

              {/* Status icon */}
              <StatusIcon status={agent.status} />

              {/* Agent role */}
              <span className="text-xs text-[var(--color-text)] truncate max-w-[200px]">
                {agent.role}
              </span>

              {/* Current tool (if running) */}
              {agent.status === 'running' && agent.currentTool && (
                <span className="text-[10px] text-[var(--color-textMuted)] truncate max-w-[150px]">
                  {agent.currentTool}
                </span>
              )}

              {/* Elapsed time */}
              <span className="text-xs text-[var(--color-textMuted)] ml-auto tabular-nums flex-shrink-0">
                {agent.elapsed !== undefined ? (
                  <span className="flex items-center gap-1">
                    <Clock size={9} />
                    {agent.status === 'running' ? `${formatElapsed(agent.elapsed)}...` : formatElapsed(agent.elapsed)}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentExecutionTimeline;
