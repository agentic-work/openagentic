/**
 * Phase H (task #153) — `artifact_open` event renderer.
 *
 * A compact banner pinned above an assistant message when the model
 * starts producing a large separable deliverable (markdown, code,
 * chart, csv). The banner shows the artifact kind icon + title and is
 * the trigger that slides in the right-side `ArtifactPanel` where the
 * content actually streams.
 *
 * Wire contract: `{artifactId, kind, title, language?, fileName?}`.
 * Visual: violet-tinted pill, kind icon, "Drafting <title>..." label.
 */
import React, { memo } from 'react';

export type ArtifactKind = 'markdown' | 'code' | 'chart' | 'csv';

export interface ArtifactStartBannerProps {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  language?: string | null;
  fileName?: string | null;
  complete?: boolean;
}

const ICON_BY_KIND: Record<ArtifactKind, (props: { size?: number }) => JSX.Element> = {
  markdown: ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  code: ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  chart: ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M3 20V4M3 20h16M7 16V8M12 16v-6M17 16v-4" />
    </svg>
  ),
  csv: ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 10h18M9 4v16M15 4v16" />
    </svg>
  ),
};

const ArtifactStartBannerComponent: React.FC<ArtifactStartBannerProps> = ({
  artifactId,
  kind,
  title,
  language,
  fileName,
  complete,
}) => {
  const Icon = ICON_BY_KIND[kind] ?? ICON_BY_KIND.code;
  const subtitle =
    fileName || language || kind;

  return (
    <span
      data-testid="artifact-start-banner"
      data-artifact-id={artifactId}
      data-kind={kind}
      data-complete={complete ? 'true' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        borderRadius: 99,
        background:
          'linear-gradient(90deg, rgba(139,92,246,0.12), rgba(99,102,241,0.12))',
        border: '1px solid rgba(139,92,246,0.32)',
        fontSize: 11,
        color: '#d4d4d8',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}
    >
      <span style={{ color: '#a78bfa' }}>
        <Icon size={12} />
      </span>
      <span style={{ color: '#a78bfa', fontWeight: 600 }}>
        {complete ? 'Drafted' : 'Drafting'} {title}
      </span>
      <span style={{ color: '#71717a' }}>· {subtitle}</span>
      {complete && (
        <span
          data-testid="artifact-complete-check"
          style={{ color: '#22c55e', display: 'inline-flex', alignItems: 'center' }}
          aria-label="complete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="3" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
    </span>
  );
};

export const ArtifactStartBanner = memo(ArtifactStartBannerComponent);
ArtifactStartBanner.displayName = 'ArtifactStartBanner';
