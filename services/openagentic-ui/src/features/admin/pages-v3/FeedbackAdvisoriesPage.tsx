/**
 * FeedbackAdvisoriesPage — V3 Phase 13 admin UI.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §15
 *
 * Surfaces the V3 FeedbackLearningService.analyze() output from
 * GET /api/admin/feedback-advisories?window=24h|7d|30d. ADVISORY ONLY this
 * phase — Apply button is disabled. A future Sev-2 follow-up wires the apply
 * path through RouterTuningService + AuditLogService once operators have
 * triaged the recommendation surface for several weeks of real feedback.
 *
 * Lives behind sidebar leaf id 'feedback-advisories' under the monitoring group.
 */

import React from 'react'
import { useAdminQuery } from '../hooks/useAdminQuery'

type AdvisoryWindow = '24h' | '7d' | '30d'

type RecommendationType =
  | 'intent_floor_bump'
  | 'intent_floor_lower'
  | 'model_demote'
  | 'model_promote'

interface AdvisoryRecommendation {
  type: RecommendationType
  intent: string
  model?: string
  evidenceCount: number
  positiveRate: number
  currentValue?: number
  recommendedValue?: number
  reason: string
}

interface AdvisoriesResponse {
  window: AdvisoryWindow
  minEvidence: number
  recommendations: AdvisoryRecommendation[]
  generatedAt: string
}

const WINDOW_OPTIONS: AdvisoryWindow[] = ['24h', '7d', '30d']

function typeLabel(t: RecommendationType): string {
  switch (t) {
    case 'model_demote':
      return 'Demote model'
    case 'model_promote':
      return 'Promote model'
    case 'intent_floor_bump':
      return 'Bump intent floor'
    case 'intent_floor_lower':
      return 'Lower intent floor'
  }
}

function typeColor(t: RecommendationType): string {
  switch (t) {
    case 'model_demote':
    case 'intent_floor_bump':
      return 'var(--accent-warn, #c80)'
    case 'model_promote':
    case 'intent_floor_lower':
      return 'var(--accent-ok, #2a9)'
  }
}

export const FeedbackAdvisoriesPage: React.FC = () => {
  const [window, setWindow] = React.useState<AdvisoryWindow>('7d')

  const q = useAdminQuery<AdvisoriesResponse>(
    ['feedback-advisories', window],
    `/api/admin/feedback-advisories?window=${encodeURIComponent(window)}`,
    { staleTime: 60_000 },
  )

  const recs = q.data?.recommendations ?? []

  return (
    <div style={{ padding: 24, color: 'var(--fg-1)' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8, color: 'var(--fg-0)' }}>
        Feedback Advisories
      </h1>
      <p style={{ marginBottom: 16, color: 'var(--fg-2)', maxWidth: 840 }}>
        Aggregated thumbs-up/thumbs-down feedback over a rolling window, grouped
        by (intent, model). Recommendations are <strong>advisory only</strong> —
        Apply is intentionally disabled this phase. Operators triage these for
        several weeks before auto-apply ships behind a feature flag.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ color: 'var(--fg-2)', fontSize: 12 }}>Window</label>
        <select
          data-testid="advisories-window"
          value={window}
          onChange={(e) => setWindow(e.target.value as AdvisoryWindow)}
          style={{
            padding: '6px 10px',
            background: 'var(--bg-2, #1a1c1f)',
            color: 'var(--fg-1)',
            border: '1px solid var(--border-1, #2a2d33)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {WINDOW_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        {q.data?.generatedAt && (
          <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>
            generated {new Date(q.data.generatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {q.isLoading ? (
        <div style={{ color: 'var(--fg-3)' }}>Loading advisories…</div>
      ) : q.error ? (
        <div style={{ color: 'var(--accent-err, #b00)' }}>
          Failed to load advisories: {String((q.error as any)?.message ?? q.error)}
        </div>
      ) : recs.length === 0 ? (
        <div
          style={{
            padding: 16,
            border: '1px dashed var(--border-1, #2a2d33)',
            borderRadius: 8,
            color: 'var(--fg-3)',
            fontSize: 13,
            maxWidth: 840,
          }}
        >
          No advisories — either no feedback in the {window} window or every
          (intent, model) group is below the evidence threshold (default 10).
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
            data-testid="advisories-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--bg-2, #1a1c1f)' }}>
                <th style={th}>Type</th>
                <th style={th}>Intent</th>
                <th style={th}>Model</th>
                <th style={th}>Evidence</th>
                <th style={th}>Positive rate</th>
                <th style={th}>Reason</th>
                <th style={th}>Apply</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r, idx) => (
                <tr
                  key={`${r.type}-${r.intent}-${r.model ?? '*'}-${idx}`}
                  style={{ borderTop: '1px solid var(--border-1, #2a2d33)' }}
                  data-testid="advisory-row"
                >
                  <td style={td}>
                    <span style={{ color: typeColor(r.type), fontWeight: 600 }}>
                      {typeLabel(r.type)}
                    </span>
                  </td>
                  <td style={td}>
                    <code style={{ color: 'var(--fg-0)' }}>{r.intent}</code>
                  </td>
                  <td style={td}>
                    {r.model ? (
                      <code style={{ color: 'var(--fg-1)' }}>{r.model}</code>
                    ) : (
                      <span style={{ color: 'var(--fg-3)' }}>—</span>
                    )}
                  </td>
                  <td style={td}>{r.evidenceCount}</td>
                  <td style={td}>{(r.positiveRate * 100).toFixed(0)}%</td>
                  <td style={{ ...td, color: 'var(--fg-2)', maxWidth: 360 }}>
                    {r.reason}
                  </td>
                  <td style={td}>
                    <button
                      type="button"
                      disabled
                      title="Advisory only — Apply ships behind a feature flag in a follow-up phase"
                      style={{
                        padding: '4px 10px',
                        background: 'var(--bg-2, #1a1c1f)',
                        color: 'var(--fg-3)',
                        border: '1px solid var(--border-1, #2a2d33)',
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: 'not-allowed',
                        opacity: 0.55,
                      }}
                    >
                      Apply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 16, color: 'var(--fg-3)', fontSize: 12, maxWidth: 840 }}>
        Phase 13 surfaces aggregated signals from{' '}
        <code>FeedbackLearningService.analyze()</code>. Apply lands in a Sev-2
        follow-up after operators triage real-world feedback for several weeks.
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

export default FeedbackAdvisoriesPage
