import * as React from 'react'
import { Btn } from './atoms'
import './styles.css'

interface EmptyStateProps {
  title: string
  body: React.ReactNode
  ctaLabel?: string
  onCtaClick?: () => void
  learnMoreHref?: string
  illustration?: React.ReactNode
}

const DEFAULT_ILLU = (
  <svg
    width="56"
    height="40"
    viewBox="0 0 56 40"
    fill="none"
    aria-hidden="true"
  >
    {/* Hairline empty-grid glyph: 3-row, 4-col cells with one row left
        intentionally blank — reads as "table waiting for data" */}
    <g stroke="var(--accent)" strokeWidth="1" opacity="0.7">
      <rect x="2" y="2" width="52" height="36" />
      <line x1="2" y1="14" x2="54" y2="14" />
      <line x1="2" y1="26" x2="54" y2="26" />
      <line x1="15" y1="2" x2="15" y2="38" />
      <line x1="28" y1="2" x2="28" y2="38" />
      <line x1="41" y1="2" x2="41" y2="38" />
    </g>
    {/* Tiny dot marking "first row would go here" */}
    <circle cx="8" cy="8" r="1.5" fill="var(--accent)" />
  </svg>
)

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  body,
  ctaLabel,
  onCtaClick,
  learnMoreHref,
  illustration,
}) => (
  <div className="aw-empty-state">
    <div className="aw-empty-state__illu">{illustration ?? DEFAULT_ILLU}</div>
    <div className="aw-empty-state__title">{title}</div>
    <div className="aw-empty-state__body">{body}</div>
    {(ctaLabel || learnMoreHref) && (
      <div className="aw-empty-state__actions">
        {ctaLabel && (
          <Btn variant="primary" onClick={onCtaClick}>
            {ctaLabel}
          </Btn>
        )}
        {learnMoreHref && (
          <a className="aw-empty-state__learn" href={learnMoreHref}>
            Learn more →
          </a>
        )}
      </div>
    )}
  </div>
)
