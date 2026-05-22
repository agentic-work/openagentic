import * as React from 'react'
import { SidePanel, Banner, Btn, FormGrid, FormRow } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'
import type { ModelRow } from './types'
import type { LlmProviderRow } from '../../hooks/useDashboardMetrics'
import type { ToastApi } from '../_shared/mutationHelpers'
import { useAdminInvalidate } from '../../hooks/useAdminQuery'

export interface ModelModalProps {
  open: boolean
  onClose: () => void
  /** When provided, modal opens in edit mode for this row. */
  editing: ModelRow | null
  /** Provider list to populate the provider dropdown in add mode. */
  providers: LlmProviderRow[] | undefined
  toast: ToastApi
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 28,
  padding: '0 8px',
  fontFamily: 'var(--font-v3-mono)',
  fontSize: 12,
  background: 'var(--bg-0)',
  border: '1px solid var(--line-1)',
  color: 'var(--fg-0)',
  outline: 'none',
}

const ROLE_OPTIONS = ['chat', 'code', 'embedding', 'vision', 'image-generation', 'reasoning']

interface AddState {
  providerName: string
  modelId: string
  displayName: string
  role: string
  maxOutputTokens: number
  temperature: number
  enabled: boolean
  capChat: boolean
  capTools: boolean
  capVision: boolean
  capEmbeddings: boolean
  capStreaming: boolean
}

interface EditState {
  enabled: boolean
  role: string
  maxTokens: number | null
  temperature: number | null
  inputCostPer1k: number | null
  outputCostPer1k: number | null
  capChat: boolean
  capTools: boolean
  capVision: boolean
  capEmbeddings: boolean
  capStreaming: boolean
  capThinking: boolean
}

const blankAdd = (): AddState => ({
  providerName: '',
  modelId: '',
  displayName: '',
  role: 'chat',
  maxOutputTokens: 8192,
  temperature: 0.7,
  enabled: true,
  capChat: true,
  capTools: false,
  capVision: false,
  capEmbeddings: false,
  capStreaming: true,
})

const fromEditRow = (row: ModelRow): EditState => ({
  enabled: row.enabled,
  role: row.role || 'chat',
  maxTokens: row.maxTokens,
  temperature: typeof (row.raw as any).temperature === 'number' ? (row.raw as any).temperature : null,
  inputCostPer1k: row.inputCostPer1k,
  outputCostPer1k: row.outputCostPer1k,
  capChat: row.caps.chat,
  capTools: row.caps.tools,
  capVision: row.caps.vision,
  capEmbeddings: row.caps.embeddings,
  capStreaming: row.caps.streaming,
  capThinking: row.caps.thinking,
})

export const ModelModal: React.FC<ModelModalProps> = ({ open, onClose, editing, providers, toast }) => {
  const invalidate = useAdminInvalidate()
  const isEdit = editing != null
  const [addForm, setAddForm] = React.useState<AddState>(blankAdd)
  const [editForm, setEditForm] = React.useState<EditState | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setErr(null)
    if (editing) {
      setEditForm(fromEditRow(editing))
    } else {
      const enabledProviders = (providers ?? []).filter((p) => p.enabled !== false)
      const firstProvider = enabledProviders[0]?.name ?? ''
      setAddForm({ ...blankAdd(), providerName: firstProvider })
      setEditForm(null)
    }
  }, [open, editing, providers])

  const handleSaveEdit = async () => {
    if (!editing || !editForm) return
    setSaving(true)
    setErr(null)
    try {
      // PATCH the registry row directly. The api accepts a partial of:
      //   enabled, role, temperature, max_tokens, capabilities, pricing fields
      const body: any = {
        enabled: editForm.enabled,
        role: editForm.role,
        temperature: editForm.temperature,
        max_tokens: editForm.maxTokens,
        capabilities: {
          chat: editForm.capChat,
          tools: editForm.capTools,
          vision: editForm.capVision,
          embeddings: editForm.capEmbeddings,
          streaming: editForm.capStreaming,
          thinking: editForm.capThinking,
        },
      }
      if (editForm.inputCostPer1k != null) body.inputCostPer1k = editForm.inputCostPer1k
      if (editForm.outputCostPer1k != null) body.outputCostPer1k = editForm.outputCostPer1k

      const res = await apiRequest(`/api/admin/llm-providers/registry/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        setErr(t.slice(0, 240) || `HTTP ${res.status}`)
        return
      }
      toast.show('ok', 'saved', `updated "${editing.model}"`)
      invalidate(['llm-registry', 'enabled'])
      invalidate(['llm-registry', 'all'])
      invalidate(['llm-providers'])
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAdd = async () => {
    if (!addForm.providerName) {
      setErr('select a provider')
      return
    }
    if (!addForm.modelId.trim()) {
      setErr('model id is required')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const body = {
        modelId: addForm.modelId.trim(),
        displayName: addForm.displayName.trim() || addForm.modelId.trim(),
        capabilities: {
          chat: addForm.capChat,
          tools: addForm.capTools,
          vision: addForm.capVision,
          embeddings: addForm.capEmbeddings,
          streaming: addForm.capStreaming,
        },
        config: {
          maxOutputTokens: addForm.maxOutputTokens,
          temperature: addForm.temperature,
          enabled: addForm.enabled,
          roles: [addForm.role],
        },
      }
      const res = await apiRequest(
        `/api/admin/llm-providers/${encodeURIComponent(addForm.providerName)}/models`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      if (res.status === 409) {
        setErr(`model "${body.modelId}" already in registry for ${addForm.providerName}`)
        return
      }
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        setErr(t.slice(0, 240) || `HTTP ${res.status}`)
        return
      }
      toast.show('ok', 'added', `added "${body.modelId}" to ${addForm.providerName}`)
      invalidate(['llm-registry', 'enabled'])
      invalidate(['llm-registry', 'all'])
      invalidate(['llm-providers'])
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const setEdit = <K extends keyof EditState>(key: K, value: EditState[K]) =>
    setEditForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit · ${editing!.model}` : 'Add Model'}
      meta={isEdit ? `${editing!.providerDisplay} · ${editing!.role}` : 'register a model on a provider'}
    >
      {err && (
        <Banner level="err" label="error">
          {err}
        </Banner>
      )}

      {isEdit && editForm ? (
        <>
          <FormGrid>
            <FormRow name="Model id" desc="immutable">
              <span className="mono">{editing!.model}</span>
            </FormRow>
            <FormRow name="Provider" desc="immutable">
              <span className="mono">{editing!.providerDisplay}</span>
            </FormRow>
            <FormRow name="Role" configKey="registry.role">
              <select
                value={editForm.role}
                onChange={(e) => setEdit('role', e.target.value)}
                style={inputStyle}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow name="Enabled">
              <input
                type="checkbox"
                checked={editForm.enabled}
                onChange={(e) => setEdit('enabled', e.target.checked)}
              />
            </FormRow>
            <FormRow name="Max tokens" configKey="registry.max_tokens">
              <input
                type="number"
                min={1}
                value={editForm.maxTokens ?? ''}
                onChange={(e) => setEdit('maxTokens', e.target.value ? Number(e.target.value) : null)}
                style={inputStyle}
              />
            </FormRow>
            <FormRow name="Temperature" configKey="registry.temperature">
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={editForm.temperature ?? ''}
                onChange={(e) =>
                  setEdit('temperature', e.target.value ? Number(e.target.value) : null)
                }
                style={inputStyle}
              />
            </FormRow>
          </FormGrid>

          <FormGrid>
            <FormRow name="Pricing override" desc="USD per 1k input tokens (overrides catalog)" configKey="registry.inputCostPer1k">
              <input
                type="number"
                step={0.0001}
                min={0}
                value={editForm.inputCostPer1k ?? ''}
                onChange={(e) =>
                  setEdit('inputCostPer1k', e.target.value ? Number(e.target.value) : null)
                }
                style={inputStyle}
              />
            </FormRow>
            <FormRow name="Output cost / 1k" configKey="registry.outputCostPer1k">
              <input
                type="number"
                step={0.0001}
                min={0}
                value={editForm.outputCostPer1k ?? ''}
                onChange={(e) =>
                  setEdit('outputCostPer1k', e.target.value ? Number(e.target.value) : null)
                }
                style={inputStyle}
              />
            </FormRow>
          </FormGrid>

          <FormGrid>
            <FormRow name="Chat">
              <input type="checkbox" checked={editForm.capChat} onChange={(e) => setEdit('capChat', e.target.checked)} />
            </FormRow>
            <FormRow name="Tools">
              <input type="checkbox" checked={editForm.capTools} onChange={(e) => setEdit('capTools', e.target.checked)} />
            </FormRow>
            <FormRow name="Vision">
              <input type="checkbox" checked={editForm.capVision} onChange={(e) => setEdit('capVision', e.target.checked)} />
            </FormRow>
            <FormRow name="Embeddings">
              <input
                type="checkbox"
                checked={editForm.capEmbeddings}
                onChange={(e) => setEdit('capEmbeddings', e.target.checked)}
              />
            </FormRow>
            <FormRow name="Streaming">
              <input
                type="checkbox"
                checked={editForm.capStreaming}
                onChange={(e) => setEdit('capStreaming', e.target.checked)}
              />
            </FormRow>
            <FormRow name="Thinking">
              <input
                type="checkbox"
                checked={editForm.capThinking}
                onChange={(e) => setEdit('capThinking', e.target.checked)}
              />
            </FormRow>
          </FormGrid>
        </>
      ) : (
        <>
          <FormGrid>
            <FormRow name="Provider" desc="enabled providers only">
              <select
                value={addForm.providerName}
                onChange={(e) => setAddForm((s) => ({ ...s, providerName: e.target.value }))}
                style={inputStyle}
              >
                <option value="">— select provider —</option>
                {(providers ?? [])
                  .filter((p) => p.enabled !== false)
                  .map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.displayName ?? p.name} ({p.type})
                    </option>
                  ))}
              </select>
            </FormRow>
            <FormRow name="Model id" desc="provider-native model id">
              <input
                type="text"
                value={addForm.modelId}
                onChange={(e) => setAddForm((s) => ({ ...s, modelId: e.target.value }))}
                style={inputStyle}
                placeholder="e.g. gpt-4o, claude-sonnet-4-5, gemini-2.5-flash"
              />
            </FormRow>
            <FormRow name="Display name" desc="optional; defaults to model id">
              <input
                type="text"
                value={addForm.displayName}
                onChange={(e) => setAddForm((s) => ({ ...s, displayName: e.target.value }))}
                style={inputStyle}
              />
            </FormRow>
            <FormRow name="Role">
              <select
                value={addForm.role}
                onChange={(e) => setAddForm((s) => ({ ...s, role: e.target.value }))}
                style={inputStyle}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow name="Max output tokens">
              <input
                type="number"
                min={1}
                value={addForm.maxOutputTokens}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, maxOutputTokens: Number(e.target.value) }))
                }
                style={inputStyle}
              />
            </FormRow>
            <FormRow name="Temperature">
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={addForm.temperature}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, temperature: Number(e.target.value) }))
                }
                style={inputStyle}
              />
            </FormRow>
            <FormRow name="Enabled on add">
              <input
                type="checkbox"
                checked={addForm.enabled}
                onChange={(e) => setAddForm((s) => ({ ...s, enabled: e.target.checked }))}
              />
            </FormRow>
          </FormGrid>

          <FormGrid>
            <FormRow name="Chat">
              <input
                type="checkbox"
                checked={addForm.capChat}
                onChange={(e) => setAddForm((s) => ({ ...s, capChat: e.target.checked }))}
              />
            </FormRow>
            <FormRow name="Tools">
              <input
                type="checkbox"
                checked={addForm.capTools}
                onChange={(e) => setAddForm((s) => ({ ...s, capTools: e.target.checked }))}
              />
            </FormRow>
            <FormRow name="Vision">
              <input
                type="checkbox"
                checked={addForm.capVision}
                onChange={(e) => setAddForm((s) => ({ ...s, capVision: e.target.checked }))}
              />
            </FormRow>
            <FormRow name="Embeddings">
              <input
                type="checkbox"
                checked={addForm.capEmbeddings}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, capEmbeddings: e.target.checked }))
                }
              />
            </FormRow>
            <FormRow name="Streaming">
              <input
                type="checkbox"
                checked={addForm.capStreaming}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, capStreaming: e.target.checked }))
                }
              />
            </FormRow>
          </FormGrid>
        </>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '14px 0 4px',
          justifyContent: 'flex-end',
          borderTop: '1px solid var(--line-1)',
          marginTop: 12,
        }}
      >
        <Btn variant="ghost" onClick={onClose} disabled={saving}>
          cancel
        </Btn>
        <Btn variant="primary" onClick={isEdit ? handleSaveEdit : handleSaveAdd} disabled={saving}>
          {saving ? 'saving…' : isEdit ? 'save changes' : 'add to registry'}
        </Btn>
      </div>
    </SidePanel>
  )
}

export default ModelModal
