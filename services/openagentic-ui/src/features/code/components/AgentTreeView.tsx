/**
 * AgentTreeView — Parallel Agent Visualization
 *
 * Shows running/completed agents in a tree view with:
 * - Status icons (spinning for running, checkmark for done, X for failed)
 * - Tools called per agent
 * - Duration
 * - Background badge
 *
 * CSS-only animations, no Framer Motion dependency.
 */

import React, { useState } from 'react';
import type { AgentTreeNode } from '@/stores/useCodeModeStore';

interface AgentTreeViewProps {
  nodes: AgentTreeNode[];
  compact?: boolean;
}

/** Extended node type for cost tracking */
interface AgentTreeNodeWithCost extends AgentTreeNode {
  cost?: number;
  totalTools?: number;
}

const STATUS_ICONS: Record<string, string> = {
  idle: '○',
  running: '◉',
  completed: '✓',
  failed: '✗',
  cancelled: '⊘',
};

const STATUS_COLORS: Record<string, string> = {
  idle: 'var(--cm-muted)',
  running: 'var(--cm-info)',
  completed: 'var(--cm-success)',
  failed: 'var(--cm-error)',
  cancelled: 'var(--cm-warning)',
};

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Progress bar for running agents */
const AgentProgressBar: React.FC<{ completed: number; total: number }> = ({ completed, total }) => {
  if (total === 0) return null;
  const pct = Math.min(100, Math.round((completed / total) * 100));
  const filledBlocks = Math.round(pct / 20);
  const emptyBlocks = 5 - filledBlocks;

  return (
    <span style={{ fontSize: '11px', fontFamily: 'inherit', color: 'var(--cm-muted)' }}>
      <span style={{ color: 'var(--cm-accent, #7c3aed)' }}>
        {'█'.repeat(filledBlocks)}
      </span>
      <span style={{ opacity: 0.3 }}>
        {'░'.repeat(emptyBlocks)}
      </span>
      <span style={{ marginLeft: '4px', fontSize: '10px' }}>{pct}%</span>
    </span>
  );
};

/** Single agent node row, expandable to show tool list */
const AgentNodeRow: React.FC<{
  node: AgentTreeNode;
  isLast: boolean;
  compact?: boolean;
}> = ({ node, isLast, compact }) => {
  const [expanded, setExpanded] = useState(false);
  const connector = isLast ? '└── ' : '├── ';
  const isRunning = node.status === 'running';
  const extNode = node as AgentTreeNodeWithCost;
  const hasCost = typeof extNode.cost === 'number' && extNode.cost > 0;
  const hasTools = node.toolsCalled.length > 0;

  return (
    <div>
      {/* Main row */}
      <div
        onClick={() => hasTools && setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
          padding: '2px 0',
          cursor: hasTools ? 'pointer' : 'default',
          borderLeft: isRunning
            ? '2px solid var(--cm-accent, #7c3aed)'
            : '2px solid transparent',
          paddingLeft: isRunning ? '4px' : '6px',
          animation: isRunning ? 'agent-border-pulse 1.5s ease-in-out infinite' : 'none',
        }}
      >
        <span style={{ color: 'var(--cm-muted)', whiteSpace: 'pre' }}>
          {connector}
        </span>

        {/* Expand chevron when tools exist */}
        {hasTools && (
          <span style={{ color: 'var(--cm-muted)', fontSize: '10px', flexShrink: 0 }}>
            {expanded ? '▼' : '▶'}
          </span>
        )}

        {/* Status icon */}
        <span
          style={{
            color: STATUS_COLORS[node.status] || 'var(--cm-muted)',
            ...(isRunning ? { animation: 'agent-pulse 1.5s ease-in-out infinite' } : {}),
          }}
        >
          {STATUS_ICONS[node.status] || '?'}
        </span>

        {/* Agent name */}
        <span style={{ fontWeight: 600, color: 'var(--cm-fg, #e0e0e0)' }}>
          {node.name}
        </span>

        {/* Progress bar for running agents */}
        {isRunning && node.toolsCalled.length > 0 && (
          <AgentProgressBar
            completed={node.toolsCalled.length}
            total={extNode.totalTools || Math.max(node.toolsCalled.length + 2, 5)}
          />
        )}

        {/* Duration for completed agents */}
        {isRunning ? (
          <span style={{ color: 'var(--cm-muted)', fontSize: '11px' }}>
            running...
          </span>
        ) : node.duration ? (
          <span style={{ color: 'var(--cm-muted)', fontSize: '11px' }}>
            ({formatDuration(node.duration)})
          </span>
        ) : null}

        {/* Cost badge */}
        {hasCost && (
          <span style={{
            color: 'var(--cm-warning, #d29922)',
            fontSize: '10px',
            padding: '0 4px',
            border: '1px solid var(--cm-border)',
            borderRadius: '3px',
            fontFamily: 'inherit',
          }}>
            ${extNode.cost!.toFixed(2)}
          </span>
        )}

        {/* Background badge */}
        {node.background && (
          <span style={{
            color: 'var(--cm-muted)',
            fontSize: '10px',
            padding: '0 4px',
            border: '1px solid var(--cm-border)',
            borderRadius: '3px',
          }}>
            bg
          </span>
        )}

        {/* Current tool or tools summary (when not expanded) */}
        {!compact && !expanded && (
          <>
            {node.currentTool ? (
              <span style={{ color: 'var(--cm-info)', fontSize: '11px' }}>
                — {node.currentTool}
              </span>
            ) : node.toolsCalled.length > 0 ? (
              <span style={{ color: 'var(--cm-muted)', fontSize: '11px' }}>
                — {node.toolsCalled.length} tools
              </span>
            ) : null}
          </>
        )}

        {/* Error */}
        {node.error && (
          <span style={{ color: STATUS_COLORS.failed, fontSize: '11px', marginLeft: '4px' }}>
            {node.error.substring(0, 40)}
          </span>
        )}
      </div>

      {/* Expanded tool list */}
      {expanded && hasTools && (
        <div style={{
          marginLeft: '28px',
          paddingLeft: '8px',
          borderLeft: '1px solid var(--cm-border, #333)',
          marginBottom: '2px',
        }}>
          {node.toolsCalled.map((tool, idx) => (
            <div
              key={`${node.id}-tool-${idx}`}
              style={{
                fontSize: '11px',
                color: 'var(--cm-muted)',
                padding: '1px 0',
              }}
            >
              <span style={{ color: 'var(--cm-info)', marginRight: '4px' }}>·</span>
              {tool}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AgentTreeView: React.FC<AgentTreeViewProps> = ({ nodes, compact }) => {
  if (!nodes || nodes.length === 0) return null;

  const running = nodes.filter(n => n.status === 'running').length;
  const completed = nodes.filter(n => n.status === 'completed').length;
  const failed = nodes.filter(n => n.status === 'failed').length;

  return (
    <div
      className="agent-tree-view"
      style={{
        fontFamily: 'var(--cm-font-mono, ui-monospace, monospace)',
        fontSize: '12px',
        lineHeight: '1.6',
        border: '1px solid var(--cm-border, #333)',
        borderRadius: '6px',
        padding: '8px 12px',
        margin: '4px 0',
        background: 'var(--cm-bg-subtle, rgba(255,255,255,0.02))',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '6px',
        color: 'var(--cm-muted, #888)',
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        <span>Agent Tree</span>
        <span style={{ marginLeft: 'auto' }}>
          {running > 0 && <span style={{ color: STATUS_COLORS.running }}>{running} running</span>}
          {running > 0 && completed > 0 && ' · '}
          {completed > 0 && <span style={{ color: STATUS_COLORS.completed }}>{completed} done</span>}
          {(running > 0 || completed > 0) && failed > 0 && ' · '}
          {failed > 0 && <span style={{ color: STATUS_COLORS.failed }}>{failed} failed</span>}
        </span>
      </div>

      {/* Agent Nodes */}
      {nodes.map((node, i) => (
        <AgentNodeRow
          key={node.id}
          node={node}
          isLast={i === nodes.length - 1}
          compact={compact}
        />
      ))}

      {/* CSS animations (injected once) */}
      <style>{`
        @keyframes agent-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes agent-border-pulse {
          0%, 100% { border-left-color: var(--cm-accent, #7c3aed); }
          50% { border-left-color: transparent; }
        }
      `}</style>
    </div>
  );
};

export default AgentTreeView;
