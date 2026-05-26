import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { MessageRow } from '../MessageTree';
import type { AssistantChatMessage } from '../../../types/uiState';
import type { CanUseToolRequest } from '../../../types/_sdk-bindings';

afterEach(() => {
  cleanup();
});

function makeStreamingAssistantMessage(
  overrides: Partial<AssistantChatMessage> = {},
): AssistantChatMessage {
  return {
    id: 'asst-1',
    role: 'assistant',
    blocks: [{ kind: 'text', text: 'Working on it…' }],
    streaming: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makePendingPermission(
  overrides: Partial<CanUseToolRequest & { request_id: string }> = {},
): CanUseToolRequest & { request_id: string } {
  return {
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    input: { command: 'ls -la /tmp' },
    tool_use_id: 'tu-1',
    request_id: 'req-1',
    ...overrides,
  };
}

describe('InlinePermissionCard — rendering location', () => {
  it('mounts INSIDE the streaming assistant message DOM (not portal/modal)', () => {
    const message = makeStreamingAssistantMessage();
    const pending = makePendingPermission();
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={respondToPermission}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    expect(card).toBeInTheDocument();

    // CRITICAL: card must be inside the streaming assistant message wrapper.
    const streamingMessage = card.closest('[data-testid="cm-streaming-message"]');
    expect(streamingMessage).not.toBeNull();
  });

  it('does NOT render when pendingPermission is null', () => {
    const message = makeStreamingAssistantMessage();
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={null}
        respondToPermission={respondToPermission}
      />,
    );

    expect(screen.queryByTestId('cm-inline-permission')).toBeNull();
  });

  it('does NOT render when message is not streaming', () => {
    const message = makeStreamingAssistantMessage({ streaming: false });
    const pending = makePendingPermission();
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={respondToPermission}
      />,
    );

    expect(screen.queryByTestId('cm-inline-permission')).toBeNull();
  });
});

describe('InlinePermissionCard — three actions', () => {
  it('renders Allow once / Allow always / Deny buttons + tool name + input preview', () => {
    const message = makeStreamingAssistantMessage();
    const pending = makePendingPermission({
      tool_name: 'Bash',
      input: { command: 'rm -rf /tmp/cache' },
    });
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={respondToPermission}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    expect(within(card).getByTestId('cm-inline-permission-allow-once')).toBeInTheDocument();
    expect(within(card).getByTestId('cm-inline-permission-allow-always')).toBeInTheDocument();
    expect(within(card).getByTestId('cm-inline-permission-deny')).toBeInTheDocument();

    // Tool name + input preview visible in the card.
    expect(card.textContent).toContain('Bash');
    expect(card.textContent).toContain('rm -rf /tmp/cache');
  });

  it('Allow once fires respondToPermission with behavior:allow (no alwaysAllow)', () => {
    const message = makeStreamingAssistantMessage();
    const pending = makePendingPermission();
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={respondToPermission}
      />,
    );

    fireEvent.click(screen.getByTestId('cm-inline-permission-allow-once'));
    expect(respondToPermission).toHaveBeenCalledTimes(1);
    const call = respondToPermission.mock.calls[0][0];
    expect(call.behavior).toBe('allow');
    // Allow once should NOT carry the alwaysAllow flag.
    expect(call.alwaysAllow).toBeFalsy();
  });

  it('Deny fires respondToPermission with behavior:deny', () => {
    const message = makeStreamingAssistantMessage();
    const pending = makePendingPermission();
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={respondToPermission}
      />,
    );

    fireEvent.click(screen.getByTestId('cm-inline-permission-deny'));
    expect(respondToPermission).toHaveBeenCalledTimes(1);
    const call = respondToPermission.mock.calls[0][0];
    expect(call.behavior).toBe('deny');
  });
});

describe('InlinePermissionCard — allow-always persists', () => {
  it('Allow always sends behavior:allow with alwaysAllow:true and the tool_name', () => {
    const message = makeStreamingAssistantMessage();
    const pending = makePendingPermission({
      tool_name: 'Bash',
      input: { command: 'echo hi' },
    });
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={respondToPermission}
      />,
    );

    fireEvent.click(screen.getByTestId('cm-inline-permission-allow-always'));
    expect(respondToPermission).toHaveBeenCalledTimes(1);
    const call = respondToPermission.mock.calls[0][0];
    expect(call.behavior).toBe('allow');
    // Always-allow rule carries metadata so the host hook (or a higher
    // layer) can persist the rule per-tool.
    expect(call.alwaysAllow).toBe(true);
    expect(call.toolName).toBe('Bash');
  });
});

describe('InlinePermissionCard — multiple sequential permissions', () => {
  it('re-renders the card on the most-recent message when pendingPermission changes back-to-back', () => {
    const message = makeStreamingAssistantMessage();
    const respondToPermission = vi.fn();

    const firstPending = makePendingPermission({
      request_id: 'req-1',
      tool_name: 'Bash',
      input: { command: 'ls' },
    });

    const { rerender } = render(
      <MessageRow
        message={message}
        pendingPermission={firstPending}
        respondToPermission={respondToPermission}
      />,
    );

    expect(screen.getByTestId('cm-inline-permission').textContent).toContain('ls');

    // Second permission arrives immediately after first is resolved.
    const secondPending = makePendingPermission({
      request_id: 'req-2',
      tool_name: 'Read',
      input: { file_path: '/tmp/foo.ts' },
    });

    rerender(
      <MessageRow
        message={message}
        pendingPermission={secondPending}
        respondToPermission={respondToPermission}
      />,
    );

    const card = screen.getByTestId('cm-inline-permission');
    expect(card).toBeInTheDocument();
    // It must now display the SECOND request, not the first.
    expect(card.textContent).toContain('Read');
    expect(card.textContent).toContain('/tmp/foo.ts');

    // Card should still be inside the streaming message — never flips
    // into a portal layer.
    expect(card.closest('[data-testid="cm-streaming-message"]')).not.toBeNull();
  });
});

describe('InlinePermissionCard — no portal/modal layer', () => {
  it('does NOT mount any [role="dialog"] when only inline card is present', () => {
    const message = makeStreamingAssistantMessage();
    const pending = makePendingPermission();
    const respondToPermission = vi.fn();

    render(
      <MessageRow
        message={message}
        pendingPermission={pending}
        respondToPermission={respondToPermission}
      />,
    );

    // Inline card is rendered.
    expect(screen.getByTestId('cm-inline-permission')).toBeInTheDocument();

    // ZERO modal/dialog elements anywhere in the document — confirms the
    // inline card replaces the portal'd PermissionDialog.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
