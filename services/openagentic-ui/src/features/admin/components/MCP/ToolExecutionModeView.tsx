/**
 * Tool Execution Mode — global read-only kill switch for MCP tools.
 *
 * Phase 1 admin-overhaul rewrite (§11.5 optimistic concurrency + §11.4 CRUD
 * feedback + §11.2 copy budget). State + save flow through useOptimisticVersion;
 * destructive transitions go through the Modal primitive's typed-confirm; 409
 * surfaces ConflictModal.
 */

import React, { useState } from 'react'
import { Shield, AlertTriangle } from 'lucide-react'
// ShieldAlert is missing from lucide-react's type defs — alias AlertTriangle.
const ShieldAlert = AlertTriangle
import { PageHeader, Modal, ConflictModal } from '../../primitives-v2'
import { useOptimisticVersion } from '../../hooks/useOptimisticVersion'

type ReadonlyState = {
  enabled: boolean
  source?: 'database' | 'env' | 'default'
  version: number
  updated_at?: string
  updated_by?: string
}

const ENABLE_PHRASE = 'enable read-only'
const RESTORE_PHRASE = 'restore full access'

export const ToolExecutionModeView: React.FC = () => {
  const opt = useOptimisticVersion<{ enabled: boolean }, ReadonlyState>({
    endpoint: '/api/admin/tools/readonly',
    queryKey: ['admin', 'tools', 'readonly'],
  })

  const [pendingTarget, setPendingTarget] = useState<boolean | null>(null)
  const enabled = opt.state?.enabled ?? false

  const onToggle = () => setPendingTarget(!enabled)
  const onCancel = () => setPendingTarget(null)
  const onConfirm = async () => {
    if (pendingTarget === null) return
    await opt.save({ enabled: pendingTarget })
    setPendingTarget(null)
  }

  const goingDestructive = pendingTarget === false // disabling read-only re-opens writes
  const requirePhrase = goingDestructive ? RESTORE_PHRASE : ENABLE_PHRASE

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        crumbs={['Admin', 'Tools', 'Execution Mode']}
        title="Tool Execution Mode"
        explainer="Block write operations across MCP tools globally."
      />

      {opt.isLoading && (
        <div
          style={{
            border: '1px solid var(--ap-ln-1, var(--line-1))',
            borderRadius: 12,
            padding: 18,
            color: 'var(--ap-fg-3, var(--fg-3))',
            background: 'var(--ap-bg-1, var(--bg-1))',
            fontSize: 13,
          }}
        >
          Loading…
        </div>
      )}

      {opt.error && (
        <div
          role="alert"
          style={{
            border: '1px solid var(--ap-err, var(--err))',
            background: 'var(--ap-err-soft, transparent)',
            borderRadius: 10,
            padding: 12,
            fontSize: 13,
            color: 'var(--ap-err, var(--err))',
          }}
        >
          {opt.error.message}
        </div>
      )}

      {opt.state && !opt.isLoading && (
        <div
          data-testid="readonly-status-card"
          style={{
            border: `1px solid ${enabled ? 'var(--ap-warn, var(--warn))' : 'var(--ap-ok, var(--ok))'}`,
            background: enabled ? 'var(--ap-warn-soft, transparent)' : 'var(--ap-ok-soft, transparent)',
            borderRadius: 12,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                display: 'grid',
                placeItems: 'center',
                color: enabled ? 'var(--ap-warn, var(--warn))' : 'var(--ap-ok, var(--ok))',
                background: enabled ? 'var(--ap-warn-soft, transparent)' : 'var(--ap-ok-soft, transparent)',
                border: `1px solid ${enabled ? 'var(--ap-warn, var(--warn))' : 'var(--ap-ok, var(--ok))'}`,
              }}
            >
              {enabled ? <ShieldAlert size={22} /> : <Shield size={22} />}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--ap-fg-0, var(--fg-0))',
                }}
              >
                {enabled ? 'Read-only mode active' : 'Full access'}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--ap-fg-2, var(--fg-2))',
                }}
              >
                {enabled
                  ? 'Write operations are blocked. List, get, describe, and search still work.'
                  : 'All MCP write operations are enabled.'}
              </p>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--ap-fg-3, var(--fg-3))',
                  marginTop: 4,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                v{opt.state.version} · {opt.state.source ?? 'default'}
                {opt.state.updated_at && ` · ${new Date(opt.state.updated_at).toLocaleString()}`}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              data-testid="toggle-readonly"
              onClick={onToggle}
              disabled={opt.isSaving}
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: '1px solid transparent',
                background: enabled ? 'var(--ap-ok, var(--ok))' : 'var(--ap-warn, var(--warn))',
                color: 'var(--ap-fg-on-accent, white)',
                cursor: opt.isSaving ? 'not-allowed' : 'pointer',
                opacity: opt.isSaving ? 0.6 : 1,
              }}
            >
              {enabled ? 'Restore Full Access' : 'Enable Read-Only Mode'}
            </button>
          </div>
        </div>
      )}

      {/* Typed-confirm modal for the destructive transition */}
      <Modal
        open={pendingTarget !== null && opt.conflict === null}
        onClose={onCancel}
        title={goingDestructive ? 'Restore full access?' : 'Enable read-only mode?'}
        body={
          goingDestructive
            ? 'Re-enables every MCP write tool. Running flows resume immediately.'
            : 'Blocks every MCP write tool. Running flows will fail at the next write step.'
        }
        variant={goingDestructive ? 'destructive' : 'confirm'}
        requireConfirmText={requirePhrase}
        primary={{
          label: goingDestructive ? 'Restore access' : 'Enable',
          onClick: onConfirm,
          loading: opt.isSaving,
        }}
        secondary={{ label: 'Cancel', onClick: onCancel }}
      />

      {/* Conflict modal for the §11.5 contract */}
      {opt.conflict && (
        <ConflictModal
          open={true}
          onClose={() => {
            opt.dismissConflict()
            setPendingTarget(null)
          }}
          conflict={opt.conflict}
          onReapply={async () => {
            const payload = opt.conflict?.attemptedPayload as { enabled: boolean } | undefined
            if (!payload) return
            await opt.resolveAndSave(payload)
            setPendingTarget(null)
          }}
          onTakeTheirs={async () => {
            opt.dismissConflict()
            setPendingTarget(null)
            await opt.refetch()
          }}
        />
      )}
    </div>
  )
}

export default ToolExecutionModeView
