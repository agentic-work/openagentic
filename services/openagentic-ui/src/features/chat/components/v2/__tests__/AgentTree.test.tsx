/**
 * Phase 10 of universal-anatomy parity — AgentTree (sidebar agent hierarchy).
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
 *     ...
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AgentTree } from '../AgentTree';

const sample = [
  { id: 'orch', label: 'cloud-arch · orchestrator', variant: 'asst' as const, count: '7t' },
  { id: 'a', label: 'k8s-topology', variant: 'k' as const, count: '18t', parentId: 'orch' },
  { id: 'b', label: 'cost-analysis', variant: 'c' as const, count: '11t', parentId: 'orch' },
  { id: 'c', label: 'network-latency', variant: 's' as const, count: '9t', parentId: 'orch' },
];

describe('AgentTree (mock 04:~830)', () => {
  it('renders cm-agent-tree with one cm-node per agent', () => {
    const { container } = render(<AgentTree nodes={sample} />);
    const tree = container.querySelector('.cm-agent-tree');
    expect(tree).not.toBeNull();
    expect(tree!.querySelectorAll('.cm-node').length).toBe(4);
  });

  it('marks descendants with cm-sub', () => {
    const { container } = render(<AgentTree nodes={sample} />);
    const subs = container.querySelectorAll('.cm-node.cm-sub');
    expect(subs.length).toBe(3);
  });

  it('emits the right cm-dot variant per node', () => {
    const { container } = render(<AgentTree nodes={sample} />);
    expect(container.querySelector('.cm-node:not(.cm-sub) .cm-dot.cm-av-asst')).not.toBeNull();
    expect(container.querySelector('.cm-node.cm-sub .cm-dot.cm-av-k')).not.toBeNull();
    expect(container.querySelector('.cm-node.cm-sub .cm-dot.cm-av-c')).not.toBeNull();
    expect(container.querySelector('.cm-node.cm-sub .cm-dot.cm-av-s')).not.toBeNull();
  });

  it('renders cm-label and cm-count for each node', () => {
    const { container } = render(<AgentTree nodes={sample} />);
    const labels = container.querySelectorAll('.cm-node .cm-label');
    const counts = container.querySelectorAll('.cm-node .cm-count');
    expect(labels.length).toBe(4);
    expect(counts.length).toBe(4);
    expect(labels[0]).toHaveTextContent('cloud-arch · orchestrator');
    expect(counts[1]).toHaveTextContent('18t');
  });

  it('renders nothing when nodes empty', () => {
    const { container } = render(<AgentTree nodes={[]} />);
    expect(container.querySelector('.cm-agent-tree')).toBeNull();
  });
});
