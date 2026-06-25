/**
 * T1-hide — hide T1 meta-tool cards from the inline activity stream.
 *
 * User directive 2026-05-12: "t1 tools shouldnt ever show up
 * inline/interleave — they are distracting and for the most part useless".
 *
 * T1 catalog (the platform's meta-tools shipped from
 * services/openagentic-api/src/routes/chat/pipeline/chat/toolRegistry.ts):
 *   tool_search, agent_search, Task, agent_send, agent_list, agent_stop,
 *   read_large_result, web_search, web_fetch, synth,
 *   pattern_save, pattern_recall,
 *   compose_visual, compose_app, render_artifact,
 *   request_clarification, browser_sandbox_exec,
 *   memorize.
 *
 * Contract:
 *   - The wire / reducer still accumulates these tool_executing /
 *     tool_result frames (telemetry + audit + persistence keep working).
 *   - AgenticActivityStream filters them at the render boundary — no
 *     CollapsedToolRow / data-collapsed-row gets emitted for any T1 name.
 *   - Non-T1 tools (openagentic_aws.*, openagentic_azure.*, kubectl_*, etc.) keep rendering.
 *   - Tool-count summary chip reflects ONLY the visible (non-T1) count.
 *   - When EVERY tool in a group is T1 the whole group disappears (no
 *     empty wrapper, no "0 tools completed" chip).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgenticActivityStream } from '../AgenticActivityStream';
import type { ContentBlock, ToolCall } from '../AgenticActivityStream/types/activity.types';

// Tiny helper — builds a completed tool block + matching ToolCall pair
const completedTool = (
  id: string,
  toolName: string,
  startTime: number,
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

describe('T1-hide — filter T1 meta-tool cards from inline activity stream', () => {
  it('hides every T1 tool card while keeping T2/T3 cards visible', () => {
    // Mixed batch: 3 T1 meta-tools (must hide) + 2 T2 openagentic_* tools (must show).
    // Slice B (2026-05-16): 2 visible tools coalesce into one cluster. The
    // cluster header surfaces the humanized names of the visible tools.
    // Assert via the cluster names preview span instead of per-row
    // `data-tool-name` — the row-level testid is only present in the
    // expanded view, but the visibility contract is what matters here.
    const pairs = [
      completedTool('t1-tool_search', 'tool_search', 1_000),
      completedTool('t2-azure', 'openagentic_azure.azure_list_subscriptions', 1_100),
      completedTool('t1-Task', 'Task', 1_200),
      completedTool('t2-aws', 'openagentic_aws.aws_cost_by_service', 1_300),
      completedTool('t1-synth', 'synth', 1_400),
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

    // T2 tools surface in the cluster header names preview.
    const names = container.querySelector('[data-testid="tool-cluster-names"]');
    expect(names).not.toBeNull();
    // Humanizer strips openagentic_azure./openagentic_aws. prefix and title-cases the
    // remainder, so we match on the trailing token.
    expect(names!.textContent).toMatch(/Azure List Subscriptions|List Subscriptions/i);
    expect(names!.textContent).toMatch(/Cost By Service/i);

    // T1 cards must NOT be present anywhere in the DOM.
    expect(document.querySelector('[data-tool-name="tool_search"]')).toBeNull();
    expect(document.querySelector('[data-tool-name="Task"]')).toBeNull();
    expect(document.querySelector('[data-tool-name="synth"]')).toBeNull();
    // Slice B: cluster summary counts the visible tools, not the hidden ones.
    expect(container.querySelector('[data-testid="tool-cluster"]')?.getAttribute('data-tool-count')).toBe('2');
  });

  it('group summary chip reflects ONLY the visible (non-T1) count', () => {
    // 5 total tools, 3 T1 hidden, 2 T2 visible → summary should be "2 tools",
    // never "5 tools completed". Single visible tool would say the label.
    const pairs = [
      completedTool('t1-tool_search', 'tool_search', 1_000),
      completedTool('t2-azure', 'openagentic_azure.azure_list_subscriptions', 1_100),
      completedTool('t1-Task', 'Task', 1_200),
      completedTool('t2-aws', 'openagentic_aws.aws_cost_by_service', 1_300),
      completedTool('t1-synth', 'synth', 1_400),
    ];
    const blocks = pairs.map((p) => p.block);
    const toolCalls = pairs.map((p) => p.toolCall);

    render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
      />,
    );

    // The post-filter group has 2 blocks → the header chip must NOT advertise
    // a five-count. Tolerant matcher — guards against "5 tools completed"
    // OR "5 tools" anywhere in the rendered text.
    expect(screen.queryByText(/5 tools/i)).toBeNull();
    expect(screen.queryByText(/^4 tools/i)).toBeNull();
    expect(screen.queryByText(/^3 tools/i)).toBeNull();
  });

  it('hides the entire group when every tool in the group is T1', () => {
    // Pure T1 batch — group is empty after filter, so nothing should render.
    const pairs = [
      completedTool('t1-tool_search', 'tool_search', 1_000),
      completedTool('t1-Task', 'Task', 1_100),
      completedTool('t1-web_search', 'web_search', 1_200),
    ];
    const blocks = pairs.map((p) => p.block);
    const toolCalls = pairs.map((p) => p.toolCall);

    render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
      />,
    );

    // No collapsed row anywhere — every block in this stream is T1.
    expect(document.querySelector('[data-collapsed-row]')).toBeNull();
    expect(document.querySelector('[data-tool-name="tool_search"]')).toBeNull();
    expect(document.querySelector('[data-tool-name="Task"]')).toBeNull();
    expect(document.querySelector('[data-tool-name="web_search"]')).toBeNull();
  });

  it('hides failed T1 cards too (user does not want T1 noise even on error)', () => {
    // A T1 tool that errored — still must not show. Pair with a passing T2.
    const t1Failed = completedTool('t1-tool_search-err', 'tool_search', 1_000);
    t1Failed.toolCall.status = 'error';
    t1Failed.toolCall.output = { error: 'no_results' };
    const t2Ok = completedTool('t2-azure', 'openagentic_azure.azure_list_subscriptions', 1_100);

    render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[t1Failed.block, t2Ok.block]}
        toolCalls={[t1Failed.toolCall, t2Ok.toolCall]}
        theme="dark"
      />,
    );

    expect(document.querySelector('[data-tool-name="tool_search"]')).toBeNull();
    expect(
      document.querySelector('[data-tool-name="openagentic_azure.azure_list_subscriptions"]'),
    ).not.toBeNull();
  });
});
