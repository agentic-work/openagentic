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
 * AgentExecutionTree — Inline collapsible block showing agent orchestration progress.
 *
 * Renders Claude Code-style: collapsed summary when done, expanded live view
 * while running. Each agent row shows status icon, role, duration, and token
 * counts. Tool calls appear nested underneath.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Loader2, ChevronRight, ChevronDown } from '@/shared/icons';
import { summarizeToolCall } from '../utils/toolSummarizer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolCallDisplay {
  toolName: string;
  input?: string;          // truncated arg string shown in the row
  args?: string;           // raw JSON args string (for approval cards)
  result?: string;         // tool result for inline summary
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  isThinking?: boolean;    // true → renders as "Thought for Xs (~N tokens)"
  thinkingTokens?: number;
  id?: string;             // unique id for per-card state (e.g. showCode)
}

export interface AgentNodeDisplay {
  agentId: string;
  role: string;
  status: 'running' | 'completed' | 'error' | 'streaming';
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: ToolCallDisplay[];
  statusLabel?: string;    // e.g. "streaming", "thinking"
}

export interface AgentExecutionTreeProps {
  executionId: string;
  strategy: string;
  status: 'running' | 'completed' | 'error';
  agents: Record<string, AgentNodeDisplay>;
  totalDurationMs?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  theme: 'light' | 'dark';
  onApprove?: (executionId: string, agentId: string, functionId: string, decision: 'approved' | 'denied') => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

// ─── Status icons ─────────────────────────────────────────────────────────────

const StatusIcon: React.FC<{
  status: 'running' | 'completed' | 'error' | 'streaming';
  size?: number;
}> = ({ status, size = 13 }) => {
  switch (status) {
    case 'completed':
      return (
        <Check
          style={{ width: size, height: size, flexShrink: 0, color: 'var(--color-success, #3fb950)', transition: 'color 0.3s ease-out' }}
        />
      );
    case 'error':
      return (
        <X
          style={{ width: size, height: size, flexShrink: 0, color: 'var(--color-error, #f85149)', transition: 'color 0.3s ease-out' }}
        />
      );
    case 'running':
    case 'streaming':
    default:
      return (
        <Loader2
          className="animate-spin"
          style={{ width: size, height: size, flexShrink: 0, color: 'var(--color-primary)', transition: 'color 0.3s ease-out' }}
        />
      );
  }
};

// ─── Tool call row ────────────────────────────────────────────────────────────

const ToolCallRow: React.FC<{ tool: ToolCallDisplay; isDark: boolean }> = ({ tool, isDark }) => {
  const mutedColor = isDark ? 'var(--text-tertiary, #8b949e)' : 'var(--text-tertiary, #6b7280)';
  const summaryColor = isDark ? 'var(--text-secondary, #a0aec0)' : 'var(--text-secondary, #4a5568)';

  if (tool.isThinking) {
    const secs = tool.durationMs ? (tool.durationMs / 1000).toFixed(1) : '?';
    const tokenStr = tool.thinkingTokens ? ` (~${formatTokens(tool.thinkingTokens)} tokens)` : '';
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 20,
          marginTop: 3,
          fontSize: 12,
          color: mutedColor,
        }}
      >
        <span style={{ userSelect: 'none' }}>›</span>
        <span style={{ fontStyle: 'italic' }}>
          Thought for {secs}s{tokenStr}
        </span>
      </div>
    );
  }

  // Generate inline summary of what the tool did (e.g. "Created uc2-vnet in eastus")
  const summary = useMemo(() => {
    if (tool.status !== 'completed' && tool.status !== 'error') return null;
    try {
      const parsedArgs = tool.args ? JSON.parse(tool.args) : (tool.input ? JSON.parse(tool.input) : undefined);
      const parsedResult = tool.result ? (typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result)) : undefined;
      const s = summarizeToolCall(tool.toolName, parsedArgs, parsedResult, tool.status as any);
      return s.kind === 'text' ? s.text : null;
    } catch {
      return null;
    }
  }, [tool.toolName, tool.args, tool.input, tool.result, tool.status]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 20,
        marginTop: 3,
        fontSize: 12,
        color: mutedColor,
      }}
    >
      <span style={{ userSelect: 'none' }}>↳</span>
      <StatusIcon status={tool.status} size={11} />
      <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
        {tool.toolName}
      </span>
      {summary && (
        <span style={{ color: summaryColor, fontStyle: 'italic', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          — {summary}
        </span>
      )}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        {tool.durationMs !== undefined && (
          <span style={{ fontSize: 11 }}>{formatDuration(tool.durationMs)}</span>
        )}
      </span>
    </div>
  );
};

// ─── Approval helpers ─────────────────────────────────────────────────────────

interface ApprovalArgs {
  riskLevel?: string;
  reason?: string;
  code?: string;
  functionId?: string;
  [key: string]: unknown;
}

function parseApprovalArgs(tool: ToolCallDisplay): ApprovalArgs | null {
  const raw = tool.args ?? tool.input ?? '';
  try {
    const parsed = JSON.parse(raw) as ApprovalArgs;
    return parsed;
  } catch {
    return null;
  }
}

function isApprovalToolCall(tool: ToolCallDisplay): boolean {
  if (!tool.toolName) return false;
  const nameLower = tool.toolName.toLowerCase();
  if (nameLower.includes('approval') || tool.toolName.startsWith('[APPROVAL]')) return true;
  // Also check args for riskLevel field
  const parsed = parseApprovalArgs(tool);
  if (parsed && parsed.riskLevel !== undefined) return true;
  return false;
}

async function postApprovalDecision(
  executionId: string,
  agentId: string,
  functionId: string,
  decision: 'approved' | 'denied',
): Promise<void> {
  const authToken = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  await fetch(`/api/agent-executions/${executionId}/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agentId, functionId, decision }),
  });
}

// ─── Approval card ────────────────────────────────────────────────────────────

const ApprovalCard: React.FC<{
  tool: ToolCallDisplay;
  agentId: string;
  executionId: string;
  isDark: boolean;
  textMuted: string;
  textPrimary: string;
  onApprove?: (executionId: string, agentId: string, functionId: string, decision: 'approved' | 'denied') => void;
}> = ({ tool, agentId, executionId, isDark, textMuted, textPrimary, onApprove }) => {
  const [showCode, setShowCode] = useState(false);

  const parsed = parseApprovalArgs(tool) ?? {};
  const riskLevel = parsed.riskLevel ?? 'unknown';
  const reason = parsed.reason ?? tool.input ?? '';
  const code = parsed.code ?? '';
  const functionId = parsed.functionId ?? tool.id ?? tool.toolName;

  const handleDecision = async (decision: 'approved' | 'denied') => {
    try {
      if (onApprove) {
        onApprove(executionId, agentId, functionId, decision);
      } else {
        await postApprovalDecision(executionId, agentId, functionId, decision);
      }
    } catch (err) {
      console.error('Approval decision failed:', err);
    }
  };

  return (
    <div
      className="ml-4 my-1.5 p-3 rounded-lg"
      style={{
        background: 'var(--thinking-bg, rgba(234,179,8,0.08))',
        border: '1px solid var(--thinking-border, rgba(234,179,8,0.25))',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ color: 'var(--color-warning, #eab308)', fontSize: 12, fontWeight: 600 }}>APPROVAL REQUIRED</span>
      </div>
      <div style={{ color: textMuted, fontSize: 12, lineHeight: 1.5 }}>
        Risk: {riskLevel}{reason ? ` — ${reason}` : ''}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => handleDecision('approved')}
          className="px-3 py-1 rounded text-xs font-medium"
          style={{ background: 'var(--toast-success, #22c55e)', color: 'white', border: 'none', cursor: 'pointer' }}
        >
          Approve
        </button>
        <button
          onClick={() => handleDecision('denied')}
          className="px-3 py-1 rounded text-xs font-medium"
          style={{ background: 'var(--toast-error, #ef4444)', color: 'white', border: 'none', cursor: 'pointer' }}
        >
          Deny
        </button>
        {code && (
          <button
            onClick={() => setShowCode(s => !s)}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{
              background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
              color: textPrimary,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {showCode ? 'Hide Code' : 'View Code'}
          </button>
        )}
      </div>
      {showCode && code && (
        <pre
          className="mt-2 p-2 rounded text-xs overflow-auto"
          style={{
            background: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)',
            fontFamily: 'var(--font-mono)',
            maxHeight: 200,
          }}
        >
          {code}
        </pre>
      )}
    </div>
  );
};

// ─── Agent row ────────────────────────────────────────────────────────────────

const AgentRow: React.FC<{
  agent: AgentNodeDisplay;
  isDark: boolean;
  executionId: string;
  textPrimary: string;
  textMuted: string;
  onApprove?: (executionId: string, agentId: string, functionId: string, decision: 'approved' | 'denied') => void;
}> = ({ agent, isDark, executionId, textPrimary, textMuted, onApprove }) => {
  const hasTokens = agent.inputTokens !== undefined || agent.outputTokens !== undefined;
  const hasDuration = agent.durationMs !== undefined;

  const tokenLabel =
    hasTokens
      ? `↑${formatTokens(agent.inputTokens ?? 0)} ↓${formatTokens(agent.outputTokens ?? 0)}`
      : null;
  const durationLabel =
    hasDuration ? formatDuration(agent.durationMs!) : agent.statusLabel ?? null;

  // Live counts for running agents
  const toolCount = agent.toolCalls?.length ?? 0;
  const totalTokens = (agent.inputTokens ?? 0) + (agent.outputTokens ?? 0);
  const isRunning = agent.status === 'running' || agent.status === 'streaming';

  // Build compact meta: "3 tool uses · 12k tokens" (running) or "2.1s · ↑1k ↓3k" (done)
  const metaParts: string[] = [];
  if (isRunning) {
    if (toolCount > 0) metaParts.push(`${toolCount} tool use${toolCount !== 1 ? 's' : ''}`);
    if (totalTokens > 0) metaParts.push(`${formatTokens(totalTokens)} tokens`);
  } else {
    if (hasDuration) metaParts.push(formatDuration(agent.durationMs!));
    if (hasTokens) metaParts.push(`↑${formatTokens(agent.inputTokens ?? 0)} ↓${formatTokens(agent.outputTokens ?? 0)}`);
  }

  return (
    <div role="treeitem" style={{ marginTop: 6 }}>
      {/* Agent header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 4,
          fontSize: 13,
        }}
      >
        <StatusIcon status={agent.status} size={13} />
        <span style={{ color: 'var(--color-text, inherit)', fontWeight: 500 }}>
          {agent.role}
        </span>
        {/* Compact meta: tool count · token count (running) or duration · tokens (done) */}
        {metaParts.length > 0 && (
          <span style={{ color: textMuted, fontSize: 12 }}>
            · {metaParts.join(' · ')}
          </span>
        )}
      </div>

      {/* Current activity — dim line showing what agent is doing NOW */}
      {isRunning && agent.statusLabel && (
        <div
          style={{
            paddingLeft: 25,
            fontSize: 12,
            color: textMuted,
            marginTop: 2,
            fontFamily: 'var(--font-mono, monospace)',
            opacity: 0.8,
          }}
        >
          ⎿ {agent.statusLabel}
        </div>
      )}

      {/* Tool calls (shown when expanded / completed) */}
      {!isRunning && agent.toolCalls && agent.toolCalls.length > 0 && (
        <div>
          {agent.toolCalls.map((tool, idx) => {
            const key = tool.id ?? `${tool.toolName}-${idx}`;
            if (isApprovalToolCall(tool)) {
              return (
                <ApprovalCard
                  key={key}
                  tool={tool}
                  agentId={agent.agentId}
                  executionId={executionId}
                  isDark={isDark}
                  textMuted={textMuted}
                  textPrimary={textPrimary}
                  onApprove={onApprove}
                />
              );
            }
            return <ToolCallRow key={key} tool={tool} isDark={isDark} />;
          })}
        </div>
      )}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const AgentExecutionTree: React.FC<AgentExecutionTreeProps> = ({
  executionId,
  strategy,
  status,
  agents,
  totalDurationMs,
  totalInputTokens,
  totalOutputTokens,
  totalToolCalls,
  theme,
  onApprove,
}) => {
  const isDark = theme === 'dark';
  const isRunning = status === 'running';

  // Expanded by default while running; auto-collapse when done
  const [expanded, setExpanded] = useState<boolean>(isRunning);
  const [wasRunning, setWasRunning] = useState<boolean>(isRunning);

  useEffect(() => {
    if (isRunning && !wasRunning) {
      setExpanded(true); // Auto-expand when agents start
    }
    setWasRunning(isRunning);
  }, [isRunning, wasRunning]);

  const agentList = Object.values(agents);
  const agentCount = agentList.length;

  const bg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const mutedColor = isDark ? 'var(--text-tertiary, #8b949e)' : 'var(--text-tertiary, #6b7280)';
  const textPrimary = isDark ? 'var(--text-primary, #e6edf3)' : 'var(--text-primary, #111827)';

  // Collapsed summary line pieces
  const summaryParts: string[] = [];
  if (agentCount > 0) summaryParts.push(`${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
  if (totalDurationMs !== undefined) summaryParts.push(formatDuration(totalDurationMs));
  if (totalInputTokens || totalOutputTokens) {
    summaryParts.push(`↑${formatTokens(totalInputTokens)} ↓${formatTokens(totalOutputTokens)}`);
  }
  if (totalToolCalls > 0) summaryParts.push(`${totalToolCalls} tool${totalToolCalls !== 1 ? 's' : ''}`);
  const summaryText = summaryParts.join(', ');

  return (
    <motion.div
      role="tree"
      aria-label="Agent execution tree"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        borderRadius: 8,
        background: bg,
        border: `1px solid ${border}`,
        marginBottom: 10,
        overflow: 'hidden',
        fontSize: 13,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Header / toggle row ─────────────────────────────────────────── */}
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '7px 10px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--color-text, inherit)',
        }}
      >
        {/* Expand/collapse chevron */}
        <motion.span
          animate={{ rotate: expanded ? 0 : -90 }}
          transition={{ duration: 0.15 }}
          style={{ display: 'inline-flex', alignItems: 'center', color: mutedColor }}
        >
          <ChevronDown style={{ width: 14, height: 14 }} />
        </motion.span>

        {/* Overall status icon */}
        <StatusIcon status={status} size={13} />

        {isRunning ? (
          /* Running header: "Running N agents..." */
          <span style={{ flex: 1, fontWeight: 500 }}>
            Running {agentCount} agent{agentCount !== 1 ? 's' : ''}…
          </span>
        ) : expanded ? (
          /* Expanded header: strategy label + agent count */
          <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 500 }}>Orchestrator</span>
            <span style={{ color: mutedColor }}>
              — {strategy}
              {agentCount > 0 ? `, ${agentCount} agent${agentCount !== 1 ? 's' : ''}` : ''}
            </span>
          </span>
        ) : (
          /* Collapsed summary */
          <span style={{ flex: 1, color: mutedColor }}>
            {summaryText}
          </span>
        )}
      </button>

      {/* ── Expanded body ───────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '4px 12px 10px 12px',
                borderTop: `1px solid ${border}`,
              }}
            >
              {agentList.length === 0 ? (
                <div style={{ color: mutedColor, fontSize: 12, padding: '4px 0' }}>
                  Waiting for agents…
                </div>
              ) : (
                agentList.map(agent => (
                  <AgentRow
                    key={agent.agentId}
                    agent={agent}
                    isDark={isDark}
                    executionId={executionId}
                    textPrimary={textPrimary}
                    textMuted={mutedColor}
                    onApprove={onApprove}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AgentExecutionTree;
