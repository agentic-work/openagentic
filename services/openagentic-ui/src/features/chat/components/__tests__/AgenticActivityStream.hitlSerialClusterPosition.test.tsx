/**
 * #922 + #831 regression — HITL card MIGRATES to bottom of message when the
 * model emits consecutive tool_use blocks (serial-tool cluster).
 *
 * Customer-visible symptom (dev 2026-05-20): the user prompts a
 * HITL-gated tool (e.g. azure_create_resource_group). The card appears
 * inline at the tool's position. Then the model immediately emits one or
 * more additional tool_use blocks (the model often dispatches a `Task` /
 * read tool back-to-back). Those blocks merge into a serial-tool cluster
 * (AAS:3480-3493 consecutive `tool_use` blocks become one `tool_group`).
 * The render path then wraps the WHOLE cluster in a single wrapper div
 * and appends `hitlNodes` AFTER that wrapper (AAS:3578-3586 `wrap()`),
 * so the HITL card lands at the BOTTOM of the cluster — visually below
 * every tool that was added after the one it gates.
 *
 * Required contract (Claude.ai parity):
 *   The HITL approval card must be a DOM DESCENDANT of the specific
 *   tool-card div whose `data-tool-name` matches the HITL entry's
 *   `toolName`. NOT a sibling appended after the whole cluster, NOT a
 *   trailing orphan strip at the end of AAS.
 *
 * Anti-regression:
 *   - Single-tool case still works (existing AgenticActivityStream.hitlInline
 *     test covers this; this file does NOT duplicate).
 *   - When 4 consecutive `azure_create_resource_group` tool_use blocks
 *     merge into a cluster + 1 pending HITL: card sits INSIDE the FIRST
 *     tool-card's subtree (earliest-unrendered-pending FIFO).
 *   - When `azure_create_resource_group` + `kubectl_get_pods` consecutive +
 *     1 pending HITL for the first: card sits INSIDE the first tool-card's
 *     subtree (NOT after the kubectl card).
 *   - Vitest, NOT bun. testing-library/react render + jsdom.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgenticActivityStream } from '../AgenticActivityStream/AgenticActivityStream';
import type {
  ContentBlock,
  ToolCall,
  HitlApprovalEntry,
} from '../AgenticActivityStream/types/activity.types';

// ───────────────────────────────────────────────────────────────────────────
// Helpers (subset of AgenticActivityStream.hitlInline.test.tsx helpers)
// ───────────────────────────────────────────────────────────────────────────

function completedTool(
  id: string,
  toolName: string,
  startTime: number,
): { block: ContentBlock; toolCall: ToolCall } {
  return {
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
    } as ContentBlock,
    toolCall: {
      id,
      toolName,
      displayName: toolName,
      input: {},
      output: { ok: true },
      status: 'success',
      startTime,
      duration: 100,
      isCollapsed: true,
    } as ToolCall,
  };
}

function pendingApproval(
  requestId: string,
  toolName: string,
  reason: string,
): HitlApprovalEntry {
  return {
    requestId,
    toolName,
    reason,
    timeoutMs: 60_000,
    status: 'pending',
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('#922+#831 — HITL card position inside a serial-tool cluster', () => {
  it('renders the HITL card as a DESCENDANT of the matching tool-card div (NOT after the cluster wrapper)', () => {
    // The model emits 4 consecutive tool_use blocks. The first is
    // azure_create_resource_group (HITL-gated). The next 3 are unrelated
    // reads (typical: model fires Task / list / read back-to-back).
    //
    // AAS merges all 4 into one `tool_group`. Pre-fix the HITL card lands
    // AFTER the cluster wrapper — visually below tool #4. Required: card
    // is a DOM descendant of the matching tool-card div for tool #1.
    const t1 = completedTool('t1', 'azure_create_resource_group', 1_000);
    const t2 = completedTool('t2', 'azure_list_resource_groups', 1_010);
    const t3 = completedTool('t3', 'azure_list_subscriptions', 1_020);
    const t4 = completedTool('t4', 'azure_advisor_recommendations', 1_030);
    const blocks: ContentBlock[] = [t1.block, t2.block, t3.block, t4.block];
    const toolCalls = [t1.toolCall, t2.toolCall, t3.toolCall, t4.toolCall];
    const approvals: HitlApprovalEntry[] = [
      pendingApproval('req-1', 'azure_create_resource_group', 'create RG'),
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

    // The card must render
    const card = screen.getByTestId('hitl-approval-card');
    expect(card).toBeInTheDocument();

    // Locate the tool-card div whose data-tool-name matches the HITL entry's toolName.
    const matchingToolCards = container.querySelectorAll(
      '[data-testid="tool-card"][data-tool-name="azure_create_resource_group"]',
    );
    expect(matchingToolCards.length).toBeGreaterThanOrEqual(1);
    const matchingToolCard = matchingToolCards[0] as HTMLElement;

    // The HITL card MUST be a descendant of the matching tool-card div.
    // This is the strict structural binding that prevents migration.
    expect(
      matchingToolCard.contains(card),
      'HITL approval card must be a DOM descendant of the matching tool-card div (data-tool-name="azure_create_resource_group"); otherwise growing the cluster pushes the card to the bottom of the message',
    ).toBe(true);
  });

  it('keeps the HITL card adjacent to tool #1 even when a non-matching tool #2 follows it back-to-back', () => {
    // Two-block serial cluster, HITL gates the first block only. Pre-fix
    // the card lands AFTER the cluster wrapper, i.e. AFTER tool #2.
    // Required: card sits inside tool #1's subtree, BEFORE tool #2 in
    // document order.
    const t1 = completedTool('t1', 'azure_create_resource_group', 1_000);
    const t2 = completedTool('t2', 'kubectl_get_pods', 1_005);
    const blocks: ContentBlock[] = [t1.block, t2.block];
    const toolCalls = [t1.toolCall, t2.toolCall];
    const approvals: HitlApprovalEntry[] = [
      pendingApproval('req-1', 'azure_create_resource_group', 'create RG'),
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

    const card = screen.getByTestId('hitl-approval-card');
    const t1Card = container.querySelector(
      '[data-testid="tool-card"][data-tool-name="azure_create_resource_group"]',
    ) as HTMLElement | null;
    const t2Card = container.querySelector(
      '[data-testid="tool-card"][data-tool-name="kubectl_get_pods"]',
    ) as HTMLElement | null;
    expect(t1Card).not.toBeNull();
    expect(t2Card).not.toBeNull();

    // (a) card is a descendant of t1Card
    expect(
      t1Card!.contains(card),
      'HITL card must be inside the matching tool-card subtree',
    ).toBe(true);

    // (b) card appears BEFORE t2Card in document order — the HITL must
    // not migrate past unrelated tools that follow the gated one.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(
      card.compareDocumentPosition(t2Card!) & FOLLOWING,
      'HITL card must come BEFORE the next tool card in document order (kubectl_get_pods should follow the HITL, not precede it)',
    ).toBeTruthy();
  });

  it('once approved, the HITL card stays at the same DOM position (descendant of the matching tool-card)', () => {
    // Status flip from pending → approved must NOT relocate the card.
    const t1 = completedTool('t1', 'azure_create_resource_group', 1_000);
    const t2 = completedTool('t2', 'azure_list_subscriptions', 1_005);
    const blocks: ContentBlock[] = [t1.block, t2.block];
    const toolCalls = [t1.toolCall, t2.toolCall];
    const approvals: HitlApprovalEntry[] = [
      {
        requestId: 'req-1',
        toolName: 'azure_create_resource_group',
        reason: 'create RG',
        timeoutMs: 60_000,
        status: 'approved', // post-click state
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
      />,
    );

    const card = screen.getByTestId('hitl-approval-card');
    expect(card.getAttribute('data-status')).toBe('approved');

    const t1Card = container.querySelector(
      '[data-testid="tool-card"][data-tool-name="azure_create_resource_group"]',
    ) as HTMLElement | null;
    expect(t1Card).not.toBeNull();
    expect(
      t1Card!.contains(card),
      'Approved HITL card must still be a descendant of the matching tool-card div',
    ).toBe(true);
  });
});
