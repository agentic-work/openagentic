import * as React from 'react'
import {
  PageHead,
  Banner,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  Chip,
  Btn,
  SectionBar,
  StatusDot,
} from '../primitives-v3'
import {
  useRouterTuning,
  useLlmRegistry,
  useRouterDecisions,
  type RouterTuningValues,
} from '../hooks/useDashboardMetrics'
import {
  ScoreBreakdownTable,
  RecentDecisions,
  rowToLabModel,
  analyzePrompt,
  extractDecisions,
  type LabModel,
  type PromptShape,
} from './RouterTuningLab'
import { apiRequest } from '@/utils/api'
import {
  useToast,
  ToastStack,
} from './_shared/mutationHelpers'
import { useAdminInvalidate } from '../hooks/useAdminQuery'

// ============================================================
// Defaults — mirror v2 RouterTuningView.DEFAULT_TUNING. Only
// used as a fallback while the API call is in flight; never as
// fabricated data once the request resolves.
// ============================================================
const DEFAULTS: RouterTuningValues = {
  costWeight: 0.5,
  qualityWeight: 0.5,
  costBonusMaxPoints: 25,
  latencyBonusMaxPoints: 10,
  toolCallingBonusMaxPoints: 50,
  reasoningBonusMaxPoints: 30,
  fcaQualityFloor: 0.75,
  fcaQualityMultiplier: 100,
  fcaQualityGatedByComplexity: true,
  costNormalizationCeiling: 0.02,
  fcaChatPoolFloor: 0.82,
  fcaSimpleToolFloor: 0.83,
  fcaComplexToolFloor: 0.9,
  fcaDestructiveFloor: 0.93,
  fcaInfraOpsFloor: 0.85,
  fcaCloudListFloor: 0.9,
  fcaComplexityBiasFloor: 0.93,
  // T3 capability gate (#1049, 2026-05-22) — mirror RouterTuning DB defaults.
  fcaT3Floor: 0.93,
  contextT3Floor: 200_000,
  t3TriggerTaskTypes: [
    'cost-audit',
    'architecture-design-agentic',
    'multi-cloud-agentic',
    'multi-system-agentic',
  ],
  capabilityProfileFloors: {
    'multi-cloud-agentic': 0.9,
    'multi-system-agentic': 0.9,
    'cost-analysis-agentic': 0.9,
    'cost-audit': 0.93,
    'security-audit-agentic': 0.9,
    'architecture-design-agentic': 0.9,
    'single-system-read': 0.85,
    'file-read': 0.85,
    'pure-chat': 0.82,
  },
  capabilityContextFloors: {
    'multi-cloud-agentic': 30_000,
    'multi-system-agentic': 30_000,
    'cost-analysis-agentic': 100_000,
    'cost-audit': 100_000,
    'security-audit-agentic': 30_000,
    'architecture-design-agentic': 30_000,
    'single-system-read': 8_000,
    'file-read': 16_000,
    'pure-chat': 4_000,
  },
  intentClassifierEnabled: true,
  intentClassifierModelId: 'gpt-oss:20b',
}

const fmt2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '—')
const fmt4 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : '—')

const inlineInputStyle: React.CSSProperties = {
  width: 70,
  height: 22,
  padding: '0 6px',
  fontFamily: 'var(--font-v3-mono)',
  fontSize: 12,
  background: 'var(--bg-0)',
  border: '1px solid var(--accent-line)',
  color: 'var(--fg-0)',
  outline: 'none',
}

// ============================================================
// EditableChip — click → inline number input, blur/Enter commits.
// dirty highlighting is rendered by the parent via accent-glow
// border when value differs from saved.
// ============================================================
const EditableChip = ({
  label,
  value,
  isDirty,
  step = 1,
  min,
  max,
  onChange,
  formatter = (v) => String(v),
}: {
  label: string
  value: number
  isDirty: boolean
  step?: number
  min?: number
  max?: number
  onChange: (next: number) => void
  formatter?: (v: number) => React.ReactNode
}) => {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(String(value))
  React.useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const n = Number(draft)
    if (!Number.isFinite(n)) {
      setDraft(String(value))
      setEditing(false)
      return
    }
    let next = n
    if (typeof min === 'number') next = Math.max(min, next)
    if (typeof max === 'number') next = Math.min(max, next)
    onChange(next)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="aw-chip" style={{ borderColor: 'var(--accent)' }}>
        <span className="aw-chip__lab">{label}</span>
        <input
          autoFocus
          type="number"
          value={draft}
          step={step}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(String(value))
              setEditing(false)
            }
          }}
          style={inlineInputStyle}
        />
      </span>
    )
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setEditing(true)
        }
      }}
      className="aw-chip"
      style={{
        borderColor: isDirty ? 'var(--warn)' : 'var(--accent-line)',
        cursor: 'pointer',
        marginRight: 4,
      }}
    >
      <span className="aw-chip__lab">{label}</span>
      <span className="aw-chip__v">{formatter(value)}</span>
    </span>
  )
}

// ============================================================
// EditableKpi — KpiGrid tile with click-to-edit sub
// ============================================================
const EditableKpi = ({
  label,
  value,
  saved,
  step,
  min,
  max,
  onChange,
  sub,
  tone,
}: {
  label: string
  value: number
  saved: number
  step?: number
  min?: number
  max?: number
  onChange: (next: number) => void
  sub: string
  tone?: 'default' | 'warn' | 'ok' | 'err'
}) => {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(String(value))
  React.useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const n = Number(draft)
    if (!Number.isFinite(n)) {
      setDraft(String(value))
      setEditing(false)
      return
    }
    let next = n
    if (typeof min === 'number') next = Math.max(min, next)
    if (typeof max === 'number') next = Math.min(max, next)
    onChange(next)
    setEditing(false)
  }

  const isDirty = value !== saved

  if (editing) {
    return (
      <Kpi
        label={label}
        value={
          <input
            autoFocus
            type="number"
            value={draft}
            step={step}
            min={min}
            max={max}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(String(value))
                setEditing(false)
              }
            }}
            style={{ ...inlineInputStyle, width: 80, height: 26 }}
          />
        }
        sub={`saved=${fmt2(saved)} · ${sub}`}
        tone={tone}
      />
    )
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setEditing(true)
        }
      }}
      style={{ cursor: 'pointer', display: 'block' }}
    >
      <Kpi
        label={label}
        value={fmt2(value)}
        sub={isDirty ? `dirty · was ${fmt2(saved)} · ${sub}` : sub}
        tone={isDirty ? 'warn' : tone}
      />
    </span>
  )
}

// ============================================================
// JsonTuningEditor — textarea + Save/Reset for one JSON-shaped tuning
// field. Added 2026-05-22 (#1049) for the T3 capability-gate JSON
// columns (t3TriggerTaskTypes / capabilityProfileFloors /
// capabilityContextFloors). Shape-validation only; the API does the
// per-key numeric range check.
// ============================================================
const JsonTuningEditor = ({
  field,
  label,
  help,
  value,
  isDirty,
  onCommit,
  validate,
}: {
  field: string
  label: string
  help: string
  value: unknown
  isDirty: boolean
  onCommit: (parsed: unknown) => void
  validate: (parsed: unknown) => string | null
}) => {
  const [draft, setDraft] = React.useState<string>(() => JSON.stringify(value, null, 2))
  const [draftError, setDraftError] = React.useState<string | null>(null)
  const lastSerialized = React.useRef<string>(JSON.stringify(value))

  React.useEffect(() => {
    const serialized = JSON.stringify(value)
    if (serialized !== lastSerialized.current) {
      lastSerialized.current = serialized
      setDraft(JSON.stringify(value, null, 2))
      setDraftError(null)
    }
  }, [value])

  const handleStage = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch (err: any) {
      setDraftError(`invalid JSON: ${err?.message ?? String(err)}`)
      return
    }
    const shapeErr = validate(parsed)
    if (shapeErr) {
      setDraftError(shapeErr)
      return
    }
    setDraftError(null)
    onCommit(parsed)
  }

  const handleRevert = () => {
    setDraft(JSON.stringify(value, null, 2))
    setDraftError(null)
  }

  return (
    <div
      data-testid={`router-tuning-json-editor-${field}`}
      style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--line-1)',
        background: isDirty ? 'color-mix(in srgb, var(--warn) 8%, var(--bg-1))' : 'var(--bg-1)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--fg-3)',
          marginBottom: 4,
        }}
      >
        {label}
        {isDirty && <span style={{ marginLeft: 8, color: 'var(--warn)' }}>· unsaved</span>}
      </div>
      <p style={{ color: 'var(--fg-3)', fontSize: 12, margin: '0 0 8px' }}>{help}</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: 120,
          background: 'var(--bg-0)',
          border: `1px solid ${draftError ? 'var(--err)' : isDirty ? 'var(--warn)' : 'var(--line-1)'}`,
          color: 'var(--fg-0)',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 12,
          padding: '8px 10px',
          outline: 'none',
          resize: 'vertical',
        }}
        aria-label={`Edit ${label}`}
      />
      {draftError && (
        <div style={{ color: 'var(--err)', fontSize: 12, marginTop: 6 }}>{draftError}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Btn variant="primary" onClick={handleStage}>
          stage edit
        </Btn>
        <Btn variant="ghost" onClick={handleRevert}>
          revert
        </Btn>
      </div>
    </div>
  )
}

// ============================================================
// Page
// ============================================================
export const RouterTuningPage: React.FC = () => {
  const tuningQ = useRouterTuning()
  const registryQ = useLlmRegistry(true)
  const decisionsQ = useRouterDecisions(20)
  const toast = useToast()
  const invalidate = useAdminInvalidate()

  const savedTuning: RouterTuningValues = tuningQ.data?.tuning ?? DEFAULTS

  const [dirty, setDirty] = React.useState<Partial<RouterTuningValues>>({})
  const [saving, setSaving] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)

  // Effective tuning = saved + dirty overrides
  const tuning: RouterTuningValues = { ...savedTuning, ...dirty }
  const dirtyCount = Object.keys(dirty).length

  const setVal = <K extends keyof RouterTuningValues>(key: K, value: RouterTuningValues[K]) => {
    setDirty((prev) => {
      const savedVal = (savedTuning as any)[key]
      // Use JSON-stringify equality for JSON-shaped fields (arrays /
      // objects); reference equality is wrong for those.
      const sameAsSaved =
        typeof value === 'object' && value !== null
          ? JSON.stringify(value) === JSON.stringify(savedVal)
          : value === savedVal
      if (sameAsSaved) {
        const { [key]: _drop, ...rest } = prev as any
        return rest as Partial<RouterTuningValues>
      }
      return { ...prev, [key]: value }
    })
  }
  const isDirtyKey = (k: keyof RouterTuningValues) => k in dirty

  const handleDiscard = () => setDirty({})

  const handleSave = async () => {
    if (dirtyCount === 0) return
    setSaving(true)
    try {
      const res = await apiRequest('/api/admin/router-tuning', {
        method: 'PUT',
        body: JSON.stringify(dirty),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        toast.show('err', 'save failed', t.slice(0, 200) || `HTTP ${res.status}`)
        return
      }
      toast.show('ok', 'saved', `applied ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`)
      setDirty({})
      invalidate(['router-tuning'])
    } catch (err: any) {
      toast.show('err', 'save failed', err?.message ?? 'unknown')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      const res = await apiRequest('/api/admin/router-tuning/reset', { method: 'POST' })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        toast.show('err', 'reset failed', t.slice(0, 200) || `HTTP ${res.status}`)
        return
      }
      toast.show('ok', 'reset', 'router tuning reset to defaults')
      setDirty({})
      invalidate(['router-tuning'])
    } catch (err: any) {
      toast.show('err', 'reset failed', err?.message ?? 'unknown')
    } finally {
      setResetting(false)
    }
  }

  // ============================================================
  // Lab — local "score it" first uses client-side breakdown for
  // fast feedback, then upgrades to server simulate result if avail.
  // ============================================================
  const [labQuery, setLabQuery] = React.useState(
    'compare our azure vs aws spend and explain the drivers',
  )
  const [labRun, setLabRun] = React.useState<{ text: string; analysis: PromptShape } | null>(null)
  const [simulating, setSimulating] = React.useState(false)
  const [simResult, setSimResult] = React.useState<any | null>(null)
  const [simError, setSimError] = React.useState<string | null>(null)

  const runLab = async () => {
    const text = labQuery.trim()
    if (!text) return
    // Client-side analysis for the immediate breakdown table
    setLabRun({ text, analysis: analyzePrompt(text) })
    // Server-side simulate for the "what would the router actually do" comparison
    setSimulating(true)
    setSimError(null)
    setSimResult(null)
    try {
      const res = await apiRequest('/api/admin/router-tuning/simulate', {
        method: 'POST',
        body: JSON.stringify({ prompt: text }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        setSimError(t.slice(0, 200) || `HTTP ${res.status}`)
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.success === false) {
        setSimError(data?.message || 'simulate failed')
        return
      }
      setSimResult(data)
    } catch (err: any) {
      setSimError(err?.message ?? 'simulate failed')
    } finally {
      setSimulating(false)
    }
  }

  const labModels: LabModel[] = React.useMemo(() => {
    const rows = registryQ.data ?? []
    return rows.map(rowToLabModel).filter((m): m is LabModel => m != null)
  }, [registryQ.data])
  const skippedCount = (registryQ.data?.length ?? 0) - labModels.length

  const podBadge =
    typeof tuningQ.data?.podCount === 'number'
      ? `${tuningQ.data.podCount} pods synced`
      : 'pods unknown'
  const lastUpdatedBadge = tuningQ.data?.lastUpdatedAt
    ? `last updated ${new Date(tuningQ.data.lastUpdatedAt).toUTCString()}`
    : 'never updated'

  return (
    <>
      <PageHead
        title="Router Tuning"
        meta={
          <>
            Smart Router scoring weights
            <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
            <StatusDot status={tuningQ.isError ? 'err' : 'ok'} />
            <span style={{ marginLeft: 6 }}>{podBadge}</span>
            <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
            <span>{lastUpdatedBadge}</span>
            {dirtyCount > 0 && (
              <>
                <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
                <span style={{ color: 'var(--warn)' }}>
                  {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Btn variant="ghost" onClick={handleDiscard} disabled={dirtyCount === 0 || saving}>
              {dirtyCount > 0 ? `discard (${dirtyCount})` : 'discard'}
            </Btn>
            <Btn variant="ghost" onClick={handleReset} disabled={resetting || saving}>
              {resetting ? 'resetting…' : 'reset'}
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSave}
              disabled={dirtyCount === 0 || saving || resetting}
            >
              {saving ? 'saving…' : 'save & apply live'}
            </Btn>
          </>
        }
      />

      <ToastStack api={toast} />

      {tuningQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/router-tuning</span> — values below
          fall back to defaults
        </Banner>
      )}
      <Banner level="info" label="rule of thumb">
        a 0.1 weight change typically shifts 10–30% of routed traffic — exercise the Live Scoring
        Lab before saving.
      </Banner>
      {/* Phase I-7: vocabulary legend so first-time operators don't have
          to reverse-engineer the abbreviations from the chips below. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          padding: '8px 18px',
          borderBottom: '1px solid var(--line-1)',
          background: 'var(--bg-1)',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-3)',
        }}
      >
        <span><span style={{ color: 'var(--fg-1)' }}>FCA</span> Function-Calling Accuracy floor — drops models below threshold from the chat pool</span>
        <span><span style={{ color: 'var(--fg-1)' }}>cost</span> $/1M-tokens cost weight — higher value penalizes expensive models</span>
        <span><span style={{ color: 'var(--fg-1)' }}>latency</span> p95 ms cost weight — higher value penalizes slow models</span>
        <span><span style={{ color: 'var(--fg-1)' }}>quality</span> benchmark blend (BFCL + MMLU + agent suite) — higher value rewards smarter models</span>
      </div>

      {/* ============== Scoring Formula ============== */}
      <SectionBar
        title="scoring formula"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            click any chip to edit · live preview below
          </span>
        }
      />
      <div
        style={{
          padding: '16px 18px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 14,
          color: 'var(--fg-1)',
          lineHeight: 2.4,
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-1)',
        }}
      >
        <EditableChip
          label="costBonus"
          value={tuning.costBonusMaxPoints}
          isDirty={isDirtyKey('costBonusMaxPoints')}
          min={0}
          max={500}
          onChange={(v) => setVal('costBonusMaxPoints', v)}
        />
        <span style={{ color: 'var(--fg-3)' }}> × </span>
        <EditableChip
          label="costWeight"
          value={tuning.costWeight}
          isDirty={isDirtyKey('costWeight')}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) => setVal('costWeight', v)}
          formatter={(v) => fmt2(v)}
        />
        <span style={{ color: 'var(--fg-3)' }}> + </span>
        <EditableChip
          label="qualityFloor"
          value={tuning.fcaQualityFloor}
          isDirty={isDirtyKey('fcaQualityFloor')}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaQualityFloor', v)}
          formatter={(v) => `FCA−${fmt2(v)}`}
        />
        <span style={{ color: 'var(--fg-3)' }}> × </span>
        <EditableChip
          label="×"
          value={tuning.fcaQualityMultiplier}
          isDirty={isDirtyKey('fcaQualityMultiplier')}
          min={0}
          max={1000}
          onChange={(v) => setVal('fcaQualityMultiplier', v)}
        />
        <span style={{ color: 'var(--fg-3)' }}> × </span>
        <EditableChip
          label="qualityWeight"
          value={tuning.qualityWeight}
          isDirty={isDirtyKey('qualityWeight')}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) => setVal('qualityWeight', v)}
          formatter={(v) => fmt2(v)}
        />
        <label
          style={{
            marginLeft: 8,
            fontSize: 9,
            padding: '1px 6px',
            border: '1px solid var(--accent-line)',
            color: 'var(--accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <input
            type="checkbox"
            checked={tuning.fcaQualityGatedByComplexity}
            onChange={(e) => setVal('fcaQualityGatedByComplexity', e.target.checked)}
            style={{ margin: 0 }}
          />
          gated by complexity
        </label>
        <br />
        <span style={{ color: 'var(--fg-3)' }}>+ </span>
        <EditableChip
          label="latencyBonus"
          value={tuning.latencyBonusMaxPoints}
          isDirty={isDirtyKey('latencyBonusMaxPoints')}
          min={0}
          max={500}
          onChange={(v) => setVal('latencyBonusMaxPoints', v)}
        />
        <span style={{ color: 'var(--fg-3)' }}> × </span>
        <EditableChip
          label="costWeight"
          value={tuning.costWeight}
          isDirty={isDirtyKey('costWeight')}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) => setVal('costWeight', v)}
          formatter={(v) => fmt2(v)}
        />
        <span style={{ color: 'var(--fg-3)' }}> + </span>
        <EditableChip
          label="toolCallingBonus"
          value={tuning.toolCallingBonusMaxPoints}
          isDirty={isDirtyKey('toolCallingBonusMaxPoints')}
          min={0}
          max={500}
          onChange={(v) => setVal('toolCallingBonusMaxPoints', v)}
        />
        <span style={{ color: 'var(--fg-3)', marginLeft: 4 }}>if hasTools</span>
        <span style={{ color: 'var(--fg-3)' }}> + </span>
        <EditableChip
          label="reasoningBonus"
          value={tuning.reasoningBonusMaxPoints}
          isDirty={isDirtyKey('reasoningBonusMaxPoints')}
          min={0}
          max={500}
          onChange={(v) => setVal('reasoningBonusMaxPoints', v)}
        />
        <span style={{ color: 'var(--fg-3)', marginLeft: 4 }}>if multi-step</span>
        <span style={{ color: 'var(--fg-3)' }}> · </span>
        <EditableChip
          label="costCeiling"
          value={tuning.costNormalizationCeiling}
          isDirty={isDirtyKey('costNormalizationCeiling')}
          step={0.001}
          min={0}
          max={1}
          onChange={(v) => setVal('costNormalizationCeiling', v)}
          formatter={(v) => fmt4(v)}
        />
        <span style={{ color: 'var(--fg-3)', marginLeft: 4 }}>$/1k</span>
      </div>

      {/* ============== FCA Floors ============== */}
      <SectionBar
        title="fca floors"
        count={6}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            click any tile to edit · exclusion filters applied before scoring
          </span>
        }
      />
      <KpiGrid cols={6}>
        <EditableKpi
          label="fcaChatPoolFloor"
          value={tuning.fcaChatPoolFloor}
          saved={savedTuning.fcaChatPoolFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaChatPoolFloor', v)}
          sub="kicks low-FCA out of chat"
        />
        <EditableKpi
          label="fcaSimpleToolFloor"
          value={tuning.fcaSimpleToolFloor}
          saved={savedTuning.fcaSimpleToolFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaSimpleToolFloor', v)}
          sub="single-round tools"
        />
        <EditableKpi
          label="fcaComplexToolFloor"
          value={tuning.fcaComplexToolFloor}
          saved={savedTuning.fcaComplexToolFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaComplexToolFloor', v)}
          sub="multi-step chains"
        />
        <EditableKpi
          label="fcaDestructiveFloor"
          value={tuning.fcaDestructiveFloor}
          saved={savedTuning.fcaDestructiveFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaDestructiveFloor', v)}
          tone="warn"
          sub="delete · drop · terminate"
        />
        <EditableKpi
          label="fcaInfraOpsFloor"
          value={tuning.fcaInfraOpsFloor}
          saved={savedTuning.fcaInfraOpsFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaInfraOpsFloor', v)}
          sub="provision · rebuild · query RG"
        />
        <EditableKpi
          label="fcaComplexityBiasFloor"
          value={tuning.fcaComplexityBiasFloor}
          saved={savedTuning.fcaComplexityBiasFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaComplexityBiasFloor', v)}
          tone="warn"
          sub="≥ 2 complexity keywords"
        />
      </KpiGrid>

      {/* ============== T3 capability gate (#1049, 2026-05-22) ============== */}
      <SectionBar
        title="t3 capability gate"
        count={5}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            structural classifier only · no lexical safety-net
          </span>
        }
      />
      <KpiGrid cols={2}>
        <EditableKpi
          label="fcaT3Floor"
          value={tuning.fcaT3Floor}
          saved={savedTuning.fcaT3Floor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => setVal('fcaT3Floor', v)}
          tone="warn"
          sub="T3 FCA floor (default 0.93)"
        />
        <EditableKpi
          label="contextT3Floor"
          value={tuning.contextT3Floor}
          saved={savedTuning.contextT3Floor}
          step={1000}
          min={0}
          onChange={(v) => setVal('contextT3Floor', Math.round(v))}
          tone="warn"
          sub="T3 context floor in tokens (default 200000)"
        />
      </KpiGrid>
      <Panel>
        <JsonTuningEditor
          field="t3TriggerTaskTypes"
          label="t3TriggerTaskTypes"
          help="JSON array of TaskType identifiers that fire the T3 gate."
          value={tuning.t3TriggerTaskTypes}
          isDirty={isDirtyKey('t3TriggerTaskTypes')}
          onCommit={(parsed) => setVal('t3TriggerTaskTypes', parsed as string[])}
          validate={(p) => {
            if (!Array.isArray(p)) return 'must be a JSON array of strings'
            if (!p.every((s) => typeof s === 'string')) return 'all entries must be strings'
            return null
          }}
        />
        <JsonTuningEditor
          field="capabilityProfileFloors"
          label="capabilityProfileFloors"
          help="JSON object map { TaskType: FCA-floor }. Replaces hardcoded CAPABILITY_PROFILES literals."
          value={tuning.capabilityProfileFloors}
          isDirty={isDirtyKey('capabilityProfileFloors')}
          onCommit={(parsed) =>
            setVal(
              'capabilityProfileFloors',
              parsed as Record<string, number>,
            )
          }
          validate={(p) => {
            if (p === null || typeof p !== 'object' || Array.isArray(p)) return 'must be a JSON object'
            for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
              if (typeof v !== 'number' || isNaN(v as number)) return `value at "${k}" must be a number`
              if ((v as number) < 0 || (v as number) > 1) return `value at "${k}" must be in [0, 1]`
            }
            return null
          }}
        />
        <JsonTuningEditor
          field="capabilityContextFloors"
          label="capabilityContextFloors"
          help="JSON object map { TaskType: context-window-token-floor }."
          value={tuning.capabilityContextFloors}
          isDirty={isDirtyKey('capabilityContextFloors')}
          onCommit={(parsed) =>
            setVal(
              'capabilityContextFloors',
              parsed as Record<string, number>,
            )
          }
          validate={(p) => {
            if (p === null || typeof p !== 'object' || Array.isArray(p)) return 'must be a JSON object'
            for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
              if (typeof v !== 'number' || isNaN(v as number) || !Number.isInteger(v)) return `value at "${k}" must be an integer`
              if ((v as number) < 0) return `value at "${k}" must be ≥ 0`
            }
            return null
          }}
        />
      </Panel>

      {/* ============== Live Scoring Lab ============== */}
      <SectionBar
        title="live scoring lab"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            client-side breakdown · simulate without saving
          </span>
        }
      />
      <Panel>
        <PanelHead
          title="prompt"
          right={
            <span style={{ color: 'var(--fg-3)' }}>
              {labModels.length} model{labModels.length === 1 ? '' : 's'} available
              {skippedCount > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--warn)' }}>
                  · {skippedCount} skipped (missing FCA / cost)
                </span>
              )}
              {simulating && (
                <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· simulating…</span>
              )}
            </span>
          }
        />
        <div
          style={{
            padding: '12px 18px',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            borderBottom: '1px solid var(--line-1)',
            background: 'var(--bg-1)',
          }}
        >
          <Chip
            label="easy"
            value="why is the sky blue?"
            onClick={() => setLabQuery('why is the sky blue?')}
          />
          <Chip
            label="medium"
            value="multi-step infra"
            onClick={() =>
              setLabQuery(
                'Provision an AKS cluster in eastus2 then deploy my helm chart',
              )
            }
          />
          <Chip
            label="hard"
            value="multicloud cost"
            onClick={() =>
              setLabQuery(
                'compare our azure vs aws spend over the last 90 days and explain the drivers',
              )
            }
          />
          <input
            type="text"
            value={labQuery}
            onChange={(e) => setLabQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runLab()
            }}
            placeholder="enter a prompt to score…"
            style={{
              flex: 1,
              minWidth: 280,
              height: 28,
              padding: '0 10px',
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 12,
              background: 'var(--bg-0)',
              border: '1px solid var(--line-1)',
              color: 'var(--fg-0)',
              outline: 'none',
            }}
          />
          <Btn variant="primary" onClick={runLab} disabled={simulating}>
            {simulating ? 'scoring…' : 'score it →'}
          </Btn>
        </div>
        {simError && (
          <Banner level="warn" label="simulate">
            server simulate unavailable ({simError}) — using client-side breakdown only
          </Banner>
        )}
        {simResult?.decision && (
          <Banner level="info" label="server pick">
            <span className="mono">{simResult.decision.selectedModelId}</span> ·{' '}
            {simResult.decision.tier ?? 'unspecified tier'} · resolved by{' '}
            <span className="mono">{simResult.decision.resolvedBy}</span>
          </Banner>
        )}
        <ScoreBreakdownTable
          run={labRun}
          tuning={tuning}
          models={labModels}
          isLoading={registryQ.isLoading}
          isError={registryQ.isError}
        />
      </Panel>

      {/* ============== Recent Decisions ============== */}
      <SectionBar
        title="recent routing decisions"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            last 20 · /api/admin/router/decisions
          </span>
        }
      />
      <Panel>
        <RecentDecisions
          isLoading={decisionsQ.isLoading}
          isError={decisionsQ.isError}
          rows={extractDecisions(decisionsQ.data)}
        />
      </Panel>

    </>
  )
}

export default RouterTuningPage
