/**
 * RED-first contract for the typed-block artifact render path.
 *
 * The legacy out-of-band sidecar (`visual-renders-strip`) is ripped.
 * `visual_render` + `app_render` ContentBlocks live in the same
 * contentBlocks[] array as thinking / text / tool_use, so they render
 * INLINE at their wire-emit chronological position inside
 * AgenticActivityStream — never pooled at the top or bottom of the
 * message bubble.
 *
 * Both badges are clickable: #879 — inline-by-default per mock-01.
 * viz_render mounts WidgetRenderer expanded chrome by default; click
 * collapses, click again re-expands. app_render mounts AppRenderer
 * iframe inline (no toggle — the iframe is always rendered).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import AgenticActivityStream from '../AgenticActivityStream';

beforeEach(() => {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  }
});
import type { ContentBlock } from '../../../hooks/useChatStream';

const mkVizBlock = (over: Partial<ContentBlock> = {}): ContentBlock => ({
  id: 'viz-1',
  index: 0,
  type: 'viz_render',
  content: '<svg><rect/></svg>',
  isComplete: true,
  template: 'sankey',
  kind: 'chart',
  title: 'Cost flow',
  timestamp: 1_700_000_000_000,
  ...over,
});

const mkAppBlock = (over: Partial<ContentBlock> = {}): ContentBlock => ({
  id: 'app-1',
  index: 0,
  type: 'app_render',
  content: '',
  html: '<!doctype html><html><body>app</body></html>',
  isComplete: true,
  title: 'Mini app',
  timestamp: 1_700_000_000_000,
  ...over,
});

describe('AgenticActivityStream — viz_render typed-block path', () => {
  it('renders <InlineVizBadge> INSIDE the agentic-activity-stream root', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkVizBlock()]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]');
    expect(root).not.toBeNull();
    const badge = root!.querySelector('[data-testid="viz-render-badge"]');
    expect(badge).not.toBeNull();
  });

  it('starts expanded by default; click collapses, click again re-expands', () => {
    // #879 — mock-01 contract: iframe-inline by default. The collapsed
    // pill is a user-driven opt-out, not the initial state.
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkVizBlock()]}
      />,
    );
    const badge = container.querySelector('[data-testid="viz-render-badge"]') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(container.querySelector('[data-testid="viz-render-expanded"]')).not.toBeNull();
    fireEvent.click(badge);
    expect(container.querySelector('[data-testid="viz-render-expanded"]')).toBeNull();
    fireEvent.click(badge);
    expect(container.querySelector('[data-testid="viz-render-expanded"]')).not.toBeNull();
  });

  it('preserves chronological order — viz_render renders after a prior tool_use block', () => {
    // Use a non-T1 tool name (T1 meta tools like compose_visual are
    // intentionally hidden from the visible group list by the AAS
    // grouper, which would make the chronological assertion vacuous).
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
      mkVizBlock({ id: 'viz-1', index: 1 }),
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
    const badge = root.querySelector('[data-testid="viz-render-badge"]');
    expect(tool).not.toBeNull();
    expect(badge).not.toBeNull();
    // Document order: tool card precedes viz badge.
    const cmp = tool!.compareDocumentPosition(badge!);
    expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('AgenticActivityStream — app_render typed-block path', () => {
  it('renders <InlineAppBadge> INSIDE the agentic-activity-stream root', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkAppBlock()]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]');
    expect(root).not.toBeNull();
    const badge = root!.querySelector('[data-testid="app-render-badge"]');
    expect(badge).not.toBeNull();
  });
});
