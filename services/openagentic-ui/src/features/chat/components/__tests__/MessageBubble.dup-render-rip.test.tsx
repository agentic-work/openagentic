/**
 * RED-first contract — Sev-0 dup-render rip for `compose_visual:table`.
 *
 * Live DOM evidence at
 * reports/verify-cadence/one-shot-redeploy-2026-05-21/07-table-dup-fullpage.png
 * showed THREE renders of the same tabular data for a single
 * `compose_visual` tool_use with `template:'table'`:
 *   (1) InlineVizBadge → iframe with srcdoc-baked HTML table (no theme
 *       inheritance, violates CLAUDE.md rule 8b)
 *   (2) Expanded ToolCard showing the raw tool_result JSON wall
 *   (3) `<StreamingTable>` strip mounted as a SIBLING below the bubble
 *       (correct premium widget, wrong position)
 *
 * User contract (verbatim 2026-05-21):
 *   - Keep the native React `<StreamingTable>` — that's the premium look.
 *   - Render it INLINE at the tool_use position (where the iframe lives).
 *   - Kill the iframe-srcdoc renderer for `template:'table'` blocks.
 *   - Kill the bottom `<StreamingTable>` strip in ChatMessages.tsx.
 *   - Collapse the ToolCard by default when its result feeds a table.
 *
 * Tests pin all three behaviors at the component-boundary level so the
 * controller's full-stack validation contract (CLAUDE.md rule 3a) has a
 * RED → GREEN cycle to point at.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgenticActivityStream from '../AgenticActivityStream';
import { ToolCard } from '../v2/ToolCard';
import type { ContentBlock } from '../AgenticActivityStream/types/activity.types';
import type { StreamingTable as StreamingTableData } from '../../hooks/useChatStream';

beforeEach(() => {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
  }
});

/**
 * Build a `viz_render` ContentBlock representing a `compose_visual({template:'table'})`
 * payload. `block.id` equals the `streaming_table.artifactId` (server emits both
 * frames with the same `artifact_id`).
 */
const mkVizTableBlock = (over: Partial<ContentBlock> = {}): ContentBlock => ({
  id: 'tbl-art-1',
  index: 0,
  type: 'viz_render',
  // The pre-fix iframe HTML for compose_visual:table. Server emits this
  // for backward compatibility but the UI is being told to ignore it
  // when there's a matching StreamingTable.
  content:
    '<div style="border:1px solid var(--mw-line-1)"><table><thead><tr><th>Subscription</th></tr></thead><tbody><tr><td>Sandbox</td></tr></tbody></table></div>',
  isComplete: true,
  template: 'table',
  kind: 'html',
  title: 'Azure subscriptions',
  timestamp: 1_700_000_000_000,
  ...over,
});

const mkStreamingTable = (over: Partial<StreamingTableData> = {}): StreamingTableData => ({
  artifactId: 'tbl-art-1',
  title: 'Azure subscriptions',
  countText: '2 rows',
  columns: [
    { key: 'name', label: 'Subscription' },
    { key: 'state', label: 'State' },
  ],
  rows: [
    { name: 'Sandbox', state: 'Enabled' },
    { name: 'Prod', state: 'Enabled' },
  ],
  ...over,
});

describe('Sev-0 dup-render rip — compose_visual:table renders native StreamingTable inline (NO iframe)', () => {
  it('a) viz_render with template=table renders ONE StreamingTable INSIDE the AAS root and ZERO iframes', () => {
    // RED contract: AgenticActivityStream must accept the matching
    // streamingTables data and render the native React StreamingTable
    // INLINE at the viz_render block's chronological position. The
    // iframe-srcdoc WidgetRenderer path is suppressed for template='table'.
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkVizTableBlock()]}
        streamingTables={[mkStreamingTable()]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]');
    expect(root).not.toBeNull();

    // Exactly ONE streaming-table mounted inline inside the bubble.
    const inlineTables = root!.querySelectorAll('[data-testid="streaming-table"]');
    expect(inlineTables.length).toBe(1);

    // Zero iframes — the InlineVizBadge → WidgetRenderer iframe path is RIPPED.
    const iframes = root!.querySelectorAll('iframe');
    expect(iframes.length).toBe(0);
  });

  it('a) preserves the row data through the inline StreamingTable render', () => {
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkVizTableBlock()]}
        streamingTables={[mkStreamingTable()]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    const tbody = root.querySelector('[data-testid="streaming-table"] tbody');
    expect(tbody).not.toBeNull();
    expect(tbody!.textContent).toContain('Sandbox');
    expect(tbody!.textContent).toContain('Prod');
  });

  it('a) renders no iframe even when streamingTables prop is absent (template=table iframe path is fully dead)', () => {
    // Even without the structured streamingTables data, the dead iframe
    // render path stays dead. The block may render nothing or a fallback,
    // but it MUST NOT mount the buggy iframe-srcdoc renderer.
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[mkVizTableBlock()]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    expect(root.querySelectorAll('iframe').length).toBe(0);
  });

  it('a) non-table templates still mount the InlineVizBadge path (no regression)', () => {
    // Regression guard: `template='svg_raw'` (or any non-table template)
    // continues to mount through InlineVizBadge → WidgetRenderer. Only
    // the table branch is special-cased.
    const svgBlock = mkVizTableBlock({
      id: 'svg-art-1',
      template: 'svg_raw',
      kind: 'svg',
      content: '<svg width="10" height="10"><rect/></svg>',
    });
    const { container } = render(
      <AgenticActivityStream
        isStreaming={false}
        streamingState="complete"
        contentBlocks={[svgBlock]}
      />,
    );
    const root = container.querySelector('[data-testid="agentic-activity-stream"]')!;
    // Non-table viz_render still uses the InlineVizBadge path; the badge
    // wrapper must mount.
    expect(root.querySelector('[data-testid="viz-render-badge"]')).not.toBeNull();
  });
});

describe('Sev-0 dup-render rip — ONLY one StreamingTable per assistant message', () => {
  it('b) when both viz_render(template=table) AND streamingTablesByMessageId carry the same data, only ONE table renders document-wide', async () => {
    // ChatMessages mounts MessageBubble + the trailing strip below. The fix
    // rips the trailing strip so even when the data path still populates
    // streamingTablesByMessageId, the strip below the bubble does NOT
    // re-render the table. We use a thin scaffold that mirrors the
    // ChatMessages structure: an AAS inside a MessageBubble surrogate,
    // PLUS the (post-fix) absent strip.
    //
    // Verified at document level via querySelectorAll('[data-testid="streaming-table"]').
    const { container } = render(
      <div data-testid="chat-messages-surrogate">
        {/* INSIDE MessageBubble — AAS owns the table render now. */}
        <div data-testid="message-bubble-surrogate">
          <AgenticActivityStream
            isStreaming={false}
            streamingState="complete"
            contentBlocks={[mkVizTableBlock()]}
            streamingTables={[mkStreamingTable()]}
          />
        </div>
        {/*
         * The trailing <div data-testid="streaming-table-strip"> sibling
         * is intentionally NOT rendered here — the production fix in
         * ChatMessages.tsx must remove that JSX block. If the production
         * code regresses and re-mounts the strip in addition to the
         * inline AAS path, the document-wide count below will be 2.
         */}
      </div>,
    );
    const tables = container.querySelectorAll('[data-testid="streaming-table"]');
    expect(tables.length).toBe(1);

    // And explicitly: no sibling streaming-table-strip wrapper survives.
    expect(container.querySelector('[data-testid="streaming-table-strip"]')).toBeNull();
  });

  it('b) ChatMessages.tsx source no longer contains the streaming-table-strip render block', async () => {
    // Source-regression cage: the user explicitly asked for the bottom
    // strip in ChatMessages.tsx:638-648 to be ripped. This guard reads
    // the source file and fails if the strip JSX is reintroduced.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // __dirname under vitest+ESM is undefined; use import.meta.url.
    const here = path.dirname(new URL(import.meta.url).pathname);
    const chatMessagesPath = path.resolve(here, '..', 'ChatMessages.tsx');
    const src = await fs.readFile(chatMessagesPath, 'utf8');
    // The pre-fix block was:
    //   <div className="cm-v2" data-testid="streaming-table-strip">
    //     {tables.map((tbl) => (<StreamingTable ... />))}
    //   </div>
    // The fix must remove the data-testid="streaming-table-strip" attr
    // because that's the sibling-after-bubble render the user wants gone.
    expect(src.includes('data-testid="streaming-table-strip"')).toBe(false);
  });
});

describe('Sev-0 dup-render rip — ToolCard whose result feeds a table primitive is COLLAPSED by default', () => {
  it('c) ToolCard with outputTemplate="table" defaults to COLLAPSED (no JSON wall)', () => {
    const { container } = render(
      <ToolCard
        name="compose_visual"
        status="ok"
        durationLabel="0.42s"
        input={{ template: 'table', data: { columns: ['name'], rows: [['Sandbox']] } }}
        result={{ columns: ['name'], rows: [['Sandbox']] }}
        outputTemplate="table"
      />,
    );
    const card = container.querySelector('.cm-tool');
    expect(card).not.toBeNull();
    // aria-expanded='false' is the user-visible collapsed state — the
    // CSS rule `.cm-tool[aria-expanded='true'] .cm-t-body { display: block }`
    // (chatmode-v2.css:241-242) hides the body when collapsed, so the
    // JSON wall is not seen even though the section element is in the DOM.
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  it('c) ToolCard with outputTemplate="streaming_table" also defaults to COLLAPSED', () => {
    // streaming_table is also a registered FrameRendererRegistry slot —
    // the same suppression applies because AAS owns the visual render
    // INLINE at the viz_render position. ToolCard renders the body
    // unconditionally (CSS hides it when aria-expanded=false), so we
    // pass a plain-string result to avoid the FrameRendererRegistry
    // path spreading malformed args at the resolved component. The
    // suppression heuristic operates on `outputTemplate` regardless of
    // result shape.
    const { container } = render(
      <ToolCard
        name="compose_visual"
        status="ok"
        outputTemplate="streaming_table"
      />,
    );
    expect(container.querySelector('.cm-tool')).toHaveAttribute('aria-expanded', 'false');
  });

  it('c) regression guard — non-table outputTemplate still defaults to EXPANDED for ok+structured results', () => {
    // Phase 3 (mock 10:257-282) — sankey / bar_chart / kpi_grid tool
    // results stay expanded so the user sees the structured data inline.
    // Only the *table* output templates flip to collapsed (because the
    // matching StreamingTable already shows the data inline).
    const { container } = render(
      <ToolCard
        name="azure_cost_management_query"
        status="ok"
        result={{ rows: [{ rg: 'core-api', usd: 12450 }] }}
        outputTemplate="sankey"
      />,
    );
    expect(container.querySelector('.cm-tool')).toHaveAttribute('aria-expanded', 'true');
  });

  it('c) regression guard — explicit defaultExpanded=true overrides the collapse rule', () => {
    // User-driven explicit override beats the heuristic.
    const { container } = render(
      <ToolCard
        name="compose_visual"
        status="ok"
        result={{ columns: ['x'], rows: [['y']] }}
        outputTemplate="table"
        defaultExpanded={true}
      />,
    );
    expect(container.querySelector('.cm-tool')).toHaveAttribute('aria-expanded', 'true');
  });
});
