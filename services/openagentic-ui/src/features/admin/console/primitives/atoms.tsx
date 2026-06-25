/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console primitives — atoms.
 *
 * Small, token-only building blocks shared across the console chrome and
 * every page body. NO color literals — tone resolves via the `data-tone`
 * attribute against the global token CSS in ../styles.css.
 */
import * as React from 'react'
import type { Tone } from '../types'

/** Status dot — a tone-tinted circle. */
export function StatusDot({ tone = 'muted' }: { tone?: Tone }) {
  return <span className="awc-sdot" data-tone={tone} />
}

/** Pill — a tone-tinted label chip, optionally with a leading dot. */
export function Pill({
  tone = 'muted',
  dot,
  children,
}: {
  tone?: Tone
  dot?: boolean
  children: React.ReactNode
}) {
  return (
    <span className="awc-pill" data-tone={tone}>
      {dot && <StatusDot tone={tone} />}
      {children}
    </span>
  )
}

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
}

/** Button — token-only; primary uses the accent→info gradient. */
export function Btn({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...rest
}: BtnProps) {
  const cls = [
    'awc-btn',
    variant === 'primary' && 'awc-pri',
    variant === 'ghost' && 'awc-ghost',
    variant === 'danger' && 'awc-danger',
    size === 'sm' && 'awc-sm',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}

/** Toggle — controlled or uncontrolled token-only switch. */
export function Toggle({
  on,
  onClick,
  disabled,
}: {
  on?: boolean
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={'awc-toggle' + (on ? ' awc-on' : '')}
      aria-pressed={!!on}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    />
  )
}

/** Tag — a mono micro-chip for types/ids. */
export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="awc-tag">{children}</span>
}
