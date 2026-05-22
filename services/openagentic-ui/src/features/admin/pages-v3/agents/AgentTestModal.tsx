import * as React from 'react'
import { SidePanel, Btn, Banner } from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'
import type { AdminAgentRow } from '../../hooks/useDashboardMetrics'

export interface AgentTestModalProps {
  open: boolean
  onClose: () => void
  agent: AdminAgentRow | null
}

interface TestResponse {
  output?: string
  response?: string
  error?: string
  metrics?: {
    modelUsed?: string
    totalInputTokens?: number
    totalOutputTokens?: number
  }
  results?: Array<{ toolCallsExecuted?: Array<{ name?: string }> }>
}

interface TestVars {
  id: string
  task: string
}

export const AgentTestModal: React.FC<AgentTestModalProps> = ({ open, onClose, agent }) => {
  const [task, setTask] = React.useState('')
  const [output, setOutput] = React.useState<TestResponse | null>(null)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)
  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!open) return
    setTask('')
    setOutput(null)
    setErrorMsg(null)
    setStartedAt(null)
    setElapsedMs(null)
  }, [open, agent?.id])

  const testM = useAdminMutation<TestResponse, TestVars>(
    (vars) => `/api/admin/agents/${encodeURIComponent(vars.id)}/test`,
    {
      method: 'POST',
      bodyOf: ({ task }) => ({ task, message: task }),
      onSuccess: (data) => {
        if (startedAt) setElapsedMs(Date.now() - startedAt)
        setOutput(data)
      },
      onError: (err) => {
        if (startedAt) setElapsedMs(Date.now() - startedAt)
        setErrorMsg(err.message)
      },
    },
  )

  const onRun = (e: React.FormEvent) => {
    e.preventDefault()
    if (!agent || !task.trim()) return
    setOutput(null)
    setErrorMsg(null)
    setStartedAt(Date.now())
    setElapsedMs(null)
    testM.mutate({ id: agent.id, task: task.trim() })
  }

  const busy = testM.isPending
  const responseText =
    output?.output ?? output?.response ?? output?.error ?? (output ? JSON.stringify(output, null, 2) : null)
  const tools = (output?.results ?? [])
    .flatMap((r) => r.toolCallsExecuted ?? [])
    .map((t) => t.name)
    .filter(Boolean) as string[]

  return (
    <SidePanel
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={agent ? `Test · ${agent.display_name ?? agent.name ?? agent.id}` : 'Test agent'}
      meta="POST /api/admin/agents/:id/test"
    >
      <form onSubmit={onRun} style={{ display: 'grid', gap: 12 }}>
        <Field label="task" desc="single-message harness · agent runs to completion">
          <textarea
            className="aw-input"
            autoFocus
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="list my Azure resource groups"
            rows={4}
            disabled={busy}
            required
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            close
          </Btn>
          <Btn variant="primary" type="submit" disabled={busy || !task.trim() || !agent}>
            {busy ? 'running…' : 'run test'}
          </Btn>
        </div>

        {errorMsg && (
          <Banner level="err" label="error">
            {errorMsg}
          </Banner>
        )}
        {responseText && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div
              style={{
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-meta)',
                color: 'var(--fg-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              response
              {output?.metrics?.modelUsed && (
                <span style={{ marginLeft: 10, color: 'var(--fg-2)' }}>
                  · {output.metrics.modelUsed}
                </span>
              )}
              {elapsedMs != null && (
                <span style={{ marginLeft: 10, color: 'var(--fg-2)' }}>
                  · {(elapsedMs / 1000).toFixed(1)}s
                </span>
              )}
              {tools.length > 0 && (
                <span style={{ marginLeft: 10, color: 'var(--fg-2)' }}>
                  · tools: {tools.join(', ')}
                </span>
              )}
            </div>
            <pre
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--line-1)',
                padding: 10,
                color: 'var(--fg-1)',
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-body, 12px)',
                whiteSpace: 'pre-wrap',
                margin: 0,
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              {responseText}
            </pre>
          </div>
        )}
      </form>
    </SidePanel>
  )
}

const Field: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({
  label,
  desc,
  children,
}) => (
  <div style={{ display: 'grid', gap: 4 }}>
    <label
      style={{
        fontFamily: 'var(--font-v3-mono)',
        fontSize: 'var(--v3-t-meta)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--fg-2)',
      }}
    >
      {label}
    </label>
    {desc && (
      <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>{desc}</span>
    )}
    {children}
  </div>
)

export default AgentTestModal
