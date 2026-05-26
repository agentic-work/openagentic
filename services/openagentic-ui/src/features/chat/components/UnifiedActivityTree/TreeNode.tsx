import React from 'react';

interface TreeNodeProps {
  status: 'success' | 'thinking' | 'running' | 'error' | 'artifact' | 'hitl';
  children: React.ReactNode;
  isLast?: boolean;
  depth?: number;
}

const STATUS_COLORS: Record<string, string> = {
  success: 'var(--cm-success)',
  thinking: 'var(--cm-accent)',
  running: 'var(--cm-info)',
  error: 'var(--cm-error)',
  artifact: 'var(--cm-accent)',
  hitl: 'var(--cm-warning)',
};

/**
 * v0.6.7 chat-polish fix 5 (task #166 remap) — depth-scaled left-border.
 * Uses mockup --line-2/3 ramp (rgba white at 0.10 → 0.16) so nesting
 * reads clearly against --bg-1 sub-agent surfaces.
 */
function depthBorderColor(depth: number): string {
  // 0 → no border, 1 → line-2, 2+ → line-3.
  if (depth <= 0) return 'transparent';
  if (depth === 1) return 'color-mix(in srgb, var(--cm-border) 80%, transparent)';
  return 'var(--cm-border)';
}

export function TreeNode({ status, children, isLast = false, depth = 0 }: TreeNodeProps) {
  return (
    <div
      data-testid="tree-node"
      data-depth={depth}
      style={{
        position: 'relative',
        paddingLeft: depth > 0 ? 20 : 0,
        marginLeft: depth > 0 ? 8 : 0,
        borderLeft: depth > 0 ? `2px solid ${depthBorderColor(depth)}` : 'none',
      }}
    >
      {/* Vertical connector line (extra hair-line for finer detail) */}
      {depth > 0 && !isLast && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: 'color-mix(in srgb, var(--cm-border) 50%, transparent)',
        }} />
      )}
      {/* Horizontal connector */}
      {depth > 0 && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 10,
          width: 12,
          height: 1,
          backgroundColor: 'color-mix(in srgb, var(--cm-border) 50%, transparent)',
        }} />
      )}
      {/* Status dot */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '2px 0',
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: STATUS_COLORS[status] || STATUS_COLORS.running,
          marginTop: 5,
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
