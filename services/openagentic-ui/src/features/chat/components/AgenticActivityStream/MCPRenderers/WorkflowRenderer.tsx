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
  active: 'var(--cm-success)',
  draft: 'var(--cm-text-muted)',
  running: 'var(--cm-warning)',
  completed: 'var(--cm-success)',
  failed: 'var(--cm-error)',
  paused: 'var(--cm-accent)',
};

const StatusDot: React.FC<{ status: string }> = ({ status }) => (
  <span
    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
    style={{ backgroundColor: statusColors[status] || 'var(--cm-text-muted)' }}
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
        background: 'var(--cm-bg-secondary)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div className="wf-exec-spinner" style={{ width: 16, height: 16, borderColor: 'var(--cm-warning)', borderTopColor: 'transparent', borderWidth: 2, borderRadius: '50%', borderStyle: 'solid', animation: 'wf-spin 0.8s linear infinite' }} />
        <span style={{ color: 'var(--cm-text-secondary)', fontSize: 13 }}>
          {toolName.replace('workflow_', '').replace(/_/g, ' ')}...
        </span>
      </div>
    );
  }

  if (!data.success && data.error) {
    return (
      <div style={{
        background: 'color-mix(in srgb, var(--cm-error) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--cm-error) 20%, transparent)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <XCircle style={{ width: 16, height: 16, color: 'var(--cm-error)', flexShrink: 0 }} />
        <span style={{ color: 'var(--cm-error)', fontSize: 13 }}>{data.error}</span>
      </div>
    );
  }

  // workflow_list result
  if (toolName === 'workflow_list' && data.workflows) {
    return (
      <div style={{
        background: 'var(--cm-bg-secondary)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--cm-border)',
        }}>
          <Workflow style={{ width: 16, height: 16, color: 'var(--cm-accent)' }} />
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
              borderBottom: '1px solid color-mix(in srgb, var(--cm-border) 50%, transparent)',
            }}>
              <StatusDot status={wf.status || 'draft'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {wf.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--cm-text-muted)', display: 'flex', gap: 8 }}>
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
        background: 'var(--cm-bg-secondary)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: 'color-mix(in srgb, var(--cm-success) 15%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CheckCircle style={{ width: 18, height: 18, color: 'var(--cm-success)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              {data.name || 'Workflow Created'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--cm-text-muted)' }}>
              {data.message}
            </div>
          </div>
        </div>
        {data.tip && (
          <div style={{
            fontSize: 12, color: 'var(--cm-text-secondary)',
            padding: '8px 10px', borderRadius: 8,
            background: 'var(--cm-bg-tertiary)',
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
            border: '1px solid var(--cm-border)',
            background: 'transparent',
            color: 'var(--cm-accent)',
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
        background: 'var(--cm-bg-secondary)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: 'color-mix(in srgb, var(--cm-warning) 15%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Play style={{ width: 16, height: 16, color: 'var(--cm-warning)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
            Execution Started
          </div>
          <div style={{ fontSize: 12, color: 'var(--cm-text-muted)' }}>
            {data.message}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cm-text-muted)', marginTop: 2 }}>
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
        background: 'var(--cm-bg-secondary)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--cm-border)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{wf.name}</div>
          {wf.description && (
            <div style={{ fontSize: 12, color: 'var(--cm-text-muted)', marginTop: 2 }}>{wf.description}</div>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--cm-text-muted)' }}>
            <span>{nodes.length} nodes</span>
            <span>{edges.length} edges</span>
            <span>{wf.executionCount || 0} runs</span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: '100%', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', color: 'var(--cm-text-secondary)',
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
                fontSize: 12, color: 'var(--cm-text-secondary)',
              }}>
                <Zap style={{ width: 10, height: 10, color: statusColors[n.type] || 'var(--cm-text-muted)' }} />
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
        background: 'var(--cm-bg-secondary)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <Activity style={{ width: 16, height: 16, color: 'var(--cm-accent)', flexShrink: 0 }} />
        <span style={{ color: 'var(--color-text)', fontSize: 13 }}>{data.message}</span>
      </div>
    );
  }

  // Fallback: null (let the generic renderer handle it)
  return null;
};

export default WorkflowRenderer;
