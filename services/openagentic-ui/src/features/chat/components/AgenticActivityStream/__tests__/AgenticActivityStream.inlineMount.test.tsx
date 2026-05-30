/**
 * #879 RED → GREEN — viz_render + app_render mount their full chrome
 * INLINE by default (no click required).
 *
 * Mock-01 (mocks/UX/AI/Chatmode/end-state-01-azure-subs-rgs.html) renders
 * compose_visual:sankey as a `.viz-head` strip + an inline iframe inside
 * the assistant message — NOT a collapsed pill that requires a click.
 *
 * Prior behavior (badges default-collapsed, app-render stubbed) was a
 * deliberate transitional placeholder. The slide-out architecture is
 * deferred; the mocks are SoT. Inline-by-default lands now.
 *
 * Pinning:
 *   - InlineVizBadge: `[data-testid="viz-render-expanded"]` is in the DOM
 *     by default. Click toggles to collapse, click again to re-expand.
 *   - InlineAppBadge: `[data-app-renderer="true"]` (AppRenderer iframe)
 *     is in the DOM by default. The console-log stub is removed.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgenticActivityStream from '../AgenticActivityStream';
import type { ContentBlock } from '../../../hooks/useChatStream';

const mkVizBlock = (over: Partial<ContentBlock> = {}): ContentBlock => ({
  id: 'viz-inline-1',
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
  id: 'app-inline-1',
  index: 0,
  type: 'app_render',
  content: '',
  html: '<!doctype html><html><body>app</body></html>',
  isComplete: true,
  title: 'Mini app',
  timestamp: 1_700_000_000_000,
  ...over,
});

beforeEach(() => {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.clear();
    } catch {
      // sessionStorage may be unavailable in some test runners; ignore.
    }
  }
});

describe('#879 — viz_render mounts WidgetRenderer chrome inline by default', () => {
  it('renders the expanded WidgetRenderer chrome without requiring a click', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkVizBlock()]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]');
    expect(root).not.toBeNull();
    const expanded = root!.querySelector('[data-testid="viz-render-expanded"]');
    expect(expanded).not.toBeNull();
  });

  it('respects sessionStorage opt-out: explicit "0" keeps the block collapsed', () => {
    window.sessionStorage.setItem('viz-render-expanded:viz-inline-1', '0');
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkVizBlock()]}
      />,
    );
    const expanded = container.querySelector('[data-testid="viz-render-expanded"]');
    expect(expanded).toBeNull();
  });
});

describe('#879 — app_render mounts AppRenderer iframe inline by default', () => {
  it('renders the AppRenderer iframe chrome by default (no click required)', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkAppBlock()]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]');
    expect(root).not.toBeNull();
    const appHost = root!.querySelector('[data-app-renderer="true"]');
    expect(appHost).not.toBeNull();
    const iframe = appHost!.querySelector('iframe');
    expect(iframe).not.toBeNull();
  });
});
