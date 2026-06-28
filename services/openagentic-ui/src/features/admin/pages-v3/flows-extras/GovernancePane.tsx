import * as React from 'react'
import {
  Panel,
  PanelHead,
  Banner,
  EmptyInline,
  FormGrid,
  FormRow,
  LockedTag,
  SectionBar,
} from '../../primitives-v3'
import { type WorkflowSettings } from './types'

interface FieldSpec {
  key: string
  label: string
  desc: string
  format?: (v: unknown) => React.ReactNode
}

const fmtNumber = (v: unknown): React.ReactNode => {
  if (v == null) return <em style={{ color: 'var(--fg-3)' }}>unset</em>
  return String(v)
}
const fmtBool = (v: unknown): React.ReactNode => {
  if (v == null) return <em style={{ color: 'var(--fg-3)' }}>unset</em>
  return v ? 'on' : 'off'
}
const fmtUsd = (v: unknown): React.ReactNode => {
  if (v == null || typeof v !== 'number') return <em style={{ color: 'var(--fg-3)' }}>unset</em>
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}
const fmtCsv = (v: unknown): React.ReactNode => {
  if (v == null) return <em style={{ color: 'var(--fg-3)' }}>unset</em>
  if (Array.isArray(v)) return v.length === 0 ? 'none' : v.join(', ')
  return String(v)
}
const fmtSec = (v: unknown): React.ReactNode => {
  if (v == null || typeof v !== 'number') return <em style={{ color: 'var(--fg-3)' }}>unset</em>
  return `${v}s`
}
const fmtMs = (v: unknown): React.ReactNode => {
  if (v == null || typeof v !== 'number') return <em style={{ color: 'var(--fg-3)' }}>unset</em>
  return `${v}ms`
}

const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'execution limits',
    fields: [
      { key: 'defaultNodeTimeout', label: 'Default node timeout', desc: 'Per-node default before a step is killed', format: fmtSec },
      { key: 'maxNodeTimeout', label: 'Max node timeout', desc: 'Hard ceiling regardless of per-node config', format: fmtSec },
      { key: 'maxExecutionTime', label: 'Max execution time', desc: 'End-to-end run duration cap', format: fmtSec },
      { key: 'maxNodesPerWorkflow', label: 'Max nodes per workflow', desc: 'Static guardrail on workflow size', format: fmtNumber },
      { key: 'maxConcurrentExecutions', label: 'Concurrent executions (org)', desc: 'Org-wide cap on running flows', format: fmtNumber },
      { key: 'maxConcurrentPerUser', label: 'Concurrent executions (user)', desc: 'Per-user concurrency cap', format: fmtNumber },
      { key: 'maxExecutionsPerHourPerUser', label: 'Hourly run cap (user)', desc: 'Sliding-window throttle per user', format: fmtNumber },
    ],
  },
  {
    title: 'cost governance',
    fields: [
      { key: 'defaultPerExecutionBudget', label: 'Default per-execution budget', desc: 'USD ceiling on a single run', format: fmtUsd },
      { key: 'maxPerExecutionBudget', label: 'Max per-execution budget', desc: 'USD hard cap admins cannot override', format: fmtUsd },
      { key: 'defaultDailyBudgetPerUser', label: 'Default daily budget (user)', desc: 'USD per-user daily allowance', format: fmtUsd },
      { key: 'defaultMonthlyBudgetPerUser', label: 'Default monthly budget (user)', desc: 'USD per-user monthly allowance', format: fmtUsd },
      { key: 'onBudgetExceeded', label: 'On budget exceeded', desc: 'Action when a run exceeds its budget', format: fmtNumber },
    ],
  },
  {
    title: 'model & agent',
    fields: [
      { key: 'maxAgentTurns', label: 'Max agent turns', desc: 'Loop ceiling for sub-agents', format: fmtNumber },
      { key: 'maxToolCallsPerAgent', label: 'Max tool calls per agent', desc: 'Tool-call budget per agent invocation', format: fmtNumber },
      { key: 'agentCostBudgetCap', label: 'Agent cost cap (USD)', desc: 'Hard cost ceiling for a single agent run', format: fmtUsd },
      { key: 'requireApprovalForHighRiskTools', label: 'HITL on high-risk tools', desc: 'Require human approval for high-risk tool calls', format: fmtBool },
      { key: 'highRiskToolsList', label: 'High-risk tools list', desc: 'Comma-separated tool names that trigger HITL', format: fmtCsv },
    ],
  },
  {
    title: 'node & error handling',
    fields: [
      { key: 'disabledNodeTypes', label: 'Disabled node types', desc: 'Globally blocked node types', format: fmtCsv },
      { key: 'defaultRetryCount', label: 'Default retry count', desc: 'Auto-retry attempts per failed node', format: fmtNumber },
      { key: 'defaultRetryDelay', label: 'Default retry delay', desc: 'Base wait before re-running a failed node', format: fmtMs },
      { key: 'defaultBackoffStrategy', label: 'Default backoff strategy', desc: 'fixed | exponential', format: fmtNumber },
      { key: 'defaultOnError', label: 'Default on-error behavior', desc: 'stop | continue | retry', format: fmtNumber },
    ],
  },
  {
    title: 'memory & context',
    fields: [
      { key: 'crossModeMemoryEnabled', label: 'Cross-mode memory', desc: 'Carry memory between chat / agents / flows', format: fmtBool },
      { key: 'memoryRetentionDays', label: 'Memory retention (days)', desc: 'Auto-prune entries older than this', format: fmtNumber },
      { key: 'maxMemoryEntriesPerUser', label: 'Max memory entries (user)', desc: 'Hard cap per-user before LRU eviction', format: fmtNumber },
    ],
  },
]

export interface GovernancePaneProps {
  data: WorkflowSettings | null | undefined
  isLoading: boolean
  isError: boolean
}

export const GovernancePane: React.FC<GovernancePaneProps> = ({ data, isLoading, isError }) => {
  if (isError) {
    return (
      <Banner level="err" label="error">
        failed to load <span className="accent">/api/admin/workflow-settings</span> — governance
        config is read-only here; use <span className="accent">?v3=0</span> to fall back to v2 to edit.
      </Banner>
    )
  }
  if (isLoading) {
    return <EmptyInline pad>loading /api/admin/workflow-settings…</EmptyInline>
  }

  return (
    <>
      <Banner level="info" label="read-only">
        Governance config renders the live response from{' '}
        <span className="accent">/api/admin/workflow-settings</span>. Mutations stay in the v2
        view (<span className="accent">?v3=0</span>) until v3 wires the PUT path.
      </Banner>
      {SECTIONS.map((section) => (
        <React.Fragment key={section.title}>
          <SectionBar title={section.title} count={section.fields.length} />
          <Panel>
            <PanelHead title={section.title} />
            <FormGrid>
              {section.fields.map((f) => (
                <FormRow
                  key={f.key}
                  name={f.label}
                  desc={f.desc}
                  configKey={f.key}
                  status={<LockedTag />}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-1)' }}>
                    {(f.format ?? fmtNumber)(data?.[f.key])}
                  </span>
                </FormRow>
              ))}
            </FormGrid>
          </Panel>
        </React.Fragment>
      ))}
    </>
  )
}

export default GovernancePane
