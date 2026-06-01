import * as React from 'react'
import {
  PageHead,
  Banner,
  Panel,
  PanelHead,
  Btn,
  StatusDot,
} from '../primitives-v3'
import { useChatLoopConfig, type ChatLoopConfigValues } from '../hooks/useDashboardMetrics'
import { apiRequest } from '@/utils/api'
import { useToast, ToastStack } from './_shared/mutationHelpers'
import { useAdminInvalidate } from '../hooks/useAdminQuery'

// Mirrors ChatLoopConfigService's MAX_TURNS_FLOOR / MAX_TURNS_CEILING.
// Backend re-validates so this is only the client-side guard rail; the
// service rejects out-of-range writes with 400.
const MAX_TURNS_FLOOR = 4
const MAX_TURNS_CEILING = 100
const MAX_TURNS_DEFAULT = 24

export const ChatLoopConfigPage: React.FC = () => {
  const configQ = useChatLoopConfig()
  const toast = useToast()
  const invalidate = useAdminInvalidate()

  const saved: ChatLoopConfigValues = configQ.data?.config ?? { maxTurns: MAX_TURNS_DEFAULT }
  const floor = configQ.data?.meta?.maxTurnsFloor ?? MAX_TURNS_FLOOR
  const ceiling = configQ.data?.meta?.maxTurnsCeiling ?? MAX_TURNS_CEILING

  const [dirty, setDirty] = React.useState<Partial<ChatLoopConfigValues>>({})
  const [saving, setSaving] = React.useState(false)

  const effectiveMaxTurns = dirty.maxTurns ?? saved.maxTurns
  const isDirty = dirty.maxTurns !== undefined && dirty.maxTurns !== saved.maxTurns

  const inRange = (n: number) =>
    Number.isInteger(n) && n >= floor && n <= ceiling

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '') {
      setDirty((p) => ({ ...p, maxTurns: undefined as any }))
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    // Drop dirty if it matches saved
    if (parsed === saved.maxTurns) {
      setDirty((p) => {
        const { maxTurns: _drop, ...rest } = p
        return rest
      })
      return
    }
    setDirty((p) => ({ ...p, maxTurns: parsed }))
  }

  const handleDiscard = () => setDirty({})

  const handleSave = async () => {
    if (!isDirty || dirty.maxTurns === undefined) return
    if (!inRange(dirty.maxTurns)) {
      toast.show(
        'err',
        'invalid value',
        `maxTurns must be an integer in [${floor}, ${ceiling}]`,
      )
      return
    }
    setSaving(true)
    try {
      const res = await apiRequest('/api/admin/chat-loop-config', {
        method: 'PUT',
        body: JSON.stringify({ maxTurns: dirty.maxTurns }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        toast.show('err', 'save failed', t.slice(0, 200) || `HTTP ${res.status}`)
        return
      }
      toast.show('ok', 'saved', `maxTurns set to ${dirty.maxTurns}`)
      setDirty({})
      invalidate(['chat-loop-config'])
    } catch (err: any) {
      toast.show('err', 'save failed', err?.message ?? 'unknown')
    } finally {
      setSaving(false)
    }
  }

  const inputInvalid =
    dirty.maxTurns !== undefined && !inRange(dirty.maxTurns)

  return (
    <>
      <PageHead
        title="Chat Loop Config"
        meta={
          <>
            <StatusDot status={configQ.isError ? 'err' : 'ok'} />
            <span style={{ marginLeft: 6 }}>
              ChatLoopConfigService — chat_loop
            </span>
            {isDirty && (
              <>
                <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
                <span style={{ color: 'var(--warn)' }}>unsaved change</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Btn variant="ghost" onClick={handleDiscard} disabled={!isDirty || saving}>
              discard
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSave}
              disabled={!isDirty || saving || inputInvalid}
            >
              {saving ? 'saving…' : 'save & apply'}
            </Btn>
          </>
        }
      />

      <ToastStack api={toast} />

      {configQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/chat-loop-config</span> —
          falling back to defaults
        </Banner>
      )}

      <Banner level="info" label="why this exists">
        Max-turns is the cap on chat-loop ReAct iterations. The 2026-05-11
        multi-cloud capstone hit the prior hardcoded 12-cap during 32-tool
        cascade fanout. Operators now lift this cap live — no redeploy.
        Range: {floor}–{ceiling}.
      </Banner>

      <Panel>
        <PanelHead title="chat_loop.max_turns" />
        <div style={{ padding: 16, display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label
              htmlFor="chat-loop-max-turns"
              style={{
                minWidth: 140,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--fg-1)',
              }}
            >
              max_turns
            </label>
            <input
              id="chat-loop-max-turns"
              type="number"
              min={floor}
              max={ceiling}
              step={1}
              value={effectiveMaxTurns}
              onChange={onInputChange}
              style={{
                width: 96,
                height: 28,
                padding: '0 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                background: 'var(--bg-0)',
                border: `1px solid ${
                  inputInvalid ? 'var(--err)' : 'var(--accent-line)'
                }`,
                color: 'var(--fg-0)',
                outline: 'none',
              }}
              data-testid="chat-loop-max-turns-input"
            />
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-3)',
              }}
            >
              saved: {saved.maxTurns} · range [{floor}, {ceiling}]
            </span>
          </div>
          {inputInvalid && (
            <Banner level="err" label="invalid">
              maxTurns must be an integer in [{floor}, {ceiling}]
            </Banner>
          )}
          <div
            style={{
              fontSize: 11,
              color: 'var(--fg-3)',
              lineHeight: 1.5,
              maxWidth: 720,
            }}
          >
            Higher values give the model more headroom for multi-step tool
            chains (e.g. multi-cloud audits, deep cascades). Lower values
            shorten the safety cap on pathological loops. The default
            (24) is 2x the prior hardcoded 12 — adjust to your workload.
          </div>
        </div>
      </Panel>
    </>
  )
}

export default ChatLoopConfigPage
