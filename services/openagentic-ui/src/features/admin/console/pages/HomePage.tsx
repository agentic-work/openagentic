/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * HomePage — the Phase-1 admin Home dashboard, at mock fidelity
 * (the admin-console mock DOMAIN_PAGES.home) and WIRED to real
 * endpoints. This is the EXEMPLAR every domain page follows:
 *   - all numbers come from a live hook or render an honest "—"
 *     (never a fabricated value),
 *   - every color resolves via a global theme token (var(--*)); zero hex,
 *   - the layout ports the mock structure: agent hero strip → 6 sparkline
 *     KPIs → capability grid → recommendations +
 *     activity feed.
 *
 * Data sources (all real admin routes):
 *   useDashboardMetrics  → token burn / spend / flows / sessions
 *   useFlowsKpisHome     → failing-flow count + success rate
 *   useMcpFleetHealth    → MCP fleet up/total
 *   useComplianceFindings→ FedRAMP open findings
 *   useRecommendations   → operator advisory cards
 *   useAuditLogs         → live activity feed
 */
import * as React from 'react'
import { ADMIN_DOMAINS, HOME_DOMAIN_ID, LEAF_COUNT } from '../ADMIN_IA'
import { DomainIcon } from '../chrome/DomainIcon'
import { Banner, Btn, KpiStrip, PageHead, Pill, Section, type Kpi } from '../primitives'
import type { Tone } from '../types'
import {
  useAuditLogs,
  useComplianceFindings,
  useDashboardMetrics,
  useDashboardStructuralCounts,
  useFlowsKpisHome,
  useMcpFleetHealth,
  useRecommendations,
  type AuditLogEntry,
} from '../../hooks/useDashboardMetrics'

export interface HomePageProps {
  org: string
  scope: string
  region: string
  avatarTitle?: string
  onOpenDomain: (domainId: string) => void
  onOpenAgent: () => void
}

/* ---------------- format helpers (honest "—" on missing) ---------------- */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function fmtUsd(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'
  return '$' + n.toFixed(2)
}
function utcStamp(): string {
  return new Date().toUTCString().slice(0, 22)
}
function deltaArrow(p: number): string {
  return p >= 0 ? '▲' : '▼'
}
function deltaDir(p: number | undefined | null): 'up' | 'down' | 'flat' {
  if (p == null) return 'flat'
  return p > 0 ? 'up' : p < 0 ? 'down' : 'flat'
}
function statusLabel(t: Tone): string {
  return t === 'ok' ? 'healthy' : t === 'warn' ? 'degraded' : t === 'err' ? 'attention' : 'idle'
}
function actorOf(l: AuditLogEntry): string {
  return l.userName || l.userEmail || l.userId || 'system'
}
function feedTime(ts: string): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
}

/** Agent-hero example prompts. */
const HERO_PROMPTS = [
  '"Add AWS Bedrock, register Claude + Titan, set as T3 default"',
  '"Build a flow: Loki errors → gpt-oss summary → Slack #ai-chat, every 10 min"',
  '"Invite alex@example.com as FinOps Admin, require MFA, grant Flows + Cost"',
]

export function HomePage({
  org,
  scope,
  region,
  avatarTitle,
  onOpenDomain,
  onOpenAgent,
}: HomePageProps) {
  const metrics = useDashboardMetrics('24h')
  const structural = useDashboardStructuralCounts()
  const flowsKpis = useFlowsKpisHome('24h')
  const mcp = useMcpFleetHealth()
  const findings = useComplianceFindings()
  const recs = useRecommendations()
  const audit = useAuditLogs(10)

  const s = metrics.data?.summary
  const ts = metrics.data?.timeSeries
  const st = structural.data
  const failed = flowsKpis.data?.failed_count ?? 0
  const mcpUp = mcp.data?.healthyServers ?? 0
  const mcpTotal = mcp.data?.totalServers
  const mcpDown = mcp.data?.down ?? 0
  const openFindings = findings.data?.summary?.open

  /* ---- 6 usage KPIs (mock parity, honest-empty) ----
     A loaded summary with totalTokens===0 is an HONEST zero ("0" + "no
     activity yet"), not a "—". "—" is reserved for "no data loaded / error". */
  const tokenSpark =
    ts?.tokenUsage && ts.tokenUsage.length ? ts.tokenUsage.map((p) => p.value) : undefined
  const kpis: Kpi[] = [
    {
      label: 'Token Burn 24h',
      val: s ? fmtNum(s.totalTokens) : '—',
      unit: s ? 'tok' : undefined,
      tone: 'accent',
      sub:
        s?.tokensDeltaPct != null
          ? `${deltaArrow(s.tokensDeltaPct)} ${Math.abs(s.tokensDeltaPct).toFixed(1)}% vs prev 24h`
          : s && s.totalTokens === 0
            ? 'no activity yet'
            : undefined,
      deltaDir: deltaDir(s?.tokensDeltaPct),
      spark: tokenSpark,
    },
    {
      label: 'Spend 24h',
      val: s ? fmtUsd(s.totalCost) : '—',
      tone: 'warn',
      sub:
        s?.costDeltaPct != null
          ? `${deltaArrow(s.costDeltaPct)} ${Math.abs(s.costDeltaPct).toFixed(1)}% vs prev 24h`
          : s && s.totalCost === 0
            ? 'no spend yet'
            : undefined,
      deltaDir: deltaDir(s?.costDeltaPct),
    },
    {
      label: 'Active Flows',
      val: s ? s.activeWorkflows : '—',
      unit: failed > 0 ? `/ ${failed} failing` : undefined,
      tone: failed > 0 ? 'err' : 'ok',
      sub:
        flowsKpis.data?.success_rate != null
          ? `${Math.round(flowsKpis.data.success_rate)}% success 24h`
          : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Live Sessions',
      val: s ? s.totalSessions ?? 0 : '—',
      tone: 'ok',
      sub: s && (s.totalSessions ?? 0) === 0 ? 'no chats yet' : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'MCP Fleet Health',
      val: mcpTotal != null ? `${mcpUp}/${mcpTotal}` : '—',
      unit: mcpTotal != null ? 'up' : undefined,
      tone: mcpDown > 0 ? 'warn' : 'ok',
      sub: mcpDown > 0 ? `${mcpDown} down` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'FedRAMP Findings',
      val: openFindings != null ? openFindings : '—',
      unit: openFindings != null ? 'open' : undefined,
      tone: (openFindings ?? 0) > 0 ? 'err' : 'ok',
      sub:
        findings.data?.summary?.total != null
          ? `${findings.data.summary.total} evaluated`
          : undefined,
      deltaDir: 'flat',
    },
  ]

  /* ---- structural KPIs — REAL on a fresh box, even with ZERO usage.
     These are platform capacity, not activity: indexed MCP tools, running
     MCP servers, registered models + providers. A brand-new install has
     substance here on day 1. "—" only on no-data/error; a genuine 0 (e.g.
     no providers configured yet) renders "0" with a clear hint. ---- */
  const structKpis: Kpi[] = [
    {
      label: 'MCP Tools Indexed',
      val: st?.mcpTools != null ? fmtNum(st.mcpTools) : '—',
      unit: st?.mcpTools != null ? 'tools' : undefined,
      tone: 'info',
      sub: st?.mcpTools === 0 ? 'indexing on first boot' : 'searchable tool catalog',
      deltaDir: 'flat',
    },
    {
      label: 'MCP Servers',
      val: st?.mcpServers != null ? st.mcpServers : '—',
      unit: st?.mcpServers != null ? 'running' : undefined,
      tone: st?.mcpServers === 0 ? 'warn' : 'ok',
      sub: st?.mcpServers === 0 ? 'none spawned yet' : 'spawned by the mcp-proxy',
      deltaDir: 'flat',
    },
    {
      label: 'Models',
      val: st?.models != null ? fmtNum(st.models) : '—',
      unit: st?.models != null ? 'assigned' : undefined,
      tone: st?.models === 0 ? 'warn' : 'accent',
      sub: st?.models === 0 ? 'assign a model to a role' : 'role assignments',
      deltaDir: 'flat',
    },
    {
      label: 'Providers',
      val: st?.providers != null ? st.providers : '—',
      unit: st?.providers != null ? 'configured' : undefined,
      tone: st?.providers === 0 ? 'warn' : 'ok',
      sub: st?.providers === 0 ? 'add an LLM provider' : 'LLM providers',
      deltaDir: 'flat',
    },
  ]

  /* ---- per-domain capability-card metric + tone (honest fallback) ---- */
  const capMeta = (id: string, leafCount: number): { sub: string; tone: Tone } => {
    const surfaces = `${leafCount} surfaces`
    switch (id) {
      case 'flows':
        return s
          ? { sub: `${s.activeWorkflows} active · ${failed} failing`, tone: failed > 0 ? 'err' : 'muted' }
          : { sub: surfaces, tone: 'muted' }
      case 'tools':
        return mcpTotal != null
          ? { sub: `${mcpUp}/${mcpTotal} MCP up`, tone: mcpDown > 0 ? 'warn' : 'ok' }
          : { sub: surfaces, tone: 'muted' }
      case 'system':
        return openFindings != null
          ? { sub: `${openFindings} open findings`, tone: openFindings > 0 ? 'err' : 'ok' }
          : { sub: surfaces, tone: 'muted' }
      case 'agents':
        return s ? { sub: `${fmtNum(s.totalAgentExecutions)} runs 24h`, tone: 'muted' } : { sub: surfaces, tone: 'muted' }
      case 'obs':
        return s ? { sub: `${fmtNum(s.totalApiRequests)} req 24h`, tone: 'muted' } : { sub: surfaces, tone: 'muted' }
      default:
        return { sub: surfaces, tone: 'muted' }
    }
  }

  const domains = ADMIN_DOMAINS.filter((d) => d.id !== HOME_DOMAIN_ID)
  const recList = recs.data?.recommendations ?? []
  const feed = audit.data?.logs ?? []

  return (
    <>
      <PageHead
        title={`Welcome back, ${avatarTitle ?? 'Trent'}`}
        sub={`${org} · ${scope} · ${region} · ${utcStamp()} — ask the Admin Agent or jump to any of ${LEAF_COUNT} surfaces`}
        actions={[
          { label: 'Customize', ic: '▦ ' },
          { label: 'Ask the Admin Agent', ic: '✦ ', primary: true, onClick: onOpenAgent },
        ]}
      />

      {/* Agent hero strip */}
      <div className="awc-chartcard" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 13,
              display: 'grid',
              placeItems: 'center',
              fontSize: 22,
              color: 'var(--accent)',
              border: '1px solid var(--line-1)',
              flexShrink: 0,
            }}
          >
            ✦
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Ask the Admin Agent to do a full setup</div>
            <div style={{ color: 'var(--fg-2)', fontSize: 12.5, marginTop: 3 }}>
              Provision a provider · create a user · build &amp; schedule a flow · register an agent ·
              triage failures — it plans, you approve, it executes.
            </div>
          </div>
          <Btn variant="primary" onClick={onOpenAgent}>
            Open Admin Agent →
          </Btn>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {HERO_PROMPTS.map((p, i) => (
            <button
              key={i}
              className="awc-chipbtn"
              style={{ flex: 1, minWidth: 200, textAlign: 'left' }}
              onClick={onOpenAgent}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Platform capacity — structural counts that are real on a fresh box */}
      <Section title="Platform" sub="installed capacity — real on a fresh box, independent of usage" />
      <KpiStrip kpis={structKpis} />

      {/* 6 sparkline KPIs — 24h usage (honest zero-state on a quiet box) */}
      <Section title="Usage · 24h" sub="activity rollups — zeros until the first chat or flow runs" />
      <KpiStrip kpis={kpis} />

      {/* capability grid — one card per admin domain */}
      <Section title="Capabilities" sub={`${LEAF_COUNT} admin surfaces across 11 domains`} />
      <div className="awc-capgrid">
        {domains.map((d) => {
          const meta = capMeta(d.id, d.leaves.length)
          return (
            <button key={d.id} className="awc-cap" onClick={() => onOpenDomain(d.id)}>
              <div className="awc-cap__ci">
                <DomainIcon path={d.icon} size={20} />
              </div>
              <h3>{d.name}</h3>
              <p>{meta.sub}</p>
              <div className="awc-cap__foot">
                <Pill tone={meta.tone} dot>
                  {statusLabel(meta.tone)}
                </Pill>
                <span className="awc-cap__arrow">→</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Recommendations + Activity feed */}
      <Section title="Recommendations & Platform Health" sub="what needs you now" />
      <div className="awc-grid2">
        <div>
          {recList.length ? (
            recList.map((r) => (
              <div key={r.id} style={{ marginBottom: 10 }}>
                <Banner tone={r.severity}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.title}</div>
                    {r.detail && (
                      <div style={{ color: 'var(--fg-2)', fontSize: 12.5, marginTop: 3 }}>{r.detail}</div>
                    )}
                    {r.action && (
                      <div style={{ marginTop: 8 }}>
                        <Btn size="sm">{r.action.label}</Btn>
                      </div>
                    )}
                  </div>
                </Banner>
              </div>
            ))
          ) : (
            <Banner tone="info">
              No recommendations right now — platform healthy or the advisory engine has no open
              signals.
            </Banner>
          )}
        </div>
        <div className="awc-tablewrap" style={{ marginBottom: 0 }}>
          <div className="awc-toolbar">
            <span style={{ fontWeight: 700 }}>Activity Feed</span>
            <span style={{ marginLeft: 'auto' }}>
              <Pill tone="ok" dot>
                live
              </Pill>
            </span>
          </div>
          {feed.length ? (
            feed.map((l) => (
              <div
                key={l.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'baseline',
                  padding: '7px 12px',
                  borderTop: '1px solid var(--line-1)',
                }}
              >
                <span
                  style={{
                    color: 'var(--fg-3)',
                    fontSize: 11,
                    fontFamily: 'var(--font-v3-mono)',
                    flexShrink: 0,
                  }}
                >
                  {feedTime(l.timestamp)}
                </span>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>{actorOf(l)}</span>
                <span
                  style={{
                    color: 'var(--fg-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {l.action ?? '—'}
                </span>
              </div>
            ))
          ) : (
            <div style={{ padding: '14px 12px', color: 'var(--fg-3)' }}>No recent activity.</div>
          )}
        </div>
      </div>
    </>
  )
}
