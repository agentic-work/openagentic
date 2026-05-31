import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  Panel,
  SectionBar,
  StatusDot,
} from '../primitives-v3'
import {
  useOllamaHosts,
  useLlmRegistry,
} from '../hooks/useDashboardMetrics'
import { OllamaHostsPane } from './llm-extras/OllamaHostsPane'
import { TieredFcPane } from './llm-extras/TieredFcPane'

// ============================================================
// Public sub-tab type — leaf ids map cleanly via TAB_ALIASES below.
// ============================================================
export type LLMExtrasTab = 'ollama' | 'tiered-fc' | 'performance'

// Leaf id → sub-tab. Sidebar leaves use slightly different ids
// (e.g. `llm-performance`, `ollama-hosts`) so we normalize here.
const TAB_ALIASES: Record<string, LLMExtrasTab> = {
  ollama: 'ollama',
  'ollama-hosts': 'ollama',
  'tiered-fc': 'tiered-fc',
  tiered: 'tiered-fc',
  'llm-performance': 'performance',
  performance: 'performance',
}

const TABS = [
  { id: 'ollama',      label: 'Ollama Hosts' },
  { id: 'tiered-fc',   label: 'Tiered Function Calling' },
  { id: 'performance', label: 'Performance Metrics' },
]

export interface LLMExtrasHubPageProps {
  /**
   * Initial sub-tab — set by the host shell from the leaf id. The
   * sidebar uses `ollama` (not `ollama-hosts`); both are accepted.
   */
  initialTab?: LLMExtrasTab | string
}

export const LLMExtrasHubPage: React.FC<LLMExtrasHubPageProps> = ({
  initialTab = 'ollama',
}) => {
  const safeInitial: LLMExtrasTab =
    TAB_ALIASES[initialTab as string] ?? 'ollama'

  const [tab, setTab] = React.useState<LLMExtrasTab>(safeInitial)
  const [pending, setPending] = React.useState<string | null>(null)

  // Re-mount when the host pushes a fresh leaf id.
  React.useEffect(() => {
    setTab(safeInitial)
  }, [safeInitial])

  const showPending = React.useCallback((label: string) => {
    setPending(label)
    window.setTimeout(() => setPending(null), 4000)
  }, [])

  const ollamaQ = useOllamaHosts()
  const regQ = useLlmRegistry(true)

  // KPI roll-ups — derived from the hooks above. We never fabricate;
  // missing data renders as '—'.
  const hostCount = ollamaQ.data?.hosts?.length
  const connectedHosts = ollamaQ.data?.hosts?.filter((h) => h.status === 'connected').length ?? 0

  // tier-1 / tier-2 model counts come from the registry rows. Without
  // a registry tier column we fall back to counting rows per priority
  // bucket (lower priority = higher tier in the v2 convention).
  const registryRows = regQ.data ?? []
  const tier1Count = React.useMemo(() => {
    return registryRows.filter((r) => r.priority != null && r.priority <= 10).length
  }, [registryRows])
  const tier2Count = React.useMemo(() => {
    return registryRows.filter(
      (r) => r.priority != null && r.priority > 10 && r.priority <= 50,
    ).length
  }, [registryRows])

  const refreshAll = () => {
    ollamaQ.refetch?.()
    regQ.refetch?.()
  }

  const anyError = ollamaQ.isError || regQ.isError
  const anyLoading = ollamaQ.isLoading || regQ.isLoading

  const meta = (
    <>
      <StatusDot status={anyError ? 'err' : anyLoading ? 'idle' : 'ok'} />
      <span style={{ marginLeft: 6 }}>
        {anyLoading
          ? 'loading…'
          : `${hostCount ?? '—'} ollama hosts · ${registryRows.length} registry rows`}
      </span>
    </>
  )

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? "LLM Operations"}
        meta={meta}
        actions={
          <Btn variant="ghost" onClick={refreshAll}>
            refresh
          </Btn>
        }
      />

      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as LLMExtrasTab)} />

      {pending && (
        <Banner level="info" label="pending">
          mutation wire-up pending — &quot;{pending}&quot; is read-only in the v3 native page.
          Use the v2 fallback (<span className="accent">?v3=0</span>) to write.
        </Banner>
      )}
      {anyError && (
        <Banner level="warn" label="warn">
          one or more upstream endpoints failed (
          <span className="accent">/api/admin/ollama/hosts</span>) — values may be partial
        </Banner>
      )}

      <KpiGrid cols={3}>
        <Kpi
          label="ollama hosts"
          value={
            ollamaQ.isLoading
              ? '…'
              : hostCount == null
                ? '—'
                : `${connectedHosts} / ${hostCount}`
          }
          sub={hostCount != null ? `${hostCount} registered` : 'no hosts'}
          tone={
            hostCount == null || hostCount === 0
              ? 'default'
              : connectedHosts === hostCount
                ? 'ok'
                : connectedHosts === 0
                  ? 'err'
                  : 'warn'
          }
        />
        <Kpi
          label="tier-1 models"
          value={regQ.isLoading ? '…' : String(tier1Count)}
          sub="priority ≤ 10 · routed first"
        />
        <Kpi
          label="tier-2 models"
          value={regQ.isLoading ? '…' : String(tier2Count)}
          sub="priority 11–50 · fallback pool"
        />
      </KpiGrid>

      {tab === 'ollama' && <OllamaHostsPane onStub={showPending} />}
      {tab === 'tiered-fc' && <TieredFcPane />}
      {tab === 'performance' && (
        <>
          <SectionBar title="performance metrics" />
          <Panel>
            <div style={{ padding: '32px 24px', textAlign: 'center' }}>
              <p style={{ color: 'var(--fg-2)', fontSize: 14, marginBottom: 6, fontWeight: 600 }}>
                LLM performance metrics
              </p>
              <p style={{ color: 'var(--fg-3)', fontSize: 12 }}>
                TTFT, latency percentiles, and throughput aren&apos;t available in this build.
              </p>
            </div>
          </Panel>
        </>
      )}
    </>
  )
}

export default LLMExtrasHubPage
