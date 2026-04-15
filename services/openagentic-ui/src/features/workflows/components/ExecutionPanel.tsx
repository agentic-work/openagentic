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
 * Execution Panel - Bottom DevTools Panel (v2)
 * Shows execution timeline, node I/O inspector with smart rendering,
 * execution history with drill-down, streaming logs, and cost summary.
 * Inspired by Chrome DevTools' Network + Performance panels.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Zap,
  CheckCircle,
  XCircle,
  AlertCircle,
  X,
  Activity,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  Brain,
  Code,
  Globe,
  Settings,
  GitBranch,
  ArrowRightLeft,
  Terminal,
  Copy,
  Search,
  Filter,
} from '@/shared/icons';
import { format } from 'date-fns';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';

export interface NodeExecution {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: number;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  tokens?: number;
  cost?: number;
  logs?: ExecutionLogEntry[];
}

export interface ExecutionLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  data?: any;
  node_id?: string;
}

export interface ExecutionData {
  executionId: string;
  status: 'running' | 'completed' | 'failed' | 'completed_with_errors';
  startedAt: string;
  completedAt?: string;
  totalDuration?: number;
  nodeExecutions: NodeExecution[];
  totalTokens?: number;
  estimatedCost?: number;
  streamingLogs?: ExecutionLogEntry[];
}

interface HistoryExecution {
  id: string;
  status: string;
  trigger_type?: string;
  total_nodes?: number;
  completed_nodes?: number;
  execution_time_ms?: number;
  cost?: number;
  started_at: string;
  completed_at?: string;
  error?: string;
}

interface HistoryDetail {
  execution: any;
  logs: ExecutionLogEntry[];
  nodeSummary: Record<string, {
    status: string;
    input?: any;
    output?: any;
    duration?: number;
    error?: string;
    logs?: ExecutionLogEntry[];
  }>;
}

interface ExecutionPanelProps {
  execution: ExecutionData | null;
  isOpen: boolean;
  onToggle: () => void;
  onNodeSelect?: (nodeId: string) => void;
  onRerun?: () => void;
  workflowId?: string;
  height?: number;
  onHeightChange?: (height: number) => void;
}

type InspectorTab = 'input' | 'output' | 'logs' | 'artifacts';
type PanelTab = 'current' | 'history' | 'streaming-logs' | 'validation';

// ─── Node Type Icons ─────────────────────────────────────────────
const NODE_TYPE_ICONS: Record<string, React.ComponentType<any>> = {
  openagentic_llm: Brain, llm_completion: Brain, multi_agent: Brain,
  agent_single: Brain, agent_pool: Brain, agent_supervisor: Brain,
  code: Code, openagentic: Terminal,
  http_request: Globe, mcp_tool: Settings,
  condition: GitBranch, transform: ArrowRightLeft,
  trigger: Zap,
};

function getNodeIcon(nodeType: string) {
  const Icon = NODE_TYPE_ICONS[nodeType] || Activity;
  return <Icon className="w-3 h-3" />;
}

// ─── JSON Tree Viewer ────────────────────────────────────────────
const JsonTree: React.FC<{ data: any; maxDepth?: number; copyable?: boolean }> = ({ data, maxDepth = 4, copyable }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (data === null || data === undefined) {
    return <span className="text-gray-500 italic">null</span>;
  }

  if (typeof data === 'string') {
    const isLong = data.length > 300;
    if (isLong) {
      return (
        <div>
          <span className="text-green-400 whitespace-pre-wrap">"{data.substring(0, 300)}"</span>
          <span className="text-gray-500 text-[10px] ml-1">...{data.length - 300} more chars</span>
        </div>
      );
    }
    return <span className="text-green-400 whitespace-pre-wrap">"{data}"</span>;
  }

  if (typeof data === 'number') return <span className="text-blue-400">{data}</span>;
  if (typeof data === 'boolean') return <span className="text-yellow-400">{String(data)}</span>;

  if (maxDepth <= 0) {
    return <span className="text-gray-500">{Array.isArray(data) ? `[${data.length}]` : '{...}'}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-500">[]</span>;
    return (
      <div className="pl-3 border-l border-gray-700/30">
        <span className="text-gray-600 text-[10px]">[{data.length}]</span>
        {data.slice(0, 20).map((item, i) => (
          <div key={i} className="py-0.5">
            <span className="text-gray-600 mr-1.5 select-none">{i}</span>
            <JsonTree data={item} maxDepth={maxDepth - 1} />
          </div>
        ))}
        {data.length > 20 && (
          <div className="text-gray-500 text-[10px] py-0.5">...{data.length - 20} more items</div>
        )}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) return <span className="text-gray-500">{'{}'}</span>;
    return (
      <div className="pl-3 border-l border-gray-700/30">
        {entries.slice(0, 30).map(([key, value]) => (
          <div key={key} className="py-0.5">
            <span className="text-purple-400 mr-1.5">{key}:</span>
            <JsonTree data={value} maxDepth={maxDepth - 1} />
          </div>
        ))}
        {entries.length > 30 && (
          <div className="text-gray-500 text-[10px] py-0.5">...{entries.length - 30} more keys</div>
        )}
      </div>
    );
  }

  return <span className="text-gray-400">{String(data)}</span>;
};

// ─── Smart Node Output Renderer ──────────────────────────────────
const NodeOutputRenderer: React.FC<{ output: any; nodeType: string; error?: string }> = ({ output, nodeType, error }) => {
  if (error) {
    return (
      <div className="rounded p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <div className="text-red-400 text-[11px] font-semibold mb-1 flex items-center gap-1.5">
          <XCircle className="w-3 h-3" /> Error
        </div>
        <pre className="text-red-300 text-[11px] whitespace-pre-wrap font-mono">{error}</pre>
      </div>
    );
  }

  if (!output && output !== 0 && output !== false) {
    return <span className="text-gray-500 italic text-[11px]">No output</span>;
  }

  const isLLM = ['openagentic_llm', 'llm_completion', 'multi_agent', 'agent_single', 'agent_pool', 'agent_supervisor'].includes(nodeType);
  const isCode = ['code', 'openagentic'].includes(nodeType);
  const isHTTP = nodeType === 'http_request';
  const isMCP = nodeType === 'mcp_tool';
  const isCondition = nodeType === 'condition';

  // LLM output: render as text with token info
  if (isLLM) {
    const content = typeof output === 'string' ? output
      : output?.content || output?.text || output?.result || output?.response
      || (typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output));
    const tokens = output?.tokensUsed || output?.tokens || output?.usage?.total_tokens;
    const model = output?.model || output?.modelUsed;

    return (
      <div className="space-y-2">
        {(model || tokens) && (
          <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {model && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,77,255,0.1)', color: '#a78bfa' }}>{model}</span>}
            {tokens && <span>{tokens.toLocaleString()} tokens</span>}
          </div>
        )}
        <div className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
          {content}
        </div>
      </div>
    );
  }

  // Code output: stdout/stderr
  if (isCode) {
    const stdout = output?.stdout || output?.output || (typeof output === 'string' ? output : null);
    const stderr = output?.stderr;
    const exitCode = output?.exitCode ?? output?.exit_code;
    const language = output?.language;

    return (
      <div className="space-y-2">
        {language && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(96,125,139,0.15)', color: '#90a4ae' }}>{language}</span>
        )}
        {exitCode !== undefined && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${exitCode === 0 ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
            exit {exitCode}
          </span>
        )}
        {stdout && (
          <pre className="text-[11px] font-mono p-2 rounded overflow-x-auto whitespace-pre-wrap"
            style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
            {stdout}
          </pre>
        )}
        {stderr && (
          <pre className="text-[11px] font-mono p-2 rounded overflow-x-auto whitespace-pre-wrap text-red-300"
            style={{ background: 'rgba(239,68,68,0.06)' }}>
            {stderr}
          </pre>
        )}
        {!stdout && !stderr && <JsonTree data={output} />}
      </div>
    );
  }

  // HTTP output: status + headers + body
  if (isHTTP) {
    const status = output?.status || output?.statusCode;
    const headers = output?.headers;
    const body = output?.body || output?.data;
    const isOk = status && status >= 200 && status < 400;

    return (
      <div className="space-y-2">
        {status && (
          <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${isOk ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
            {status} {output?.statusText || ''}
          </span>
        )}
        {headers && (
          <details className="group">
            <summary className="text-[10px] cursor-pointer" style={{ color: 'var(--color-text-tertiary)' }}>
              Headers ({Object.keys(headers).length})
            </summary>
            <div className="mt-1 pl-2">
              <JsonTree data={headers} maxDepth={1} />
            </div>
          </details>
        )}
        {body && (
          <div>
            <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Body</div>
            {typeof body === 'string' ? (
              <pre className="text-[11px] font-mono p-2 rounded overflow-x-auto whitespace-pre-wrap"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                {body.substring(0, 2000)}{body.length > 2000 ? `\n...${body.length - 2000} more chars` : ''}
              </pre>
            ) : (
              <JsonTree data={body} />
            )}
          </div>
        )}
        {!status && !body && <JsonTree data={output} />}
      </div>
    );
  }

  // MCP tool: show tool name + result
  if (isMCP) {
    const toolName = output?.toolName || output?.tool;
    const result = output?.result || output?.content || output;

    return (
      <div className="space-y-2">
        {toolName && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,188,212,0.1)', color: '#4dd0e1' }}>
            {toolName}
          </span>
        )}
        {typeof result === 'string' ? (
          <div className="text-[11px] whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{result}</div>
        ) : (
          <JsonTree data={result} />
        )}
      </div>
    );
  }

  // Condition: show which branch
  if (isCondition) {
    const branch = output?.branch || output?.result;
    const condition = output?.condition || output?.expression;

    return (
      <div className="space-y-2">
        {condition && (
          <div className="text-[10px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
            {condition}
          </div>
        )}
        {branch !== undefined && (
          <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
            branch === true || branch === 'true' ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'
          }`}>
            Branch: {String(branch)}
          </span>
        )}
        <JsonTree data={output} />
      </div>
    );
  }

  // Default: JSON tree
  return <JsonTree data={output} />;
};

// ─── Log Level Badge ─────────────────────────────────────────────
const LogLevelBadge: React.FC<{ level: string }> = ({ level }) => {
  const colors: Record<string, { text: string; bg: string }> = {
    debug: { text: '#8E8E93', bg: 'rgba(142,142,147,0.1)' },
    info: { text: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
    warn: { text: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    error: { text: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  };
  const c = colors[level] || colors.info;
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider"
      style={{ color: c.text, background: c.bg }}>
      {level}
    </span>
  );
};

// ─── Duration Format ─────────────────────────────────────────────
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

// ═════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════

export const ExecutionPanel: React.FC<ExecutionPanelProps> = ({
  execution,
  isOpen,
  onToggle,
  onNodeSelect,
  onRerun,
  workflowId,
  height = 320,
}) => {
  const { getAuthHeaders } = useAuth();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('output');
  const [panelTab, setPanelTab] = useState<PanelTab>('current');
  const [isResizing, setIsResizing] = useState(false);
  const [panelHeight, setPanelHeight] = useState(height);
  const [isMaximized, setIsMaximized] = useState(false);
  const [logFilter, setLogFilter] = useState('');

  // History state
  const [history, setHistory] = useState<HistoryExecution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [historySelectedNode, setHistorySelectedNode] = useState<string | null>(null);
  const [historyInspectorTab, setHistoryInspectorTab] = useState<InspectorTab>('output');

  // Validation state
  const [validationResult, setValidationResult] = useState<{
    ready: boolean;
    compilation: { valid: boolean; errors: any[]; warnings: any[] };
    runtime: { ready: boolean; issues: any[] };
  } | null>(null);
  const [validating, setValidating] = useState(false);

  const handleValidate = useCallback(async () => {
    if (!workflowId || validating) return;
    setValidating(true);
    setValidationResult(null);
    setPanelTab('validation');
    try {
      const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/validate`), {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const result = await response.json();
        setValidationResult(result);
      }
    } catch {
      // ignore
    } finally {
      setValidating(false);
    }
  }, [workflowId, validating, getAuthHeaders]);

  // Streaming logs
  const [streamingLogs, setStreamingLogs] = useState<ExecutionLogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Accumulate streaming logs from execution
  useEffect(() => {
    if (execution?.streamingLogs) {
      setStreamingLogs(execution.streamingLogs);
    }
  }, [execution?.streamingLogs]);

  // Auto-scroll logs
  useEffect(() => {
    if (panelTab === 'streaming-logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingLogs, panelTab]);

  // Switch to current tab when a new execution starts
  useEffect(() => {
    if (execution?.status === 'running') {
      setPanelTab('current');
    }
  }, [execution?.executionId]);

  // Fetch execution history
  const fetchHistory = useCallback(async () => {
    if (!workflowId) return;
    setHistoryLoading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions`), { headers });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.executions || []);
      }
    } catch (err) {
      console.error('Failed to fetch execution history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [workflowId, getAuthHeaders]);

  // Fetch execution detail
  const fetchHistoryDetail = useCallback(async (execId: string) => {
    if (!workflowId) return;
    setHistoryDetailLoading(true);
    setHistoryDetail(null);
    setHistorySelectedNode(null);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions/${execId}`), { headers });
      if (res.ok) {
        const data = await res.json();
        setHistoryDetail(data);
      }
    } catch (err) {
      console.error('Failed to fetch execution detail:', err);
    } finally {
      setHistoryDetailLoading(false);
    }
  }, [workflowId, getAuthHeaders]);

  useEffect(() => {
    if (panelTab === 'history' && isOpen && workflowId) {
      fetchHistory();
    }
  }, [panelTab, isOpen, workflowId, fetchHistory]);

  // When history execution selected, fetch its detail
  useEffect(() => {
    if (selectedHistoryId) {
      fetchHistoryDetail(selectedHistoryId);
    }
  }, [selectedHistoryId, fetchHistoryDetail]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !execution) return null;
    return execution.nodeExecutions.find(n => n.nodeId === selectedNodeId) || null;
  }, [selectedNodeId, execution]);

  // Timeline calculations
  const timelineData = useMemo(() => {
    if (!execution?.nodeExecutions.length) return { maxTime: 0, nodes: [] };
    const maxTime = Math.max(
      ...execution.nodeExecutions
        .filter(n => n.startTime !== undefined && n.duration !== undefined)
        .map(n => (n.startTime || 0) + (n.duration || 0)),
      1
    );
    return { maxTime, nodes: execution.nodeExecutions };
  }, [execution]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(prev => prev === nodeId ? null : nodeId);
    onNodeSelect?.(nodeId);
  }, [onNodeSelect]);

  // Resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = panelHeight;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      setPanelHeight(Math.max(150, Math.min(800, startHeight + delta)));
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelHeight]);

  // Copy output to clipboard
  const copyToClipboard = useCallback((data: any) => {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const statusColor = execution?.status === 'completed' ? 'var(--color-success)'
    : execution?.status === 'completed_with_errors' ? '#f59e0b'
    : execution?.status === 'failed' ? '#ef4444'
    : '#3b82f6';

  const completedCount = execution?.nodeExecutions.filter(n => n.status === 'completed').length || 0;
  const failedCount = execution?.nodeExecutions.filter(n => n.status === 'failed').length || 0;
  const totalCount = execution?.nodeExecutions.length || 0;
  const actualHeight = isMaximized ? 600 : panelHeight;

  // ─── History node summary for timeline ──────────────────────
  const historyNodes = useMemo(() => {
    if (!historyDetail?.nodeSummary) return [];
    return Object.entries(historyDetail.nodeSummary).map(([nodeId, info]) => ({
      nodeId,
      nodeLabel: nodeId.replace(/-\d+$/, '').replace(/_/g, ' '),
      nodeType: (info as any).nodeType || 'unknown',
      status: (info as any).status === 'success' ? 'completed' : (info as any).status || 'completed',
      duration: (info as any).duration,
      input: (info as any).input,
      output: (info as any).output,
      error: (info as any).error,
      logs: (info as any).logs,
    }));
  }, [historyDetail]);

  const historyMaxTime = useMemo(() => {
    return Math.max(...historyNodes.map(n => n.duration || 0), 1);
  }, [historyNodes]);

  const selectedHistoryNode = useMemo(() => {
    if (!historySelectedNode) return null;
    return historyNodes.find(n => n.nodeId === historySelectedNode) || null;
  }, [historySelectedNode, historyNodes]);

  // ─── Filtered logs ──────────────────────────────────────────
  const filteredLogs = useMemo(() => {
    const logs = execution?.streamingLogs || streamingLogs || [];
    if (!logFilter) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter(l => l.message.toLowerCase().includes(q) || l.level.includes(q));
  }, [execution?.streamingLogs, streamingLogs, logFilter]);

  return (
    <div className="relative">
      {/* Toggle Bar */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-1.5 border-t transition-colors cursor-pointer"
        style={{
          background: 'var(--color-surface, #1C1C1E)',
          borderColor: 'var(--color-border, rgba(255,255,255,0.08))',
        }}
      >
        <div className="flex items-center gap-3">
          <Activity className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-medium text-gray-400">Execution</span>
          {execution && (
            <>
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[11px] text-gray-400">
                {completedCount}/{totalCount} nodes
                {failedCount > 0 && ` (${failedCount} failed)`}
                {execution.totalDuration != null && ` - ${formatDuration(execution.totalDuration)}`}
              </span>
              {execution.status === 'running' && (
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {workflowId && (
            <button
              onClick={(e) => { e.stopPropagation(); handleValidate(); }}
              disabled={validating}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                validationResult?.ready === true ? 'text-green-400 hover:bg-green-500/20' :
                validationResult?.ready === false ? 'text-red-400 hover:bg-red-500/20' :
                'text-yellow-400 hover:bg-yellow-500/20'
              }`}
              title="Validate workflow readiness"
            >
              {validating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />}
              {validating ? 'Checking...' : validationResult?.ready === true ? 'Ready' : validationResult?.ready === false ? `${(validationResult.compilation.errors.length || 0) + (validationResult.runtime.issues.length || 0)} Issues` : 'Validate'}
            </button>
          )}
          {onRerun && execution?.status !== 'running' && (
            <button
              onClick={(e) => { e.stopPropagation(); onRerun(); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-blue-500/20 text-blue-400"
              title="Re-run workflow"
            >
              <RotateCcw className="w-3 h-3" />
              Re-run
            </button>
          )}
          {execution?.estimatedCost != null && execution.estimatedCost > 0 && (
            <span className="text-[11px] text-gray-400">${execution.estimatedCost.toFixed(4)}</span>
          )}
          {execution?.totalTokens != null && execution.totalTokens > 0 && (
            <span className="text-[11px] text-gray-400">{execution.totalTokens.toLocaleString()} tok</span>
          )}
          {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronUp className="w-3.5 h-3.5 text-gray-400" />}
        </div>
      </button>

      {/* Panel Content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: actualHeight }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t"
            style={{
              background: 'var(--color-bg-primary, #000000)',
              borderColor: 'var(--color-border, rgba(255,255,255,0.08))',
            }}
          >
            {/* Resize Handle */}
            <div
              className={`h-1 cursor-ns-resize hover:bg-blue-500/30 transition-colors ${isResizing ? 'bg-blue-500/50' : ''}`}
              onMouseDown={handleMouseDown}
            />

            {/* Panel Tabs */}
            <div
              className="flex items-center gap-1 px-3 py-1.5 border-b"
              style={{
                background: 'var(--color-surface, #1C1C1E)',
                borderColor: 'var(--color-border, rgba(255,255,255,0.08))',
              }}
            >
              {(['current', 'history', 'streaming-logs', 'validation'] as PanelTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setPanelTab(tab)}
                  className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                    panelTab === tab ? 'bg-blue-500/20 text-blue-400' : ''
                  }`}
                  style={panelTab !== tab ? { color: 'var(--color-text-tertiary, #636366)' } : undefined}
                >
                  {tab === 'current' ? 'Current Run'
                    : tab === 'history' ? 'History'
                    : tab === 'validation' ? 'Validate'
                    : 'Logs'}
                  {tab === 'streaming-logs' && streamingLogs.length > 0 && (
                    <span className="ml-1 text-[9px] opacity-70">({streamingLogs.length})</span>
                  )}
                  {tab === 'validation' && validationResult && !validationResult.ready && (
                    <span className="ml-1 text-[9px] text-red-400">
                      ({(validationResult.compilation.errors.length || 0) + (validationResult.runtime.issues.length || 0)})
                    </span>
                  )}
                </button>
              ))}

              <div className="ml-auto flex items-center gap-1">
                {panelTab === 'history' && (
                  <button
                    onClick={fetchHistory}
                    className="p-1 rounded hover:bg-white/5 transition-colors"
                    style={{ color: 'var(--color-text-tertiary, #636366)' }}
                    title="Refresh history"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  className="p-1 rounded hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--color-text-tertiary, #636366)' }}
                  title={isMaximized ? 'Restore' : 'Maximize'}
                >
                  {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {/* ═══ STREAMING LOGS TAB ═══ */}
            {panelTab === 'streaming-logs' && (
              <div className="flex flex-col" style={{ height: actualHeight - 40 }}>
                {/* Log filter */}
                <div className="px-3 py-1.5 border-b flex items-center gap-2"
                  style={{ borderColor: 'var(--color-border, rgba(255,255,255,0.08))' }}>
                  <Search className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input
                    type="text"
                    value={logFilter}
                    onChange={e => setLogFilter(e.target.value)}
                    placeholder="Filter logs..."
                    className="flex-1 bg-transparent text-[11px] outline-none"
                    style={{ color: 'var(--color-text)' }}
                  />
                  {logFilter && (
                    <button onClick={() => setLogFilter('')} className="p-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-[11px]">
                  {filteredLogs.length === 0 ? (
                    <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                      <div className="text-center">
                        <Terminal className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        <p className="text-xs">No logs yet</p>
                        <p className="text-[10px] mt-1 opacity-60">Logs will stream here during execution</p>
                      </div>
                    </div>
                  ) : (
                    filteredLogs.map((log, i) => (
                      <div key={i} className="flex items-start gap-2 py-0.5 hover:bg-white/[0.02]">
                        <span className="text-[10px] flex-shrink-0 w-16 text-right" style={{ color: 'var(--color-text-tertiary)' }}>
                          {log.timestamp ? format(new Date(log.timestamp), 'HH:mm:ss') : ''}
                        </span>
                        <LogLevelBadge level={log.level} />
                        {log.node_id && (
                          <span className="text-[10px] px-1 rounded flex-shrink-0" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                            {log.node_id}
                          </span>
                        )}
                        <span style={{ color: log.level === 'error' ? '#ef4444' : log.level === 'warn' ? '#f59e0b' : 'var(--color-text-secondary)' }}>
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}

            {/* ═══ VALIDATION TAB ═══ */}
            {panelTab === 'validation' && (
              <div className="overflow-y-auto px-4 py-3" style={{ height: actualHeight - 40 }}>
                {!validationResult && !validating && (
                  <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                    <AlertCircle className="w-8 h-8 mb-3 opacity-30" />
                    <p className="text-xs mb-2">Pre-flight check for your workflow</p>
                    <button
                      onClick={handleValidate}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                    >
                      Run Validation
                    </button>
                  </div>
                )}
                {validating && (
                  <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-xs">Checking workflow readiness...</span>
                  </div>
                )}
                {validationResult && !validating && (
                  <div className="space-y-3">
                    {/* Overall status */}
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                      validationResult.ready
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {validationResult.ready ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      {validationResult.ready ? 'Workflow is ready to execute' : 'Issues found — fix before executing'}
                    </div>

                    {/* Compilation errors */}
                    {validationResult.compilation.errors.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-red-400 mb-1.5 uppercase tracking-wide">Structure Errors</h4>
                        {validationResult.compilation.errors.map((err: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 px-2 py-1.5 text-[11px] rounded mb-1"
                            style={{ background: 'rgba(239,68,68,0.06)', color: 'var(--color-text-secondary)' }}
                            onClick={() => err.nodeId && onNodeSelect?.(err.nodeId)}
                          >
                            <XCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <span className="text-red-300 font-medium">[{err.code}]</span>{' '}
                              {err.message}
                              {err.nodeId && <span className="text-gray-500 ml-1">({err.nodeId})</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Runtime issues - grouped by category */}
                    {validationResult.runtime.issues.length > 0 && (() => {
                      const credentialCodes = new Set(['MISSING_CREDENTIAL', 'SECRET_NOT_FOUND', 'ENV_NOT_SET', 'HARDCODED_CREDENTIAL']);
                      const configCodes = new Set(['EMPTY_PROMPT', 'EMPTY_CODE', 'NO_CONDITION', 'NO_TOOL_SELECTED', 'NO_TOOL_SERVER', 'EMPTY_URL', 'INVALID_URL', 'NO_HTTP_METHOD', 'NO_AGENTS', 'NO_TASK', 'NO_GOAL', 'NO_TRANSFORM', 'NO_COLLECTION', 'NO_QUERY', 'NO_LOOP_LIMIT', 'NO_LOOP_DATA', 'NO_WEBHOOK_PATH', 'NO_SCHEDULE', 'NO_APPROVERS', 'NO_CREW_CONFIG', 'NO_GRAPH_CONFIG', 'INCOMPLETE_CONDITION']);
                      const availCodes = new Set(['MODEL_UNAVAILABLE', 'TOOL_NOT_FOUND', 'MISSING_TOOL_PARAM']);
                      const flowCodes = new Set(['DISCONNECTED_NODE', 'NO_INPUT_SOURCE']);

                      const groups = [
                        { label: 'Credentials & Secrets', icon: '🔑', codes: credentialCodes, color: 'red' },
                        { label: 'Missing Configuration', icon: '⚙️', codes: configCodes, color: 'yellow' },
                        { label: 'Availability', icon: '🔌', codes: availCodes, color: 'orange' },
                        { label: 'Data Flow', icon: '↔️', codes: flowCodes, color: 'blue' },
                      ];

                      const allIssues = validationResult.runtime.issues as any[];
                      const categorized = new Set<number>();

                      return (
                        <div className="space-y-2">
                          {groups.map(group => {
                            const groupIssues = allIssues.filter((issue: any, idx: number) => {
                              if (group.codes.has(issue.code)) { categorized.add(idx); return true; }
                              return false;
                            });
                            if (groupIssues.length === 0) return null;
                            const colorMap: Record<string, string> = { red: 'text-red-400', yellow: 'text-yellow-400', orange: 'text-orange-400', blue: 'text-blue-400' };
                            const bgMap: Record<string, string> = { red: 'rgba(239,68,68,0.06)', yellow: 'rgba(245,158,11,0.06)', orange: 'rgba(249,115,22,0.06)', blue: 'rgba(59,130,246,0.06)' };
                            return (
                              <div key={group.label}>
                                <h4 className={`text-[11px] font-semibold ${colorMap[group.color]} mb-1.5 uppercase tracking-wide`}>
                                  {group.icon} {group.label} ({groupIssues.length})
                                </h4>
                                {groupIssues.map((issue: any, i: number) => (
                                  <div key={i} className="flex items-start gap-2 px-2 py-1.5 text-[11px] rounded mb-1 cursor-pointer hover:bg-white/[0.03]"
                                    style={{ background: bgMap[group.color], color: 'var(--color-text-secondary)' }}
                                    onClick={() => issue.nodeId && onNodeSelect?.(issue.nodeId)}
                                  >
                                    <AlertCircle className={`w-3 h-3 ${colorMap[group.color]} flex-shrink-0 mt-0.5`} />
                                    <div>
                                      <span className={`${colorMap[group.color]} font-medium`}>[{issue.code}]</span>{' '}
                                      {issue.message}
                                      {issue.nodeId && <span className="text-gray-500 ml-1 cursor-pointer hover:text-gray-300">(click to select)</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                          {/* Uncategorized issues */}
                          {allIssues.filter((_: any, idx: number) => !categorized.has(idx)).length > 0 && (
                            <div>
                              <h4 className="text-[11px] font-semibold text-yellow-400 mb-1.5 uppercase tracking-wide">Other Issues</h4>
                              {allIssues.filter((_: any, idx: number) => !categorized.has(idx)).map((issue: any, i: number) => (
                                <div key={i} className="flex items-start gap-2 px-2 py-1.5 text-[11px] rounded mb-1 cursor-pointer hover:bg-white/[0.03]"
                                  style={{ background: 'rgba(245,158,11,0.06)', color: 'var(--color-text-secondary)' }}
                                  onClick={() => issue.nodeId && onNodeSelect?.(issue.nodeId)}
                                >
                                  <AlertCircle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <span className="text-yellow-300 font-medium">[{issue.code}]</span>{' '}
                                    {issue.message}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Warnings */}
                    {validationResult.compilation.warnings.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">Warnings</h4>
                        {validationResult.compilation.warnings.map((w: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 px-2 py-1.5 text-[11px] rounded mb-1"
                            style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--color-text-tertiary)' }}
                          >
                            <AlertCircle className="w-3 h-3 text-gray-500 flex-shrink-0 mt-0.5" />
                            <span>{w.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Re-validate button */}
                    <button
                      onClick={handleValidate}
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors hover:bg-blue-500/20 text-blue-400 border border-blue-500/20"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Re-validate
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ HISTORY TAB ═══ */}
            {panelTab === 'history' && workflowId && (
              <div className="overflow-hidden" style={{ height: actualHeight - 40 }}>
                {historyLoading ? (
                  <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                    <p className="text-xs">Loading history...</p>
                  </div>
                ) : history.length === 0 ? (
                  <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                    <div className="text-center">
                      <Clock className="w-6 h-6 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">No execution history</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full">
                    {/* History list (left) */}
                    <div className="w-56 flex-shrink-0 border-r overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
                      {history.map(exec => {
                        const sc = exec.status === 'completed' ? '#00D26A'
                          : exec.status === 'failed' ? '#ef4444'
                          : exec.status === 'running' ? '#3b82f6'
                          : '#6b7280';
                        const isSelected = selectedHistoryId === exec.id;
                        return (
                          <div
                            key={exec.id}
                            onClick={() => setSelectedHistoryId(isSelected ? null : exec.id)}
                            className="flex items-center gap-2.5 px-3 py-2 border-b cursor-pointer transition-colors hover:bg-white/[0.02]"
                            style={{
                              borderColor: 'var(--color-border)',
                              background: isSelected ? 'var(--color-bg-secondary)' : undefined,
                            }}
                          >
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: sc }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                                  {exec.id.substring(0, 8)}
                                </span>
                                <span className="text-[9px] px-1 py-0.5 rounded uppercase font-bold"
                                  style={{ color: sc, backgroundColor: `${sc}15` }}>
                                  {exec.status}
                                </span>
                              </div>
                              <div className="text-[10px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                <span>{exec.started_at ? format(new Date(exec.started_at), 'MMM d, HH:mm') : '-'}</span>
                                {exec.execution_time_ms != null && (
                                  <span>{formatDuration(exec.execution_time_ms)}</span>
                                )}
                                {exec.cost != null && exec.cost > 0 && (
                                  <span>${exec.cost.toFixed(3)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* History detail (right) */}
                    <div className="flex-1 overflow-hidden">
                      {!selectedHistoryId ? (
                        <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                          <p className="text-xs">Select an execution to inspect</p>
                        </div>
                      ) : historyDetailLoading ? (
                        <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                          <p className="text-xs">Loading execution detail...</p>
                        </div>
                      ) : !historyDetail ? (
                        <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                          <p className="text-xs">Failed to load execution detail</p>
                        </div>
                      ) : (
                        <div className="flex h-full">
                          {/* History Timeline */}
                          <div className="w-1/2 border-r overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
                            {/* Summary bar */}
                            <div className="sticky top-0 z-10 px-3 py-2 border-b flex items-center gap-3"
                              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                              <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-bold"
                                style={{
                                  color: historyDetail.execution?.status === 'completed' ? 'var(--color-success)' : '#ef4444',
                                  background: historyDetail.execution?.status === 'completed' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                }}>
                                {historyDetail.execution?.status}
                              </span>
                              {historyDetail.execution?.execution_time_ms != null && (
                                <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                  {formatDuration(historyDetail.execution.execution_time_ms)}
                                </span>
                              )}
                              <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                {historyNodes.length} nodes
                              </span>
                            </div>

                            {/* Node timeline bars */}
                            <div className="p-2 space-y-1">
                              {historyNodes.map((node) => {
                                const widthPct = historyMaxTime > 0
                                  ? Math.max(((node.duration || 0) / historyMaxTime) * 100, 3)
                                  : 3;
                                const barColor = node.status === 'completed' || node.status === 'success' ? 'var(--color-success)'
                                  : node.status === 'failed' || node.status === 'error' ? '#ef4444'
                                  : '#4b5563';
                                const isSelected = historySelectedNode === node.nodeId;

                                return (
                                  <div
                                    key={node.nodeId}
                                    onClick={() => setHistorySelectedNode(prev => prev === node.nodeId ? null : node.nodeId)}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-white/[0.03]"
                                    style={{ background: isSelected ? 'var(--color-bg-secondary)' : undefined }}
                                  >
                                    <div className="flex-shrink-0 w-4">
                                      {(node.status === 'completed' || node.status === 'success') && <CheckCircle className="w-3 h-3 text-green-400" />}
                                      {(node.status === 'failed' || node.status === 'error') && <XCircle className="w-3 h-3 text-red-400" />}
                                      {!['completed', 'failed', 'success', 'error'].includes(node.status) && (
                                        <div className="w-3 h-3 rounded-full" style={{ background: 'var(--color-text-tertiary)' }} />
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0 w-28">
                                      {getNodeIcon(node.nodeType)}
                                      <span className="text-[11px] truncate font-medium" style={{ color: 'var(--color-text)' }}>
                                        {node.nodeLabel}
                                      </span>
                                    </div>
                                    <div className="flex-1 h-3.5 rounded relative overflow-hidden"
                                      style={{ background: 'var(--color-bg-secondary)' }}>
                                      <div className="absolute h-full rounded" style={{ width: `${widthPct}%`, backgroundColor: barColor, opacity: 0.6 }} />
                                    </div>
                                    <span className="flex-shrink-0 w-14 text-[10px] text-right" style={{ color: 'var(--color-text-tertiary)' }}>
                                      {node.duration != null ? formatDuration(node.duration) : '-'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* History Node Inspector */}
                          <div className="w-1/2 overflow-hidden flex flex-col">
                            {!selectedHistoryNode ? (
                              <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                                <div className="text-center">
                                  <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-30" />
                                  <p className="text-xs">Click a node to inspect I/O</p>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex-shrink-0 px-3 py-2 border-b"
                                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      {getNodeIcon(selectedHistoryNode.nodeType)}
                                      <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{selectedHistoryNode.nodeLabel}</span>
                                      <span className="text-[9px] px-1.5 py-0.5 rounded uppercase"
                                        style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                                        {selectedHistoryNode.nodeType}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => copyToClipboard(selectedHistoryNode.output)} className="p-0.5 rounded hover:bg-white/5"
                                        style={{ color: 'var(--color-text-tertiary)' }} title="Copy output">
                                        <Copy className="w-3 h-3" />
                                      </button>
                                      <button onClick={() => setHistorySelectedNode(null)} className="p-0.5 rounded hover:opacity-80"
                                        style={{ color: 'var(--color-text-tertiary)' }}>
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="flex gap-1 mt-2">
                                    {(['input', 'output', 'logs'] as InspectorTab[]).map(tab => (
                                      <button key={tab} onClick={() => setHistoryInspectorTab(tab)}
                                        className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors uppercase tracking-wider ${
                                          historyInspectorTab === tab ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'border border-transparent'
                                        }`}
                                        style={historyInspectorTab !== tab ? { color: 'var(--color-text-tertiary)' } : undefined}>
                                        {tab}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px]">
                                  {historyInspectorTab === 'input' && <JsonTree data={selectedHistoryNode.input} />}
                                  {historyInspectorTab === 'output' && (
                                    <NodeOutputRenderer output={selectedHistoryNode.output} nodeType={selectedHistoryNode.nodeType} error={selectedHistoryNode.error} />
                                  )}
                                  {historyInspectorTab === 'logs' && (
                                    <div className="space-y-0.5">
                                      {(!selectedHistoryNode.logs || selectedHistoryNode.logs.length === 0) ? (
                                        <span style={{ color: 'var(--color-text-tertiary)' }}>No logs for this node</span>
                                      ) : (
                                        selectedHistoryNode.logs.map((log: any, i: number) => (
                                          <div key={i} className="flex items-start gap-2 py-0.5">
                                            <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                                              {log.timestamp ? format(new Date(log.timestamp), 'HH:mm:ss.SSS') : ''}
                                            </span>
                                            <LogLevelBadge level={log.level} />
                                            <span style={{ color: log.level === 'error' ? '#ef4444' : 'var(--color-text-secondary)' }}>
                                              {log.message}
                                            </span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ CURRENT RUN TAB ═══ */}
            {panelTab === 'current' && (
              !execution ? (
                <div className="flex items-center justify-center" style={{ height: actualHeight - 40, color: 'var(--color-text-tertiary)' }}>
                  <div className="text-center">
                    <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No execution data</p>
                    <p className="text-xs mt-1 opacity-60">Execute a workflow to see results here</p>
                  </div>
                </div>
              ) : (
                <div className="flex" style={{ height: actualHeight - 40 }}>
                  {/* Left: Timeline */}
                  <div className="w-1/2 border-r overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="sticky top-0 z-10 px-3 py-2 border-b flex items-center justify-between"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Timeline</span>
                        {execution.status === 'running' && (
                          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                        )}
                      </div>
                      <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        {execution.totalDuration ? formatDuration(execution.totalDuration) : 'Running...'}
                      </span>
                    </div>

                    <div className="p-2 space-y-0.5">
                      {timelineData.nodes.map((node, idx) => {
                        const startPct = timelineData.maxTime > 0
                          ? ((node.startTime || 0) / timelineData.maxTime) * 100 : 0;
                        const widthPct = timelineData.maxTime > 0
                          ? Math.max(((node.duration || 0) / timelineData.maxTime) * 100, 3)
                          : (node.status === 'running' ? 50 : 3);
                        const barColor = node.status === 'completed' ? 'var(--color-success)'
                          : node.status === 'failed' ? '#ef4444'
                          : node.status === 'running' ? '#3b82f6'
                          : node.status === 'skipped' ? '#4b5563'
                          : '#374151';
                        const isSelected = selectedNodeId === node.nodeId;

                        return (
                          <div
                            key={node.nodeId}
                            onClick={() => handleNodeClick(node.nodeId)}
                            className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-white/[0.03]"
                            style={{ background: isSelected ? 'var(--color-bg-secondary)' : undefined }}
                          >
                            {/* Execution order number */}
                            <span className="flex-shrink-0 w-4 text-[9px] text-center font-mono"
                              style={{ color: 'var(--color-text-tertiary)' }}>{idx + 1}</span>

                            {/* Status icon */}
                            <div className="flex-shrink-0 w-4">
                              {node.status === 'completed' && <CheckCircle className="w-3 h-3 text-green-400" />}
                              {node.status === 'failed' && <XCircle className="w-3 h-3 text-red-400" />}
                              {node.status === 'running' && (
                                <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                              )}
                              {node.status === 'pending' && (
                                <div className="w-3 h-3 rounded-full" style={{ background: 'var(--color-text-tertiary)' }} />
                              )}
                              {node.status === 'skipped' && (
                                <div className="w-3 h-3 rounded-full opacity-30" style={{ background: 'var(--color-text-tertiary)' }} />
                              )}
                            </div>

                            {/* Node icon + name */}
                            <div className="flex items-center gap-1.5 flex-shrink-0 w-28">
                              {getNodeIcon(node.nodeType)}
                              <span className={`text-[11px] truncate font-medium ${node.status === 'skipped' ? 'opacity-40' : ''}`}
                                style={{ color: 'var(--color-text)' }}>
                                {node.nodeLabel}
                              </span>
                            </div>

                            {/* Timeline bar */}
                            <div className="flex-1 h-4 rounded relative overflow-hidden"
                              style={{ background: 'var(--color-bg-secondary)' }}>
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${widthPct}%` }}
                                transition={{ duration: 0.3 }}
                                className={`absolute h-full rounded ${node.status === 'running' ? 'animate-pulse' : ''}`}
                                style={{ left: `${startPct}%`, backgroundColor: barColor, opacity: 0.65 }}
                              />
                            </div>

                            {/* Duration + cost */}
                            <div className="flex-shrink-0 w-16 text-right">
                              <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                {node.duration != null ? formatDuration(node.duration) : node.status === 'running' ? '...' : '-'}
                              </div>
                              {node.cost != null && node.cost > 0 && (
                                <div className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                  ${node.cost.toFixed(4)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Cost Summary */}
                    {(execution.totalTokens || execution.estimatedCost) && (
                      <div className="sticky bottom-0 px-3 py-2 border-t"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                        <div className="flex items-center justify-between text-[11px]">
                          {execution.totalTokens != null && (
                            <span style={{ color: 'var(--color-text-secondary)' }}>
                              Tokens: <span className="font-medium" style={{ color: 'var(--color-text)' }}>{execution.totalTokens.toLocaleString()}</span>
                            </span>
                          )}
                          {execution.estimatedCost != null && (
                            <span style={{ color: 'var(--color-text-secondary)' }}>
                              Cost: <span className="font-medium" style={{ color: 'var(--color-text)' }}>${execution.estimatedCost.toFixed(4)}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Node I/O Inspector */}
                  <div className="w-1/2 overflow-hidden flex flex-col">
                    {!selectedNode ? (
                      <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
                        <div className="text-center">
                          <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-30" />
                          <p className="text-xs">Click a node to inspect I/O</p>
                          <p className="text-[10px] mt-1 opacity-50">Input, output, and logs per node</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Inspector Header */}
                        <div className="flex-shrink-0 px-3 py-2 border-b"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getNodeIcon(selectedNode.nodeType)}
                              <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{selectedNode.nodeLabel}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded uppercase"
                                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                                {selectedNode.nodeType}
                              </span>
                              {selectedNode.duration != null && (
                                <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                  {formatDuration(selectedNode.duration)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => copyToClipboard(selectedNode.output)} className="p-0.5 rounded hover:bg-white/5"
                                style={{ color: 'var(--color-text-tertiary)' }} title="Copy output">
                                <Copy className="w-3 h-3" />
                              </button>
                              <button onClick={() => setSelectedNodeId(null)} className="p-0.5 rounded hover:opacity-80"
                                style={{ color: 'var(--color-text-tertiary)' }}>
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          <div className="flex gap-1 mt-2">
                            {(['input', 'output', 'logs'] as InspectorTab[]).map(tab => (
                              <button key={tab} onClick={() => setInspectorTab(tab)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors uppercase tracking-wider ${
                                  inspectorTab === tab ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'border border-transparent'
                                }`}
                                style={inspectorTab !== tab ? { color: 'var(--color-text-tertiary)' } : undefined}>
                                {tab}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Inspector Content */}
                        <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px]">
                          {inspectorTab === 'input' && <JsonTree data={selectedNode.input} />}
                          {inspectorTab === 'output' && (
                            <NodeOutputRenderer output={selectedNode.output} nodeType={selectedNode.nodeType} error={selectedNode.error} />
                          )}
                          {inspectorTab === 'logs' && (
                            <div className="space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                              <div className="py-0.5">
                                <span style={{ color: 'var(--color-text-tertiary)' }}>[start]</span>{' '}
                                Node execution started
                                {selectedNode.startTime !== undefined && ` at +${selectedNode.startTime}ms`}
                              </div>
                              {selectedNode.duration !== undefined && (
                                <div className="py-0.5">
                                  <span style={{ color: 'var(--color-text-tertiary)' }}>[end]</span>{' '}
                                  Completed in {formatDuration(selectedNode.duration)}
                                </div>
                              )}
                              {selectedNode.tokens !== undefined && (
                                <div className="py-0.5">
                                  <span style={{ color: 'var(--color-text-tertiary)' }}>[tokens]</span>{' '}
                                  {selectedNode.tokens.toLocaleString()} tokens used
                                </div>
                              )}
                              {selectedNode.cost != null && selectedNode.cost > 0 && (
                                <div className="py-0.5">
                                  <span style={{ color: 'var(--color-text-tertiary)' }}>[cost]</span>{' '}
                                  ${selectedNode.cost.toFixed(4)}
                                </div>
                              )}
                              {selectedNode.error && (
                                <div className="py-0.5 text-red-400">
                                  <span className="text-red-600">[error]</span>{' '}
                                  {selectedNode.error}
                                </div>
                              )}
                              {/* Real logs from execution */}
                              {selectedNode.logs && selectedNode.logs.length > 0 && (
                                <>
                                  <div className="border-t my-1 pt-1" style={{ borderColor: 'var(--color-border)' }} />
                                  {selectedNode.logs.map((log, i) => (
                                    <div key={i} className="flex items-start gap-2 py-0.5">
                                      <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                                        {log.timestamp ? format(new Date(log.timestamp), 'HH:mm:ss.SSS') : ''}
                                      </span>
                                      <LogLevelBadge level={log.level} />
                                      <span style={{ color: log.level === 'error' ? '#ef4444' : 'var(--color-text-secondary)' }}>
                                        {log.message}
                                      </span>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
