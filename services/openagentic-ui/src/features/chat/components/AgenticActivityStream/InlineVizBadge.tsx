/**
 * InlineVizBadge — typed-block render for `viz_render` ContentBlocks.
 *
 * Two visual states under a single root `data-testid="viz-render-badge"`:
 *   - collapsed (default): compact pill (~32px tall) showing template
 *     name + status. Click toggles to expanded.
 *   - expanded: full WidgetRenderer chrome with a Collapse header button.
 *     Expanded state is marked with a nested `data-testid="viz-render-expanded"`.
 *
 * EVERY visualization gets an "Expand" button that opens a full-screen
 * modal (ChartExpandModal) with the same WidgetRenderer at larger size +
 * wheel-zoom + pan. Sev-0 #1065 — previously this was gated to
 * arch_diagram / reactflow_arch / arch only AND the click handler was a
 * console.debug stub, so sankey / line / bar / donut / network / chord
 * / heatmap had NO openable + zoom/scan affordance.
 *
 * Expand/collapse state is persisted per block.id in sessionStorage.
 *
 * Theme tokens only — no hex / rgb literals. Iframe-isolated artifact
 * chrome propagates parent theme via existing WidgetRenderer plumbing.
 */

import React, { useCallback, useState, useEffect } from 'react';

import { WidgetRenderer } from '../v2/WidgetRenderer';
import { ChartExpandModal } from '../../../../lib/charts/ChartExpandModal';

import type { ContentBlock } from './types/activity.types';

export interface InlineVizBadgeProps {
  block: ContentBlock;
}

function storageKey(id: string): string {
  return `viz-render-expanded:${id}`;
}

function readInitialExpanded(id: string): boolean {
  // #879 — inline-by-default per mock-01 contract. Mocks show the full
  // WidgetRenderer iframe rendered inline at the wire-emit position, not
  // a collapsed pill. sessionStorage '0' is an explicit opt-out (the user
  // collapsed this block earlier); absent or '1' means expand.
  if (typeof window === 'undefined') return true;
  try {
    const v = window.sessionStorage.getItem(storageKey(id));
    return v !== '0';
  } catch {
    return true;
  }
}

export const InlineVizBadge: React.FC<InlineVizBadgeProps> = ({ block }) => {
  const [expanded, setExpanded] = useState<boolean>(() => readInitialExpanded(block.id));
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const isStreaming = !block.isComplete;
  const template = block.template || block.kind || 'visualization';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(storageKey(block.id), expanded ? '1' : '0');
    } catch {
      // sessionStorage may be unavailable (private mode); ignore.
    }
  }, [expanded, block.id]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const onKeyToggle = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  // Sev-0 #1065 — Expand opens the ChartExpandModal for ANY viz template
  // (sankey, line, bar, donut, network, chord, heatmap, arch_diagram, …).
  // Modal mounts the same WidgetRenderer at full-screen size so wheel-zoom
  // + click-drag pan from the underlying chart primitive work naturally.
  const onPopOut = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setModalOpen(true);
  }, []);
  const onModalClose = useCallback(() => setModalOpen(false), []);

  return (
    <div
      data-testid="viz-render-badge"
      data-template={template}
      data-expanded={expanded ? 'true' : 'false'}
    >
      {/* Toggle is on the pill ONLY — keeping it off the outer wrapper means
         clicks inside the expanded WidgetRenderer (ellipsis menu, action
         buttons, the iframe surface itself) don't bubble up and collapse
         the card. */}
      <div
        onClick={toggle}
        onKeyDown={onKeyToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 32,
          padding: '0 12px',
          borderRadius: 6,
          border: '1px solid var(--cm-border)',
          background: 'var(--cm-bg)',
          color: 'var(--cm-fg)',
          cursor: 'pointer',
          fontSize: 12,
          lineHeight: '32px',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: isStreaming ? 'var(--cm-info)' : 'var(--cm-success)',
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 500 }}>{block.title || template}</span>
        {isStreaming && (
          <span style={{ color: 'var(--cm-fg)', opacity: 0.6 }}>rendering…</span>
        )}
        <span style={{ color: 'var(--cm-fg)', opacity: 0.5 }}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {expanded && (
        <div
          data-testid="viz-render-expanded"
          style={{
            position: 'relative',
            marginTop: 6,
            border: '1px solid var(--cm-border)',
            borderRadius: 8,
            background: 'var(--cm-bg)',
          }}
        >
          {/* Sev-0 #1065 — Expand button shown for EVERY viz template
             (sankey, line, bar, donut, network, chord, heatmap, arch_*).
             Click opens a full-screen modal where the chart primitive's
             native wheel-zoom + click-drag pan kicks in. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '6px 10px',
              borderBottom: '1px solid var(--cm-border)',
            }}
          >
            <button
              type="button"
              onClick={onPopOut}
              aria-label="Expand visualization"
              data-testid="viz-render-popout"
              style={{
                background: 'transparent',
                border: '1px solid var(--cm-border)',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 4,
              }}
            >
              Expand
            </button>
          </div>
          <WidgetRenderer
            template={template}
            kind={(block.kind as 'svg' | 'html' | 'reactflow_arch' | 'arch_diagram' | 'chart') ?? 'svg'}
            content={block.content}
            title={block.title}
            caption={block.caption}
            loadingMessages={block.loadingMessages}
          />
        </div>
      )}
      <ChartExpandModal
        title={block.title || template}
        subtitle={block.caption}
        open={modalOpen}
        onClose={onModalClose}
      >
        <WidgetRenderer
          template={template}
          kind={(block.kind as 'svg' | 'html' | 'reactflow_arch' | 'arch_diagram' | 'chart') ?? 'svg'}
          content={block.content}
          title={block.title}
          caption={block.caption}
          loadingMessages={block.loadingMessages}
        />
      </ChartExpandModal>
    </div>
  );
};

export default InlineVizBadge;
