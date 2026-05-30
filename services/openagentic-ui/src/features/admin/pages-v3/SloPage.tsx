/**
 * SloPage — V3 Phase 12 admin UI.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §13/§14.3
 *
 * Surfaces the V3 SLO definitions from /api/admin/slo + per-metric
 * live status from /api/admin/slo/:metric/status. Phase 12 ships
 * read-only table with green/red status indicator + raw observation
 * value. Full edit form (upsert/toggle/delete) ships in a follow-up
 * once operators have feedback on threshold tuning from real-world
 * use.
 *
 * The page lives behind the v3 admin sidebar leaf id 'slo' (see
 * shell-v3/sidebar-data.ts) and is wired in AdminPortalHostV3 by leaf id.
 */

import React from 'react'
import { useAdminQuery } from '../hooks/useAdminQuery'

interface SLODefinition {
  metric: string
  type: 'p99' | 'error_rate' | 'rps_floor'
  threshold: number
  window: string
  description: string
  enabled: boolean
}

interface SLOListResponse {
  slos: SLODefinition[]
}

interface SLOStatusResponse {
  slo: SLODefinition
  met: boolean
  observation: number | null
}

const SloStatusCell: React.FC<{ metric: string; enabled: boolean }> = ({ metric, enabled }) => {
  const q = useAdminQuery<SLOStatusResponse>(
    ['slo-status', metric],
    `/api/admin/slo/${encodeURIComponent(metric)}/status`,
    { staleTime: 30_000, refetchInterval: enabled ? 30_000 : undefined },
  )
  if (!enabled) {
    return (
      <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>
        disabled
      </span>
    )
  }
  if (q.isLoading) {
    return <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>checking…</span>
  }
  if (q.error) {
    return <span style={{ color: 'var(--accent-err, #b00)', fontSize: 12 }}>error</span>
  }
  const data = q.data
  if (!data) return <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>—</span>
  const met = data.met
  const dot = (
    <span
      aria-label={met ? 'met' : 'breached'}
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: met ? 'var(--accent-ok, #2a9)' : 'var(--accent-err, #b00)',
        marginRight: 8,
        verticalAlign: 'middle',
      }}
    />
  )
  return (
    <span style={{ fontSize: 13 }}>
      {dot}
      <span style={{ color: 'var(--fg-1)' }}>{met ? 'met' : 'breached'}</span>
      {data.observation !== null ? (
        <span style={{ color: 'var(--fg-3)', marginLeft: 8 }}>
          ({fmtObs(data.slo.type, data.observation)})
        </span>
      ) : null}
    </span>
  )
}

function fmtObs(type: SLODefinition['type'], obs: number): string {
  if (type === 'p99') return `${obs.toFixed(2)}s`
  if (type === 'error_rate') return `${(obs * 100).toFixed(2)}%`
  if (type === 'rps_floor') return `${obs.toFixed(0)} total`
  return String(obs)
}

function fmtThreshold(slo: SLODefinition): string {
  if (slo.type === 'p99') return `<= ${slo.threshold}s`
  if (slo.type === 'error_rate') return `<= ${(slo.threshold * 100).toFixed(2)}%`
  if (slo.type === 'rps_floor') return `>= ${slo.threshold}`
  return String(slo.threshold)
}

export const SloPage: React.FC = () => {
  const listQ = useAdminQuery<SLOListResponse>(
    ['slo', 'list'],
    '/api/admin/slo',
    { staleTime: 60_000 },
  )
  const slos = listQ.data?.slos ?? []
  return (
    <div style={{ padding: 24, color: 'var(--fg-1)' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8, color: 'var(--fg-0)' }}>
        Service Level Objectives
      </h1>
      <p style={{ marginBottom: 16, color: 'var(--fg-2)', maxWidth: 840 }}>
        V3 chat-loop SLOs — per-metric thresholds with live status against the
        prom-client default register. Status is the result of evaluating the
        threshold against the current registry snapshot; precise windowed
        evaluation queries the Prometheus proxy in a follow-up.
      </p>
      {listQ.isLoading ? (
        <div style={{ color: 'var(--fg-3)' }}>Loading SLOs…</div>
      ) : listQ.error ? (
        <div style={{ color: 'var(--accent-err, #b00)' }}>
          Failed to load SLOs: {String((listQ.error as any)?.message ?? listQ.error)}
        </div>
      ) : (
        <div
          style={{
            border: '1px solid var(--border-1, #2a2d33)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table
            data-testid="slo-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--bg-2, #1a1c1f)' }}>
                <th style={th}>Metric</th>
                <th style={th}>Type</th>
                <th style={th}>Threshold</th>
                <th style={th}>Window</th>
                <th style={th}>Description</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {slos.map((s) => (
                <tr key={s.metric} style={{ borderTop: '1px solid var(--border-1, #2a2d33)' }}>
                  <td style={td}>
                    <code style={{ color: 'var(--fg-0)' }}>{s.metric}</code>
                  </td>
                  <td style={td}>
                    <span style={{ color: 'var(--fg-2)' }}>{s.type}</span>
                  </td>
                  <td style={td}>{fmtThreshold(s)}</td>
                  <td style={td}>
                    <span style={{ color: 'var(--fg-3)' }}>{s.window}</span>
                  </td>
                  <td style={{ ...td, color: 'var(--fg-2)' }}>{s.description}</td>
                  <td style={td}>
                    <SloStatusCell metric={s.metric} enabled={s.enabled} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ marginTop: 16, color: 'var(--fg-3)', fontSize: 12, maxWidth: 840 }}>
        Edit form (upsert / toggle / delete) ships in a follow-up. For now
        operators tune thresholds directly through the API:
        <code> POST /api/admin/slo</code>,
        <code> PATCH /api/admin/slo/:metric/toggle</code>,
        <code> DELETE /api/admin/slo/:metric</code>.
      </p>
    </div>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  color: 'var(--fg-2)',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

const td: React.CSSProperties = {
  padding: '8px 12px',
  verticalAlign: 'top',
}

export default SloPage
