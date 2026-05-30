import * as React from 'react'
import {
  Banner,
  Dt,
  type DtCol,
  EmptyInline,
  StatusDot,
} from '../primitives-v3'
import type {
  LlmRegistryRow,
  RouterTuningValues,
  RouterDecisionEntry,
} from '../hooks/useDashboardMetrics'

// ============================================================
// Types
// ============================================================
export interface LabModel {
  id: string
  provider: string
  fca: number
  cost: number
  latency: number
  tier: string
}

export interface ScoreBreakdown {
  cost: number
  latency: number
  quality: number
  toolCalling: number
  reasoning: number
  total: number
  filteredBy: string | null
}

export interface PromptShape {
  hasTools: boolean
  isMultiStep: boolean
  isComplexReasoning: boolean
  isMultiCloud: boolean
  destructive: boolean
  complexityBias: boolean
  estimatedTokens: number
}

// ============================================================
// Helpers
// ============================================================
export function rowToLabModel(row: LlmRegistryRow): LabModel | null {
  const caps = (row.capabilities ?? {}) as Record<string, unknown>
  const costObj = caps.cost as Record<string, unknown> | undefined
  const perfObj = caps.performance as Record<string, unknown> | undefined

  const fca =
    typeof row.functionCallingAccuracy === 'number'
      ? row.functionCallingAccuracy
      : typeof caps.functionCallingAccuracy === 'number'
      ? (caps.functionCallingAccuracy as number)
      : null
  const cost =
    typeof row.inputCostPer1k === 'number'
      ? row.inputCostPer1k
      : typeof costObj?.inputPer1kTokens === 'number'
      ? (costObj.inputPer1kTokens as number)
      : null
  const latency =
    typeof row.avgLatencyMs === 'number'
      ? row.avgLatencyMs
      : typeof perfObj?.avgLatencyMs === 'number'
      ? (perfObj.avgLatencyMs as number)
      : null

  if (fca === null || cost === null) return null
  return {
    id: row.model,
    provider: row.provider,
    fca,
    cost,
    latency: latency ?? 500,
    tier: row.role ?? 'mid',
  }
}

export function analyzePrompt(text: string): PromptShape {
  const lower = text.toLowerCase()
  const hasTools =
    /\b(list|show|query|get|call|use|fetch|inventory|audit|describe|delete|create|provision|deploy|restart|scale)\b/.test(
      lower,
    )
  const isMultiStep =
    /\b(then|after|next|step|phase|first|second|finally)\b/.test(lower) ||
    /\d+[-\s]?(step|phase)/.test(lower)
  const isComplexReasoning =
    /\b(design|architect|plan|strategy|compare|analyze|explain|why|tradeoff|migrate)\b/.test(lower)
  const isMultiCloud =
    ['azure', 'aws', 'gcp', 'google cloud'].filter((k) => lower.includes(k)).length >= 2 ||
    /\bmulticloud\b|\bmulti-cloud\b/.test(lower)
  const destructive =
    /\b(delete|drop|terminate|destroy|purge|wipe|remove)\b/.test(lower) &&
    /\b(resource group|subscription|vm|instance|database|db|cluster|pod|bucket)\b/.test(lower)
  const complexityBias =
    [
      'architecture',
      'diagram',
      'interactive',
      'decoupled',
      'multicloud',
      'multi-cloud',
      'layered',
      'layers',
      'enterprise',
      'scale',
    ].filter((k) => lower.includes(k)).length >= 2
  const estimatedTokens = Math.min(400, Math.max(20, text.length / 4))
  return {
    hasTools,
    isMultiStep,
    isComplexReasoning,
    isMultiCloud,
    destructive,
    complexityBias,
    estimatedTokens,
  }
}

export function getFilterReason(
  m: LabModel,
  t: RouterTuningValues,
  a: PromptShape,
): string | null {
  if (a.destructive && m.fca < t.fcaDestructiveFloor) return 'fcaDestructiveFloor'
  if (a.complexityBias && m.fca < t.fcaComplexityBiasFloor) return 'fcaComplexityBiasFloor'
  if (
    (a.isMultiStep || a.isComplexReasoning || a.isMultiCloud) &&
    m.fca < t.fcaComplexToolFloor
  )
    return 'fcaComplexToolFloor'
  if (a.hasTools && m.fca < t.fcaSimpleToolFloor) return 'fcaSimpleToolFloor'
  if (
    !a.hasTools &&
    !a.isMultiStep &&
    !a.isComplexReasoning &&
    !a.isMultiCloud &&
    m.fca < t.fcaChatPoolFloor
  )
    return 'fcaChatPoolFloor'
  return null
}

export function scoreModel(
  m: LabModel,
  t: RouterTuningValues,
  a: PromptShape,
): ScoreBreakdown {
  const filteredBy = getFilterReason(m, t, a)
  const ceiling = t.costNormalizationCeiling || 0.02
  const cost = (1 - Math.min(m.cost / ceiling, 1)) * t.costBonusMaxPoints * t.costWeight
  const latency =
    (1 - Math.min(m.latency / 1000, 1)) * t.latencyBonusMaxPoints * t.costWeight

  const hasAnyComplexity =
    a.hasTools || a.isMultiStep || a.isComplexReasoning || a.isMultiCloud
  let quality = 0
  if (!t.fcaQualityGatedByComplexity || hasAnyComplexity) {
    const headroom = Math.max(0, m.fca - t.fcaQualityFloor)
    quality = headroom * t.fcaQualityMultiplier * t.qualityWeight
  }
  const toolCalling = a.hasTools
    ? m.fca * t.toolCallingBonusMaxPoints * (0.5 + t.qualityWeight * 0.5)
    : 0
  const reasoning =
    a.isMultiStep || a.isMultiCloud
      ? m.fca * t.reasoningBonusMaxPoints * (0.5 + t.qualityWeight * 0.5)
      : 0
  const total = cost + latency + quality + toolCalling + reasoning
  return { cost, latency, quality, toolCalling, reasoning, total, filteredBy }
}

const fmt2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '—')
const fmt4 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : '—')
const fmtPct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : '—')

// ============================================================
// ScoreBreakdownTable
// ============================================================
export const ScoreBreakdownTable = ({
  run,
  tuning,
  models,
  isLoading,
  isError,
}: {
  run: { text: string; analysis: PromptShape } | null
  tuning: RouterTuningValues
  models: LabModel[]
  isLoading: boolean
  isError: boolean
}) => {
  if (isLoading) return <EmptyInline pad>loading registry…</EmptyInline>
  if (isError) {
    return (
      <Banner level="err" label="error">
        failed to fetch <span className="accent">/api/admin/llm-providers/registry</span>
      </Banner>
    )
  }
  if (models.length === 0) {
    return (
      <EmptyInline pad>
        no enabled models with FCA + cost in the registry — add one from{' '}
        <span className="accent">#provider-mgmt</span>
      </EmptyInline>
    )
  }
  if (!run) {
    return (
      <EmptyInline pad>
        enter a prompt and press <span className="accent">score it</span> to see the per-model
        breakdown.
      </EmptyInline>
    )
  }

  type Row = LabModel & { score: ScoreBreakdown }
  const rows: Row[] = models
    .map((m) => ({ ...m, score: scoreModel(m, tuning, run.analysis) }))
    .sort((a, b) => {
      if (!!a.score.filteredBy !== !!b.score.filteredBy) {
        return a.score.filteredBy ? 1 : -1
      }
      return b.score.total - a.score.total
    })

  const columns: DtCol<Row>[] = [
    {
      key: 'model',
      label: 'MODEL',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={r.score.filteredBy ? 'idle' : 'ok'} />
          <span>{r.id}</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>· {r.provider}</span>
        </span>
      ),
    },
    { key: 'tier', label: 'TIER', className: 'mono', render: (r) => r.tier },
    { key: 'fca', label: 'FCA', className: 'num', render: (r) => fmtPct(r.fca) },
    { key: 'cost', label: '$/1K', className: 'num', render: (r) => `$${fmt4(r.cost)}` },
    { key: 'lat', label: 'LAT', className: 'num', render: (r) => `${Math.round(r.latency)}ms` },
    { key: 'cost-pts', label: 'COST', className: 'num', render: (r) => fmt2(r.score.cost) },
    { key: 'lat-pts', label: 'LAT-PTS', className: 'num', render: (r) => fmt2(r.score.latency) },
    { key: 'qual-pts', label: 'QUAL', className: 'num', render: (r) => fmt2(r.score.quality) },
    { key: 'tool-pts', label: 'TOOLS', className: 'num', render: (r) => fmt2(r.score.toolCalling) },
    { key: 'reason-pts', label: 'REASON', className: 'num', render: (r) => fmt2(r.score.reasoning) },
    {
      key: 'total',
      label: 'TOTAL',
      className: 'num',
      render: (r) =>
        r.score.filteredBy ? (
          <span style={{ color: 'var(--warn)' }}>filtered</span>
        ) : (
          <span style={{ color: 'var(--accent)' }}>{fmt2(r.score.total)}</span>
        ),
    },
    { key: 'reason', label: 'NOTE', className: 'dim', render: (r) => r.score.filteredBy ?? '—' },
  ]

  return (
    <>
      <div
        style={{
          padding: '8px 18px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 11,
          color: 'var(--fg-2)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-1)',
        }}
      >
        analysis: hasTools={String(run.analysis.hasTools)} · multiStep=
        {String(run.analysis.isMultiStep)} · complexReasoning=
        {String(run.analysis.isComplexReasoning)} · multiCloud=
        {String(run.analysis.isMultiCloud)} · destructive=
        {String(run.analysis.destructive)} · complexityBias=
        {String(run.analysis.complexityBias)} · est tokens=
        {Math.round(run.analysis.estimatedTokens)}
      </div>
      <Dt<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyInline pad>no candidates</EmptyInline>}
      />
    </>
  )
}

// ============================================================
// RecentDecisions
// ============================================================
export function extractDecisions(
  resp: { decisions?: RouterDecisionEntry[]; logs?: RouterDecisionEntry[] } | undefined,
): RouterDecisionEntry[] {
  if (!resp) return []
  if (Array.isArray(resp.decisions)) return resp.decisions
  if (Array.isArray(resp.logs)) return resp.logs
  return []
}

export const RecentDecisions = ({
  isLoading,
  isError,
  rows,
}: {
  isLoading: boolean
  isError: boolean
  rows: RouterDecisionEntry[]
}) => {
  if (isLoading) return <EmptyInline pad>loading…</EmptyInline>
  if (isError) {
    return (
      <EmptyInline pad>
        endpoint <span className="accent">/api/admin/router/decisions</span> not available — wire
        it up to populate this feed (TODO)
      </EmptyInline>
    )
  }
  if (rows.length === 0) {
    return (
      <EmptyInline pad>
        no recent decisions captured —{' '}
        <span className="accent">/api/admin/router/decisions</span> returned an empty list
      </EmptyInline>
    )
  }

  const columns: DtCol<RouterDecisionEntry>[] = [
    {
      key: 'ts',
      label: 'WHEN',
      className: 'mono',
      width: '160px',
      render: (r) => (r.timestamp ? new Date(r.timestamp).toUTCString().slice(5, 22) : '—'),
    },
    { key: 'tier', label: 'TIER', className: 'mono', width: '90px', render: (r) => r.tier ?? '—' },
    { key: 'model', label: 'MODEL', className: 'name', render: (r) => r.selectedModelId ?? '—' },
    { key: 'resolved', label: 'RESOLVED BY', className: 'dim', render: (r) => r.resolvedBy ?? '—' },
    {
      key: 'fca',
      label: 'FCA',
      className: 'num',
      render: (r) => (typeof r.fca === 'number' ? fmtPct(r.fca) : '—'),
    },
    {
      key: 'cost',
      label: '$/1K',
      className: 'num',
      render: (r) =>
        typeof r.inputCostPer1k === 'number' ? `$${fmt4(r.inputCostPer1k)}` : '—',
    },
    {
      key: 'lat',
      label: 'LAT',
      className: 'num',
      render: (r) =>
        typeof r.avgLatencyMs === 'number' ? `${Math.round(r.avgLatencyMs)}ms` : '—',
    },
    {
      key: 'score',
      label: 'SCORE',
      className: 'num',
      render: (r) => (typeof r.score === 'number' ? fmt2(r.score) : '—'),
    },
    {
      key: 'prompt',
      label: 'PROMPT',
      className: 'dim',
      render: (r) =>
        r.prompt
          ? r.prompt.length > 80
            ? `${r.prompt.slice(0, 80)}…`
            : r.prompt
          : '—',
    },
  ]

  return (
    <Dt<RouterDecisionEntry>
      columns={columns}
      rows={rows}
      rowKey={(r, i) => r.id ?? r.timestamp ?? String(i)}
      rowDataAttrs={(r: any) => {
        const path = String(r.path ?? r.escalationPath ?? '').toLowerCase()
        const escalated = r.escalated === true || path.includes('escalat')
        return {
          status: escalated ? 'warn' : 'ok',
        }
      }}
      empty={<EmptyInline pad>no decisions</EmptyInline>}
    />
  )
}
