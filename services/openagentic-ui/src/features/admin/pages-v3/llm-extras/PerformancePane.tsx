/**
 * LLM Performance pane — enterprise analytics.
 *
 * The /api/admin/metrics/llm/performance and /performance-trends endpoints
 * are deleted in OSS. Render the enterprise upsell instead of fetching a
 * 404 endpoint and showing empty/error states.
 */
import * as React from 'react'
import { Panel, SectionBar } from '../../primitives-v3'

export const PerformancePane: React.FC = () => (
  <>
    <SectionBar
      title="performance metrics"
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
        <p style={{ color: 'var(--fg-3)', fontSize: 12, marginBottom: 20 }}>
          LLM performance metrics (TTFT, latency percentiles, per-model breakdown) require the hosted edition.
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
