/**
 * B8 (chatmode punch-list, 2026-05-12) — Compliance banner rendered
 * inline with an assistant message whose canonical stop_reason was
 * `content_filter`, `safety`, or `recitation`. Before B8 these all
 * collapsed to `end_turn` and the UI showed a truncated bubble with no
 * indication that a safety filter fired. For your environment FedRAMP-Hi audit this
 * hid a SAFETY event from the operator + audit log.
 *
 * Visual: subtle red/orange border + icon + compliance copy. Sits
 * above (or replaces) the partial assistant text so the user knows the
 * platform did NOT fail silently — RAI / Vertex SAFETY / RECITATION
 * tripped on the model's output and the platform owner has been
 * notified.
 *
 * Wire contract: useChatStream stores `{kind, model, message}` per
 * assistant message id in `contentFilterBannerByMessageId`. ChatMessages
 * mounts this component when the entry is set for the message.
 *
 * Plan ref: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md §1.4
 */
import React, { memo } from 'react';

export interface ContentFilterBannerProps {
  /** Discriminator the server attached to the frame
   *  ('content_filter' | 'safety' | 'recitation'). Used to vary the
   *  headline; the body copy is the same compliance language for all
   *  three (the FedRAMP audit doesn't distinguish them in user UX). */
  kind?: string;
  /** Model that produced the filtered turn — surfaced in the audit row
   *  so the user knows which deployment tripped. */
  model?: string;
  /** Server-supplied compliance message (already user-friendly). The
   *  component renders this verbatim; the wire contract owns the copy. */
  message: string;
}

function headlineForKind(kind: string | undefined): string {
  switch (kind) {
    case 'safety':
      return 'Safety filter triggered';
    case 'recitation':
      return 'Recitation filter triggered';
    case 'content_filter':
    default:
      return 'Responsible AI filter triggered';
  }
}

const ContentFilterBannerComponent: React.FC<ContentFilterBannerProps> = ({
  kind,
  model,
  message,
}) => {
  const headline = headlineForKind(kind);
  return (
    <div
      data-testid="content-filter-banner"
      data-kind={kind ?? 'content_filter'}
      data-model={model || undefined}
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 12px',
        margin: '8px 0',
        borderRadius: 8,
        border: '1px solid rgba(239,68,68,0.55)',
        background:
          'linear-gradient(90deg, rgba(239,68,68,0.10), rgba(249,115,22,0.08))',
        color: '#fecaca',
        fontFamily: 'var(--font-v3-mono, JetBrains Mono, monospace)',
        fontSize: 12,
        lineHeight: '1.45em',
      }}
    >
      <span
        aria-hidden="true"
        style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.4">
          <path d="M12 2l10 18H2L12 2z" />
          <line x1="12" y1="9" x2="12" y2="14" />
          <circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          data-testid="content-filter-banner-headline"
          style={{ color: '#f87171', fontWeight: 600, letterSpacing: 0.1 }}
        >
          {headline}
        </span>
        <span data-testid="content-filter-banner-message" style={{ color: '#fecaca' }}>
          {message}
        </span>
        {model ? (
          <span
            data-testid="content-filter-banner-model"
            style={{ color: '#a3a3a3', fontSize: 11, marginTop: 2 }}
          >
            model: {model}
          </span>
        ) : null}
      </span>
    </div>
  );
};

export const ContentFilterBanner = memo(ContentFilterBannerComponent);
ContentFilterBanner.displayName = 'ContentFilterBanner';
