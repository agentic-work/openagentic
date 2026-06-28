import * as React from 'react'
import { SidePanel, Btn, Banner, Toggle, Chip } from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'
import type {
  AdminAgentRow,
  AdminAgentSkillRow,
} from '../../hooks/useDashboardMetrics'

export interface AgentModalProps {
  open: boolean
  onClose: () => void
  /** Undefined → create mode. Defined → edit mode (prefilled). */
  editing?: AdminAgentRow | null
  /** Skills picker source. */
  skills: AdminAgentSkillRow[]
  /** Called after a successful create or update. */
  onSaved?: () => void
}

interface CreatePayload {
  name: string
  displayName: string
  description?: string
  agentType: string
  skills: string[]
  enabled: boolean
  category?: string
}

interface UpdatePayload {
  id: string
  name?: string
  displayName?: string
  description?: string
  agentType?: string
  skills?: string[]
  enabled?: boolean
}

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const AgentModal: React.FC<AgentModalProps> = ({
  open,
  onClose,
  editing,
  skills,
  onSaved,
}) => {
  const isEdit = !!editing
  const [displayName, setDisplayName] = React.useState('')
  const [name, setName] = React.useState('')
  const [nameDirty, setNameDirty] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const [agentType, setAgentType] = React.useState('custom')
  const [skillIds, setSkillIds] = React.useState<string[]>([])
  const [enabled, setEnabled] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setNameDirty(false)
    if (editing) {
      setDisplayName(editing.display_name ?? editing.name ?? '')
      setName(editing.name ?? '')
      setDescription(editing.description ?? '')
      setAgentType(editing.agent_type ?? 'custom')
      setSkillIds(editing.skills ?? [])
      setEnabled(editing.enabled !== false)
    } else {
      setDisplayName('')
      setName('')
      setDescription('')
      setAgentType('custom')
      setSkillIds([])
      setEnabled(true)
    }
  }, [open, editing])

  // Auto-derive slug from displayName when the user hasn't manually
  // edited the name field. This matches the v2 form behavior.
  React.useEffect(() => {
    if (!nameDirty && !isEdit) {
      setName(slugify(displayName))
    }
  }, [displayName, nameDirty, isEdit])

  const createM = useAdminMutation<{ id: string }, CreatePayload>(
    '/api/admin/agents',
    {
      method: 'POST',
      invalidateKeys: [['admin-agents'], ['admin-agents-metrics']],
      onSuccess: () => {
        onSaved?.()
        onClose()
      },
      onError: (err) => setError(err.message),
    },
  )
  const updateM = useAdminMutation<unknown, UpdatePayload>(
    (vars) => `/api/admin/agents/${encodeURIComponent(vars.id)}`,
    {
      method: 'PUT',
      bodyOf: ({ id: _id, ...rest }) => rest,
      invalidateKeys: [['admin-agents']],
      onSuccess: () => {
        onSaved?.()
        onClose()
      },
      onError: (err) => setError(err.message),
    },
  )

  const busy = createM.isPending || updateM.isPending

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!displayName.trim()) {
      setError('display name is required')
      return
    }
    const slug = name.trim() || slugify(displayName)
    if (!slug) {
      setError('name slug could not be derived — please supply manually')
      return
    }
    if (isEdit && editing) {
      updateM.mutate({
        id: editing.id,
        name: slug,
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        agentType: agentType.trim() || 'custom',
        skills: skillIds,
        enabled,
      })
    } else {
      createM.mutate({
        name: slug,
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        agentType: agentType.trim() || 'custom',
        skills: skillIds,
        enabled,
        category: 'custom',
      })
    }
  }

  const toggleSkill = (id: string) => {
    setSkillIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]))
  }

  return (
    <SidePanel
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={isEdit ? `Edit · ${editing?.display_name ?? editing?.name ?? ''}` : 'Register agent'}
      meta={
        isEdit
          ? 'change identity, skills, or enabled state'
          : 'register a new agent definition · model + prompt configured later'
      }
    >
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
        {error && (
          <Banner level="err" label="error">
            {error}
          </Banner>
        )}
        <Field label="display name" desc="required · shown in pickers">
          <input
            className="aw-input"
            type="text"
            autoFocus
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Cloud Operator"
            disabled={busy}
            required
          />
        </Field>
        <Field label="name slug" desc="machine name · auto-derived from display name">
          <input
            className="aw-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameDirty(true)
            }}
            placeholder="cloud-operator"
            disabled={busy || isEdit}
          />
        </Field>
        <Field label="agent type" desc="free-text role · cloud_operations, devops, custom, …">
          <input
            className="aw-input"
            type="text"
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
            placeholder="custom"
            disabled={busy}
          />
        </Field>
        <Field label="description" desc="optional · single-line summary">
          <textarea
            className="aw-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="acts on cloud resources via Azure / AWS / GCP MCP"
            rows={3}
            disabled={busy}
          />
        </Field>
        <Field label="skills" desc={`pick from ${skills.length} registered skills`}>
          {skills.length === 0 ? (
            <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
              no skills registered — add via /api/admin/agents/skills
            </span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {skills.map((s) => (
                <Chip
                  key={s.id}
                  value={s.display_name ?? s.name}
                  on={skillIds.includes(s.id)}
                  onClick={() => !busy && toggleSkill(s.id)}
                />
              ))}
            </div>
          )}
        </Field>
        <Field label="enabled" desc="disabled agents are hidden from runtime resolvers">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Toggle on={enabled} onChange={setEnabled} label={enabled ? 'enabled' : 'disabled'} />
            <span style={{ color: 'var(--fg-2)', fontSize: 'var(--v3-t-meta)' }}>
              {enabled ? 'enabled' : 'disabled'}
            </span>
          </span>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            cancel
          </Btn>
          <Btn variant="primary" type="submit" disabled={busy}>
            {busy ? 'saving…' : isEdit ? 'save changes' : 'register agent'}
          </Btn>
        </div>
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
        fontFamily: 'var(--font-mono)',
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

export default AgentModal
