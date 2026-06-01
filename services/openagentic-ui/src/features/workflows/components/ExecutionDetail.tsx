/**
 * ExecutionDetail - Rich drill-down view for a workflow execution
 *
 * Features:
 * - Waterfall timeline (vertical bar chart of node durations)
 * - Node inspector: click node → Input/Output/Logs tabs
 * - Execution summary bar: total duration, cost, node count, trigger type
 * - Uses NodeOutputRenderer for type-aware display
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Clock, CheckCircle, XCircle, Activity,
  ChevronDown, ChevronRight, Zap, AlertCircle, RefreshCw,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { WorkflowApiService } from '../services/workflowApi';
import { NodeOutputRenderer } from './NodeOutputRenderer';

interface ExecutionDetailProps {
  workflowId: string;
  executionId: string;
  onClose: () => void;
  /** Called when user clicks Retry on a failed node after execution has finished */
  onRetryNode?: (nodeId: string) => void;
}

interface NodeSummary {
  status: string;
  input: any;
  output: any;
  duration: number | null;
  error: string | null;
  logs: any[];
}

const statusColors: Record<string, string> = {
  completed: 'var(--color-success)',
  running: 'var(--color-warning)',
  failed: 'var(--color-error)',
  pending: 'var(--color-fg-muted)',
  unknown: 'var(--color-fg-subtle)',
};

export const ExecutionDetail: React.FC<ExecutionDetailProps> = ({
  workflowId,
  executionId,
  onClose,
  onRetryNode,
}) => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [execution, setExecution] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [nodeSummary, setNodeSummary] = useState<Record<string, NodeSummary>>({});
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'output' | 'input' | 'logs'>('output');

  const api = useMemo(() => new WorkflowApiService(getAuthHeaders), [getAuthHeaders]);

  useEffect(() => {
    const loadDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getExecutionDetail(workflowId, executionId);
        setExecution(data.execution);
        setLogs(data.logs || []);
        setNodeSummary(data.nodeSummary || {});
      } catch (err: any) {
        setError(err.message || 'Failed to load execution detail');
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [api, workflowId, executionId]);

  // Calculate max duration for waterfall scaling
  const maxDuration = useMemo(() => {
    let max = 0;
    for (const node of Object.values(nodeSummary)) {
      if (node.duration && node.duration > max) max = node.duration;
    }
    return max || 1;
  }, [nodeSummary]);

  const nodeIds = Object.keys(nodeSummary);
  const selectedNodeData = selectedNode ? nodeSummary[selectedNode] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8" style={{ color: 'var(--color-text-tertiary)' }}>
        <div className="wf-exec-spinner" style={{ width: 20, height: 20, marginRight: 10 }} />
        Loading execution detail...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 text-error">
        <AlertCircle className="w-5 h-5 mr-2" />
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-surface, #1C1C1E)' }}>
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          {execution?.status === 'completed' && <CheckCircle style={{ width: 16, height: 16, color: 'var(--color-success)' }} />}
          {execution?.status === 'failed' && <XCircle style={{ width: 16, height: 16, color: 'var(--color-error)' }} />}
          {execution?.status === 'running' && <div className="wf-exec-spinner" style={{ width: 14, height: 14 }} />}
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {execution?.status?.charAt(0).toUpperCase() + execution?.status?.slice(1)}
          </span>
        </div>

        <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          <Clock className="w-3 h-3" />
          {execution?.execution_time_ms ? `${execution.execution_time_ms}ms` : 'N/A'}
        </div>

        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {nodeIds.length} nodes
        </div>

        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {execution?.trigger_type || 'manual'}
        </div>

        <div className="flex-1" />

        <button onClick={onClose} className="p-1 rounded hover:bg-surface/10" style={{ color: 'var(--color-text-tertiary)' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main content: waterfall + inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Waterfall timeline */}
        <div className="w-64 border-r overflow-y-auto wf-scrollbar" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-3 py-2 text-xs font-semibold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>
            Waterfall
          </div>
          {nodeIds.map((nodeId) => {
            const node = nodeSummary[nodeId];
            const barWidth = node.duration ? Math.max(4, (node.duration / maxDuration) * 100) : 4;
            const isSelected = selectedNode === nodeId;
            const executionDone = execution?.status !== 'running';
            const canRetry = onRetryNode && executionDone && node.status === 'failed';

            return (
              <button
                key={nodeId}
                onClick={() => { setSelectedNode(nodeId); setInspectorTab('output'); }}
                className="w-full px-3 py-2 text-left transition-colors"
                style={{
                  background: isSelected ? 'color-mix(in srgb, var(--user-accent-primary, #FF5722) 10%, transparent)' : 'transparent',
                  borderLeft: isSelected ? '2px solid var(--user-accent-primary, #FF5722)' : '2px solid transparent',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: statusColors[node.status] || 'var(--color-fg-subtle)' }}
                  />
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {nodeId}
                  </span>
                  {/* S6: animated streaming indicator for in-flight nodes */}
                  {node.status === 'running' && (
                    <span
                      data-testid={`streaming-indicator-${nodeId}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 2,
                        fontSize: 9, color: 'var(--color-info)', marginLeft: 2,
                      }}
                      title="Streaming…"
                    >
                      <span style={{
                        display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
                        background: 'var(--color-info)',
                        animation: 'wf-agent-pulse 1.4s ease-in-out infinite',
                      }} />
                      …
                    </span>
                  )}
                  {/* P3: Retry button for failed nodes after execution completes */}
                  {canRetry && (
                    <button
                      data-testid={`retry-node-${nodeId}`}
                      onClick={(e) => { e.stopPropagation(); onRetryNode!(nodeId); }}
                      title={`Retry ${nodeId} from this node`}
                      style={{
                        marginLeft: 'auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        fontSize: 9,
                        color: 'var(--color-warning)',
                        background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
                        borderRadius: 4,
                        padding: '1px 5px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <RefreshCw style={{ width: 8, height: 8 }} />
                      Retry
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      height: 6,
                      width: `${barWidth}%`,
                      borderRadius: 3,
                      backgroundColor: statusColors[node.status] || 'var(--color-fg-subtle)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                  {node.duration && (
                    <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
                      {node.duration}ms
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Node inspector */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedNodeData ? (
            <>
              {/* Tabs */}
              <div className="flex gap-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
                {(['output', 'input', 'logs'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setInspectorTab(tab)}
                    className="px-4 py-2.5 text-xs font-medium transition-colors"
                    style={{
                      color: inspectorTab === tab ? 'var(--user-accent-primary, #FF5722)' : 'var(--color-text-tertiary)',
                      borderBottom: inspectorTab === tab ? '2px solid var(--user-accent-primary, #FF5722)' : '2px solid transparent',
                    }}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === 'logs' && selectedNodeData.logs.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'var(--color-surface-secondary, #333)' }}>
                        {selectedNodeData.logs.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-4 wf-scrollbar">
                {inspectorTab === 'output' && (
                  selectedNodeData.output ? (
                    <NodeOutputRenderer
                      output={selectedNodeData.output}
                      nodeType="unknown"
                    />
                  ) : (
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No output data</div>
                  )
                )}

                {inspectorTab === 'input' && (
                  selectedNodeData.input ? (
                    <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {JSON.stringify(selectedNodeData.input, null, 2)}
                    </pre>
                  ) : (
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No input data</div>
                  )
                )}

                {inspectorTab === 'logs' && (
                  selectedNodeData.logs.length > 0 ? (
                    <div className="space-y-1">
                      {selectedNodeData.logs.map((log: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs py-1">
                          <span className="font-mono w-16 flex-shrink-0" style={{
                            color: log.level === 'error' ? 'var(--color-error)' : log.level === 'warn' ? 'var(--color-warning)' : 'var(--color-text-tertiary)',
                          }}>
                            [{log.level}]
                          </span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>{log.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No logs for this node</div>
                  )
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-text-tertiary)' }}>
              <div className="text-center">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <div className="text-xs">Select a node in the waterfall to inspect it</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
