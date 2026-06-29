/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * ScopeModal — the scope switcher (a token-only side sheet). The
 * open-source build is single-scope ("Local"); org/env/region show "—"
 * honestly when unset — never fabricated.
 */
import * as React from 'react'
import type { Tone } from '../types'
import { Pill, StatusDot } from '../primitives'

export interface ScopeOption {
  id: string
  org: string
  name: string
  env: string
  region: string
  tone: Tone
  tid?: string
}

export function ScopeModal({
  open,
  scopes,
  activeId,
  onClose,
  onPick,
}: {
  open: boolean
  scopes: ScopeOption[]
  activeId: string
  onClose: () => void
  onPick: (id: string) => void
}) {
  if (!open) return null
  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'color-mix(in srgb, var(--bg-0) 62%, transparent)',
          backdropFilter: 'blur(3px)',
          zIndex: 60,
        }}
        onClick={onClose}
      />
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 460,
          maxWidth: '94vw',
          background: 'var(--bg-1)',
          borderLeft: '1px solid var(--line-2)',
          zIndex: 61,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 70px -20px color-mix(in srgb, var(--bg-0) 80%, transparent)',
        }}
      >
        <div
          style={{
            padding: '18px 20px',
            borderBottom: '1px solid var(--line-1)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--fg-0)' }}>Switch scope</h3>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4, fontFamily: 'var(--font-v3-mono)' }}>
              workspace · environment
            </div>
          </div>
          <button
            className="awc-btn awc-sm awc-ghost"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {scopes.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 13px',
                borderRadius: 11,
                border: '1px solid ' + (s.id === activeId ? 'var(--accent-line)' : 'var(--line-1)'),
                background: s.id === activeId ? 'var(--accent-soft)' : 'var(--bg-2)',
                marginBottom: 8,
                width: '100%',
                textAlign: 'left',
                color: 'var(--fg-0)',
              }}
            >
              <StatusDot tone={s.tone} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {s.org} · {s.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2, fontFamily: 'var(--font-v3-mono)' }}>
                  {s.env.toLowerCase()} · {s.region}
                </div>
              </div>
              {s.id === activeId ? (
                <Pill tone="info">current</Pill>
              ) : (
                <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>switch →</span>
              )}
            </button>
          ))}
        </div>
      </aside>
    </>
  )
}
