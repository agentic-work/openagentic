/**
 * VersionDiffView - Visual diff between two workflow versions
 *
 * Features:
 * - Summary stats: nodes/edges added, removed, modified
 * - Change list with color-coded indicators
 * - Side-by-side field comparison for modified nodes
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, GitBranch, Plus, Minus, Edit, ChevronDown, ChevronRight } from '@/shared/icons';

interface VersionDiffViewProps {
  currentVersion: {
    version: number;
    definition: { nodes: any[]; edges: any[] };
    settings?: any;
    createdAt: string;
  };
  compareVersion: {
    version: number;
    definition: { nodes: any[]; edges: any[] };
    settings?: any;
    createdAt: string;
  };
  onClose: () => void;
}

interface NodeChange {
  type: 'added' | 'removed' | 'modified';
  nodeId: string;
  label: string;
  nodeType: string;
  changedFields?: { field: string; oldValue: any; newValue: any }[];
}

interface EdgeChange {
  type: 'added' | 'removed';
  edgeId: string;
  source: string;
  target: string;
}

function getNodeLabel(node: any): string {
  return node?.data?.label || node?.data?.name || node?.id || 'Unknown';
}

function getNodeType(node: any): string {
  return node?.type || node?.data?.type || 'unknown';
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => deepEqual(a[key], b[key]));
}

function diffNodeFields(
  oldNode: any,
  newNode: any,
): { field: string; oldValue: any; newValue: any }[] {
  const changes: { field: string; oldValue: any; newValue: any }[] = [];
  const skipKeys = new Set(['id', 'selected', 'dragging', 'measured', 'width', 'height', 'positionAbsolute', 'resizing']);

  const allKeys = new Set([
    ...Object.keys(oldNode || {}),
    ...Object.keys(newNode || {}),
  ]);

  for (const key of allKeys) {
    if (skipKeys.has(key)) continue;
    const oldVal = oldNode?.[key];
    const newVal = newNode?.[key];
    if (!deepEqual(oldVal, newVal)) {
      changes.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

function formatValue(val: any): string {
  if (val === undefined) return '(undefined)';
  if (val === null) return '(null)';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

export const VersionDiffView: React.FC<VersionDiffViewProps> = ({
  currentVersion,
  compareVersion,
  onClose,
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const toggleExpanded = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const { nodeChanges, edgeChanges, summary } = useMemo(() => {
    const currentNodes = currentVersion.definition?.nodes || [];
    const compareNodes = compareVersion.definition?.nodes || [];
    const currentEdges = currentVersion.definition?.edges || [];
    const compareEdges = compareVersion.definition?.edges || [];

    const currentNodeMap = new Map(currentNodes.map((n: any) => [n.id, n]));
    const compareNodeMap = new Map(compareNodes.map((n: any) => [n.id, n]));

    const nodeChanges: NodeChange[] = [];

    // Added nodes: in current but not in compare
    for (const node of currentNodes) {
      if (!compareNodeMap.has(node.id)) {
        nodeChanges.push({
          type: 'added',
          nodeId: node.id,
          label: getNodeLabel(node),
          nodeType: getNodeType(node),
        });
      }
    }

    // Removed nodes: in compare but not in current
    for (const node of compareNodes) {
      if (!currentNodeMap.has(node.id)) {
        nodeChanges.push({
          type: 'removed',
          nodeId: node.id,
          label: getNodeLabel(node),
          nodeType: getNodeType(node),
        });
      }
    }

    // Modified nodes: in both but different
    for (const node of currentNodes) {
      const oldNode = compareNodeMap.get(node.id);
      if (oldNode && !deepEqual(node, oldNode)) {
        const changedFields = diffNodeFields(oldNode, node);
        if (changedFields.length > 0) {
          nodeChanges.push({
            type: 'modified',
            nodeId: node.id,
            label: getNodeLabel(node),
            nodeType: getNodeType(node),
            changedFields,
          });
        }
      }
    }

    // Edge changes
    const currentEdgeIds = new Set(currentEdges.map((e: any) => e.id));
    const compareEdgeIds = new Set(compareEdges.map((e: any) => e.id));
    const edgeChanges: EdgeChange[] = [];

    for (const edge of currentEdges) {
      if (!compareEdgeIds.has(edge.id)) {
        edgeChanges.push({ type: 'added', edgeId: edge.id, source: edge.source, target: edge.target });
      }
    }
    for (const edge of compareEdges) {
      if (!currentEdgeIds.has(edge.id)) {
        edgeChanges.push({ type: 'removed', edgeId: edge.id, source: edge.source, target: edge.target });
      }
    }

    const added = nodeChanges.filter((c) => c.type === 'added').length;
    const removed = nodeChanges.filter((c) => c.type === 'removed').length;
    const modified = nodeChanges.filter((c) => c.type === 'modified').length;

    return {
      nodeChanges,
      edgeChanges,
      summary: {
        nodesAdded: added,
        nodesRemoved: removed,
        nodesModified: modified,
        edgesAdded: edgeChanges.filter((c) => c.type === 'added').length,
        edgesRemoved: edgeChanges.filter((c) => c.type === 'removed').length,
      },
    };
  }, [currentVersion, compareVersion]);

  const totalChanges = nodeChanges.length + edgeChanges.length;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="glass flex flex-col h-full"
      style={{ borderRadius: 0, color: 'var(--color-fg)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-surface/10 transition-colors"
          title="Close diff view"
        >
          <ArrowLeft size={16} />
        </button>
        <GitBranch size={16} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-medium">
          Version {compareVersion.version} &rarr; Version {currentVersion.version}
        </span>
      </div>

      {/* Summary stats */}
      <div
        className="grid grid-cols-5 gap-2 px-4 py-3 border-b text-xs"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        <StatBadge label="Added" count={summary.nodesAdded} color="var(--color-success)" />
        <StatBadge label="Removed" count={summary.nodesRemoved} color="var(--color-error)" />
        <StatBadge label="Modified" count={summary.nodesModified} color="var(--color-warning)" />
        <StatBadge label="Edges +" count={summary.edgesAdded} color="var(--color-success)" />
        <StatBadge label="Edges -" count={summary.edgesRemoved} color="var(--color-error)" />
      </div>

      {/* Change list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {totalChanges === 0 && (
          <div className="text-center text-sm py-8" style={{ color: 'var(--color-fg-muted)' }}>
            No differences found between these versions.
          </div>
        )}

        {/* Node changes */}
        {nodeChanges.map((change) => (
          <NodeChangeRow
            key={change.nodeId}
            change={change}
            expanded={expandedNodes.has(change.nodeId)}
            onToggle={() => toggleExpanded(change.nodeId)}
          />
        ))}

        {/* Edge changes */}
        {edgeChanges.length > 0 && (
          <div className="pt-2">
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-fg-muted)' }}>
              Edge Changes
            </div>
            {edgeChanges.map((change) => (
              <div
                key={change.edgeId}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs mb-1"
                style={{
                  background: change.type === 'added' ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'color-mix(in srgb, var(--color-error) 8%, transparent)',
                  borderLeft: `3px solid ${change.type === 'added' ? 'var(--color-success)' : 'var(--color-error)'}`,
                }}
              >
                {change.type === 'added' ? <Plus size={12} color="var(--color-success)" /> : <Minus size={12} color="var(--color-error)" />}
                <span>{change.source} &rarr; {change.target}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

/* ---------- Sub-components ---------- */

const StatBadge: React.FC<{ label: string; count: number; color: string }> = ({ label, count, color }) => (
  <div className="flex flex-col items-center gap-0.5">
    <span className="font-mono font-semibold text-base" style={{ color }}>{count}</span>
    <span style={{ color: 'var(--color-fg-muted)' }}>{label}</span>
  </div>
);

const NodeChangeRow: React.FC<{
  change: NodeChange;
  expanded: boolean;
  onToggle: () => void;
}> = ({ change, expanded, onToggle }) => {
  const bgMap = { added: 'color-mix(in srgb, var(--color-success) 8%, transparent)', removed: 'color-mix(in srgb, var(--color-error) 8%, transparent)', modified: 'color-mix(in srgb, var(--color-warning) 8%, transparent)' };
  const borderMap = { added: 'var(--color-success)', removed: 'var(--color-error)', modified: 'var(--color-warning)' };
  const iconMap = {
    added: <Plus size={14} color="var(--color-success)" />,
    removed: <Minus size={14} color="var(--color-error)" />,
    modified: <Edit size={14} color="var(--color-warning)" />,
  };

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{ background: bgMap[change.type], borderLeft: `3px solid ${borderMap[change.type]}` }}
    >
      <button
        onClick={change.type === 'modified' ? onToggle : undefined}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs"
        style={{ cursor: change.type === 'modified' ? 'pointer' : 'default' }}
      >
        {iconMap[change.type]}
        <span className="font-medium flex-1">{change.label}</span>
        <span className="opacity-60">{change.nodeType}</span>
        {change.type === 'modified' && (
          expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        )}
      </button>

      <AnimatePresence>
        {change.type === 'modified' && expanded && change.changedFields && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {change.changedFields.map((f) => (
                <div key={f.field} className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="font-medium mb-0.5" style={{ color: 'var(--color-fg-muted)' }}>
                      {f.field} <span style={{ color: 'var(--color-error)' }}>(old)</span>
                    </div>
                    <pre
                      className="p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all"
                      style={{ background: 'color-mix(in srgb, var(--color-error) 6%, transparent)', maxHeight: 120 }}
                    >
                      {formatValue(f.oldValue)}
                    </pre>
                  </div>
                  <div>
                    <div className="font-medium mb-0.5" style={{ color: 'var(--color-fg-muted)' }}>
                      {f.field} <span style={{ color: 'var(--color-success)' }}>(new)</span>
                    </div>
                    <pre
                      className="p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all"
                      style={{ background: 'color-mix(in srgb, var(--color-success) 6%, transparent)', maxHeight: 120 }}
                    >
                      {formatValue(f.newValue)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
