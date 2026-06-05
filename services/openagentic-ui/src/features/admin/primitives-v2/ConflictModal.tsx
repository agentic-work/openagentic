/**
 * ConflictModal — Phase 1 admin overhaul §11.5.
 *
 * The 409-Conflict UI. Pairs with `useOptimisticVersion`. When two admins edit
 * the same row simultaneously and one save's version goes stale, the api
 * returns 409 with `currentRow` + `conflictingFields`; this modal renders that
 * state as a per-field diff with three actions:
 *
 *   • Re-apply mine — keep your edit; refetch + retry POST with new version
 *   • Take theirs   — discard your edit; sync to currentRow
 *   • Keep editing  — close the modal; your edit remains in the form
 *
 * Built on primitives-v2/Modal so the chrome (focus-trap, esc, tokens, no-hex)
 * is shared with every other dialog. The CTAs live in a row inside the dialog
 * body since the Modal primitive only supports primary+secondary; that's
 * intentional — adding a 3rd CTA slot would invite ambiguity for other
 * destructive flows.
 */

import React from 'react'
import { Modal } from './Modal'
import type { VersionedRow, ConflictState } from '../hooks/useOptimisticVersion'

export interface ConflictModalProps<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  open: boolean
  onClose: () => void
  conflict: ConflictState<TPayload>
  onReapply: () => void
  onTakeTheirs: () => void
  /** Override the dialog title. Default: "Someone else just saved this". */
  title?: string
  /** override default test id. */
  testId?: string
}

function formatActor(updatedBy: unknown, updatedAt: unknown): string {
  const who = typeof updatedBy === 'string' && updatedBy.length > 0 ? updatedBy : 'another admin'
  if (typeof updatedAt === 'string') {
    try {
      const ago = formatRelative(new Date(updatedAt))
      return `${who} · ${ago}`
    } catch { /* fallthrough */ }
  }
  return who
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function ConflictModal<TPayload extends Record<string, unknown>>({
  open,
  onClose,
  conflict,
  onReapply,
  onTakeTheirs,
  title = 'Someone else just saved this',
  testId = 'conflict-modal',
}: ConflictModalProps<TPayload>) {
  const { currentRow, conflictingFields, attemptedPayload } = conflict
  const actor = formatActor((currentRow as VersionedRow).updated_by, (currentRow as any).updated_at)

  const fieldRows = (conflictingFields ?? []).map((f) => ({
    field: f,
    theirs: formatValue((currentRow as Record<string, unknown>)[f]),
    yours: formatValue((attemptedPayload as Record<string, unknown>)[f]),
  }))

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      body={`${actor} edited this before your save landed.`}
      variant="confirm"
      testId={testId}
      // Modal owns primary+secondary; we hide them by sticking neutral handlers
      // and rendering our own three buttons inside `children`. The Modal close
      // button (Esc + backdrop) still works.
      primary={{ label: 'Re-apply mine', onClick: onReapply }}
      secondary={{ label: 'Keep editing', onClick: onClose }}
    >
      <div data-testid={`${testId}-diff`} style={{ marginTop: 4 }}>
        {fieldRows.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ap-fg-3, var(--fg-3))',
              padding: '8px 0',
            }}
          >
            No per-field diff available. Choose how to proceed below.
          </div>
        ) : (
          <div
            role="table"
            style={{
              border: '1px solid var(--glass-border)',
              borderRadius: 8,
              overflow: 'hidden',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              background: 'var(--ctl-surf)',
            }}
          >
            <div
              role="row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                background: 'var(--ctl-surf-hover)',
                color: 'var(--ap-fg-3, var(--fg-3))',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 600,
              }}
            >
              <span style={{ padding: '6px 10px' }}>Field</span>
              <span style={{ padding: '6px 10px' }}>Their value</span>
              <span style={{ padding: '6px 10px' }}>Your value</span>
            </div>
            {fieldRows.map((r) => (
              <div
                key={r.field}
                role="row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  borderTop: '1px solid var(--ap-ln-1, var(--line-1))',
                }}
              >
                <span style={{ padding: '6px 10px', color: 'var(--ap-fg-1, var(--fg-1))', fontWeight: 500 }}>
                  {r.field}
                </span>
                <span style={{ padding: '6px 10px', color: 'var(--ap-fg-2, var(--fg-2))' }}>{r.theirs}</span>
                <span style={{ padding: '6px 10px', color: 'var(--ap-accent, var(--accent))' }}>{r.yours}</span>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 14,
          }}
        >
          <button
            type="button"
            onClick={onTakeTheirs}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid var(--ap-ln-2, var(--line-2))',
              background: 'transparent',
              color: 'var(--ap-fg-1, var(--fg-1))',
              cursor: 'pointer',
            }}
          >
            Take theirs
          </button>
        </div>
      </div>
    </Modal>
  )
}
