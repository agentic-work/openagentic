/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Prompts domain — the admin-v4 page bodies for the four Prompts leaves, at
 * mock fidelity (the admin-console mock invSet 'prompt-modules' /
 * 'pipeline-settings' / 'prompt-effectiveness' / 'prompt-metrics') and WIRED
 * to the real admin prompt routes. Every number comes from a live hook or
 * renders an honest "—"; never a fabricated value. Every color resolves via a
 * global theme token (var(--*)); zero hex.
 *
 * Each component renders ONLY the page BODY (PageHead + content). AdminConsole
 * appends the OptionSpec (the two-part leaf contract), so these never render
 * their own optionSpec.
 *
 * Data sources (all real admin routes):
 *   prompt-modules        → GET /api/admin/rbac-system-prompts ({ roles })
 *                         + GET /api/admin/service-prompts      ({ prompts })
 *   pipeline-settings     → GET /api/admin/pipeline/summary      ({ config, … })
 *   prompt-effectiveness  → GET /api/admin/prompts/effectiveness (moduleUsage …)
 *   prompt-metrics        → GET /api/admin/prompts/effectiveness (token figures)
 */
import * as React from 'react'
import {
  Banner,
  Btn,
  DataTable,
  FormSection,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  Tag,
  Toggle,
  type DtColumn,
  type FormRow,
  type Kpi,
} from '../primitives'
import { HBars, type HBarItem } from '../primitives'
import type { Tone } from '../types'
import type { LeafPageProps } from './registry'
import { useAdminQuery, useAdminMutation } from '../../hooks/useAdminQuery'

/* ============================================================
 * format helpers (honest "—" on missing)
 * ============================================================ */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n)}%`
}
function fmtDate(d: string | Date | null | undefined): string {
  if (d == null) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  const z = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${z(dt.getUTCMonth() + 1)}-${z(dt.getUTCDate())}`
}
/** Stringify any unknown payload so it can NEVER render as a JSX object child. */
function safeStr(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/* ============================================================
 * prompt-modules — /api/admin/rbac-system-prompts + /api/admin/service-prompts
 *
 * Mock columns: Module | Tier | Tenant scope | Version | Updated | Enabled | actions
 * Tier filter chips: all | system | behavioral | tool. Search. Detail side-panel.
 * ============================================================ */

interface RbacPromptRoleRow {
  role_key: string
  active_version: number | null
  active_id: string | null
  active_updated_at: string | null
  total_versions: number
  preview: string | null
  unseeded?: boolean
}
interface RbacSystemPromptsResponse {
  roles?: RbacPromptRoleRow[]
}

interface ServicePromptKeyRow {
  prompt_key: string
  version: number | null
  updated_at: string | null
  description: string | null
  preview: string | null
}
interface ServicePromptsResponse {
  prompts?: ServicePromptKeyRow[]
}

/** A unified prompt-module row spanning both source endpoints. */
interface ModuleRow extends Record<string, unknown> {
  id: string
  name: string
  tier: 'system' | 'behavioral' | 'tool'
  tenantScope: string
  version: number | null
  updatedAt: string | null
  enabled: boolean
  preview: string | null
  source: 'rbac' | 'service'
}

const TIER_TONE: Record<ModuleRow['tier'], Tone> = {
  system: 'err',
  behavioral: 'accent',
  tool: 'info',
}

/**
 * Classify a service-prompt key into the mock's 3-tier taxonomy. The behavioral
 * chatmode sections are seeded with `chatmode_*` / clarify / artifact / grounding
 * keys (see DEFAULT_SERVICE_PROMPTS); tool/title/summary keys are the tool tier;
 * everything else falls to behavioral. RBAC role bodies are always Layer-1 system.
 */
function classifyServiceKey(key: string): ModuleRow['tier'] {
  const k = key.toLowerCase()
  if (
    k.includes('clarif') ||
    k.includes('artifact') ||
    k.includes('grounding') ||
    k.includes('behavior') ||
    k.includes('safety') ||
    k.includes('output') ||
    k.includes('structure') ||
    k.includes('visual') ||
    k.includes('cost')
  ) {
    return 'behavioral'
  }
  if (k.includes('tool') || k.includes('title') || k.includes('summary') || k.includes('slack')) {
    return 'tool'
  }
  return 'behavioral'
}

function PromptModulesPage({ leafId }: LeafPageProps) {
  const rbac = useAdminQuery<RbacSystemPromptsResponse>(
    ['prompts', 'rbac-system-prompts'],
    '/api/admin/rbac-system-prompts',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const service = useAdminQuery<ServicePromptsResponse>(
    ['prompts', 'service-prompts'],
    '/api/admin/service-prompts',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const [selected, setSelected] = React.useState<ModuleRow | null>(null)

  const rows: ModuleRow[] = React.useMemo(() => {
    const out: ModuleRow[] = []
    for (const r of rbac.data?.roles ?? []) {
      out.push({
        id: `rbac:${r.role_key}`,
        name: `${r.role_key} (Layer-1 identity)`,
        tier: 'system',
        // tenant scope is normalized server-side; the list route is caller-scoped.
        tenantScope: 'platform',
        version: r.active_version,
        updatedAt: r.active_updated_at,
        enabled: !r.unseeded && r.active_version != null,
        preview: r.preview,
        source: 'rbac',
      })
    }
    for (const p of service.data?.prompts ?? []) {
      out.push({
        id: `service:${p.prompt_key}`,
        name: p.prompt_key,
        tier: classifyServiceKey(p.prompt_key),
        tenantScope: 'platform',
        version: p.version,
        updatedAt: p.updated_at,
        enabled: p.version != null,
        preview: p.preview ?? p.description,
        source: 'service',
      })
    }
    return out
  }, [rbac.data, service.data])

  const isLoading = rbac.isLoading || service.isLoading
  const isError = rbac.isError && service.isError

  const counts = React.useMemo(() => {
    const c = { system: 0, behavioral: 0, tool: 0 }
    for (const r of rows) c[r.tier] += 1
    return c
  }, [rows])

  const cols: DtColumn<ModuleRow>[] = [
    {
      key: 'name',
      label: 'Module',
      val: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <Tag>{r.source}</Tag>
        </span>
      ),
    },
    {
      key: 'tier',
      label: 'Tier',
      val: (r) => r.tier,
      render: (r) => (
        <Pill tone={TIER_TONE[r.tier]} dot>
          {r.tier}
        </Pill>
      ),
    },
    {
      key: 'tenantScope',
      label: 'Tenant scope',
      val: (r) => r.tenantScope,
      render: (r) => <span style={{ color: 'var(--fg-2)' }}>{r.tenantScope}</span>,
    },
    {
      key: 'version',
      label: 'Version',
      r: true,
      val: (r) => r.version ?? -1,
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)' }}>
          {r.version != null ? `v${r.version}` : '—'}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      label: 'Updated',
      val: (r) => r.updatedAt ?? '',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-3)' }}>
          {fmtDate(r.updatedAt)}
        </span>
      ),
    },
    {
      key: 'enabled',
      label: 'Enabled',
      val: (r) => (r.enabled ? 1 : 0),
      render: (r) => <Toggle on={r.enabled} />,
    },
    {
      label: '',
      r: true,
      render: (r) => (
        <Btn
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            setSelected(r)
          }}
        >
          details
        </Btn>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Modules"
        sub="DB-backed, versioned, per-tenant prompt modules"
        mode="hitl"
        actions={[{ label: 'New module', ic: '+ ', primary: true }]}
      />

      {isError && (
        <Banner tone="err">
          Could not load prompt modules — the rbac-system-prompts and
          service-prompts routes both returned an error.
        </Banner>
      )}
      {!isError && isLoading && <Banner tone="info">Loading prompt modules…</Banner>}

      {!isLoading && !isError && (
        <DataTable<ModuleRow>
          cols={cols}
          rows={rows}
          search="module, tag…"
          onRow={(r) => setSelected(r)}
          dimKey="enabled"
          empty="No prompt modules seeded yet."
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'system', label: 'system', cnt: counts.system },
              { id: 'behavioral', label: 'behavioral', cnt: counts.behavioral },
              { id: 'tool', label: 'tool', cnt: counts.tool },
            ],
            filter: (row, chip) => (chip === 'all' ? true : (row as ModuleRow).tier === chip),
          }}
        />
      )}

      {selected && (
        <div className="awc-chartcard" style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15 }}>{selected.name}</span>
            <Pill tone={TIER_TONE[selected.tier]} dot>
              {selected.tier}
            </Pill>
            {selected.tier === 'system' && (
              <Pill tone="warn" dot>
                edit · HITL
              </Pill>
            )}
            <Btn
              size="sm"
              variant="ghost"
              style={{ marginLeft: 'auto' }}
              onClick={() => setSelected(null)}
            >
              close
            </Btn>
          </div>
          <div className="awc-grid2">
            <FormSection
              title="Overview"
              mode="readonly"
              rows={[
                { label: 'Source', type: 'text', value: selected.source, locked: true },
                { label: 'Tier', type: 'text', value: selected.tier, locked: true },
                { label: 'Tenant scope', type: 'text', value: selected.tenantScope, locked: true },
                {
                  label: 'Active version',
                  type: 'text',
                  value: selected.version != null ? `v${selected.version}` : '—',
                  locked: true,
                },
                { label: 'Updated', type: 'text', value: fmtDate(selected.updatedAt), locked: true },
              ]}
            />
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 12.5,
                  color: 'var(--fg-2)',
                  marginBottom: 6,
                }}
              >
                Active body preview
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--line-1)',
                  background: 'var(--bg-2)',
                  color: 'var(--fg-1)',
                  fontFamily: 'var(--font-v3-mono)',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 260,
                  overflow: 'auto',
                }}
              >
                {selected.preview ? safeStr(selected.preview) : 'No preview available.'}
              </pre>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Btn size="sm" variant="primary">
                  Edit{selected.tier === 'system' ? ' · HITL' : ''}
                </Btn>
                <Btn size="sm">Versions</Btn>
                <Btn size="sm">Diff</Btn>
                <Btn size="sm">Rollback</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ============================================================
 * pipeline-settings — /api/admin/pipeline/summary
 *
 * Mock: layers section (system / behavioral / tool order + grounding toggle),
 * behavior section (clarifyFirst / artifactForce / groundingDefault), save (HITL).
 * The summary route exposes the live pipeline config flags; we surface those.
 * ============================================================ */

interface PipelineSummaryConfig {
  enableMCP?: boolean
  enablePromptEngineering?: boolean
  enableCoT?: boolean
  enableRAG?: boolean
  enableCaching?: boolean
  enableAnalytics?: boolean
  maxConcurrentRequests?: number
  requestTimeoutMs?: number
}
interface PipelineSummaryResponse {
  config?: PipelineSummaryConfig
  promptStatus?: string
  mcpStatus?: string
  cacheStatus?: string
  analyticsStatus?: string
  enabledTechniques?: string[]
}

/* ============================================================
 * Grounding domain policy — admin block/allow-list for web grounding
 * (2026-06-22). Reads + writes the per-tenant `grounding.domain_policy`
 * service-prompt key (JSON body) via the existing service-prompts CRUD route.
 * The grounding pipeline filters web sources through this policy; the default
 * competitor list (anthropic.com, openai.com, …) is merged server-side, so
 * leaving the block list empty still suppresses competitor sites.
 * ============================================================ */

interface DomainPolicyBody {
  groundingBlockedDomains: string[]
  groundingAllowedDomains?: string[]
  includeDefaultCompetitors?: boolean
}
interface ServicePromptGetResponse {
  prompt_key?: string
  body?: string
}

/** Newline/comma-separated textarea ⇆ string[] helpers. */
function linesToDomains(s: string): string[] {
  return s
    .split(/[\n,]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 0)
}
function domainsToLines(arr: string[] | undefined): string {
  return (arr ?? []).join('\n')
}

function GroundingDomainPolicyCard() {
  const q = useAdminQuery<ServicePromptGetResponse>(
    ['prompts', 'grounding-domain-policy'],
    '/api/admin/service-prompts/grounding.domain_policy',
    { staleTime: 30_000 },
  )

  const save = useAdminMutation<unknown, DomainPolicyBody>(
    '/api/admin/service-prompts/grounding.domain_policy',
    {
      method: 'POST',
      invalidateKeys: [['prompts', 'grounding-domain-policy']],
      // The route body is { body: string, reason?: string } — stringify the
      // policy JSON into `body`.
      bodyOf: (vars) => ({
        body: JSON.stringify(vars, null, 2),
        reason: 'admin edit — grounding domain block/allow-list',
      }),
    },
  )

  // Parse the stored JSON body into editable local state.
  const parsed: DomainPolicyBody = React.useMemo(() => {
    const raw = q.data?.body
    if (typeof raw !== 'string' || raw.trim() === '') {
      return { groundingBlockedDomains: [], groundingAllowedDomains: [], includeDefaultCompetitors: true }
    }
    try {
      const j = JSON.parse(raw)
      return {
        groundingBlockedDomains: Array.isArray(j.groundingBlockedDomains)
          ? j.groundingBlockedDomains.filter((x: unknown) => typeof x === 'string')
          : [],
        groundingAllowedDomains: Array.isArray(j.groundingAllowedDomains)
          ? j.groundingAllowedDomains.filter((x: unknown) => typeof x === 'string')
          : [],
        includeDefaultCompetitors: j.includeDefaultCompetitors !== false,
      }
    } catch {
      return { groundingBlockedDomains: [], groundingAllowedDomains: [], includeDefaultCompetitors: true }
    }
  }, [q.data?.body])

  const [blocked, setBlocked] = React.useState('')
  const [allowed, setAllowed] = React.useState('')
  const [includeDefaults, setIncludeDefaults] = React.useState(true)
  const [dirty, setDirty] = React.useState(false)

  // Hydrate local editor state once the fetched policy lands (and on refetch
  // when the user has not made unsaved edits).
  React.useEffect(() => {
    if (dirty) return
    setBlocked(domainsToLines(parsed.groundingBlockedDomains))
    setAllowed(domainsToLines(parsed.groundingAllowedDomains))
    setIncludeDefaults(parsed.includeDefaultCompetitors !== false)
  }, [parsed, dirty])

  const onSave = () => {
    save.mutate(
      {
        groundingBlockedDomains: linesToDomains(blocked),
        groundingAllowedDomains: linesToDomains(allowed),
        includeDefaultCompetitors: includeDefaults,
      },
      { onSuccess: () => setDirty(false) },
    )
  }

  const taStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 96,
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--line-1)',
    background: 'var(--bg-2)',
    color: 'var(--fg-1)',
    fontFamily: 'var(--font-v3-mono)',
    fontSize: 12.5,
    resize: 'vertical',
  }

  return (
    <div className="awc-chartcard" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Grounding domain policy</span>
        <Pill tone="accent" dot>
          web sources
        </Pill>
        {dirty && (
          <Pill tone="warn" dot>
            unsaved
          </Pill>
        )}
      </div>
      <div style={{ color: 'var(--fg-2)', fontSize: 12.5, marginBottom: 12 }}>
        Block (or allow-list) the sites the assistant may search/ground/cite. One
        domain per line. Subdomain-aware — blocking <code>anthropic.com</code> also
        blocks <code>www.anthropic.com</code>. Competitor AI-vendor sites are
        suppressed by default.
      </div>

      {q.isError && (
        <Banner tone="err">
          Could not load the grounding domain policy —
          /api/admin/service-prompts/grounding.domain_policy returned an error.
        </Banner>
      )}
      {!q.isError && q.isLoading && <Banner tone="info">Loading grounding domain policy…</Banner>}

      <div className="awc-grid2" style={{ gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--fg-2)', marginBottom: 6 }}>
            Blocked domains
          </div>
          <textarea
            style={taStyle}
            value={blocked}
            placeholder={'example.com\ninternal-vendor.io'}
            onChange={(e) => {
              setBlocked(e.target.value)
              setDirty(true)
            }}
          />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--fg-2)', marginBottom: 6 }}>
            Allowed domains (optional)
          </div>
          <textarea
            style={taStyle}
            value={allowed}
            placeholder={'leave empty for block-list-only mode'}
            onChange={(e) => {
              setAllowed(e.target.value)
              setDirty(true)
            }}
          />
          <div style={{ color: 'var(--fg-3)', fontSize: 11.5, marginTop: 4 }}>
            When non-empty, ONLY these domains may be grounded/cited.
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--line-1)',
        }}
      >
        <Toggle
          on={includeDefaults}
          onClick={() => {
            setIncludeDefaults((v) => !v)
            setDirty(true)
          }}
        />
        <span style={{ fontSize: 12.5, color: 'var(--fg-1)' }}>
          Suppress competitor AI-vendor sites by default (anthropic.com, openai.com,
          gemini.google.com, mistral.ai, …)
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Btn variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={onSave}>
          {save.isPending ? 'Saving…' : 'Save domain policy'}
        </Btn>
        {save.isError && (
          <span style={{ color: 'var(--err, var(--fg-2))', fontSize: 12 }}>
            Save failed — {save.error?.message ?? 'unknown error'}
          </span>
        )}
        {save.isSuccess && !dirty && (
          <span style={{ color: 'var(--ok, var(--fg-2))', fontSize: 12 }}>Saved.</span>
        )}
      </div>
    </div>
  )
}

function PipelineSettingsPage({ leafId }: LeafPageProps) {
  const q = useAdminQuery<PipelineSummaryResponse>(
    ['prompts', 'pipeline-summary'],
    '/api/admin/pipeline/summary',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const cfg = q.data?.config
  const techniques = q.data?.enabledTechniques ?? []

  // honest "—" boolean for FormRow.value: undefined while loading / on error.
  const flag = (v: boolean | undefined): boolean | undefined => (cfg ? Boolean(v) : undefined)

  const layerRows: FormRow[] = [
    {
      label: 'System prompt layer',
      desc: 'Layer-1 RBAC identity — always first in the assembly order.',
      type: 'badge',
      badge: <Tag>order 1 · locked</Tag>,
      locked: true,
    },
    {
      label: 'Behavioral layer',
      desc: 'DB-backed chatmode behavioral sections (clarify, artifact, grounding…).',
      type: 'badge',
      badge: <Tag>order 2</Tag>,
    },
    {
      label: 'Tool layer',
      desc: 'Tool-array contract + meta-tool instructions.',
      type: 'badge',
      badge: <Tag>order 3</Tag>,
    },
    {
      label: 'Grounding layer',
      desc: 'RAG context injection (enableRAG).',
      type: 'toggle',
      value: flag(cfg?.enableRAG),
    },
  ]

  const behaviorRows: FormRow[] = [
    {
      label: 'Prompt engineering',
      desc: 'Master switch for the prompt-assembly pipeline (enablePromptEngineering).',
      type: 'toggle',
      value: flag(cfg?.enablePromptEngineering),
    },
    {
      label: 'Chain-of-thought',
      desc: 'CoT scaffolding for complex prompts (enableCoT).',
      type: 'toggle',
      value: flag(cfg?.enableCoT),
    },
    {
      label: 'Prompt caching',
      desc: 'Provider-side prompt cache reuse (enableCaching).',
      type: 'toggle',
      value: flag(cfg?.enableCaching),
    },
    {
      label: 'Analytics capture',
      desc: 'Record prompt-effectiveness outcomes (enableAnalytics).',
      type: 'toggle',
      value: flag(cfg?.enableAnalytics),
    },
  ]

  const limitsRows: FormRow[] = [
    {
      label: 'Max concurrent requests',
      type: 'number',
      value: cfg?.maxConcurrentRequests != null ? cfg.maxConcurrentRequests : undefined,
      suffix: 'reqs',
    },
    {
      label: 'Request timeout',
      type: 'number',
      value: cfg?.requestTimeoutMs != null ? cfg.requestTimeoutMs : undefined,
      suffix: 'ms',
    },
  ]

  return (
    <>
      <PageHead
        title="Pipeline Settings"
        sub="prompt assembly order + layers"
        mode="hitl"
        actions={[{ label: 'Save changes', ic: '✓ ', primary: true }]}
      />

      {q.isError && (
        <Banner tone="err">
          Could not load pipeline configuration — /api/admin/pipeline/summary
          returned an error.
        </Banner>
      )}
      {!q.isError && q.isLoading && <Banner tone="info">Loading pipeline configuration…</Banner>}
      {!q.isLoading && !q.isError && !cfg && (
        <Banner tone="warn">
          Pipeline summary returned no config block — nothing to configure.
        </Banner>
      )}

      {techniques.length > 0 && (
        <Banner tone="info">
          Active techniques: {techniques.map(safeStr).join(' · ')}
        </Banner>
      )}

      <FormSection
        title="Assembly layers"
        sub="prompt assembly order"
        rows={layerRows}
        mode="hitl"
      />
      <FormSection
        title="Behavior"
        sub="pipeline behavior flags"
        rows={behaviorRows}
        mode="hitl"
      />
      <FormSection
        title="Limits"
        sub="concurrency + timeout"
        rows={limitsRows}
        mode="hitl"
      />

      <div style={{ marginTop: 8 }}>
        <Banner tone="warn">
          Saving pipeline settings is a mutating change and requires HITL
          approval before it propagates to every replica.
        </Banner>
      </div>

      <Section title="Grounding domain policy" sub="block/allow-list for web sources" />
      <GroundingDomainPolicyCard />
    </>
  )
}

/* ============================================================
 * prompt-effectiveness — /api/admin/prompts/effectiveness
 *
 * Mock: window selector (7d/30d/90d, the endpoint is a fixed 30d window),
 * KPI strip (3): modules tracked | avg win-rate | regressions.
 * Effectiveness table: Module | Version | Win-rate | Sample | Trend.
 * Win-rate chart (HBars per module).
 * ============================================================ */

interface ModuleUsageRow {
  moduleName: string
  usageCount: number
  positiveCount: number
  negativeCount: number
  averageTokenCost: number
}
interface PromptEffectivenessResponse {
  totalModules?: number
  enabledModules?: number
  averageTokenCost?: number
  totalTokenBudgetUsed?: number
  recentCompositions?: number
  positiveOutcomes?: number
  negativeOutcomes?: number
  pendingOutcomes?: number
  moduleUsage?: ModuleUsageRow[]
}

/** Win-rate = positive / (positive + negative); null when no scored samples. */
function winRate(r: ModuleUsageRow): number | null {
  const scored = r.positiveCount + r.negativeCount
  if (scored <= 0) return null
  return (r.positiveCount / scored) * 100
}

interface EffectivenessTableRow extends Record<string, unknown> {
  moduleName: string
  sample: number
  scored: number
  winRate: number | null
  positiveCount: number
  negativeCount: number
}

function PromptEffectivenessPage({ leafId }: LeafPageProps) {
  const q = useAdminQuery<PromptEffectivenessResponse>(
    ['prompts', 'effectiveness'],
    '/api/admin/prompts/effectiveness',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const data = q.data
  const modules = data?.moduleUsage ?? []

  const tableRows: EffectivenessTableRow[] = React.useMemo(
    () =>
      modules.map((m) => ({
        moduleName: m.moduleName,
        sample: m.usageCount,
        scored: m.positiveCount + m.negativeCount,
        winRate: winRate(m),
        positiveCount: m.positiveCount,
        negativeCount: m.negativeCount,
      })),
    [modules],
  )

  // avg win-rate across modules that have at least one scored sample.
  const scoredRows = tableRows.filter((r) => r.winRate != null)
  const avgWinRate =
    scoredRows.length > 0
      ? scoredRows.reduce((a, r) => a + (r.winRate ?? 0), 0) / scoredRows.length
      : null
  const regressions = scoredRows.filter((r) => (r.winRate ?? 100) < 50).length

  const kpis: Kpi[] = [
    {
      label: 'Modules tracked',
      val: data ? fmtNum(data.totalModules ?? modules.length) : '—',
      tone: 'accent',
      sub: data?.recentCompositions != null ? `${fmtNum(data.recentCompositions)} compositions 30d` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Avg win-rate',
      val: data ? fmtPct(avgWinRate) : '—',
      tone: (avgWinRate ?? 100) < 50 ? 'err' : 'ok',
      sub: scoredRows.length > 0 ? `${scoredRows.length} scored modules` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Regressions',
      val: data ? fmtNum(regressions) : '—',
      unit: data ? '< 50%' : undefined,
      tone: regressions > 0 ? 'err' : 'ok',
      sub:
        data?.negativeOutcomes != null
          ? `${fmtNum(data.negativeOutcomes)} negative outcomes`
          : undefined,
      deltaDir: 'flat',
    },
  ]

  const winBars: HBarItem[] = scoredRows
    .slice()
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .slice(0, 12)
    .map((r) => ({
      l: r.moduleName,
      v: r.winRate ?? 0,
      tone: (r.winRate ?? 0) < 50 ? 'err' : (r.winRate ?? 0) < 70 ? 'warn' : 'ok',
      disp: fmtPct(r.winRate),
    }))

  const cols: DtColumn<EffectivenessTableRow>[] = [
    { key: 'moduleName', label: 'Module', val: (r) => r.moduleName, render: (r) => <span style={{ fontWeight: 600 }}>{r.moduleName}</span> },
    {
      key: 'winRate',
      label: 'Win-rate',
      r: true,
      val: (r) => r.winRate ?? -1,
      render: (r) =>
        r.winRate == null ? (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ) : (
          <Pill tone={r.winRate < 50 ? 'err' : r.winRate < 70 ? 'warn' : 'ok'} dot>
            {fmtPct(r.winRate)}
          </Pill>
        ),
    },
    {
      key: 'sample',
      label: 'Sample',
      r: true,
      val: (r) => r.sample,
      render: (r) => <span style={{ fontFamily: 'var(--font-v3-mono)' }}>{fmtNum(r.sample)}</span>,
    },
    {
      key: 'scored',
      label: 'Scored',
      r: true,
      val: (r) => r.scored,
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-2)' }}>
          {fmtNum(r.positiveCount)}↑ / {fmtNum(r.negativeCount)}↓
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Effectiveness"
        sub="per-module A/B + win-rate · 30-day window"
        mode="readonly"
      />

      {q.isError && (
        <Banner tone="err">
          Could not load prompt effectiveness — /api/admin/prompts/effectiveness
          returned an error.
        </Banner>
      )}
      {!q.isError && q.isLoading && <Banner tone="info">Loading effectiveness data…</Banner>}

      <KpiStrip kpis={kpis} />

      <Section title="Win-rate by module" sub="positive ÷ scored outcomes (30d)" />
      {winBars.length > 0 ? (
        <div className="awc-chartcard">
          <HBars items={winBars} max={100} />
        </div>
      ) : (
        <Banner tone="info">
          No scored outcomes in the last 30 days — win-rate appears once
          PromptEffectiveness rows accumulate positive / negative outcomes.
        </Banner>
      )}

      <Section title="Effectiveness table" sub="per-module sample + win-rate" />
      <DataTable<EffectivenessTableRow>
        cols={cols}
        rows={tableRows}
        search="module…"
        empty="No prompt-effectiveness rows in the 30-day window."
      />
    </>
  )
}

/* ============================================================
 * prompt-metrics — /api/admin/prompts/effectiveness (token figures)
 *
 * Mock: window selector (1h/24h/7d — endpoint is a fixed 30d window),
 * KPI strip (4): avg prompt tokens | assembly latency | cache hit % | layers active.
 * tokens-over-time chart (area). The endpoint has NO time series, so the area
 * chart renders an honest empty state instead of a fabricated series; the real
 * token totals power the KPI strip.
 * ============================================================ */

function PromptMetricsPage({ leafId }: LeafPageProps) {
  const eff = useAdminQuery<PromptEffectivenessResponse>(
    ['prompts', 'effectiveness'],
    '/api/admin/prompts/effectiveness',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const pipeline = useAdminQuery<PipelineSummaryResponse>(
    ['prompts', 'pipeline-summary'],
    '/api/admin/pipeline/summary',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const data = eff.data
  const cfg = pipeline.data?.config

  // "layers active" = count of the always-on system layer + the enabled
  // behavioral/tool/grounding pipeline flags (honest from the live config).
  const layersActive =
    cfg != null
      ? 1 /* system layer is always on */ +
        (cfg.enablePromptEngineering ? 1 : 0) +
        (cfg.enableMCP ? 1 : 0) +
        (cfg.enableRAG ? 1 : 0)
      : undefined

  const kpis: Kpi[] = [
    {
      label: 'Avg prompt tokens',
      val: data?.averageTokenCost != null ? fmtNum(data.averageTokenCost) : '—',
      unit: data?.averageTokenCost != null ? 'tok' : undefined,
      tone: 'accent',
      sub:
        data?.recentCompositions != null
          ? `${fmtNum(data.recentCompositions)} compositions 30d`
          : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Tokens used 30d',
      val: data?.totalTokenBudgetUsed != null ? fmtNum(data.totalTokenBudgetUsed) : '—',
      unit: data?.totalTokenBudgetUsed != null ? 'tok' : undefined,
      tone: 'info',
      sub: 'prompt assembly budget',
      deltaDir: 'flat',
    },
    {
      // No cache-hit metric on the effectiveness endpoint — honest "—" rather
      // than a fabricated number. Tone stays muted to signal "not measured".
      label: 'Cache hit %',
      val: '—',
      tone: 'muted',
      sub: 'no cache-hit metric on this route',
      deltaDir: 'flat',
    },
    {
      label: 'Layers active',
      val: layersActive != null ? fmtNum(layersActive) : '—',
      tone: 'ok',
      sub: cfg ? 'from live pipeline config' : undefined,
      deltaDir: 'flat',
    },
  ]

  const showError = eff.isError && pipeline.isError
  const showLoading = (eff.isLoading || pipeline.isLoading) && !showError

  return (
    <>
      <PageHead
        title="Metrics"
        sub="prompt token + latency overhead · 30-day window"
        mode="readonly"
      />

      {showError && (
        <Banner tone="err">
          Could not load prompt metrics — the effectiveness and pipeline-summary
          routes both returned an error.
        </Banner>
      )}
      {showLoading && <Banner tone="info">Loading prompt metrics…</Banner>}

      <KpiStrip kpis={kpis} />

      <Section title="Tokens over time" sub="prompt-assembly token volume" />
      <Banner tone="info">
        The effectiveness route exposes window totals
        {data?.totalTokenBudgetUsed != null
          ? ` (${fmtNum(data.totalTokenBudgetUsed)} tokens over 30d)`
          : ''}{' '}
        but no per-bucket time series — a tokens-over-time chart appears once a
        bucketed prompt-metrics endpoint lands. Window totals are shown above.
      </Banner>
    </>
  )
}

/* ============================================================
 * export — exactly the 4 Prompts leaf ids
 * ============================================================ */
export const promptsPages: Record<string, React.ComponentType<LeafPageProps>> = {
  'prompt-modules': PromptModulesPage,
  'pipeline-settings': PipelineSettingsPage,
  'prompt-effectiveness': PromptEffectivenessPage,
  'prompt-metrics': PromptMetricsPage,
}
