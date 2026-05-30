/**
 * AgenticActivityStream — follow_up chip row honors the user-facing toggle.
 *
 * Bug repro (live 2026-05-19 chat-dev): the user disabled the "Follow-up
 * suggestions" toggle in the composer toolbar (ChatInputToolbar.tsx), but
 * follow-up chip buttons continued to appear at the end of assistant turns.
 *
 * Root cause: ChipsRow.tsx gates rendering on `useFollowupChipsStore.enabled`,
 * but AgenticActivityStream.tsx renders follow_up blocks INLINE through its
 * own JSX path (around line 3096) which never consulted the store. The AAS
 * render path is the one that fires in production — the toolbar toggle was
 * a no-op for users.
 *
 * Fix: AAS reads `useFollowupChipsStore.enabled` and short-circuits the
 * follow_up branch when the toggle is OFF.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgenticActivityStream from '../AgenticActivityStream';
import type { ContentBlock } from '../../../hooks/useChatStream';
import { useFollowupChipsStore } from '@/stores/useFollowupChipsStore';

beforeEach(() => {
  // Reset the persisted toggle to the default-ON state at the start of every test.
  useFollowupChipsStore.setState({ enabled: true });
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  }
});

const mkFollowUpBlock = (items: string[]): ContentBlock => ({
  id: 'fu-toggle-1',
  index: 0,
  type: 'follow_up',
  content: '',
  isComplete: true,
  items,
  timestamp: 1_700_000_000_000,
});

describe('AgenticActivityStream — follow_up toggle honor', () => {
  it('renders chips when useFollowupChipsStore.enabled === true (default)', () => {
    const blocks: ContentBlock[] = [
      mkFollowUpBlock(['drill into us-east', 'show last hour', 'open RCA']),
    ];
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    expect(container.querySelector('[data-testid="followups"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="followup-chip"]')).toHaveLength(3);
  });

  it('does NOT render chips when useFollowupChipsStore.enabled === false (toolbar toggle OFF)', () => {
    // User flipped the toggle OFF — chips MUST disappear platform-wide,
    // including the AAS inline render path.
    useFollowupChipsStore.setState({ enabled: false });

    const blocks: ContentBlock[] = [
      mkFollowUpBlock(['drill into us-east', 'show last hour', 'open RCA']),
    ];
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );

    // Neither the row nor any chip button should be in the DOM.
    expect(container.querySelector('[data-testid="followups"]')).toBeNull();
    expect(container.querySelector('[data-testid="followup-chip"]')).toBeNull();
  });

  it('re-renders chips when toggle flips back ON without a remount', () => {
    useFollowupChipsStore.setState({ enabled: false });

    const blocks: ContentBlock[] = [
      mkFollowUpBlock(['a', 'b', 'c']),
    ];
    const { container, rerender } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    expect(container.querySelector('[data-testid="followups"]')).toBeNull();

    // Flip ON — Zustand subscription triggers a re-render automatically.
    useFollowupChipsStore.setState({ enabled: true });
    rerender(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    expect(container.querySelector('[data-testid="followups"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="followup-chip"]')).toHaveLength(3);
  });
});
