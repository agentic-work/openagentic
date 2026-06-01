import * as React from 'react'
import { SidePanel, Banner, Btn, FormGrid, FormRow } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'
import {
  type RoleKey,
  type DefaultModels,
  type DefaultModelsResponse,
  ROLE_KEYS,
  ROLE_META,
  AUTO_VALUE,
} from './types'
import type { LlmRegistryRow } from '../../hooks/useDashboardMetrics'
import type { ToastApi } from '../_shared/mutationHelpers'
import { useAdminInvalidate } from '../../hooks/useAdminQuery'

export interface RoleAssignModalProps {
  open: boolean
  onClose: () => void
  /** Pre-selected role (optional). When set, the role dropdown locks. */
  role: RoleKey | null
  /** Pre-selected model (optional). When set, model dropdown shows it pre-filled. */
  preselectModel: string | null
  defaults: DefaultModels | null
  registry: LlmRegistryRow[] | undefined
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

export const RoleAssignModal: React.FC<RoleAssignModalProps> = ({
  open,
  onClose,
  role: lockedRole,
  preselectModel,
  defaults,
  registry,
  toast,
}) => {
  const invalidate = useAdminInvalidate()
  const [role, setRole] = React.useState<RoleKey>('chat')
  const [model, setModel] = React.useState<string>('')
  const [saving, setSaving] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setErr(null)
    const initialRole = lockedRole ?? 'chat'
    setRole(initialRole)
    const fallback = defaults?.[initialRole] ?? ''
    setModel(preselectModel ?? fallback ?? '')
  }, [open, lockedRole, preselectModel, defaults])

  // Filter registry rows by role-compatible capability for the model dropdown.
  const candidateModels = React.useMemo<LlmRegistryRow[]>(() => {
    const rows = registry ?? []
    if (rows.length === 0) return []
    if (role === 'embedding') {
      return rows.filter((r) => {
        const caps = (r.capabilities ?? {}) as Record<string, unknown>
        return caps.embeddings === true || r.role === 'embedding'
      })
    }
    if (role === 'vision') {
      return rows.filter((r) => {
        const caps = (r.capabilities ?? {}) as Record<string, unknown>
        return caps.vision === true
      })
    }
    if (role === 'imageGen') {
      return rows.filter((r) => {
        const caps = (r.capabilities ?? {}) as Record<string, unknown>
        return caps.imageGeneration === true || r.role === 'image-generation'
      })
    }
    return rows
  }, [registry, role])

  const handleSave = async () => {
    if (!model) {
      setErr('select a model')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const patch: Partial<DefaultModels> = { [role]: model }
      const res = await apiRequest('/api/admin/llm-providers/default-models', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      const data: DefaultModelsResponse | { message?: string; error?: string } | null = await res
        .json()
        .catch(() => null)
      if (!res.ok) {
        const msg = (data as any)?.message || (data as any)?.error || `HTTP ${res.status}`
        setErr(String(msg).slice(0, 240))
        return
      }
      toast.show('ok', 'saved', `${ROLE_META[role].label} → ${model}`)
      invalidate(['default-models'])
      invalidate(['llm-registry', 'enabled'])
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
      title={lockedRole ? `Switch · ${ROLE_META[lockedRole].label}` : 'Assign Role'}
      meta={lockedRole ? ROLE_META[lockedRole].useCase : 'pick a role + model'}
    >
      {err && (
        <Banner level="err" label="error">
          {err}
        </Banner>
      )}
      <FormGrid>
        <FormRow name="Role" desc="role to (re)assign">
          <select
            value={role}
            disabled={lockedRole != null}
            onChange={(e) => setRole(e.target.value as RoleKey)}
            style={inputStyle}
          >
            {ROLE_KEYS.map((k) => (
              <option key={k} value={k}>
                {ROLE_META[k].label} ({k})
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow name="Model" desc={`${candidateModels.length} candidate model${candidateModels.length === 1 ? '' : 's'} for this role`}>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            <option value="">— select model —</option>
            <option value={AUTO_VALUE}>auto · let smart-router pick</option>
            {candidateModels.map((r) => (
              <option key={r.id} value={r.model}>
                {r.model} · {(r as any).provider_display_name ?? r.provider}
              </option>
            ))}
          </select>
        </FormRow>
        {defaults?.[role] && defaults[role] !== model && (
          <FormRow name="Currently">
            <span className="mono" style={{ color: 'var(--fg-3)' }}>
              {defaults[role]}
            </span>
          </FormRow>
        )}
      </FormGrid>

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
          {saving ? 'saving…' : 'save assignment'}
        </Btn>
      </div>
    </SidePanel>
  )
}

export default RoleAssignModal
