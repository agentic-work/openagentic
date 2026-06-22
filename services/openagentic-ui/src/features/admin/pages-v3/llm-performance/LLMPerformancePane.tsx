/**
 * LLM Performance pane.
 *
 * The underlying /api/admin/prom proxy and gen_ai.* OTel metrics aren't
 * wired in this build, so the pane shows a neutral empty-state instead of
 * empty charts / "no data" states.
 */
import * as React from 'react'
import { Panel, SectionBar } from '../../primitives-v3'

interface Props {
  timeRange: string
}

const LLMPerformancePane: React.FC<Props> = () => (
  <>
    <SectionBar title="llm & router analytics" />
    <Panel>
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--fg-2)', fontSize: 14, marginBottom: 6, fontWeight: 600 }}>
          LLM &amp; Router analytics
        </p>
        <p style={{ color: 'var(--fg-3)', fontSize: 12 }}>
          TTFT / TPOT latency charts, per-model throughput, finish-reason distribution, and
          router decision analytics aren&apos;t available in this build.
        </p>
      </div>
    </Panel>
  </>
)

export default LLMPerformancePane
