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
  ChevronDown, ChevronRight, Zap, AlertCircle,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { WorkflowApiService } from '../services/workflowApi';
import { NodeOutputRenderer } from './NodeOutputRenderer';

interface ExecutionDetailProps {
  workflowId: string;
  executionId: string;
  onClose: () => void;
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
  completed: '#22c55e',
  running: '#ff9800',
  failed: '#f44336',
  pending: '#9e9e9e',
  unknown: '#607d8b',
};

export const ExecutionDetail: React.FC<ExecutionDetailProps> = ({
  workflowId,
  executionId,
  onClose,
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
      <div className="flex items-center justify-center p-8 text-red-500">
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
          {execution?.status === 'completed' && <CheckCircle style={{ width: 16, height: 16, color: '#22c55e' }} />}
          {execution?.status === 'failed' && <XCircle style={{ width: 16, height: 16, color: '#f44336' }} />}
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

        <button onClick={onClose} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--color-text-tertiary)' }}>
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

            return (
              <button
                key={nodeId}
                onClick={() => { setSelectedNode(nodeId); setInspectorTab('output'); }}
                className="w-full px-3 py-2 text-left transition-colors"
                style={{
                  background: isSelected ? 'rgba(59,130,246,0.1)' : 'transparent',
                  borderLeft: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: statusColors[node.status] || '#607d8b' }}
                  />
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {nodeId}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      height: 6,
                      width: `${barWidth}%`,
                      borderRadius: 3,
                      backgroundColor: statusColors[node.status] || '#607d8b',
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
                      color: inspectorTab === tab ? '#3b82f6' : 'var(--color-text-tertiary)',
                      borderBottom: inspectorTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
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
                            color: log.level === 'error' ? '#f44336' : log.level === 'warn' ? '#ff9800' : 'var(--color-text-tertiary)',
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
