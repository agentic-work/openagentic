import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { MessageRow } from '../MessageTree';
import type {
  AssistantChatMessage,
  UiToolUseBlock,
} from '../../../types/uiState';
import type { CanUseToolRequest } from '../../../types/_sdk-bindings';

afterEach(() => {
  cleanup();
});

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

/**
 * Build a streaming assistant message that mirrors the parallel-task-
 * 3-subagents fixture state at mid-stream: three Task tool_use blocks,
 * each with its own subBlocks (the subagent's transcript so far).
 */
function makeMessageWithThreeSubagents(): AssistantChatMessage {
  const subagent = (
    parentToolUseId: string,
    bodyText: string,
  ): UiToolUseBlock => ({
    kind: 'tool_use',
    toolUseId: parentToolUseId,
    name: 'Task',
    partialInputJson: '{}',
    input: { description: `agent ${parentToolUseId}` },
    streaming: true,
    subBlocks: [
      { kind: 'text', text: bodyText },
    ],
  });

  return {
    id: 'asst-fanout-1',
    role: 'assistant',
    blocks: [
      subagent('toolu_TA', 'foundA'),
      subagent('toolu_TB', 'foundB'),
      subagent('toolu_TC', 'foundC'),
    ],
    streaming: true,
    createdAt: Date.now(),
  };
}

function makePendingPermissionForSubagent(
  parentToolUseId: string | null,
): CanUseToolRequest & { request_id: string; parent_tool_use_id?: string | null } {
  return {
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    input: { command: 'echo hi' },
    tool_use_id: 'tu-bash-1',
    request_id: `req-${parentToolUseId ?? 'root'}-1`,
    parent_tool_use_id: parentToolUseId,
  };
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('InlinePermissionCard — parent_tool_use_id routing', () => {
  it('mounts INSIDE the matching subagent panel when parent_tool_use_id matches a top-level tool_use', () => {
    const message = makeMessageWithThreeSubagents();
    // Permission from the SECOND subagent. The card must land in B's
    // panel, not at the end of the assistant message body.
    const pending = makePendingPermissionForSubagent('toolu_TB');

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={vi.fn()}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    expect(card).toBeInTheDocument();

    // The matching subagent panel is keyed by `data-tool-use-id` —
    // emitted by ToolUseRow once Phase F lands. The card's nearest
    // enclosing `[data-tool-use-id]` ancestor must be the Task block
    // whose id matches `pendingPermission.parent_tool_use_id`. This
    // proves the card is rendered INSIDE B's panel rather than at
    // message-tail (where there'd be no tool_use ancestor) or inside
    // a sibling subagent's panel.
    const enclosing = card.closest('[data-tool-use-id]');
    expect(enclosing).not.toBeNull();
    expect(enclosing?.getAttribute('data-tool-use-id')).toBe('toolu_TB');
    expect(enclosing?.textContent).toContain('foundB');
    // Negative: card must NOT be inside A or C's panel.
    expect(enclosing?.textContent).not.toContain('foundA');
    expect(enclosing?.textContent).not.toContain('foundC');
  });

  it('mounts at message-tail when parent_tool_use_id is null (root, single-agent behaviour)', () => {
    const message = makeMessageWithThreeSubagents();
    const pending = makePendingPermissionForSubagent(null);

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={vi.fn()}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    expect(card).toBeInTheDocument();

    // For the root case the card must NOT be inside any tool_use block —
    // it sits at the streaming-message tail, after the last block.
    const enclosing = card.closest('[data-tool-use-id]');
    expect(enclosing).toBeNull();

    // Sanity: the streaming-message wrapper is still the nearest ancestor.
    const streamingWrapper = card.closest('[data-testid="cm-streaming-message"]');
    expect(streamingWrapper).not.toBeNull();
  });

  it('falls back to message-tail when parent_tool_use_id matches no top-level tool_use', () => {
    const message = makeMessageWithThreeSubagents();
    // Reference an id that doesn't exist in the tree — could happen if
    // the daemon emits a control_request before the parent tool_use
    // block has been seen by the reducer (race condition). The card
    // must still be visible to the user; defaulting to message-tail
    // is safer than rendering nothing.
    const pending = makePendingPermissionForSubagent('toolu_DOES_NOT_EXIST');

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={vi.fn()}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    expect(card).toBeInTheDocument();
    expect(card.closest('[data-tool-use-id]')).toBeNull();
    expect(card.closest('[data-testid="cm-streaming-message"]')).not.toBeNull();
  });

  it('mounts in the FIRST subagent when parent_tool_use_id matches it', () => {
    const message = makeMessageWithThreeSubagents();
    const pending = makePendingPermissionForSubagent('toolu_TA');

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={vi.fn()}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    const enclosing = card.closest('[data-tool-use-id]');
    expect(enclosing).not.toBeNull();
    expect(enclosing?.getAttribute('data-tool-use-id')).toBe('toolu_TA');
  });

  it('mounts in the THIRD subagent when parent_tool_use_id matches it', () => {
    const message = makeMessageWithThreeSubagents();
    const pending = makePendingPermissionForSubagent('toolu_TC');

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={vi.fn()}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    const enclosing = card.closest('[data-tool-use-id]');
    expect(enclosing).not.toBeNull();
    expect(enclosing?.getAttribute('data-tool-use-id')).toBe('toolu_TC');
  });

  it('renders exactly one card even when parent_tool_use_id routes into a subagent', () => {
    const message = makeMessageWithThreeSubagents();
    const pending = makePendingPermissionForSubagent('toolu_TB');

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={vi.fn()}
      />,
    );

    const cards = screen.getAllByTestId('cm-inline-permission');
    expect(cards).toHaveLength(1);
  });
});
