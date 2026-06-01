import * as React from 'react'
import { SidePanel, Banner, Btn, FormGrid, FormRow } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'
import {
  PROVIDER_META,
  type AuthMode,
  type ProviderType,
} from '../../components/LLM/LLMProviderManagement/types'
import type { LlmProviderRow } from '../../hooks/useDashboardMetrics'
import type { ToastApi } from '../_shared/mutationHelpers'
import { useAdminInvalidate } from '../../hooks/useAdminQuery'
import { deriveOrigin } from './deriveOrigin'

export interface ProviderModalProps {
  open: boolean
  onClose: () => void
  /** When provided, the modal opens in edit mode for this row. */
  editing: LlmProviderRow | null
  toast: ToastApi
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 28,
  padding: '0 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  background: 'var(--bg-0)',
  border: '1px solid var(--line-1)',
  color: 'var(--fg-0)',
  outline: 'none',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 80,
  padding: 8,
  resize: 'vertical',
}

const PROVIDER_TYPES: ProviderType[] = [
  'azure-openai',
  'azure-ai-foundry',
  'vertex-ai',
  'aws-bedrock',
  'ollama',
  'anthropic',
  'openai',
]

interface FormState {
  name: string
  displayName: string
  providerType: ProviderType
  priority: number
  enabled: boolean
  description: string
  authMode: AuthMode
  authValues: Record<string, string>
  providerConfig: Record<string, any>
}

const blankState = (): FormState => ({
  name: '',
  displayName: '',
  providerType: 'openai',
  priority: 50,
  enabled: true,
  description: '',
  authMode: 'api-key',
  authValues: {},
  providerConfig: {},
})

function fromRow(row: LlmProviderRow): FormState {
  const raw = row as any
  const ac = raw.auth_config ?? raw.authConfig ?? {}
  const pc = raw.provider_config ?? raw.config ?? {}
  return {
    name: row.name,
    displayName: row.displayName ?? row.name,
    providerType: (row.type as ProviderType) ?? 'openai',
    priority: row.priority ?? 50,
    enabled: row.enabled !== false,
    description: raw.description ?? '',
    authMode: (ac.tenantId ? 'entra-id' : 'api-key') as AuthMode,
    authValues: { ...ac },
    providerConfig: { ...pc },
  }
}

export const ProviderModal: React.FC<ProviderModalProps> = ({ open, onClose, editing, toast }) => {
  const invalidate = useAdminInvalidate()
  const isEdit = editing != null
  const [form, setForm] = React.useState<FormState>(blankState)
  const [saving, setSaving] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  // Reset on open
  React.useEffect(() => {
    if (!open) return
    setErr(null)
    setForm(editing ? fromRow(editing) : blankState())
  }, [open, editing])

  const meta = PROVIDER_META[form.providerType]
  const authFields = meta?.authModes?.[form.authMode] ?? meta?.authFields ?? []
  const providerConfigFields = meta?.providerConfigFields ?? []

  const setAuthVal = (key: string, value: string) =>
    setForm((s) => ({ ...s, authValues: { ...s.authValues, [key]: value } }))
  const setConfigVal = (key: string, value: any) =>
    setForm((s) => ({ ...s, providerConfig: { ...s.providerConfig, [key]: value } }))

  const validate = (): string | null => {
    if (!form.name.trim()) return 'name is required (lowercase, kebab-case)'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.name.trim()))
      return 'name must be lowercase letters/digits/dashes only'
    if (!form.displayName.trim()) return 'display name is required'
    for (const f of authFields) {
      if (f.required && !form.authValues[f.key]) return `${f.label} is required`
    }
    return null
  }

  const handleSave = async () => {
    const v = validate()
    if (v) {
      setErr(v)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      // FedRAMP discriminator — per-provider-type required origin fields
      // (see services/openagentic-api/src/services/llm-providers/
      // ProviderDiscriminatorSchema.ts). The v3 modal doesn't expose a
      // separate Origin section; deriveOrigin computes every required
      // field from the auth/config the operator already filled in.
      const providerConfig: Record<string, any> = { ...form.providerConfig }
      providerConfig.origin = deriveOrigin({
        providerType: form.providerType,
        auth: form.authValues,
        existingOrigin: providerConfig.origin as Record<string, string | undefined> | undefined,
        hostStr: String(
          providerConfig.host ?? providerConfig.baseUrl ?? providerConfig.endpoint ?? '',
        ),
        providerName: form.name,
      })

      const payload: any = {
        name: form.name.trim(),
        displayName: form.displayName.trim(),
        // The api destructures camelCase (`providerType`, `authConfig`,
        // `providerConfig`). Sending snake_case yields `undefined` for
        // those required fields and the api 400s with "Missing required
        // fields" — without indicating which. Sev-1 caught 2026-05-11.
        providerType: form.providerType,
        priority: form.priority,
        enabled: form.enabled,
        description: form.description.trim() || undefined,
        authConfig: form.authValues,
        providerConfig,
      }
      const url = isEdit
        ? `/api/admin/llm-providers/${editing!.id}`
        : '/api/admin/llm-providers'
      // Edit carries optimistic concurrency token (version)
      if (isEdit) {
        payload.version = (editing as any).version ?? 1
      }
      const res = await apiRequest(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      if (res.status === 409) {
        const d = await res.json().catch(() => ({}))
        const fields = Array.isArray(d.conflictingFields)
          ? ` (${d.conflictingFields.join(', ')})`
          : ''
        setErr(
          `another admin saved this provider before your changes landed${fields}. close + reopen to reload`,
        )
        toast.show('err', 'conflict', 'concurrent edit detected — reload before retrying')
        return
      }
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        let parsed: any
        try {
          parsed = JSON.parse(t)
        } catch {
          // not JSON
        }
        const msg = parsed?.message || parsed?.error || t || `HTTP ${res.status}`
        setErr(msg.slice(0, 240))
        return
      }
      toast.show('ok', 'saved', `provider "${payload.displayName}" ${isEdit ? 'updated' : 'created'}`)
      invalidate(['llm-providers'])
      invalidate(['provider-health'])
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit · ${editing!.displayName ?? editing!.name}` : 'Add Provider'}
      meta={isEdit ? `${editing!.type}` : undefined}
    >
      {err && (
        <Banner level="err" label="error">
          {err}
        </Banner>
      )}
      <FormGrid>
        <FormRow name="Name" desc="lowercase id, used in URLs and audit logs">
          <input
            type="text"
            value={form.name}
            disabled={isEdit}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            style={inputStyle}
            placeholder="e.g. azure-prod-eastus"
          />
        </FormRow>
        <FormRow name="Display name" desc="shown in operator UI">
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))}
            style={inputStyle}
            placeholder="e.g. Azure OpenAI (East US)"
          />
        </FormRow>
        <FormRow name="Provider type" desc="determines auth schema">
          <select
            value={form.providerType}
            disabled={isEdit}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                providerType: e.target.value as ProviderType,
                authValues: {},
                providerConfig: {},
              }))
            }
            style={inputStyle}
          >
            {PROVIDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROVIDER_META[t]?.label ?? t}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow name="Priority" desc="lower = preferred (0–100)">
          <input
            type="number"
            min={0}
            max={100}
            value={form.priority}
            onChange={(e) => setForm((s) => ({ ...s, priority: Number(e.target.value) }))}
            style={inputStyle}
          />
        </FormRow>
        <FormRow name="Enabled">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
          />
        </FormRow>
        <FormRow name="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
            style={textareaStyle}
            placeholder="optional notes"
          />
        </FormRow>
      </FormGrid>

      {meta?.authModes && (
        <FormGrid>
          <FormRow name="Auth mode" desc="API Key uses static key; Entra-ID uses AAD app-reg">
            <select
              value={form.authMode}
              onChange={(e) =>
                setForm((s) => ({ ...s, authMode: e.target.value as AuthMode, authValues: {} }))
              }
              style={inputStyle}
            >
              {Object.keys(meta.authModes).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FormRow>
        </FormGrid>
      )}

      <FormGrid>
        {authFields.map((f) => (
          <FormRow
            key={f.key}
            name={`${f.label}${f.required ? ' *' : ''}`}
            configKey={`auth_config.${f.key}`}
          >
            {f.type === 'textarea' ? (
              <textarea
                value={form.authValues[f.key] ?? ''}
                onChange={(e) => setAuthVal(f.key, e.target.value)}
                style={textareaStyle}
                placeholder={f.placeholder}
              />
            ) : (
              <input
                type={f.type === 'password' ? 'password' : 'text'}
                value={form.authValues[f.key] ?? ''}
                onChange={(e) => setAuthVal(f.key, e.target.value)}
                style={inputStyle}
                placeholder={f.placeholder}
              />
            )}
          </FormRow>
        ))}
      </FormGrid>

      {providerConfigFields.length > 0 && (
        <FormGrid>
          {providerConfigFields.map((f) => (
            <FormRow
              key={f.key}
              name={f.label}
              desc={f.help}
              configKey={`provider_config.${f.key}`}
            >
              {f.type === 'toggle' ? (
                <input
                  type="checkbox"
                  checked={form.providerConfig[f.key] != null ? !!form.providerConfig[f.key] : !!f.default}
                  onChange={(e) => setConfigVal(f.key, e.target.checked)}
                />
              ) : f.type === 'select' && f.options ? (
                <select
                  value={form.providerConfig[f.key] ?? f.default ?? ''}
                  onChange={(e) => setConfigVal(f.key, e.target.value)}
                  style={inputStyle}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'number' ? (
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={form.providerConfig[f.key] ?? f.default ?? 0}
                  onChange={(e) => setConfigVal(f.key, Number(e.target.value))}
                  style={inputStyle}
                />
              ) : f.type === 'textarea' ? (
                <textarea
                  value={form.providerConfig[f.key] ?? f.default ?? ''}
                  onChange={(e) => setConfigVal(f.key, e.target.value)}
                  style={textareaStyle}
                  placeholder={f.placeholder}
                />
              ) : (
                <input
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={form.providerConfig[f.key] ?? f.default ?? ''}
                  onChange={(e) => setConfigVal(f.key, e.target.value)}
                  style={inputStyle}
                  placeholder={f.placeholder}
                />
              )}
            </FormRow>
          ))}
        </FormGrid>
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
        <Btn variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'saving…' : isEdit ? 'save changes' : 'create provider'}
        </Btn>
      </div>
    </SidePanel>
  )
}

export default ProviderModal
