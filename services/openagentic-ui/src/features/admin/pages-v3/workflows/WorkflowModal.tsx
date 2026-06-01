import * as React from 'react'
import { SidePanel, Btn, Banner } from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'
import type { AdminWorkflowRow } from '../../hooks/useWorkflows'

export type WorkflowVisibility = 'private' | 'team' | 'public'

export interface WorkflowFormValues {
  name: string
  description: string
  visibility: WorkflowVisibility
}

export interface WorkflowModalProps {
  open: boolean
  onClose: () => void
  /** Undefined → create mode. Defined → edit mode (prefilled from row). */
  editing?: AdminWorkflowRow | null
  /** Called after a successful create with the newly created workflow id. */
  onCreated?: (id: string) => void
  /** Called after a successful edit. */
  onSaved?: () => void
}

const EMPTY_DEFINITION = { nodes: [], edges: [] }

interface CreatePayload {
  name: string
  description?: string
  definition: typeof EMPTY_DEFINITION
  is_public?: boolean
}
interface UpdatePayload {
  id: string
  name?: string
  description?: string
  visibility?: WorkflowVisibility
}

export const WorkflowModal: React.FC<WorkflowModalProps> = ({
  open,
  onClose,
  editing,
  onCreated,
  onSaved,
}) => {
  const isEdit = !!editing
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [visibility, setVisibility] = React.useState<WorkflowVisibility>('private')
  const [error, setError] = React.useState<string | null>(null)

  // Reset form whenever the modal opens (or switches between edit/create).
  React.useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setName(editing.name ?? '')
      setDescription(editing.description ?? '')
      const v = (editing.visibility ?? 'private') as WorkflowVisibility
      setVisibility(['private', 'team', 'public'].includes(v) ? v : 'private')
    } else {
      setName('')
      setDescription('')
      setVisibility('private')
    }
  }, [open, editing])

  const createM = useAdminMutation<{ workflow: { id: string } }, CreatePayload>(
    '/api/workflows',
    {
      method: 'POST',
      invalidateKeys: [['admin-workflows'], ['admin-workflow-stats']],
      onSuccess: (data) => {
        const id = data?.workflow?.id
        if (id && onCreated) onCreated(id)
        onClose()
      },
      onError: (err) => setError(err.message),
    },
  )

  // Two-step edit:
  //   1. PUT /api/workflows/:id  for name + description
  //   2. PATCH /api/admin/workflows/:id/visibility for visibility (if dirty)
  // The admin endpoint is the only one that lets us change visibility on
  // somebody else's workflow without 403'ing.
  const updateNameM = useAdminMutation<unknown, UpdatePayload>(
    (vars) => `/api/workflows/${encodeURIComponent(vars.id)}`,
    {
      method: 'PUT',
      bodyOf: ({ name, description }) => ({ name, description }),
      onError: (err) => setError(err.message),
    },
  )
  const updateVisM = useAdminMutation<unknown, { id: string; visibility: WorkflowVisibility }>(
    (vars) => `/api/admin/workflows/${encodeURIComponent(vars.id)}/visibility`,
    {
      method: 'PATCH',
      bodyOf: ({ visibility }) => ({ visibility }),
      invalidateKeys: [['admin-workflows']],
      onError: (err) => setError(err.message),
    },
  )

  const busy = createM.isPending || updateNameM.isPending || updateVisM.isPending

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('name is required')
      return
    }
    if (isEdit && editing) {
      try {
        await updateNameM.mutateAsync({
          id: editing.id,
          name: name.trim(),
          description: description.trim() || undefined,
        })
        if ((editing.visibility ?? 'private') !== visibility) {
          await updateVisM.mutateAsync({ id: editing.id, visibility })
        }
        onSaved?.()
        onClose()
      } catch {
        // error already wired via onError
      }
    } else {
      createM.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        definition: EMPTY_DEFINITION,
        is_public: visibility === 'public',
      })
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={isEdit ? `Edit · ${editing?.name ?? ''}` : 'New workflow'}
      meta={
        isEdit
          ? 'change name, description, or visibility'
          : 'create a blank workflow — opens in canvas after save'
      }
    >
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
        {error && (
          <Banner level="err" label="error">
            {error}
          </Banner>
        )}
        <Field label="name" desc="required · unique per user">
          <input
            className="aw-input"
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="invoice-classifier"
            disabled={busy}
            required
          />
        </Field>
        <Field label="description" desc="optional · single-line summary">
          <textarea
            className="aw-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="classify inbound invoices and route to the right queue"
            rows={3}
            disabled={busy}
          />
        </Field>
        <Field label="visibility" desc="who can see + run this workflow">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['private', 'team', 'public'] as WorkflowVisibility[]).map((v) => (
              <Btn
                key={v}
                variant={visibility === v ? 'primary' : 'ghost'}
                onClick={(e) => {
                  e.preventDefault()
                  setVisibility(v)
                }}
                disabled={busy}
              >
                {v}
              </Btn>
            ))}
          </div>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            cancel
          </Btn>
          <Btn variant="primary" type="submit" disabled={busy}>
            {busy ? 'saving…' : isEdit ? 'save changes' : 'create + open'}
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

export default WorkflowModal
