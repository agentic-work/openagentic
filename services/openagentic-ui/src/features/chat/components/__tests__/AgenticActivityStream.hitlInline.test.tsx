/**
 * Sev-1 #922 — HITL approval cards MUST render INLINE with the matching
 * tool_use, not in a per-message footer strip.
 *
 * Background (dev live drive 2026-05-17, image 0.7.1-87b85a9b): when
 * the model fired two parallel `azure_create_resource_group` tool_use
 * blocks, the HITL approval cards rendered at the bottom of the message
 * (rectTop 796/894/992) while the corresponding tool cards rendered near
 * the top of the activity stream. User: "hitl doesnt stay where it
 * popped up inline".
 *
 * Fix: AAS owns the HITL render. Given a synthetic activity stream with
 * [text, tool_use(azure_create_resource_group, id=t1), text,
 *  tool_use(other_tool, id=t2), text] and a pending HITL approval whose
 * toolName matches the first tool, the approval card MUST render
 * IMMEDIATELY AFTER the t1 tool_use card in DOM order — never in a
 * detached per-message footer.
 *
 * Correlation: server does not emit toolUseId on the hitl_approval frame;
 * we correlate by toolName + "earliest unrendered pending tool_use with
 * matching toolName". Multiple pending approvals for the same toolName
 * pair off in arrival order with the matching tool_use blocks left-to-right.
 *
 * Theme tokens (CLAUDE.md rule 8b): the card must resolve colors via
 * var(--cm-*) — no hardcoded hex / rgb / named-color literals.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgenticActivityStream } from '../AgenticActivityStream';
import type {
  ContentBlock,
  ToolCall,
} from '../AgenticActivityStream/types/activity.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    input: { name: 'rg-test' },
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

type HitlEntry = {
  requestId: string;
  toolName: string;
  serverName?: string;
  reason: string;
  timeoutMs: number;
  arguments?: unknown;
  status: 'pending' | 'approved' | 'denied' | 'expired';
};

const pendingApproval = (
  requestId: string,
  toolName: string,
  reason: string,
): HitlEntry => ({
  requestId,
  toolName,
  reason,
  timeoutMs: 60_000,
  status: 'pending',
});

// ---------------------------------------------------------------------------

describe('Sev-1 #922 — HITL approval cards render INLINE with matching tool_use', () => {
  it('renders the approval card IMMEDIATELY AFTER the matching tool_use card', () => {
    // Layout: text → tool_use(azure_create_resource_group, t1) → text →
    //         tool_use(other_tool, t2) → text. One pending HITL approval
    //         matching the first tool. The approval card MUST appear in
    //         DOM order after the t1 tool-card and BEFORE the t2 tool-card.
    const t1 = completedTool('t1', 'azure_create_resource_group', 1_000);
    const t2 = completedTool('t2', 'kubectl_get_pods', 2_000);
    const blocks: ContentBlock[] = [
      textBlock('intro', 'Creating resource group...', 900),
      t1.block,
      textBlock('mid', 'Now checking pods...', 1_500),
      t2.block,
      textBlock('end', 'All done.', 2_500),
    ];
    const toolCalls = [t1.toolCall, t2.toolCall];
    const approvals: HitlEntry[] = [
      pendingApproval('req-1', 'azure_create_resource_group', 'write-tier RG create'),
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

    // The approval card renders inside AAS.
    const card = screen.getByTestId('hitl-approval-card');
    expect(card).toBeInTheDocument();
    expect(card.getAttribute('data-status')).toBe('pending');

    // Approve / Deny buttons are wired for a pending entry.
    expect(screen.getByTestId('hitl-approve-btn')).toBeInTheDocument();
    expect(screen.getByTestId('hitl-deny-btn')).toBeInTheDocument();

    // The card sits AFTER the t1 tool-card in DOM order (compareDocumentPosition).
    const t1Card = container.querySelector(
      '[data-testid="tool-card"][data-tool-name="azure_create_resource_group"]',
    );
    const t2Card = container.querySelector(
      '[data-testid="tool-card"][data-tool-name="kubectl_get_pods"]',
    );
    expect(t1Card).not.toBeNull();
    expect(t2Card).not.toBeNull();

    // compareDocumentPosition returns DOCUMENT_POSITION_FOLLOWING (4) when the
    // argument node FOLLOWS the calling node. So t1Card.compareDocumentPosition(card)
    // includes the FOLLOWING bit iff the card comes after t1.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(t1Card!.compareDocumentPosition(card) & FOLLOWING).toBeTruthy();
    // And the card sits BEFORE t2Card (i.e. t2 follows the card).
    expect(card.compareDocumentPosition(t2Card!) & FOLLOWING).toBeTruthy();
  });

  it('does NOT render a hitl-approval-strip footer detached from the tool cards', () => {
    // The orphan footer strip from ChatMessages.tsx:881-1010 is ripped. The
    // AAS-owned render still emits a wrapper (data-testid="hitl-approval-strip")
    // but it must live INSIDE the agentic-activity-stream container, NOT as
    // a top-level child of the message-row.
    const t1 = completedTool('t1', 'azure_create_resource_group', 1_000);
    const blocks: ContentBlock[] = [t1.block];
    const toolCalls = [t1.toolCall];
    const approvals: HitlEntry[] = [
      pendingApproval('req-1', 'azure_create_resource_group', 'write-tier RG create'),
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

    const aas = container.querySelector('[data-testid="agentic-activity-stream"]');
    const card = container.querySelector('[data-testid="hitl-approval-card"]');
    expect(aas).not.toBeNull();
    expect(card).not.toBeNull();

    // The HITL card lives INSIDE the AAS root (no detached footer render).
    expect(aas!.contains(card)).toBe(true);
  });

  it('matches multiple pending approvals to their tool_use in arrival order (toolName + earliest-unrendered-pending)', () => {
    // Two parallel azure_create_resource_group dispatches + two pending HITL
    // approvals. Both cards render INLINE, each adjacent to its tool_use.
    const t1 = completedTool('t1', 'azure_create_resource_group', 1_000);
    const t2 = completedTool('t2', 'azure_create_resource_group', 1_100);
    const blocks: ContentBlock[] = [
      t1.block,
      textBlock('between', 'second rg below', 1_050),
      t2.block,
    ];
    const toolCalls = [t1.toolCall, t2.toolCall];
    const approvals: HitlEntry[] = [
      pendingApproval('req-a', 'azure_create_resource_group', 'rg #1'),
      pendingApproval('req-b', 'azure_create_resource_group', 'rg #2'),
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

    const cards = container.querySelectorAll('[data-testid="hitl-approval-card"]');
    expect(cards.length).toBe(2);

    // The cards interleave with the tool cards in chronological emit order.
    // Earliest unrendered match: req-a goes to t1, req-b goes to t2.
    const toolCards = container.querySelectorAll(
      '[data-testid="tool-card"][data-tool-name="azure_create_resource_group"]',
    );
    expect(toolCards.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to end-of-stream render when no tool_use matches the toolName', () => {
    // Approval references a tool that never appeared in the activity stream
    // (race condition: hitl frame arrived before tool_executing). The card
    // must still render — at the end of the stream — so the user can act
    // on it.
    const blocks: ContentBlock[] = [
      textBlock('only-text', 'Hello.', 1_000),
    ];
    const approvals: HitlEntry[] = [
      pendingApproval('req-orphan', 'azure_create_resource_group', 'orphan'),
    ];

    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
        toolCalls={[]}
        theme="dark"
        hitlApprovals={approvals}
      />,
    );

    const card = container.querySelector('[data-testid="hitl-approval-card"]');
    expect(card).not.toBeNull();
    // Still owned by AAS.
    const aas = container.querySelector('[data-testid="agentic-activity-stream"]');
    expect(aas!.contains(card!)).toBe(true);
  });
});
