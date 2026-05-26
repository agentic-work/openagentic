/**
 * Phase H (task #153) — `image_progress` event renderer.
 *
 * Replaces the generic loading skeleton during image generation with a
 * progress-aware thumbnail. The partial-URL is a full image URL once
 * the provider returns one (today: only at progress=1.0 since no
 * provider streams partial frames — DALL-E / Imagen 3 / gpt-image-1
 * all return a single final). The thumb's opacity animates toward the
 * `progress` value.
 *
 * Wire contract: `{imageGenId, progress, partialUrl?, eta?, prompt?}`.
 */
import React, { memo } from 'react';

export interface ImageProgressThumbProps {
  imageGenId: string;
  progress: number;          // 0..1
  partialUrl?: string | null;
  eta?: number | null;       // seconds
  prompt?: string | null;
}

function formatEta(eta?: number | null): string | null {
  if (typeof eta !== 'number' || !Number.isFinite(eta) || eta <= 0) return null;
  if (eta < 60) return `${Math.ceil(eta)}s`;
  return `${Math.ceil(eta / 60)}m`;
}

const ImageProgressThumbComponent: React.FC<ImageProgressThumbProps> = ({
  imageGenId,
  progress,
  partialUrl,
  eta,
  prompt,
}) => {
  const pct = Math.max(0, Math.min(1, Number(progress) || 0));
  const pctLabel = `${Math.round(pct * 100)}%`;
  const etaLabel = formatEta(eta);
  const complete = pct >= 1;

  return (
    <div
      data-testid="image-progress-thumb"
      data-image-gen-id={imageGenId}
      data-progress={pct.toFixed(2)}
      data-complete={complete ? 'true' : undefined}
      role="img"
      aria-label={prompt ? `Image generation: ${prompt}` : 'Image generation'}
      aria-busy={!complete}
      style={{
        position: 'relative',
        width: 256,
        height: 256,
        borderRadius: 12,
        overflow: 'hidden',
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--cm-accent) 10%, transparent), color-mix(in srgb, var(--cm-info) 10%, transparent))',
        border: '1px solid color-mix(in srgb, var(--cm-accent) 28%, transparent)',
      }}
    >
      {partialUrl ? (
        <img
          data-testid="image-progress-thumb-img"
          src={partialUrl}
          alt={prompt ?? ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: Math.max(0.15, pct),
            transition: 'opacity 240ms ease-out',
          }}
        />
      ) : (
        <div
          data-testid="image-progress-thumb-skeleton"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(90deg, color-mix(in srgb, var(--cm-accent) 8%, transparent) 0%, color-mix(in srgb, var(--cm-accent) 24%, transparent) 50%, color-mix(in srgb, var(--cm-accent) 8%, transparent) 100%)',
            backgroundSize: '200% 100%',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          bottom: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '4px 8px',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--cm-bg) 55%, transparent)',
          color: 'var(--cm-text-secondary)',
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          lineHeight: 1.2,
        }}
      >
        <span data-testid="image-progress-pct" style={{ fontWeight: 600, color: 'var(--cm-accent)' }}>
          {pctLabel}
        </span>
        {etaLabel && (
          <span data-testid="image-progress-eta" style={{ color: 'var(--cm-text-secondary)' }}>
            · {etaLabel}
          </span>
        )}
      </div>
    </div>
  );
};

export const ImageProgressThumb = memo(ImageProgressThumbComponent);
ImageProgressThumb.displayName = 'ImageProgressThumb';
