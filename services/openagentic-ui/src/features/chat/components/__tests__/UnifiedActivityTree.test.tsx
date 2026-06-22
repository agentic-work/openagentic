/**
 * UnifiedActivityTree — v0.6.7 chat-polish fix 5
 *
 * Verifies agent cards get:
 *   - first-letter avatar (button, colored by id hash)
 *   - turn count label
 *   - click-to-collapse behaviour (children hide)
 * and TreeNode left-border deepens with depth.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UnifiedActivityTree } from '../UnifiedActivityTree/UnifiedActivityTree';
import type { NormalizedStreamEvent } from '../../../../types/AnthropicStreamEvent';
import { colorHashForId } from '../UnifiedActivityTree/colorHash';

describe('UnifiedActivityTree (v0.6.7 agent cards)', () => {
  // Slice G.4c — tool calls are emitted as canonical content_block_start
  // (type: 'tool_use') / content_block_stop. agent_start/agent_stop remain
  // platform envelope events. agentStack pushes the agent on agent_start so
  // canonical content_blocks nest under the active agent.
  const events: NormalizedStreamEvent[] = [
    { type: 'agent_start', id: 'a1', name: 'infra-agent', role: 'infrastructure' },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'list_pods', input: {} } } as any,
    { type: 'content_block_stop', index: 0 } as any,
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't2', name: 'get_node', input: {} } } as any,
    { type: 'content_block_stop', index: 1 } as any,
    { type: 'agent_stop', id: 'a1', durationMs: 2000, tokensIn: 100, tokensOut: 200, cost: 0.001 },
  ];

  it('renders agent avatar, name, role, turn count', () => {
    render(<UnifiedActivityTree events={events} isStreaming={false} theme="dark" />);
    const card = screen.getByTestId('agent-card');
    expect(card).toHaveAttribute('data-agent-id', 'a1');

    const avatar = screen.getByTestId('agent-avatar');
    // First letter of agent name
    expect(avatar.textContent).toBe('I');
    // Background color is assigned via inline style. Browsers normalize
    // hex → rgb so we just assert it's a non-empty color. The 4-anchor
    // mockup palette (see colorHash.ts) returns hex strings directly.
    expect((avatar as HTMLElement).style.backgroundColor).not.toBe('');
    expect(colorHashForId('a1', 'dark')).toMatch(/^#[0-9a-f]{6}$/i);

    const turns = screen.getByTestId('agent-turn-count');
    expect(turns.textContent).toBe('2 turns');
  });

  it('click on avatar collapses the agent card', () => {
    render(<UnifiedActivityTree events={events} isStreaming={false} theme="dark" />);
    const card = screen.getByTestId('agent-card');
    expect(card).toHaveAttribute('data-collapsed', 'false');
    // Two tool children rendered
    const toolRowsBefore = screen.getAllByTestId('tree-node').filter(n =>
      Number(n.getAttribute('data-depth') ?? '0') > 0
    );
    expect(toolRowsBefore.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('agent-avatar'));
    expect(card).toHaveAttribute('data-collapsed', 'true');

    const toolRowsAfter = screen.getAllByTestId('tree-node').filter(n =>
      Number(n.getAttribute('data-depth') ?? '0') > 0
    );
    expect(toolRowsAfter.length).toBe(0);
  });

  it('decomposes 2 sub-agents into expanded cards (Mockup 03 sub-agent pattern)', () => {
    // Two sub-agents under a parent orchestrator — matches
    // docs/release-plans/v0.6.7-ux-mockups/03-secure-api-build.html
    // "dev agent · 2 sub-agents · 2 passes" flow.
    const twoAgentEvents: NormalizedStreamEvent[] = [
      { type: 'agent_start', id: 'gc1', name: 'go-codegen', role: 'code_execution' },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'write_file', input: {} } } as any,
      { type: 'content_block_stop', index: 0 } as any,
      { type: 'agent_stop', id: 'gc1', durationMs: 11200, tokensIn: 2000, tokensOut: 1412, cost: 0.042 },
      { type: 'agent_start', id: 'sa1', name: 'security-audit', role: 'validation' },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't2', name: 'vuln_scan', input: {} } } as any,
      { type: 'content_block_stop', index: 1 } as any,
      { type: 'agent_stop', id: 'sa1', durationMs: 5700, tokensIn: 900, tokensOut: 704, cost: 0.019 },
    ];
    render(<UnifiedActivityTree events={twoAgentEvents} isStreaming={false} theme="dark" />);
    const cards = screen.getAllByTestId('agent-card');
    expect(cards.length).toBe(2);
    // Each card has its own stats block + return_value pill
    const statsBlocks = screen.getAllByTestId('agent-stats');
    expect(statsBlocks.length).toBe(2);
    const returns = screen.getAllByTestId('agent-return');
    expect(returns.length).toBe(2);
    // Name + role chip render on each card
    expect(screen.getByText('go-codegen')).toBeInTheDocument();
    expect(screen.getByText('security-audit')).toBeInTheDocument();
    // role chip uses "sub-agent · <role>" pattern
    expect(screen.getByText(/sub-agent · code_execution/)).toBeInTheDocument();
    expect(screen.getByText(/sub-agent · validation/)).toBeInTheDocument();
    // Each card has a colored left-border (3px)
    for (const card of cards) {
      expect((card as HTMLElement).style.borderLeft).toMatch(/3px solid/);
    }
  });

  it('depth-scaled left-border color is darker at deeper levels', () => {
    const nestedEvents: NormalizedStreamEvent[] = [
      { type: 'agent_start', id: 'p1', name: 'planner', role: 'planner' },
      { type: 'agent_start', id: 'c1', name: 'coder', role: 'coder', parentId: 'p1' },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'read_file', input: {} } } as any,
      { type: 'content_block_stop', index: 0 } as any,
      { type: 'agent_stop', id: 'c1', durationMs: 500, tokensIn: 10, tokensOut: 10, cost: 0 },
      { type: 'agent_stop', id: 'p1', durationMs: 600, tokensIn: 20, tokensOut: 20, cost: 0 },
    ];
    render(<UnifiedActivityTree events={nestedEvents} isStreaming={false} theme="dark" />);
    const nodes = screen.getAllByTestId('tree-node');
    const byDepth = new Map<number, HTMLElement>();
    nodes.forEach(n => {
      const d = Number(n.getAttribute('data-depth') ?? '0');
      if (!byDepth.has(d)) byDepth.set(d, n as HTMLElement);
    });
    // Depth 0 node has no left-border; depth >= 1 does.
    expect(byDepth.get(0)?.style.borderLeft).toBe('');
    expect(byDepth.get(1)?.style.borderLeft ?? '').toMatch(/2px solid/);
    expect(byDepth.get(1)?.style.borderLeft ?? '').toMatch(/rgba\(255,\s?255,\s?255,/);
  });
});
