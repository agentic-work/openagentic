/**
 * Slice B — serial-tool cluster contract (REVISED 2026-05-17 PM).
 *
 * Original contract (Q12 live drive on `0.7.1-d92fdb72`) pinned clusters
 * to "collapsed by default". User direction 2026-05-17 PM reversed that:
 * "stream and finished result have to be EXACTLY THE SAME" — defaulting
 * clusters to collapsed created a flip from "individual cards visible
 * mid-stream" → "cluster summary with children hidden at finalize",
 * violating CLAUDE.md rule 8a. New contract: cluster wrapper still
 * exists for N>=2 (preserves header summary, click-to-collapse
 * affordance), but DEFAULT state is EXPANDED so children stay visible
 * at all times. User's manual click DOES still collapse (and persists
 * via sessionStorage).
 *
 * Contract:
 *   - Single tool_use block       → no cluster wrapper, single ToolCard.
 *   - 2+ consecutive tool_use     → one `tool-cluster` container,
 *                                   **EXPANDED by default**, header shows
 *                                   count + tool names, children visible.
 *   - Click cluster header        → toggles collapsed; click again expands.
 *   - Interleaved-text between    → two SEPARATE clusters / cards,
 *     two tool blocks               never merged across prose.
 *   - Manual collapse persists    → sessionStorage key
 *     across re-renders             `cm.toolCluster.<index>`.
 *   - Testids                     → outer `tool-cluster`, header
 *                                   `tool-cluster-header`, per-child
 *                                   `tool-card` (so #842 arch GREEN).
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgenticActivityStream from '../AgenticActivityStream';
import type { ContentBlock } from '../../../hooks/useChatStream';

const mkToolBlock = (over: Partial<ContentBlock> & { id: string; toolName: string }): ContentBlock => ({
  index: 0,
  type: 'tool_use',
  content: '',
  isComplete: true,
  toolId: over.id,
  timestamp: 1_700_000_000_000,
  ...over,
});

const mkTextBlock = (over: Partial<ContentBlock> & { id: string; content: string }): ContentBlock => ({
  index: 0,
  type: 'text',
  isComplete: true,
  timestamp: 1_700_000_000_000,
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
});

describe('Slice B — serial-tool collapse / cluster', () => {
  it('single consecutive tool_use renders WITHOUT a cluster wrapper', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_list_subscriptions' }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    expect(root.querySelector('[data-testid="tool-cluster"]')).toBeNull();
    expect(root.querySelector('[data-testid="tool-card"]')).not.toBeNull();
  });

  it('two consecutive tool_use → one cluster, header shows count + names, children visible by default', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query' }),
          mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer' }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const clusters = root.querySelectorAll('[data-testid="tool-cluster"]');
    expect(clusters.length).toBe(1);
    const header = clusters[0].querySelector('[data-testid="tool-cluster-header"]')!;
    expect(header).not.toBeNull();
    expect(header.textContent).toMatch(/2 tools/i);
    const names = clusters[0].querySelector('[data-testid="tool-cluster-names"]')!;
    expect(names).not.toBeNull();
    expect(names.textContent).toMatch(/Cost Query/);
    expect(names.textContent).toMatch(/Cost Explorer/);
    // New contract (2026-05-17 PM): EXPANDED by default — children visible.
    expect(clusters[0].querySelectorAll('[data-testid="tool-card"]').length).toBe(2);
  });

  it('four consecutive tool_use → collapsed cluster, header shows first 2 names + ellipsis', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query' }),
          mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer' }),
          mkToolBlock({ id: 't-3', index: 2, toolName: 'gcp_cost_query' }),
          mkToolBlock({ id: 't-4', index: 3, toolName: 'azure_advisor_recommendations' }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const cluster = root.querySelector('[data-testid="tool-cluster"]')!;
    const header = cluster.querySelector('[data-testid="tool-cluster-header"]')!;
    expect(header.textContent).toMatch(/4 tools/i);
    // First 2 humanized names appear, ellipsis indicates remaining count.
    const names = cluster.querySelector('[data-testid="tool-cluster-names"]')!;
    expect(names).not.toBeNull();
    expect(names.textContent).toMatch(/Cost Query/);
    expect(names.textContent).toMatch(/Cost Explorer/);
    expect(names.textContent).toMatch(/\+\s*2\s*more|…|\.\.\./);
  });

  it('click cluster header → toggles collapse; children hidden after click, visible again after second click', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query' }),
          mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer' }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const cluster = root.querySelector('[data-testid="tool-cluster"]')!;
    const header = cluster.querySelector('[data-testid="tool-cluster-header"]') as HTMLElement;
    // Default: expanded → cards visible.
    expect(cluster.querySelectorAll('[data-testid="tool-card"]').length).toBe(2);
    // First click: collapse → cards hidden.
    fireEvent.click(header);
    expect(cluster.querySelector('[data-testid="tool-card"]')).toBeNull();
    // Second click: expand again → cards visible.
    fireEvent.click(header);
    expect(cluster.querySelectorAll('[data-testid="tool-card"]').length).toBe(2);
  });

  it('text between two tool blocks → TWO SEPARATE clusters / single cards (never merged)', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[
          mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query' }),
          mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer' }),
          mkTextBlock({ id: 'tx-1', index: 2, content: 'now pulling GCP...' }),
          mkToolBlock({ id: 't-3', index: 3, toolName: 'gcp_cost_query' }),
          mkToolBlock({ id: 't-4', index: 4, toolName: 'gcp_billing_query' }),
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    // First two tool blocks are pre-text, last two are post-text → two
    // separate clusters. Total cluster count = 2.
    const clusters = root.querySelectorAll('[data-testid="tool-cluster"]');
    expect(clusters.length).toBe(2);
    // Interleaved text block sits between them in DOM order.
    const textBlock = root.querySelector('.interleaved-text-block');
    expect(textBlock).not.toBeNull();
    const cmp1 = clusters[0].compareDocumentPosition(textBlock!);
    expect(cmp1 & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cmp2 = textBlock!.compareDocumentPosition(clusters[1]);
    expect(cmp2 & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('manual collapse persists across re-renders via sessionStorage', () => {
    const blocks = [
      mkToolBlock({ id: 't-1', index: 0, toolName: 'azure_cost_query' }),
      mkToolBlock({ id: 't-2', index: 1, toolName: 'aws_cost_explorer' }),
    ];
    const { container, unmount } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    const cluster = container.querySelector('[data-testid="tool-cluster"]')!;
    const header = cluster.querySelector('[data-testid="tool-cluster-header"]') as HTMLElement;
    // Default expanded.
    expect(cluster.querySelectorAll('[data-testid="tool-card"]').length).toBe(2);
    // User collapses.
    fireEvent.click(header);
    expect(cluster.querySelector('[data-testid="tool-card"]')).toBeNull();
    // sessionStorage records the manual collapse under a stable cluster key.
    const keys = Object.keys(sessionStorage);
    expect(keys.some((k) => k.startsWith('cm.toolCluster.'))).toBe(true);

    // Re-render fresh (simulates remount / message list re-render).
    unmount();
    const { container: c2 } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={blocks}
      />,
    );
    const cluster2 = c2.querySelector('[data-testid="tool-cluster"]')!;
    // Persisted: collapsed → child cards hidden after remount.
    expect(cluster2.querySelector('[data-testid="tool-card"]')).toBeNull();
  });
});
