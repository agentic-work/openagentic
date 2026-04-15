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
 * WorkflowRenderer - Rich card renderer for workflow_* MCP tool results in chat
 *
 * Renders workflow creation, execution, and inspection results as interactive cards
 * instead of raw JSON.
 */

import React, { useState } from 'react';
import type { MCPRendererProps } from './types';
import {
  Workflow,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Copy,
  ChevronDown,
  ChevronRight,
  Zap,
  Activity,
} from '@/shared/icons';

interface WorkflowData {
  success?: boolean;
  workflow_id?: string;
  name?: string;
  message?: string;
  tip?: string;
  count?: number;
  workflows?: Array<{
    id: string;
    name: string;
    description?: string;
    status?: string;
    node_count?: number;
    execution_count?: number;
  }>;
  execution_id?: string;
  executions?: any[];
  workflow?: any;
  error?: string;
}

const statusColors: Record<string, string> = {
  active: '#00ff00',
  draft: '#9e9e9e',
  running: '#ff9800',
  completed: '#00ff00',
  failed: '#f44336',
  paused: '#9c27b0',
};

const StatusDot: React.FC<{ status: string }> = ({ status }) => (
  <span
    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
    style={{ backgroundColor: statusColors[status] || '#9e9e9e' }}
  />
);

export const WorkflowRenderer: React.FC<MCPRendererProps> = ({
  toolName,
  output,
  status,
  isComplete,
}) => {
  const [expanded, setExpanded] = useState(false);
  const data = (output || {}) as WorkflowData;

  if (status === 'calling') {
    return (
      <div className="wf-chat-card" style={{
        background: 'var(--color-surface, #1C1C1E)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div className="wf-exec-spinner" style={{ width: 16, height: 16, borderColor: '#ff9800', borderTopColor: 'transparent', borderWidth: 2, borderRadius: '50%', borderStyle: 'solid', animation: 'wf-spin 0.8s linear infinite' }} />
        <span style={{ color: 'var(--color-text-secondary, #8E8E93)', fontSize: 13 }}>
          {toolName.replace('workflow_', '').replace(/_/g, ' ')}...
        </span>
      </div>
    );
  }

  if (!data.success && data.error) {
    return (
      <div style={{
        background: 'rgba(244, 67, 54, 0.08)',
        border: '1px solid rgba(244, 67, 54, 0.2)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <XCircle style={{ width: 16, height: 16, color: '#f44336', flexShrink: 0 }} />
        <span style={{ color: '#f44336', fontSize: 13 }}>{data.error}</span>
      </div>
    );
  }

  // workflow_list result
  if (toolName === 'workflow_list' && data.workflows) {
    return (
      <div style={{
        background: 'var(--color-surface, #1C1C1E)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        }}>
          <Workflow style={{ width: 16, height: 16, color: 'var(--user-accent-primary, #3b82f6)' }} />
          <span style={{ color: 'var(--color-text)', fontSize: 13, fontWeight: 600 }}>
            {data.count} Workflow{data.count !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {data.workflows.map(wf => (
            <div key={wf.id} style={{
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.04))',
            }}>
              <StatusDot status={wf.status || 'draft'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {wf.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #636366)', display: 'flex', gap: 8 }}>
                  <span>{wf.node_count} nodes</span>
                  <span>{wf.execution_count} runs</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // workflow_create / workflow_create_from_description result
  if ((toolName === 'workflow_create' || toolName === 'workflow_create_from_description') && data.workflow_id) {
    return (
      <div style={{
        background: 'var(--color-surface, #1C1C1E)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: 'rgba(0, 255, 0, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CheckCircle style={{ width: 18, height: 18, color: '#00ff00' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              {data.name || 'Workflow Created'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary, #636366)' }}>
              {data.message}
            </div>
          </div>
        </div>
        {data.tip && (
          <div style={{
            fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)',
            padding: '8px 10px', borderRadius: 8,
            background: 'var(--color-bg-secondary, rgba(255,255,255,0.04))',
            marginTop: 4,
          }}>
            {data.tip}
          </div>
        )}
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('navigateToWorkflow', { detail: { workflowId: data.workflow_id } }));
          }}
          style={{
            marginTop: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            background: 'transparent',
            color: 'var(--user-accent-primary, #3b82f6)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <ExternalLink style={{ width: 12, height: 12 }} />
          Open in Flows
        </button>
      </div>
    );
  }

  // workflow_execute result
  if (toolName === 'workflow_execute' && data.execution_id) {
    return (
      <div style={{
        background: 'var(--color-surface, #1C1C1E)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: 'rgba(255, 152, 0, 0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Play style={{ width: 16, height: 16, color: '#ff9800' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
            Execution Started
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary, #636366)' }}>
            {data.message}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-tertiary, #636366)', marginTop: 2 }}>
            ID: {data.execution_id}
          </div>
        </div>
      </div>
    );
  }

  // workflow_get result (detailed view)
  if (toolName === 'workflow_get' && data.workflow) {
    const wf = data.workflow;
    const nodes = wf.nodes || [];
    const edges = wf.edges || [];
    return (
      <div style={{
        background: 'var(--color-surface, #1C1C1E)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{wf.name}</div>
          {wf.description && (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary, #636366)', marginTop: 2 }}>{wf.description}</div>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--color-text-tertiary, #636366)' }}>
            <span>{nodes.length} nodes</span>
            <span>{edges.length} edges</span>
            <span>{wf.executionCount || 0} runs</span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: '100%', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', color: 'var(--color-text-secondary, #8E8E93)',
            fontSize: 12, cursor: 'pointer', textAlign: 'left',
          }}
        >
          {expanded ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
          Node graph
        </button>
        {expanded && (
          <div style={{ padding: '0 16px 12px' }}>
            {nodes.map((n: any) => (
              <div key={n.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)',
              }}>
                <Zap style={{ width: 10, height: 10, color: statusColors[n.type] || '#607d8b' }} />
                <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{n.data?.label || n.id}</span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>({n.type})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Default: render the message if present
  if (data.message) {
    return (
      <div style={{
        background: 'var(--color-surface, #1C1C1E)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <Activity style={{ width: 16, height: 16, color: 'var(--user-accent-primary, #3b82f6)', flexShrink: 0 }} />
        <span style={{ color: 'var(--color-text)', fontSize: 13 }}>{data.message}</span>
      </div>
    );
  }

  // Fallback: null (let the generic renderer handle it)
  return null;
};

export default WorkflowRenderer;
