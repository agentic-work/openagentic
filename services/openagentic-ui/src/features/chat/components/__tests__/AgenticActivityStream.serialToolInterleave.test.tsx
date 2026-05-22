/**
 * #814 (origin) → Slice B (2026-05-16) — serial tool dispatches.
 *
 * Origin contract (#814, superseded): consecutive tool_use blocks with
 * differing toolCallRound MUST render as N separate groups so the
 * narrative reads one-beat-per-tool. The concern was a "12 tools
 * completed" coalesce that hid chronological emit position.
 *
 * Slice B contract (current, Q12 live drive 2026-05-16): the user
 * complained that 107 individual tool cards rendered fully expanded with
 * no summary. The new rule: consecutive tool_use blocks within a single
 * assistant turn (i.e. NOT separated by interleaved text / thinking /
 * artifact blocks) collapse into ONE `tool-cluster` with a one-line
 * summary header (`N tools completed`, names list, expandable). Any
 * non-tool block immediately breaks the cluster — chronological
 * invariant preserved (CLAUDE.md rule 8(a)). True parallel fan-out
 * (shared toolCallRound) still uses the premium grid renderer.
 *
 * This test pins the NEW Slice B contract on top of the original #814
 * concern: tools that have prose / thinking between them never merge.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgenticActivityStream } from '../AgenticActivityStream';
import type { ContentBlock, ToolCall } from '../AgenticActivityStream/types/activity.types';

const completedTool = (
  id: string,
  toolName: string,
  startTime: number,
  toolCallRound: number | undefined,
): { block: ContentBlock; toolCall: ToolCall } => ({
  block: {
    id: `block-${id}`,
    type: 'tool_use',
    content: '',
    timestamp: startTime,
    isComplete: true,
    toolId: id,
    toolName,
    startTime,
    duration: 100,
    toolCallRound,
  },
  toolCall: {
    id,
    toolName,
    displayName: toolName,
    input: { q: 'x' },
    output: { ok: true },
    status: 'success',
    startTime,
    duration: 100,
    isCollapsed: true,
  },
});

const textBlock = (id: string, content: string, ts: number): ContentBlock => ({
  id: `block-${id}`,
  type: 'text',
  content,
  timestamp: ts,
  isComplete: true,
});

describe('Slice B — serial tool dispatches cluster, prose breaks the cluster', () => {
  it('three back-to-back tools (different rounds) merge into ONE cluster', () => {
    const pairs = [
      completedTool('a', 'openagentic_azure.azure_list_subscriptions', 1_000, 1),
      completedTool('b', 'openagentic_aws.aws_list_accounts', 1_500, 2),
      completedTool('c', 'kubectl_get_pods', 2_000, 3),
    ];
    const blocks = pairs.map((p) => p.block);
    const toolCalls = pairs.map((p) => p.toolCall);

    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
      />,
    );

    // One cluster groups all three, with the count summary in the header.
    const clusters = container.querySelectorAll('[data-testid="tool-cluster"]');
    expect(clusters.length).toBe(1);
    expect(clusters[0].getAttribute('data-tool-count')).toBe('3');
    expect(screen.getByTestId('tool-cluster-header').textContent).toMatch(
      /3 tools completed/i,
    );
  });

  it('three tools with prose between → THREE separate clusters / cards', () => {
    // Chronological invariant: a text block between tool dispatches MUST
    // break the cluster (CLAUDE.md rule 8(a)).
    const pairs = [
      completedTool('a', 'openagentic_azure.azure_list_subscriptions', 1_000, undefined),
      completedTool('b', 'openagentic_aws.aws_list_accounts', 1_500, undefined),
    ];
    const blocks: ContentBlock[] = [
      pairs[0].block,
      textBlock('t1', 'now checking aws...', 1_200),
      pairs[1].block,
    ];
    const toolCalls = pairs.map((p) => p.toolCall);

    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
      />,
    );

    // No cluster (only 1 tool on each side of the prose).
    expect(container.querySelectorAll('[data-testid="tool-cluster"]').length).toBe(0);
    // Two tool-card emit positions.
    const cards = container.querySelectorAll('[data-testid="tool-card"]');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    // Interleaved text block sits between the two tool emit positions.
    const text = container.querySelector('.interleaved-text-block');
    expect(text).not.toBeNull();
  });

  it('three tools with the SAME toolCallRound (true parallel fan-out) merge into one cluster', () => {
    // Positive case — preserve existing behavior. Parallel fan-out is
    // a valid cluster: backend dispatched all three as one batch.
    const pairs = [
      completedTool('a', 'openagentic_azure.azure_list_subscriptions', 1_000, 7),
      completedTool('b', 'openagentic_aws.aws_list_accounts', 1_005, 7),
      completedTool('c', 'kubectl_get_pods', 1_010, 7),
    ];
    const blocks = pairs.map((p) => p.block);
    const toolCalls = pairs.map((p) => p.toolCall);

    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
      />,
    );

    // The parallel fan-out renders as a `tool-cluster` (Slice B testid)
    // and still stamps `data-tool-call-round` so backends can identify
    // true batched dispatches.
    const fanOut = container.querySelector('[data-tool-call-round="7"]');
    expect(fanOut).not.toBeNull();
    expect(fanOut?.getAttribute('data-tool-count')).toBe('3');
    expect(fanOut?.getAttribute('data-testid')).toBe('tool-cluster');
  });
});
