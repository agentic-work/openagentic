import React from 'react'
import { Info, X } from 'lucide-react'

/**
 * ExplainerCard — drop-in "what does this page do, why does it matter"
 * card. Anchors at the top of confusing pages (Default Models, Tiered FC,
 * Router Tuning) per Mission Control standards §8.
 *
 * Theme-aware: pulls colors from --bg-1, --line-2, --accent, --fg-0/2.
 * Icon is the section's own (passed via `icon`) or a default Info glyph.
 */
export function ExplainerCard({
  title,
  body,
  why,
  icon,
  onSuppress,
  suppressed,
  variant = 'info',
}: {
  title: string
  body: React.ReactNode
  why?: React.ReactNode
  icon?: React.ReactNode
  onSuppress?: () => void
  suppressed?: boolean
  variant?: 'info' | 'warn' | 'sot'
}) {
  if (suppressed) return null
  const accentColor =
    variant === 'warn'
      ? 'var(--ap-warning, var(--warn))'
      : variant === 'sot'
        ? 'var(--ap-success, var(--ok))'
        : 'var(--ap-accent, var(--accent))'
  return (
    <div
      role="region"
      aria-label={title}
      className="font-ui text-fg-0 mb-4 max-w-[980px] rounded border border-ln-2 bg-bg-1 px-5 py-4"
      style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-mono" style={{ color: accentColor }}>
        {icon ?? <Info size={12} />}
        <span>{variant === 'sot' ? 'REGISTRY · SoT' : 'WHAT IS THIS'}</span>
      </div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="text-fg-2 text-[13px] leading-6">{body}</div>
      {why && (
        <div className="text-fg-0 mt-3 border-t border-ln-1 pt-3 text-[13px]">
          <span className="font-semibold" style={{ color: accentColor }}>
            Why:{' '}
          </span>
          {why}
        </div>
      )}
      {onSuppress && (
        <button
          type="button"
          aria-label="Hide explainer"
          onClick={onSuppress}
          className="text-fg-3 hover:text-fg-0 mt-3 inline-flex items-center gap-1 text-[10px] font-mono"
        >
          <X size={11} /> Hide this
        </button>
      )}
    </div>
  )
}
