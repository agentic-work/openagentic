/**
 * LLM Performance pane — enterprise analytics tab.
 *
 * The underlying /api/admin/prom proxy and gen_ai.* OTel metrics are
 * only available in the hosted edition. OSS shows the enterprise upsell
 * instead of empty charts / "no data" states.
 */
import * as React from 'react'
import { Panel, SectionBar } from '../../primitives-v3'

interface Props {
  timeRange: string
}

const LLMPerformancePane: React.FC<Props> = () => (
  <>
    <SectionBar
      title="advanced analytics"
      right={
        <a
          href="https://agenticwork.io"
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: 'var(--accent)', fontSize: 11, textDecoration: 'none' }}
        >
          upgrade → agenticwork.io
        </a>
      }
    />
    <Panel>
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--fg-2)', fontSize: 14, marginBottom: 6, fontWeight: 600 }}>
          Advanced Analytics — Enterprise Edition
        </p>
        <p style={{ color: 'var(--fg-3)', fontSize: 12, marginBottom: 4 }}>
          LLM &amp; Router analytics require the hosted edition.
        </p>
        <p style={{ color: 'var(--fg-3)', fontSize: 12, marginBottom: 20 }}>
          TTFT / TPOT latency charts, per-model throughput, finish-reason distribution,
          OTel gen_ai.* metrics, and router decision analytics.
        </p>
        <a
          href="https://agenticwork.io"
          target="_blank"
          rel="noreferrer noopener"
          style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 6,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Learn more at agenticwork.io
        </a>
      </div>
    </Panel>
  </>
)

export default LLMPerformancePane
