import * as React from 'react'
import {
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  SectionBar,
  Dt,
  type DtCol,
  StatusDot,
  Btn,
  type Status,
} from '../../primitives-v3'
import { useTestHarness } from '../../components/Testing/useTestHarness'

interface TestResult {
  category: string
  test: string
  status: 'pass' | 'fail' | 'skip' | 'running'
  durationMs?: number
  error?: string
  details?: any
  timestamp?: string
}

const CATEGORIES: { id: string; label: string; description: string }[] = [
  { id: 'health', label: 'System', description: 'health endpoints, db connectivity, queue lag' },
  { id: 'models', label: 'LLM Models', description: 'one chat round-trip per registered model' },
  { id: 'chat', label: 'Chat', description: 'streaming + tool-call round-trip via fastify.inject' },
  { id: 'agents', label: 'Agents', description: 'sub-agent dispatch + return shape (skips when proxy absent)' },
  { id: 'k8s', label: 'K8s Cluster', description: 'pod-status sanity + restart deltas (skips on RBAC 403)' },
  { id: 'mcp', label: 'MCP Servers', description: 'list-tools, call a known idempotent tool' },
  { id: 'workflows', label: 'Workflows', description: 'execute a seeded probe workflow' },
  { id: 'code', label: 'Code Mode', description: 'openagentic session spawn + smoke prompt' },
]

const statusToDot = (s: TestResult['status']): Status => {
  if (s === 'pass') return 'ok'
  if (s === 'fail') return 'err'
  if (s === 'skip') return 'warn'
  return 'idle'
}

export const TestsPane: React.FC = () => {
  const { results, running, summary, startTests, stopTests } = useTestHarness()

  const passed = summary?.passed ?? results.filter((r) => r.status === 'pass').length
  const failed = summary?.failed ?? results.filter((r) => r.status === 'fail').length
  const skipped = summary?.skipped ?? results.filter((r) => r.status === 'skip').length
  const total = summary?.totalTests ?? results.length

  // Group by category for the catalog table
  const byCategory = React.useMemo(() => {
    const map = new Map<string, TestResult[]>()
    for (const r of results) {
      const arr = map.get(r.category) ?? []
      arr.push(r)
      map.set(r.category, arr)
    }
    return map
  }, [results])

  const onLightItUp = () => {
    if (running) {
      stopTests()
    } else {
      startTests(CATEGORIES.map((c) => c.id))
    }
  }

  const onRunCategory = (categoryId: string) => {
    if (running) return
    startTests([categoryId])
  }

  const catalogCols: DtCol<{ id: string; label: string; description: string }>[] = [
    { key: 'cat', label: 'category', className: 'mono', render: (r) => r.id },
    { key: 'name', label: 'name', className: 'name', render: (r) => r.label },
    { key: 'desc', label: 'description', render: (r) => r.description },
    {
      key: 'last',
      label: 'last result',
      align: 'right',
      width: '180px',
      render: (r) => {
        const arr = byCategory.get(r.id) ?? []
        if (arr.length === 0) {
          return <span style={{ color: 'var(--fg-3)' }}>—</span>
        }
        const p = arr.filter((x) => x.status === 'pass').length
        const f = arr.filter((x) => x.status === 'fail').length
        const s = arr.filter((x) => x.status === 'skip').length
        return (
          <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 'var(--v3-t-meta)' }}>
            <span style={{ color: 'var(--ok)' }}>{p}p</span>
            {' · '}
            <span style={{ color: f > 0 ? 'var(--err)' : 'var(--fg-2)' }}>{f}f</span>
            {' · '}
            <span style={{ color: s > 0 ? 'var(--warn)' : 'var(--fg-2)' }}>{s}s</span>
          </span>
        )
      },
    },
    {
      key: 'run',
      label: '',
      align: 'right',
      width: '90px',
      render: (r) => (
        <Btn
          variant="ghost"
          onClick={() => onRunCategory(r.id)}
          disabled={running}
          data-testid={`harness-run-${r.id}`}
        >
          run
        </Btn>
      ),
    },
  ]

  const resultCols: DtCol<TestResult>[] = [
    {
      key: 'st',
      label: '',
      width: '24px',
      render: (r) => <StatusDot status={statusToDot(r.status)} />,
    },
    { key: 'cat', label: 'category', className: 'mono', render: (r) => r.category },
    { key: 'test', label: 'test', className: 'name', render: (r) => r.test },
    {
      key: 'dur',
      label: 'duration',
      align: 'right',
      className: 'num',
      render: (r) =>
        typeof r.durationMs === 'number' ? `${r.durationMs}ms` : '—',
    },
    {
      key: 'err',
      label: 'error',
      render: (r) =>
        r.error ? (
          <span style={{ color: 'var(--err)' }}>
            {r.error.slice(0, 120)}
            {r.error.length > 120 ? '…' : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
  ]

  return (
    <>
      <SectionBar
        title="test harness"
        right={
          <Btn
            variant={running ? 'ghost' : 'primary'}
            onClick={onLightItUp}
            data-testid="harness-light-it-up"
          >
            {running ? `stop (${total} tests)` : 'light it up'}
          </Btn>
        }
      />

      <Banner level="info" label="cost">
        Running tests incurs LLM token usage for chat / models / agents
        categories. The capstone is simulated and free. Stop anytime to
        cancel — partial results are kept.
      </Banner>

      <KpiGrid cols={4}>
        <Kpi
          label="categories"
          value={CATEGORIES.length.toLocaleString()}
          sub="covered by harness"
        />
        <Kpi
          label="status"
          value={running ? 'running' : total > 0 ? 'idle' : 'never run'}
          sub={running ? `${total} so far` : ''}
          tone={running ? 'default' : failed > 0 ? 'err' : passed > 0 ? 'ok' : 'default'}
        />
        <Kpi
          label="passed / total"
          value={`${passed.toLocaleString()} / ${total.toLocaleString()}`}
          sub={`${skipped.toLocaleString()} skipped`}
          tone={total > 0 && failed === 0 && passed > 0 ? 'ok' : 'default'}
        />
        <Kpi
          label="failures"
          value={failed.toLocaleString()}
          sub={total > 0 ? 'from last run' : ''}
          tone={failed > 0 ? 'err' : 'default'}
        />
      </KpiGrid>

      <SectionBar title="categories" />
      <Panel>
        <PanelHead title="catalog" count={CATEGORIES.length} />
        <Dt
          columns={catalogCols}
          rows={CATEGORIES}
          rowKey={(r) => r.id}
        />
      </Panel>

      <SectionBar title="results" />
      <Panel>
        <PanelHead title="live + last run" count={results.length} />
        {results.length === 0 ? (
          <EmptyInline pad>no results yet — click "light it up" to run</EmptyInline>
        ) : (
          <Dt
            columns={resultCols}
            rows={results}
            rowKey={(r, i) => `${r.category}-${r.test}-${i}`}
          />
        )}
      </Panel>
    </>
  )
}

export default TestsPane
