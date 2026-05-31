/**
 * LLM Performance pane.
 *
 * The /api/admin/metrics/llm/performance and /performance-trends endpoints
 * aren't wired in this build, so the pane shows a neutral empty-state
 * instead of fetching a 404 endpoint and showing empty/error states.
 */
import * as React from 'react'
import { Panel, SectionBar } from '../../primitives-v3'

export const PerformancePane: React.FC = () => (
  <>
    <SectionBar title="performance metrics" />
    <Panel>
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--fg-2)', fontSize: 14, marginBottom: 6, fontWeight: 600 }}>
          LLM performance metrics
        </p>
        <p style={{ color: 'var(--fg-3)', fontSize: 12 }}>
          TTFT, latency percentiles, and per-model breakdown aren&apos;t available in this build.
        </p>
      </div>
    </Panel>
  </>
)
