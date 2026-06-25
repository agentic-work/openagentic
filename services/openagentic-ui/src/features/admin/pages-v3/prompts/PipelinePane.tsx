import * as React from 'react'
import {
  Panel,
  PanelHead,
  Banner,
  SectionBar,
  Btn,
} from '../../primitives-v3'

const Row: React.FC<{
  label: string
  hint: string
  to: string
  toLabel: string
}> = ({ label, hint, to, toLabel }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr auto',
      gap: 14,
      alignItems: 'center',
      padding: '10px 14px',
      borderTop: '1px solid var(--line-1)',
    }}
  >
    <div style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      {label}
    </div>
    <div style={{ color: 'var(--fg-2)', fontSize: 12 }}>{hint}</div>
    <Btn
      variant="ghost"
      onClick={() => {
        if (typeof window !== 'undefined') {
          window.location.hash = to
        }
      }}
    >
      {toLabel} →
    </Btn>
  </div>
)

export const PipelinePane: React.FC = () => {
  return (
    <>
      <Banner level="warn" label="deprecated">
        <span>
          The chat-pipeline configuration UI was retired with the V1 pipeline rip on
          2026-05-05. The capabilities that used to live here have been redistributed
          across the surfaces below. <span className="accent">/api/admin/pipeline-config</span>{' '}
          is gone — it returns 404 — and its source files were deleted (see
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {' '}wave5-v1-pipeline-deletion.source-regression.test.ts
          </span>).
        </span>
      </Banner>

      <SectionBar
        title="where the old settings live now"
        right={<span style={{ color: 'var(--fg-3)' }}>read-only navigation</span>}
      />
      <Panel>
        <PanelHead title="redistributed surfaces" />
        <div>
          <Row
            label="routing weights"
            hint="alpha / beta / gamma scoring + tier-routing knobs (was: pipeline.multiModel)"
            to="#router-tuning"
            toLabel="Router Tuning"
          />
          <Row
            label="prompt modules"
            hint="composable system prompts that injection-rules pick per-context (was: pipeline.prompt skills)"
            to="#prompt-modules"
            toLabel="Modules tab"
          />
          <Row
            label="effectiveness"
            hint="positive / negative outcomes per module (was: prompt-effectiveness leaf)"
            to="#prompt-effectiveness"
            toLabel="Effectiveness tab"
          />
          <Row
            label="prompt metrics"
            hint="per-session prompt + injection telemetry (was: prompt-metrics leaf)"
            to="#prompt-metrics"
            toLabel="Metrics tab"
          />
          <Row
            label="model defaults"
            hint="which model serves each system role"
            to="#default-models"
            toLabel="Default Models"
          />
          <Row
            label="provider config"
            hint="auth, base URLs, health, rate limits"
            to="#providers"
            toLabel="Providers"
          />
        </div>
      </Panel>

      <Banner level="info" label="why">
        The V2 pipeline is compiled — its sequence of stages is checked into source,
        not driven by a JSON config. This eliminated the entire class of
        "config silently overrode source" bugs that haunted V1 (see{' '}
        <span className="accent">CLAUDE.md sev-0 patterns</span>). Any setting
        that still belongs to a single feature now lives on that feature's
        own admin page, not a global stage form.
      </Banner>
    </>
  )
}
