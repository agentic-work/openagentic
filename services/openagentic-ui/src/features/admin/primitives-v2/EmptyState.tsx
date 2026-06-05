import React from 'react'

export interface EmptyStateProps {
  title: string
  hint: React.ReactNode
  cta?: string
  onCta?: () => void
}

/**
 * EmptyState — the contract: every empty/zero-data surface must render a
 * title, a one-sentence hint explaining what would appear here, and (when
 * actionable) a CTA. Replaces the live console's bare "—" / "No data yet" /
 * blank panel patterns.
 */
export function EmptyState({ title, hint, cta, onCta }: EmptyStateProps) {
  return (
    <div
      role="status"
      style={{
        textAlign: 'center',
        padding: '56px 24px',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px dashed var(--glass-border)',
        borderRadius: 'var(--radius-chip)',
        boxShadow: 'var(--glass-card-shadow)',
        color: 'var(--ap-fg-2, var(--fg-2))',
      }}
    >
      <h4
        style={{
          margin: '0 0 6px',
          fontFamily: 'var(--font-disp, Fraunces, Georgia, serif)',
          fontWeight: 500,
          fontSize: 18,
          color: 'var(--ap-fg-0, var(--fg-0))',
        }}
      >
        {title}
      </h4>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: 12.5,
          maxWidth: 360,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        {hint}
      </p>
      {cta && (
        <button
          type="button"
          onClick={onCta}
          style={{
            fontFamily: 'var(--font-ui, inherit)',
            fontSize: 12,
            fontWeight: 500,
            padding: '6px 14px',
            borderRadius: 3,
            background: 'var(--ap-accent, var(--accent))',
            color: 'var(--ap-fg-on-accent, white)',
            border: '1px solid var(--ap-accent, var(--accent))',
            cursor: 'pointer',
          }}
        >
          {cta}
        </button>
      )}
    </div>
  )
}
