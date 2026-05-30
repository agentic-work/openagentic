/**
 * AgentTree — multi-agent dispatch hierarchy primitive.
 *
 * Mock anatomy: mocks/UX/04-multiregion-k8s-dr-runbook.html:~830 + 05/06/09.
 *
 *   <div class="cm-agent-tree">
 *     <div class="cm-node">
 *       <span class="cm-dot cm-av-asst" />
 *       <span class="cm-label">cloud-arch · orchestrator</span>
 *       <span class="cm-count">7t</span>
 *     </div>
 *     <div class="cm-node cm-sub">
 *       <span class="cm-dot cm-av-k" />
 *       <span class="cm-label">k8s-topology</span>
 *       <span class="cm-count">18t</span>
 *     </div>
 *   </div>
 *
 * Agent variants: `asst` (orchestrator/purple), `c` (amber), `g` (green),
 * `s` (red), `k` (blue), `n` (neutral), `p` (pink). Match cm-av-* classes
 * already declared in chatmode-v2.css.
 */

import React from 'react';

export type AgentTreeVariant = 'asst' | 'c' | 'g' | 's' | 'k' | 'n' | 'p';

export interface AgentTreeNode {
  id: string;
  label: string;
  variant: AgentTreeVariant;
  count?: string;
  /** When set, renders with cm-sub class (depth 1 child). */
  parentId?: string;
}

export interface AgentTreeProps {
  nodes: ReadonlyArray<AgentTreeNode>;
}

export function AgentTree({ nodes }: AgentTreeProps) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <div className="cm-agent-tree" data-testid="agent-tree">
      {nodes.map((n) => (
        <div
          key={n.id}
          className={`cm-node${n.parentId ? ' cm-sub' : ''}`}
        >
          <span className={`cm-dot cm-av-${n.variant}`} aria-hidden />
          <span className="cm-label">{n.label}</span>
          {n.count && <span className="cm-count">{n.count}</span>}
        </div>
      ))}
    </div>
  );
}
