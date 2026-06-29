/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * DomainIcon — renders a single-path domain glyph with currentColor
 * stroke, so it resolves to the active theme foreground/accent at paint.
 */
import * as React from 'react'

export function DomainIcon({ path, size = 17 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d={path} />
    </svg>
  )
}
