/**
 * DashboardOverview · admin-v2 Control Plane layout
 *
 * Data source: /admin/dashboard/metrics?timeRange=X  — the SAME endpoint v1
 * uses. No mock data. Live-only.
 *
 * Layout:
 *   [breadcrumb]
 *   [Dashboard Overview]  [tabs prominently up top]  [time-range pill]
 *   [12 stat cards: 2 rows × 6]
 *   [tab content]
 */
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { StatCard, BigChart, PageHeader } from '../../primitives-v2'
import { apiRequest } from '../../../../utils/api'
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer } from 'recharts'
import { LLMSankeyModal } from '../../components/LLM/LLMSankeyModal'
import { GitMerge } from 'lucide-react'

// Lazy: Performance tab content. Reuses the standalone LLMPerformanceMetrics
// component (also reachable via the `llm-performance` slug); no new props.
const LLMPerformanceMetrics = lazy(() => import('../../components/LLM/LLMPerformanceMetrics'))

const PIE_COLORS = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--err)', 'var(--info)']

const RANGES = ['1h','6h','12h','24h','7d','30d','90d'] as const
type Range = typeof RANGES[number]

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'usage',       label: 'Usage & Tokens' },
  { id: 'cost',        label: 'Cost Analysis' },
  { id: 'flows',       label: 'Flows & Agents' },
  { id: 'mcp',         label: 'MCP & Tools' },
  { id: 'api',         label: 'API & Limits' },
  { id: 'infra',       label: 'Infrastructure' },
  { id: 'performance', label: 'Performance' },
] as const
type TabId = typeof TABS[number]['id']

// --- metrics shape (subset of v1's response) -------------------------------
interface TSPoint { timestamp: string; value: number }
interface Metrics {
  success?: boolean
  summary: {
    totalUsers: number; activeUsers: number
    totalSessions: number; sessionChange: number
    totalMessages: number; messageChange: number
    totalTokens: number
    totalCost: number
    totalImages: number
    totalMcpCalls: number
    totalEmbeddings?: number
    totalCodeTokens?: number; totalCodeCost?: number; totalCodeMessages?: number; totalCodeSessions?: number
    totalWorkflowExecutions?: number; workflowSuccessRate?: number
    totalAgentExecutions?: number; agentTotalCost?: number
    totalApiRequests?: number; apiAvgResponseTime?: number; apiErrorRate?: number
  }
  timeSeries: {
    sessions: TSPoint[]
    messages: TSPoint[]
    tokenUsage: TSPoint[]
    images: TSPoint[]
    embeddings: TSPoint[]
    codeTokenUsage?: TSPoint[]
    workflowExecutions?: TSPoint[]
    agentExecutions?: TSPoint[]
    apiRequests?: TSPoint[]
    codeSessions?: TSPoint[]
  }
  modelUsage?: { model: string; count: number; tokens: number; cost: number }[]
  costByModel?: { model: string; data: TSPoint[] }[]
  mcpToolUsage?: { tool: string; count: number }[]
  tokensBySource?: { model: string; data: TSPoint[] }[]
  tokenTotalsBySource?: Record<string, number>
  perUserUsage?: { userId: string; email: string; name: string; sessions: number; messages: number; tokens: number; cost: number; lastActive: string }[]
  workflowMetrics?: { statusCounts: { completed: number; failed: number; running: number; pending: number }; successRate: number; totalWorkflows: number; activeWorkflows: number }
  apiMetrics?: { totalRequests: number; errorCount: number; errorRate: number; avgResponseTime: number; bySource: { source: string; count: number }[] }
}

function toSeries(points: TSPoint[] | undefined, bucketCount = 24): number[] {
  if (!points || !points.length) return new Array(bucketCount).fill(0)
  if (points.length <= bucketCount) return points.map(p => p.value)
  const stride = Math.ceil(points.length / bucketCount)
  const out: number[] = []
  for (let i = 0; i < points.length; i += stride) out.push(points[i].value)
  return out.slice(0, bucketCount)
}
function fmtNum(n: number | undefined): string {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}
function fmtMoney(n: number | undefined): string { return n == null ? '—' : `$${n.toFixed(2)}` }

function useDashboardMetrics(range: Range) {
  const [data, setData] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchOnce = async () => {
      setLoading(true); setError(null)
      try {
        const r = await apiRequest(`/admin/dashboard/metrics?timeRange=${range}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (j?.success === false) throw new Error(j?.error || 'fetch failed')
        if (!cancelled) setData(j)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'fetch failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchOnce()
    const handle = setInterval(fetchOnce, 60_000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [range])

  return { data, loading, error }
}

export function DashboardOverview() {
  const [range, setRange] = useState<Range>('24h')
  const [tab, setTab] = useState<TabId>('overview')
  const [sankeyOpen, setSankeyOpen] = useState(false)
  const { data, loading, error } = useDashboardMetrics(range)

  const s = data?.summary
  const ts = data?.timeSeries

  // Sparkline series per stat card (falls back to zeros when metrics still loading)
  const spk = useMemo(() => ({
    users:     toSeries(ts?.sessions),     // no dedicated per-user series; use sessions as proxy
    sessions:  toSeries(ts?.sessions),
    messages:  toSeries(ts?.messages),
    code:      toSeries(ts?.codeSessions),
    flows:     toSeries(ts?.workflowExecutions),
    agents:    toSeries(ts?.agentExecutions),
    chatTok:   toSeries(ts?.tokenUsage),
    codeTok:   toSeries(ts?.codeTokenUsage),
    cost:      toSeries(ts?.tokenUsage),    // token chart as cost proxy
    api:       toSeries(ts?.apiRequests),
    mcp:       toSeries(ts?.sessions),      // no mcp timeseries; use sessions proxy
    images:    toSeries(ts?.images),
  }), [ts])

  return (
    <div className="p-5 pb-10">
      {/* Universal admin chrome — matches every other admin page. */}
      <PageHeader
        crumbs={['Admin', 'Dashboard Overview']}
        title="Dashboard Overview"
        explainer="Real-time system performance metrics across all platform modes: Chat, Code, Flows, and Agents."
      />
      {/* Tabs + range pills row (kept inline below the universal header). */}
      <div className="flex items-center justify-end gap-4 mb-4 flex-wrap">
        {/* Tabs — prominently placed at top, replacing the old live/mock blurb */}
        <div className="flex gap-1 bg-bg-1 border border-ln-2 rounded-md p-1" data-testid="dashboard-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'px-3 py-1.5 text-[12px] font-semibold rounded font-ui whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'bg-pri text-white shadow-sm'
                  : 'text-fg-2 hover:text-fg-0 hover:bg-bg-2',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Range pills */}
        <div className="flex gap-0.5 bg-bg-1 border border-ln-2 rounded-md p-0.5" data-testid="range-pills">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                'px-2.5 py-1 text-[11px] font-mono rounded',
                range === r ? 'bg-pri text-white' : 'text-fg-2 hover:text-fg-0',
              ].join(' ')}
            >{r}</button>
          ))}
        </div>
      </div>

      {/* Error / loading banner */}
      {error && (
        <div className="px-3 py-2 mb-3 bg-err/10 border border-err text-err text-[12px] font-mono rounded">
          metrics fetch failed: {error}
        </div>
      )}
      {loading && !data && (
        <div className="px-3 py-2 mb-3 text-fg-3 font-mono text-[12px]">loading metrics…</div>
      )}

      {/* Row 1 — 6 stat cards */}
      <div className="grid grid-cols-6 gap-px bg-ln-1 border border-ln-2 rounded-md overflow-hidden mb-3.5">
        <StatCard label="Total Users"     value={fmtNum(s?.totalUsers)}   sub={s ? `${s.activeUsers} active` : ''} sparkData={spk.users}/>
        <StatCard label="Chat Sessions"   value={fmtNum(s?.totalSessions)} dir={s && s.sessionChange >= 0 ? 'up' : 'down'} delta={s?.sessionChange != null ? `${s.sessionChange > 0 ? '+' : ''}${s.sessionChange}%` : ''} sparkData={spk.sessions} variant="info"/>
        <StatCard label="Messages"        value={fmtNum(s?.totalMessages)} dir={s && s.messageChange >= 0 ? 'up' : 'down'} delta={s?.messageChange != null ? `${s.messageChange > 0 ? '+' : ''}${s.messageChange}%` : ''} sparkData={spk.messages}/>
        <StatCard label="Code Sessions"   value={fmtNum(s?.totalCodeSessions ?? 0)} sub={s?.totalCodeMessages != null ? `${s.totalCodeMessages} reqs` : ''} sparkData={spk.code}/>
        <StatCard label="Flow Executions" value={fmtNum(s?.totalWorkflowExecutions ?? 0)} sub={s?.workflowSuccessRate != null ? `${s.workflowSuccessRate}% success` : ''} variant="ok" sparkData={spk.flows}/>
        <StatCard label="Agent Runs"      value={fmtNum(s?.totalAgentExecutions ?? 0)} sub={s?.agentTotalCost != null ? fmtMoney(s.agentTotalCost) : ''} sparkData={spk.agents}/>
      </div>
      {/* Row 2 — 6 stat cards */}
      <div className="grid grid-cols-6 gap-px bg-ln-1 border border-ln-2 rounded-md overflow-hidden mb-4">
        <StatCard label="Chat Tokens"     value={fmtNum(s?.totalTokens)}     variant="info"  sparkData={spk.chatTok}/>
        <StatCard label="Code Tokens"     value={fmtNum(s?.totalCodeTokens ?? 0)}              sparkData={spk.codeTok}/>
        <StatCard label="Total Cost"      value={fmtMoney((s?.totalCost ?? 0) + (s?.totalCodeCost ?? 0) + (s?.agentTotalCost ?? 0))} sub={s ? `Chat ${fmtMoney(s.totalCost)} · Code ${fmtMoney(s.totalCodeCost ?? 0)}` : ''} variant="warn" sparkData={spk.cost}/>
        <StatCard label="API Requests"    value={fmtNum(s?.totalApiRequests ?? 0)} sub={s?.apiAvgResponseTime != null ? `${s.apiAvgResponseTime}ms avg` : ''} sparkData={spk.api}/>
        <StatCard label="MCP Tool Calls"  value={fmtNum(s?.totalMcpCalls)} variant="info" sparkData={spk.mcp}/>
        <StatCard label="Images Generated" value={fmtNum(s?.totalImages)}                       sparkData={spk.images}/>
      </div>

      {/* Tab content */}
      {tab === 'overview'    && <OverviewTab  m={data} range={range} onOpenSankey={() => setSankeyOpen(true)}/>}
      {tab === 'usage'       && <UsageTab     m={data}/>}
      {tab === 'cost'        && <CostTab      m={data}/>}
      {tab === 'flows'       && <FlowsTab     m={data}/>}
      {tab === 'mcp'         && <McpTab       m={data}/>}
      {tab === 'api'         && <ApiTab       m={data}/>}
      {tab === 'infra'       && <InfraTab     m={data}/>}
      {tab === 'performance' && (
        <Suspense fallback={<div className="p-10 text-center font-mono text-fg-3 text-sm">loading performance metrics…</div>}>
          {/* theme prop is declared but ignored by LLMPerformanceMetrics; pass empty for TS. */}
          <LLMPerformanceMetrics theme="" />
        </Suspense>
      )}

      {/* LLM Cost Sankey (v1's LLMSankeyModal, triggered from Overview tab) */}
      <LLMSankeyModal
        isOpen={sankeyOpen}
        onClose={() => setSankeyOpen(false)}
        modelUsage={data?.modelUsage || []}
        timeRange={range}
      />
    </div>
  )
}

// ═══════════════════════════ TAB COMPONENTS ══════════════════════════════════

function Panel({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-1 border border-ln-2 rounded-md overflow-hidden">
      <div className="flex justify-between items-center px-3 py-2 border-b border-ln-2 bg-bg-0">
        <span className="font-mono text-[11px] font-bold tracking-[0.1em] uppercase text-fg-1">▸ {title}</span>
        {right && <span className="font-mono text-[11px] text-fg-3">{right}</span>}
      </div>
      {children}
    </div>
  )
}
function ChartPanel({ title, right, series, yFormat }: { title: string; right?: string; series: import('../../primitives-v2').ChartSeries[]; yFormat?: (v: number) => string }) {
  return (
    <Panel title={title} right={right}>
      <div className="h-[220px]"><BigChart series={series} yFormat={yFormat}/></div>
    </Panel>
  )
}

function OverviewTab({ m, range, onOpenSankey }: { m: Metrics | null; range: Range; onOpenSankey: () => void }) {
  const ts = m?.timeSeries
  const mcpData = (m?.mcpToolUsage || []).slice(0, 5)
  const hasModels = (m?.modelUsage?.length ?? 0) > 0
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <ChartPanel title="chat sessions" series={[{ name: 'sessions', color: 'var(--accent)', data: toSeries(ts?.sessions) }]}/>
        <ChartPanel title="messages"      series={[{ name: 'messages', color: 'var(--accent)', data: toSeries(ts?.messages) }]}/>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <ChartPanel title="code mode sessions" series={[{ name: 'code', color: 'var(--ok)', data: toSeries(ts?.codeSessions) }]}/>
        <ChartPanel title="workflow executions" series={[{ name: 'flows', color: 'var(--warn)', data: toSeries(ts?.workflowExecutions) }]}/>
      </div>
      {/* MCP usage wheel + LLM Sankey CTA — the two "kickass diagrams" live on Overview */}
      <div className="grid grid-cols-2 gap-2.5">
        <Panel title="MCP tool usage" right={mcpData.length ? `top ${mcpData.length} of ${m?.mcpToolUsage?.length || 0}` : ''}>
          {mcpData.length ? (
            <div className="flex items-center gap-4 p-4 h-[220px]">
              <div className="flex-1 h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mcpData} dataKey="count" nameKey="tool" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="var(--glass-page-bg)" strokeWidth={2}>
                      {mcpData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]}/>)}
                    </Pie>
                    <RTooltip
                      contentStyle={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--glass-border)', borderRadius: 6, fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 11, padding: '6px 10px' }}
                      itemStyle={{ color: 'var(--fg-0)' }}
                      formatter={(v: any, n: any) => [`${v} calls`, n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                {mcpData.map((t, i) => (
                  <div key={t.tool} className="flex items-center justify-between text-[11px] font-mono">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}/>
                      <span className="truncate text-fg-1">{t.tool}</span>
                    </div>
                    <span className="text-fg-0 tabular-nums font-semibold">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="p-6 text-fg-3 text-[12px] font-mono text-center">no MCP tool calls recorded in this range</div>}
        </Panel>
        <Panel title="model cost sankey" right={hasModels ? `${m?.modelUsage?.length} models` : ''}>
          <button
            onClick={onOpenSankey}
            disabled={!hasModels}
            className={[
              'w-full h-[220px] flex flex-col items-center justify-center gap-3 transition-colors',
              hasModels ? 'hover:bg-bg-2 text-fg-1' : 'text-fg-3 cursor-not-allowed',
            ].join(' ')}
          >
            <div className="p-3 rounded-full" style={{ background: hasModels ? 'var(--glass-accent-fill)' : 'var(--ctl-surf)' }}>
              <GitMerge size={28} style={{ color: hasModels ? 'var(--accent)' : 'var(--fg-3)' }}/>
            </div>
            <div className="text-center">
              <div className="font-semibold text-[14px]" style={{ color: hasModels ? 'var(--fg-0)' : 'var(--fg-3)' }}>
                {hasModels ? 'Open LLM Cost Sankey' : 'No model usage yet'}
              </div>
              <div className="text-fg-2 text-[11px] font-mono mt-1">
                {hasModels ? `token flow · providers → models → cost · ${range} window` : 'run a few chats and come back'}
              </div>
            </div>
          </button>
        </Panel>
      </div>
    </div>
  )
}

function UsageTab({ m }: { m: Metrics | null }) {
  const tokensSeries = (m?.tokensBySource || []).slice(0, 3).map((s, i) => ({
    name: s.model, color: ['var(--accent)', 'var(--warn)', 'var(--ok)'][i] || 'var(--accent)',
    data: toSeries(s.data), label: `${s.model} ${fmtNum(m?.tokenTotalsBySource?.[s.model])}`,
  }))
  const topUsers = (m?.perUserUsage || []).slice(0, 6)
  const topModels = (m?.modelUsage || []).slice(0, 5)

  return (
    <div className="space-y-2.5">
      {tokensSeries.length > 0
        ? <ChartPanel title="tokens · 24h · by provider" right={m?.summary.totalTokens != null ? `${fmtNum(m.summary.totalTokens)} total` : ''} series={tokensSeries} yFormat={v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0)}/>
        : <ChartPanel title="tokens · 24h" series={[{ name: 'tokens', color: 'var(--accent)', data: toSeries(m?.timeSeries.tokenUsage) }]}/>
      }
      <div className="grid grid-cols-2 gap-2.5">
        <Panel title="top users · by tokens" right={topUsers.length ? `${topUsers.length} tracked` : ''}>
          {topUsers.length ? (
            <table className="w-full text-[11px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-fg-3 border-b border-ln-2"><th className="text-left py-1.5 px-3 font-mono">user</th><th className="text-right py-1.5 px-3 font-mono">sessions</th><th className="text-right py-1.5 px-3 font-mono">tokens</th><th className="text-right py-1.5 px-3 font-mono">spend</th></tr></thead>
              <tbody>{topUsers.map(u => (
                <tr key={u.userId} className="border-t border-ln-1 hover:bg-bg-2">
                  <td className="py-1.5 px-3 font-mono text-[11px] text-fg-1">{u.email || u.name}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-0">{u.sessions}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-0">{fmtNum(u.tokens)}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-0">{fmtMoney(u.cost)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="p-4 text-fg-3 text-[11px] font-mono">no per-user data yet</div>}
        </Panel>
        <Panel title="top models · by tokens">
          {topModels.length ? (
            <table className="w-full text-[11px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-fg-3 border-b border-ln-2"><th className="text-left py-1.5 px-3 font-mono">model</th><th className="text-right py-1.5 px-3 font-mono">calls</th><th className="text-right py-1.5 px-3 font-mono">tokens</th><th className="text-right py-1.5 px-3 font-mono">cost</th></tr></thead>
              <tbody>{topModels.map(r => (
                <tr key={r.model} className="border-t border-ln-1 hover:bg-bg-2">
                  <td className="py-1.5 px-3 font-mono text-[11px] text-fg-1">{r.model}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-0">{r.count}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-0">{fmtNum(r.tokens)}</td>
                  <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-0">{fmtMoney(r.cost)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="p-4 text-fg-3 text-[11px] font-mono">no model usage data yet</div>}
        </Panel>
      </div>
    </div>
  )
}

function CostTab({ m }: { m: Metrics | null }) {
  const cbm = m?.costByModel || []
  const totalCost = (m?.summary.totalCost ?? 0) + (m?.summary.totalCodeCost ?? 0) + (m?.summary.agentTotalCost ?? 0)
  const costSeries = cbm.slice(0, 4).map((s, i) => ({
    name: s.model, color: ['var(--accent)', 'var(--warn)', 'var(--err)', 'var(--ok)'][i] || 'var(--accent)',
    data: toSeries(s.data), label: s.model,
  }))

  // bar rows from modelUsage costs
  const bars = (m?.modelUsage || []).slice(0, 5).map(r => ({ lbl: r.model, cost: r.cost }))
  const maxCost = Math.max(1, ...bars.map(b => b.cost))

  return (
    <div className="space-y-2.5">
      {costSeries.length
        ? <ChartPanel title="spend · by model" right={fmtMoney(totalCost) + ' total'} series={costSeries} yFormat={v => '$' + v.toFixed(2)}/>
        : <ChartPanel title="spend" series={[{ name: 'cost', color: 'var(--warn)', data: toSeries(m?.timeSeries.tokenUsage) }]} yFormat={v => '$' + v.toFixed(2)}/>
      }
      <div className="grid grid-cols-2 gap-2.5">
        <Panel title="cost breakdown · by model">
          {bars.length ? (
            <div className="p-2">{bars.map(b => (
              <div key={b.lbl} className="grid grid-cols-[160px_1fr_80px] items-center gap-3 py-1.5 px-3 text-[11px] font-mono">
                <span className="text-fg-2 truncate">{b.lbl}</span>
                <div className="h-1.5 bg-bg-3 rounded overflow-hidden"><div className="h-full bg-pri rounded" style={{ width: `${(b.cost/maxCost)*100}%` }}/></div>
                <span className="text-right tabular-nums text-fg-0 font-semibold">{fmtMoney(b.cost)}</span>
              </div>
            ))}</div>
          ) : <div className="p-4 text-fg-3 text-[11px] font-mono">no cost data</div>}
        </Panel>
        <Panel title="totals">
          <div className="p-4">
            <div className="font-mono text-[32px] font-bold text-fg-0 leading-none">{fmtMoney(totalCost)}</div>
            <div className="text-fg-2 text-[11px] mt-1">total · {m ? 'live' : '—'}</div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-[11px]">
              <span className="text-fg-2">chat</span><span className="text-fg-0 text-right tabular-nums">{fmtMoney(m?.summary.totalCost ?? 0)}</span>
              <span className="text-fg-2">code</span><span className="text-fg-0 text-right tabular-nums">{fmtMoney(m?.summary.totalCodeCost ?? 0)}</span>
              <span className="text-fg-2">agents</span><span className="text-fg-0 text-right tabular-nums">{fmtMoney(m?.summary.agentTotalCost ?? 0)}</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function FlowsTab({ m }: { m: Metrics | null }) {
  const wf = m?.workflowMetrics
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <ChartPanel title="workflow executions" right={wf ? `${wf.totalWorkflows} flows · ${wf.successRate?.toFixed(0)}% success` : ''}
          series={[{ name: 'runs', color: 'var(--ok)', data: toSeries(m?.timeSeries.workflowExecutions) }]}/>
        <ChartPanel title="agent runs" right={m?.summary.totalAgentExecutions != null ? `${m.summary.totalAgentExecutions} runs · ${fmtMoney(m.summary.agentTotalCost)}` : ''}
          series={[{ name: 'agents', color: 'var(--accent)', data: toSeries(m?.timeSeries.agentExecutions) }]}/>
      </div>
      {wf && (
        <div className="grid grid-cols-4 gap-2.5">
          {(['completed','running','pending','failed'] as const).map(k => (
            <Panel key={k} title={k}>
              <div className="p-4 text-center">
                <div className={`font-mono text-[32px] font-bold leading-none ${k === 'failed' ? 'text-err' : k === 'completed' ? 'text-ok' : 'text-fg-0'}`}>{wf.statusCounts[k] ?? 0}</div>
                <div className="text-fg-3 text-[10px] uppercase tracking-wider mt-2 font-mono">{k}</div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}

function McpTab({ m }: { m: Metrics | null }) {
  const tools = (m?.mcpToolUsage || []).slice(0, 10)
  return (
    <div className="space-y-2.5">
      <ChartPanel title="mcp tool calls · over time" right={m?.summary.totalMcpCalls != null ? `${fmtNum(m.summary.totalMcpCalls)} total` : ''}
        series={[{ name: 'calls', color: 'var(--accent)', data: toSeries(m?.timeSeries.messages) }]}/>
      <Panel title="top tools">
        {tools.length ? (
          <table className="w-full text-[11px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-fg-3 border-b border-ln-2"><th className="text-left py-1.5 px-3 font-mono">tool</th><th className="text-right py-1.5 px-3 font-mono">calls</th></tr></thead>
            <tbody>{tools.map(t => (
              <tr key={t.tool} className="border-t border-ln-1 hover:bg-bg-2">
                <td className="py-1.5 px-3 font-mono text-fg-1">{t.tool}</td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums text-fg-0">{t.count.toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="p-4 text-fg-3 text-[11px] font-mono">no MCP tool calls recorded in this range</div>}
      </Panel>
    </div>
  )
}

function ApiTab({ m }: { m: Metrics | null }) {
  const api = m?.apiMetrics
  return (
    <div className="space-y-2.5">
      <ChartPanel title="request rate" right={api ? `${fmtNum(api.totalRequests)} · avg ${api.avgResponseTime?.toFixed(0)}ms` : ''}
        series={[{ name: 'req', color: 'var(--accent)', data: toSeries(m?.timeSeries.apiRequests) }]}/>
      <div className="grid grid-cols-3 gap-2.5">
        <Panel title="error rate"><div className="p-5 text-center">
          <div className={`font-mono text-[32px] font-bold leading-none ${api && api.errorRate > 1 ? 'text-err' : 'text-ok'}`}>{api ? `${api.errorRate.toFixed(2)}%` : '—'}</div>
          <div className="text-fg-3 text-[10px] uppercase tracking-wider mt-2 font-mono">{api ? `${api.errorCount} errors` : ''}</div>
        </div></Panel>
        <Panel title="avg response"><div className="p-5 text-center">
          <div className="font-mono text-[32px] font-bold text-fg-0 leading-none">{api ? `${api.avgResponseTime.toFixed(0)}ms` : '—'}</div>
          <div className="text-fg-3 text-[10px] uppercase tracking-wider mt-2 font-mono">avg response time</div>
        </div></Panel>
        <Panel title="requests by source">
          {api?.bySource?.length ? (
            <div className="p-2">{api.bySource.slice(0, 6).map(r => (
              <div key={r.source} className="grid grid-cols-[120px_1fr_60px] items-center gap-2 py-1 px-3 text-[11px] font-mono">
                <span className="text-fg-2 truncate">{r.source}</span>
                <div className="h-1 bg-bg-3 rounded overflow-hidden"><div className="h-full bg-pri rounded" style={{ width: `${(r.count / api.totalRequests) * 100}%` }}/></div>
                <span className="text-right tabular-nums text-fg-0">{r.count.toLocaleString()}</span>
              </div>
            ))}</div>
          ) : <div className="p-4 text-fg-3 text-[11px] font-mono">no source data</div>}
        </Panel>
      </div>
    </div>
  )
}

function InfraTab({ m }: { m: Metrics | null }) {
  return (
    <div className="space-y-2.5">
      <Panel title="platform totals">
        <div className="p-4 grid grid-cols-4 gap-4">
          <div><div className="text-fg-3 text-[10px] uppercase tracking-wider font-mono">embeddings</div><div className="font-mono text-[22px] text-fg-0 font-bold mt-1">{fmtNum(m?.summary.totalEmbeddings)}</div></div>
          <div><div className="text-fg-3 text-[10px] uppercase tracking-wider font-mono">images gen</div><div className="font-mono text-[22px] text-fg-0 font-bold mt-1">{fmtNum(m?.summary.totalImages)}</div></div>
          <div><div className="text-fg-3 text-[10px] uppercase tracking-wider font-mono">mcp calls</div><div className="font-mono text-[22px] text-fg-0 font-bold mt-1">{fmtNum(m?.summary.totalMcpCalls)}</div></div>
          <div><div className="text-fg-3 text-[10px] uppercase tracking-wider font-mono">active users</div><div className="font-mono text-[22px] text-fg-0 font-bold mt-1">{fmtNum(m?.summary.activeUsers)}</div></div>
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-2.5">
        <ChartPanel title="embeddings · over time" series={[{ name: 'emb', color: 'var(--accent)', data: toSeries(m?.timeSeries.embeddings) }]}/>
        <ChartPanel title="images · over time" series={[{ name: 'img', color: 'var(--ok)', data: toSeries(m?.timeSeries.images) }]}/>
      </div>
      <Panel title="infrastructure-level metrics">
        <div className="p-4 text-fg-3 text-[11px] font-mono">
          Per-service health / pod status / resource usage lives in Grafana (linked via the sidebar). Admin-v2 phase-4 will wire kube-state-metrics via <span className="text-fg-1">/api/admin/prom/*</span>.
        </div>
      </Panel>
    </div>
  )
}
