/**
 * MultiAgentSwarmPopover — TDD-driven component for the live agent swarm UX.
 *
 * Listens to subagent.start / subagent.complete events emitted by the engine
 * for a specific multi_agent / agent_pool / agent_supervisor node. Renders
 * one card per agent slot with status (queued / running / done / failed),
 * role, agentId preview, and output preview. Animated pulse while running.
 *
 * The popover is anchored to the running node and dismisses when the parent
 * unmounts or when the user closes it. Reusable for any node that emits
 * `subagent.*` events.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

afterEach(() => cleanup());

import { MultiAgentSwarmPopover } from '../MultiAgentSwarmPopover';

describe('MultiAgentSwarmPopover — TDD', () => {
  it('RED 1: renders nothing when isOpen=false', () => {
    const { container } = render(
      <MultiAgentSwarmPopover isOpen={false} nodeId="multi-1" agents={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('RED 2: renders one card per agent slot', () => {
    render(
      <MultiAgentSwarmPopover
        isOpen={true}
        nodeId="multi-1"
        agents={[
          { slot: 0, role: 'researcher', displayName: 'Researcher', status: 'running' },
          { slot: 1, role: 'analyst', displayName: 'Analyst', status: 'queued' },
          { slot: 2, role: 'critic', displayName: 'Critic', status: 'queued' },
        ]}
      />,
    );
    expect(screen.getByText('Researcher')).toBeInTheDocument();
    expect(screen.getByText('Analyst')).toBeInTheDocument();
    expect(screen.getByText('Critic')).toBeInTheDocument();
  });

  it('RED 3: shows status pill per agent (queued/running/done/failed)', () => {
    render(
      <MultiAgentSwarmPopover
        isOpen={true}
        nodeId="multi-1"
        agents={[
          { slot: 0, role: 'r', displayName: 'A1', status: 'running' },
          { slot: 1, role: 'r', displayName: 'A2', status: 'completed' },
          { slot: 2, role: 'r', displayName: 'A3', status: 'failed' },
        ]}
      />,
    );
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.getByText(/done|completed/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it('RED 4: surfaces output preview when provided', () => {
    render(
      <MultiAgentSwarmPopover
        isOpen={true}
        nodeId="multi-1"
        agents={[
          {
            slot: 0,
            role: 'researcher',
            displayName: 'Researcher',
            status: 'completed',
            outputPreview: 'I performed a web_search and found 14 relevant sources on the topic.',
          },
        ]}
      />,
    );
    expect(screen.getByText(/web_search and found/i)).toBeInTheDocument();
  });

  it('RED 5: surfaces error message on failed agents', () => {
    render(
      <MultiAgentSwarmPopover
        isOpen={true}
        nodeId="multi-1"
        agents={[
          { slot: 0, role: 'researcher', displayName: 'Researcher', status: 'failed', error: 'rate limited' },
        ]}
      />,
    );
    expect(screen.getByText(/rate limited/i)).toBeInTheDocument();
  });

  it('RED 6: pattern badge shown when provided', () => {
    render(
      <MultiAgentSwarmPopover
        isOpen={true}
        nodeId="multi-1"
        pattern="supervisor"
        agents={[{ slot: 0, role: 'r', displayName: 'A', status: 'running' }]}
      />,
    );
    expect(screen.getByText(/supervisor/i)).toBeInTheDocument();
  });
});
