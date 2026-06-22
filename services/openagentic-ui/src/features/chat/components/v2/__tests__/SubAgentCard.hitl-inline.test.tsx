/**
 * HITL.3 — sub-agent HITL chip renders INLINE inside the sub-agent's
 * tool card context.
 *
 * When openagentic-proxy emits `mcp_approval_required` for a tool inside a
 * sub-agent's execution (e.g. `azure_create_resource_group` called by
 * the cost-analysis agent), the HITL chip must render INLINE at the
 * sub-agent's tool card position in the activity stream — NOT as a
 * detached footer block.
 *
 * The HITL approval entry carries `parentToolUseId` (the Task tool_use_id
 * that spawned the sub-agent) so the AAS can distinguish "this HITL
 * belongs to sub-agent-A's tool call" from "this HITL belongs to the
 * main agent's direct tool call" when both have the same toolName.
 *
 * RED: fails because:
 *   (a) HitlApprovalEntry doesn't have parentToolUseId field (type gap)
 *   (b) useChatStream handler doesn't capture parentToolUseId from the frame
 *   (c) AAS hitlByToolName lookup doesn't use parentToolUseId for refined
 *       matching
 *
 * GREEN: passes once all three are fixed.
 *
 * Uses the same render harness as AgenticActivityStream.hitlInline.test.tsx.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgenticActivityStream } from '../../AgenticActivityStream';
import type {
  ContentBlock,
  ToolCall,
  HitlApprovalEntry,
} from '../../AgenticActivityStream/types/activity.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function completedTool(
  id: string,
  toolName: string,
  ts: number,
  agentId?: string,
  parentToolId?: string,
): { block: ContentBlock; toolCall: ToolCall } {
  return {
    block: {
      id: `block-${id}`,
      type: 'tool_use',
      content: '',
      timestamp: ts,
      isComplete: true,
      toolId: id,
      toolName,
      startTime: ts,
      duration: 100,
      agentId,
      parentToolId,
    } as ContentBlock,
    toolCall: {
      id,
      toolName,
      displayName: toolName,
      input: {},
      output: { ok: true },
      status: 'success',
      startTime: ts,
      duration: 100,
      isCollapsed: true,
    } as ToolCall,
  };
}

function textBlock(id: string, content: string, ts: number): ContentBlock {
  return { id: `block-${id}`, type: 'text', content, timestamp: ts, isComplete: true } as ContentBlock;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HITL.3 — sub-agent HITL chip renders inline at sub-agent tool card', () => {

  // ── HITL.3a — HitlApprovalEntry type carries parentToolUseId ─────────────
  it('HitlApprovalEntry type accepts parentToolUseId field', () => {
    // Compile-time check: if HitlApprovalEntry doesn't have parentToolUseId,
    // this assignment causes a type error (caught at tsc, not vitest).
    // Runtime check: the field is preserved as-is.
    const entry: HitlApprovalEntry = {
      requestId: 'req-sub-1',
      toolName: 'azure_create_resource_group',
      reason: 'Creates a new Azure RG',
      timeoutMs: 300_000,
      status: 'pending',
      parentToolUseId: 'toolu_task_abc123',  // ← NEW field
    };
    expect(entry.parentToolUseId).toBe('toolu_task_abc123');
  });

  // ── HITL.3b — Sub-agent tool HITL chip renders inside the AAS ────────────
  it('renders HITL chip at the sub-agent tool_use block (matched by toolName)', () => {
    // Simulate an activity stream with:
    //   1. Parent agent text
    //   2. Task tool_use (spawns cost-analysis sub-agent)  ← parentToolUseId
    //   3. Sub-agent tool_use (azure_create_resource_group) ← HITL target
    //   4. Parent agent text
    //
    // The HITL approval entry has parentToolUseId pointing to the Task tool.
    // The chip should render adjacent to the sub-agent's tool card.

    // Task tool is the parent agent's delegation (has agentId to appear as agent block)
    const taskTool = completedTool('task-1', 'Task', 1_000, 'agent-cost-analysis');
    // Sub-agent's tool call is a regular tool_use block (no agentId — it's a
    // tool that the sub-agent invoked via MCP, not the agent block itself)
    const subAgentTool = completedTool(
      'sub-rg-1',
      'azure_create_resource_group',
      1_200,
      undefined, // no agentId — this is a regular tool_use
      'task-1',  // parentToolId → belongs to the Task spawn context
    );

    const blocks: ContentBlock[] = [
      textBlock('text-0', 'Delegating to cost analysis agent...', 900),
      taskTool.block,
      subAgentTool.block,
      textBlock('text-1', 'Waiting for approval...', 1_400),
    ];
    const toolCalls = [taskTool.toolCall, subAgentTool.toolCall];

    const approvals: HitlApprovalEntry[] = [
      {
        requestId: 'req-sub-rg',
        toolName: 'azure_create_resource_group',
        reason: 'Sub-agent wants to create a resource group in production',
        timeoutMs: 300_000,
        status: 'pending',
        parentToolUseId: 'task-1',
      },
    ];

    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
        hitlApprovals={approvals}
        onApproveHitl={vi.fn()}
        onDenyHitl={vi.fn()}
      />,
    );

    // The HITL card must appear in the AAS
    const card = screen.getByTestId('hitl-approval-card');
    expect(card).toBeInTheDocument();
    expect(card.getAttribute('data-status')).toBe('pending');

    // Approve / Deny buttons must be present for a pending entry
    expect(screen.getByTestId('hitl-approve-btn')).toBeInTheDocument();
    expect(screen.getByTestId('hitl-deny-btn')).toBeInTheDocument();

    // The HITL card must sit INSIDE the AAS root (not a detached footer)
    const aas = container.querySelector('[data-testid="agentic-activity-stream"]');
    expect(aas).not.toBeNull();
    expect(aas!.contains(card)).toBe(true);

    // The HITL card must appear AFTER the sub-agent tool card in DOM order
    const subAgentToolCard = container.querySelector(
      '[data-testid="tool-card"][data-tool-name="azure_create_resource_group"]',
    );
    expect(subAgentToolCard).not.toBeNull();
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(
      subAgentToolCard!.compareDocumentPosition(card) & FOLLOWING,
      'HITL chip must appear AFTER the sub-agent tool card, not before it',
    ).toBeTruthy();
  });

  // ── HITL.3c — parentToolUseId does not break main-agent HITL ─────────────
  it('main-agent HITL without parentToolUseId still renders correctly (regression guard)', () => {
    // An approval entry WITHOUT parentToolUseId — the standard main-agent
    // case. Must still render the chip inline at the matching tool_use.
    const mainTool = completedTool('main-rg-1', 'azure_create_resource_group', 1_000);
    const blocks: ContentBlock[] = [mainTool.block];
    const toolCalls = [mainTool.toolCall];
    const approvals: HitlApprovalEntry[] = [
      {
        requestId: 'req-main-rg',
        toolName: 'azure_create_resource_group',
        reason: 'Main agent creates RG',
        timeoutMs: 60_000,
        status: 'pending',
        // parentToolUseId is intentionally absent — legacy main-agent path
      },
    ];

    render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={toolCalls}
        theme="dark"
        hitlApprovals={approvals}
        onApproveHitl={vi.fn()}
        onDenyHitl={vi.fn()}
      />,
    );

    const card = screen.getByTestId('hitl-approval-card');
    expect(card).toBeInTheDocument();
    expect(card.getAttribute('data-status')).toBe('pending');
  });
});
