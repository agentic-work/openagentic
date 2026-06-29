/**
 * RED contract for AgenticActivityStream rendering of the F1-6 follow_up
 * chip row (Sev-0 2026-05-17).
 *
 * Northstar: all 17 mocks at `mocks/UX/AI/Chatmode/end-state-{01..17}.html`
 * render a `.followups` container immediately after final synthesis with 3
 * `.chip` button children. We mirror that with stable testids:
 *
 *   <div data-testid="followups">
 *     <button data-testid="followup-chip">drill into prod-west</button>
 *     <button data-testid="followup-chip">apply terraform plan</button>
 *     <button data-testid="followup-chip">open RCA template</button>
 *   </div>
 *
 * Theme invariant (CLAUDE.md rule 8b): every color comes from `var(--cm-*)`
 * or `var(--accent)` — no hex/rgb/named-color literals. We assert that by
 * grepping inline styles for `#` (color-hex literals).
 *
 * Position invariant (CLAUDE.md rule 8a): follow_up block renders AFTER
 * the last text/tool block, never before.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgenticActivityStream from '../AgenticActivityStream';
import type { ContentBlock } from '../../../hooks/useChatStream';

beforeEach(() => {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  }
});

const mkFollowUpBlock = (items: string[]): ContentBlock => ({
  id: 'fu-1',
  index: 0,
  type: 'follow_up',
  content: '',
  isComplete: true,
  items,
  timestamp: 1_700_000_000_000,
});

describe('AgenticActivityStream — follow_up render (Sev-0 F1-6)', () => {
  it('renders <div data-testid="followups"> with one <button data-testid="followup-chip"> per item', () => {
    const blocks: ContentBlock[] = [
      mkFollowUpBlock([
        'drill into prod-west',
        'apply terraform plan',
        'open RCA template',
      ]),
    ];
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    const root = container.querySelector('[data-testid="followups"]');
    expect(root).not.toBeNull();
    const chips = root!.querySelectorAll('[data-testid="followup-chip"]');
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain('drill into prod-west');
    expect(chips[1].textContent).toContain('apply terraform plan');
    expect(chips[2].textContent).toContain('open RCA template');
  });

  it('renders nothing when items[] is empty', () => {
    const blocks: ContentBlock[] = [mkFollowUpBlock([])];
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    // Empty items should NOT produce the container.
    expect(container.querySelector('[data-testid="followups"]')).toBeNull();
    expect(container.querySelector('[data-testid="followup-chip"]')).toBeNull();
  });

  it('renders follow_up AFTER prior text/tool blocks (chronological position)', () => {
    const blocks: ContentBlock[] = [
      {
        id: 'tu-1',
        index: 0,
        type: 'tool_use',
        content: '',
        isComplete: true,
        toolName: 'azure_list_subscriptions',
        toolId: 'tu-1',
        timestamp: 1_700_000_000_000,
      },
      {
        id: 'text-1',
        index: 1,
        type: 'text',
        content: 'Final synthesis here.',
        isComplete: true,
        timestamp: 1_700_000_000_001,
      },
      mkFollowUpBlock(['a', 'b', 'c']),
    ];
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const tool = root.querySelector('[data-testid="tool-card"]');
    const followups = root.querySelector('[data-testid="followups"]');
    expect(tool).not.toBeNull();
    expect(followups).not.toBeNull();
    const cmp = tool!.compareDocumentPosition(followups!);
    expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses ONLY theme tokens — no hex/rgb color literals in inline styles (CLAUDE.md rule 8b)', () => {
    const blocks: ContentBlock[] = [mkFollowUpBlock(['a', 'b', 'c'])];
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    const followups = container.querySelector('[data-testid="followups"]') as HTMLElement;
    // Collect every inline style on the followups subtree.
    const all: string[] = [];
    const visit = (el: HTMLElement) => {
      const style = el.getAttribute('style');
      if (style) all.push(style);
      for (const child of Array.from(el.children)) {
        if (child instanceof HTMLElement) visit(child);
      }
    };
    visit(followups);
    const joined = all.join(' ; ');
    // No `#abc` or `#abcdef` color literals.
    expect(joined).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // No `rgb(...)` / `rgba(...)` literal color forms.
    expect(joined).not.toMatch(/\brgba?\(\s*\d/);
    // At minimum one CSS var reference present (sanity).
    expect(joined).toMatch(/var\(--/);
  });
});
