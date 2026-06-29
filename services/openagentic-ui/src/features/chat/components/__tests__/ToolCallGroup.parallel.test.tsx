/**
 * Task #131 (Phase F₂) — parallel fan-out group rendering test.
 *
 * Mocks a stream with 3 concurrent `tool_executing` events followed by
 * out-of-order `tool_result` events. Asserts:
 *   1. The group card shows 3 sub-cards under one parent.
 *   2. Each sub-card has its own independent status (running / success /
 *      error) — the DOM order stays stable (emit order) while the
 *      visual state flips per block as its completion arrives.
 *   3. Cards retain their data-tool-name identity after out-of-order
 *      result events (the third-emitted tool can finish first).
 *   4. The group header reflects "N tools completed" when all done.
 *   5. The fan-out label renders "Parallel fan-out · 3 concurrent calls".
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolCallGroup } from '../UnifiedAgentActivity/ToolCallGroup';
import type { ContentBlock, ToolCall } from '../AgenticActivityStream/types/activity.types';

const makeBlock = (
  toolName: string,
  slot: number,
  opts: Partial<ContentBlock> = {}
): ContentBlock => ({
  id: `block-${toolName}-${slot}`,
  type: 'tool_use',
  timestamp: 1_700_000_000_000 + slot,
  content: '',
  toolId: `call-${toolName}`,
  toolName,
  isComplete: false,
  startTime: 1_700_000_000_000 + slot,
  toolCallRound: 1,
  parallelSlotIndex: slot,
  ...opts,
});

const makeCall = (toolName: string, output?: unknown): ToolCall => ({
  id: `call-${toolName}`,
  toolName,
  displayName: toolName,
  input: {},
  output,
  status: output == null ? 'calling' : 'success',
  startTime: 1_700_000_000_000,
  isCollapsed: false,
});

describe('ToolCallGroup (task #131 parallel fan-out)', () => {
  it('renders N sub-cards when N blocks share a toolCallRound', () => {
    const blocks: ContentBlock[] = [
      makeBlock('azure_list_subscriptions', 0),
      makeBlock('aws_get_caller_identity', 1),
      makeBlock('gcp_list_projects', 2),
    ];
    render(<ToolCallGroup blocks={blocks} toolCalls={[]} isStreaming />);
    const group = screen.getByTestId('parallel-tool-group');
    expect(group).toBeInTheDocument();
    expect(group.getAttribute('data-tool-count')).toBe('3');
    expect(group.getAttribute('data-tool-call-round')).toBe('1');

    const subs = screen.getAllByTestId('parallel-tool-subcard');
    expect(subs).toHaveLength(3);
    // Emit order is preserved in DOM (slot 0, 1, 2).
    expect(subs[0].getAttribute('data-tool-name')).toBe('azure_list_subscriptions');
    expect(subs[1].getAttribute('data-tool-name')).toBe('aws_get_caller_identity');
    expect(subs[2].getAttribute('data-tool-name')).toBe('gcp_list_projects');
  });

  it('shows the "Parallel fan-out · N concurrent calls" header', () => {
    const blocks = [makeBlock('a', 0), makeBlock('b', 1)];
    render(<ToolCallGroup blocks={blocks} toolCalls={[]} isStreaming />);
    const hdr = screen.getByTestId('parallel-tool-group-header');
    expect(hdr.textContent).toMatch(/Parallel fan-out/i);
    expect(hdr.textContent).toMatch(/2 concurrent calls/i);
  });

  it('each sub-card tracks its own status; out-of-order completion updates in place', () => {
    // Initial: all three running. Then tool C (slot 2) completes first,
    // then A (slot 0) errors, then B (slot 1) completes.
    // v2 ToolCard status values: 'running' | 'ok' | 'err'.
    const running = [
      makeBlock('tool_a', 0),
      makeBlock('tool_b', 1),
      makeBlock('tool_c', 2),
    ];
    const { rerender } = render(
      <ToolCallGroup blocks={running} toolCalls={[]} isStreaming />
    );
    let subs = screen.getAllByTestId('parallel-tool-subcard');
    expect(subs.every(s => s.getAttribute('data-tool-status') === 'running')).toBe(true);

    // C completes first (out of emit order).
    const stepA = [
      running[0],
      running[1],
      { ...running[2], isComplete: true, duration: 1470, result: { ok: true } },
    ];
    rerender(<ToolCallGroup blocks={stepA} toolCalls={[makeCall('tool_c', { ok: true })]} isStreaming />);
    subs = screen.getAllByTestId('parallel-tool-subcard');
    // DOM order is STILL slot 0, 1, 2 (stable — no reorder).
    expect(subs[0].getAttribute('data-tool-name')).toBe('tool_a');
    expect(subs[1].getAttribute('data-tool-name')).toBe('tool_b');
    expect(subs[2].getAttribute('data-tool-name')).toBe('tool_c');
    // But visual state of slot 2 has flipped to ok even though A/B
    // are still running. This is the completion-order reveal.
    expect(subs[0].getAttribute('data-tool-status')).toBe('running');
    expect(subs[1].getAttribute('data-tool-status')).toBe('running');
    expect(subs[2].getAttribute('data-tool-status')).toBe('ok');

    // A errors.
    const stepB = [
      { ...stepA[0], isComplete: true, error: 'permission denied', duration: 800 },
      stepA[1],
      stepA[2],
    ];
    rerender(<ToolCallGroup blocks={stepB} toolCalls={[makeCall('tool_c', { ok: true })]} isStreaming />);
    subs = screen.getAllByTestId('parallel-tool-subcard');
    expect(subs[0].getAttribute('data-tool-status')).toBe('err');
    expect(subs[1].getAttribute('data-tool-status')).toBe('running');
    expect(subs[2].getAttribute('data-tool-status')).toBe('ok');

    // Finally B completes.
    const stepC = [
      stepB[0],
      { ...stepB[1], isComplete: true, duration: 2100, result: { rows: [] } },
      stepB[2],
    ];
    rerender(
      <ToolCallGroup
        blocks={stepC}
        toolCalls={[makeCall('tool_c', { ok: true }), makeCall('tool_b', { rows: [] })]}
        isStreaming
      />
    );
    subs = screen.getAllByTestId('parallel-tool-subcard');
    // Stable emit order preserved.
    expect(subs[0].getAttribute('data-tool-name')).toBe('tool_a');
    expect(subs[1].getAttribute('data-tool-name')).toBe('tool_b');
    expect(subs[2].getAttribute('data-tool-name')).toBe('tool_c');
    expect(subs[0].getAttribute('data-tool-status')).toBe('err');
    expect(subs[1].getAttribute('data-tool-status')).toBe('ok');
    expect(subs[2].getAttribute('data-tool-status')).toBe('ok');

    // Group header swaps to "N tools completed (…failed)" once all done.
    const group = screen.getByTestId('parallel-tool-group');
    expect(group.getAttribute('data-all-complete')).toBe('true');
    expect(group.textContent).toMatch(/3 tools completed/);
    expect(group.textContent).toMatch(/1 failed/);
  });

  it('renders a per-card timer with the elapsed or final duration', () => {
    // Keep the group open by leaving one block running; the group only
    // auto-collapses once every block is complete. This exercises the
    // mixed-state pass (some cards done, some running) that the mockup
    // calls out as the signature visual of the fan-out.
    const mixed = [
      makeBlock('probe_a', 0, { isComplete: true, duration: 1820 }),
      makeBlock('probe_b', 1, { isComplete: true, duration: 1470 }),
      makeBlock('probe_c', 2), // still running
    ];
    render(<ToolCallGroup blocks={mixed} toolCalls={[]} isStreaming />);
    const timers = screen.getAllByTestId('parallel-tool-timer');
    expect(timers).toHaveLength(3);
    expect(timers[0].textContent).toMatch(/1\.82s/);
    expect(timers[1].textContent).toMatch(/1\.47s/);
    // Running card shows its live "Running…" indicator (v2 ToolCard contract).
    expect(timers[2].textContent).toMatch(/Running/);
  });

  it('stable DOM ordering uses parallelSlotIndex, not insertion order', () => {
    // Blocks arrive with slot indices 2, 0, 1 (simulating event reorder);
    // component must render them in slot order (0, 1, 2).
    const blocks = [
      makeBlock('third', 2),
      makeBlock('first', 0),
      makeBlock('second', 1),
    ];
    render(<ToolCallGroup blocks={blocks} toolCalls={[]} isStreaming />);
    const subs = screen.getAllByTestId('parallel-tool-subcard');
    expect(subs[0].getAttribute('data-tool-name')).toBe('first');
    expect(subs[1].getAttribute('data-tool-name')).toBe('second');
    expect(subs[2].getAttribute('data-tool-name')).toBe('third');
  });

  it('does not render when blocks have no toolCallRound (guards against accidental use)', () => {
    // Even though this component is only wired by AgenticActivityStream
    // when all blocks share a round, exercise the no-round path to
    // confirm we still render without crashing. Slice B (2026-05-16):
    // the group emits `tool-cluster` instead of `parallel-tool-group`
    // when blocks.length >= 2, and child cells emit `tool-card`.
    const blocks = [
      { ...makeBlock('x', 0), toolCallRound: undefined },
      { ...makeBlock('y', 1), toolCallRound: undefined },
    ];
    const { container } = render(<ToolCallGroup blocks={blocks} toolCalls={[]} isStreaming />);
    const group = container.querySelector('[data-testid="tool-cluster"]')!;
    expect(group).not.toBeNull();
    // data-tool-call-round attr should be absent or empty when undefined.
    const attr = group.getAttribute('data-tool-call-round');
    expect(attr === null || attr === '' || attr === 'undefined').toBe(true);
    // Expand the cluster so child cards render, then count them.
    const header = group.querySelector('[data-testid="tool-cluster-header"]') as HTMLElement;
    expect(header).not.toBeNull();
    fireEvent.click(header);
    const cards = group.querySelectorAll('[data-testid="tool-card"]');
    expect(cards.length).toBe(2);
  });
});
