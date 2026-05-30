/**
 * InlineAppBadge — typed-block render for `app_render` ContentBlocks.
 *
 * #879 — inline-by-default per mock-01 contract. Renders a `.viz-head`
 * style strip (icon + tool name + template badge + title + status dot)
 * followed by the AppRenderer iframe immediately below. The slide-out
 * drawer architecture is deferred — mocks show the iframe rendered
 * inline at the wire-emit chronological position.
 *
 * Theme tokens only — no hex / rgb literals.
 */

import React from 'react';

import type { ContentBlock } from '../AgenticActivityStream/types/activity.types';
import { AppRenderer } from './AppRenderer';

export interface InlineAppBadgeProps {
  block: ContentBlock;
}

export const InlineAppBadge: React.FC<InlineAppBadgeProps> = ({ block }) => {
  const isStreaming = !block.isComplete;
  const title = block.title || 'Mini app';
  const html = typeof block.html === 'string' ? block.html : '';

  return (
    <div
      data-testid="app-render-badge"
      data-streaming={isStreaming ? 'true' : 'false'}
      style={{
        margin: '6px 0',
        border: '1px solid var(--cm-border)',
        borderRadius: 8,
        background: 'var(--cm-bg)',
        overflow: 'hidden',
      }}
    >
      <div
        className="viz-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--cm-border)',
          background: 'var(--cm-bg-2, var(--cm-bg))',
          color: 'var(--cm-fg)',
          fontSize: 12,
        }}
      >
        <span aria-hidden="true">📦</span>
        <span style={{ fontWeight: 600 }}>compose_app</span>
        <span style={{ color: 'var(--cm-fg)', opacity: 0.7 }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: isStreaming ? 'var(--cm-info)' : 'var(--cm-success)',
          }}
        />
        {isStreaming && (
          <span style={{ color: 'var(--cm-fg)', opacity: 0.6 }}>rendering…</span>
        )}
      </div>
      <AppRenderer
        artifactId={block.id}
        html={html}
        title={title}
        pyodideRequired={block.pyodideRequired === true}
        nonce={typeof block.nonce === 'string' ? block.nonce : undefined}
      />
    </div>
  );
};

export default InlineAppBadge;
