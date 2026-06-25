/**
 * AgenticActivityStream — v0.6.7 task #159 delegation wiring tests
 *
 * Verifies that the five premium UX components shipped in task #151 are
 * actually consumed by AgenticActivityStream instead of sitting idle:
 *
 *   1. InlineThinkingBlock renders for thinking content blocks (not the
 *      legacy CollapsedThinkingBlock).
 *   2. ToolCallCard renders for executing tool_use blocks AND receives
 *      inputDeltaContent for live input_json_delta streaming.
 *
 * CostPill + UnifiedActivityTree are composed by MessageBubble (one level
 * up) so they have their own dedicated tests. This file just nails down
 * the AgenticActivityStream seam so a future refactor can't silently
 * unwire the premium renderers.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgenticActivityStream } from '../AgenticActivityStream';
import type { ContentBlock, ToolCall } from '../AgenticActivityStream/types/activity.types';

describe('AgenticActivityStream delegation (v0.6.7 task #159)', () => {
  it('delegates thinking blocks to InlineThinkingBlock', () => {
    const blocks: ContentBlock[] = [
      {
        id: 'thinking-1',
        type: 'thinking',
        content: 'weighing options about the plan',
        timestamp: 1_000,
        isComplete: true,
        startTime: 1_000,
        duration: 2_500,
      },
      // At least one text block so hasInterleavedContent trips and the
      // thinking_group path runs.
      {
        id: 'text-1',
        type: 'text',
        content: 'done',
        timestamp: 4_000,
        isComplete: true,
      },
    ];

    render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={[]}
        theme="dark"
      />
    );

    // InlineThinkingBlock renders a data-testid="inline-thinking-block"
    // root. The legacy CollapsedThinkingBlock does NOT emit that attr.
    const thinking = screen.getByTestId('inline-thinking-block');
    expect(thinking).toBeInTheDocument();
    expect(thinking.getAttribute('data-streaming')).toBe('false');
    // Header should read "Thought · 2.5s · ~N tok" once complete.
    const header = screen.getByTestId('inline-thinking-header');
    expect(header.textContent).toMatch(/Thought · 2\.5s/);
  });

  it('delegates executing tool blocks to ToolCallCard with inputDeltaContent', () => {
    const partialJson = '{"ns":';
    const blocks: ContentBlock[] = [
      {
        id: 'tool-1',
        type: 'tool_use',
        content: partialJson, // block.content carries input_json_delta partial JSON
        timestamp: 1_000,
        isComplete: false, // executing
        toolId: 't1',
        toolName: 'list_pods',
        startTime: 1_000,
      },
    ];
    const toolCalls: ToolCall[] = [
      {
        id: 't1',
        toolName: 'list_pods',
        displayName: 'list_pods',
        input: undefined,
        output: undefined,
        status: 'calling',
        startTime: 1_000,
        isCollapsed: true,
      },
    ];

    render(
      <AgenticActivityStream
        isStreaming={true}
        streamingState="tool_use"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
      />
    );

    // v2 ToolCard adapter emits data-tool-card with data-tool-status.
    // Streaming JSON shows up in the INPUT panel (data-testid="tool-input").
    const card = document.querySelector('[data-tool-card]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.getAttribute('data-tool-status')).toBe('running');
    const inputPanel = screen.getByTestId('tool-input');
    expect(inputPanel.textContent).toContain('ns');
  });

  it('does NOT render the live-input ToolCallCard once the tool completes', () => {
    const blocks: ContentBlock[] = [
      {
        id: 'tool-1',
        type: 'tool_use',
        content: '{"ns":"default"}', // final valid JSON after stream end
        timestamp: 1_000,
        isComplete: true, // completed
        toolId: 't1',
        toolName: 'list_pods',
        startTime: 1_000,
        duration: 750,
      },
    ];
    const toolCalls: ToolCall[] = [
      {
        id: 't1',
        toolName: 'list_pods',
        displayName: 'list_pods',
        input: { ns: 'default' },
        output: { pods: [] },
        status: 'success',
        startTime: 1_000,
        duration: 750,
        isCollapsed: true,
      },
    ];

    render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
      />
    );

    // v2 ToolCard renders with status='ok' (not 'running') once complete.
    const card = document.querySelector('[data-tool-card]') as HTMLElement | null;
    if (card) {
      expect(card.getAttribute('data-tool-status')).not.toBe('running');
    }
  });
});
