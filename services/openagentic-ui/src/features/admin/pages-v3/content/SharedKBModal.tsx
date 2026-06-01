import * as React from 'react'
import {
  Modal,
  v3InputStyle,
  v3TextareaStyle,
  Btn,
  Banner,
  FormGrid,
  FormRow,
  Toggle,
  Chip,
} from '../../primitives-v3'
import type { SharedKBSourceRow, SharedKBType } from './hooks'

const TYPES: SharedKBType[] = ['webpage', 'document', 'rss', 'http', 'database', 'agent']

export type SharedKBModalMode = 'create' | 'edit'

export interface SharedKBModalProps {
  open: boolean
  mode: SharedKBModalMode
  initial: SharedKBSourceRow | null
  onClose: () => void
  onSubmit: (
    payload: {
      id?: string
      name: string
      description: string
      type: SharedKBType
      config: Record<string, unknown>
      enabled: boolean
      schedule: string | null
    },
    mode: SharedKBModalMode,
  ) => Promise<void>
  isSubmitting: boolean
  error?: string | null
}

export const SharedKBModal: React.FC<SharedKBModalProps> = ({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}) => {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [type, setType] = React.useState<SharedKBType>('webpage')
  const [url, setUrl] = React.useState('')
  const [enabled, setEnabled] = React.useState(true)
  const [schedule, setSchedule] = React.useState('')
  const [authJson, setAuthJson] = React.useState('{}')
  const [authError, setAuthError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setType((initial?.type as SharedKBType) ?? 'webpage')
    setEnabled(initial?.enabled ?? true)
    setSchedule(initial?.schedule ?? '')
    const cfg = initial?.config ?? {}
    setUrl(((cfg as any).url ?? (cfg as any).path ?? '') as string)
    const cfgWithoutUrl = { ...(cfg as any) }
    delete cfgWithoutUrl.url
    delete cfgWithoutUrl.path
    setAuthJson(Object.keys(cfgWithoutUrl).length > 0 ? JSON.stringify(cfgWithoutUrl, null, 2) : '{}')
    setAuthError(null)
  }, [open, initial])

  const valid = name.trim().length > 0 && url.trim().length > 0

  const submit = () => {
    let cfgExtra: Record<string, unknown> = {}
    try {
      cfgExtra = JSON.parse(authJson || '{}')
      setAuthError(null)
    } catch (err: any) {
      setAuthError(`auth/config JSON: ${err?.message ?? 'parse failed'}`)
      return
    }
    void onSubmit(
      {
        id: mode === 'edit' ? initial?.id : undefined,
        name: name.trim(),
        description: description.trim(),
        type,
        config: { ...cfgExtra, url: url.trim() },
        enabled,
        schedule: schedule.trim() || null,
      },
      mode,
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? `Edit KB source · ${initial?.name ?? ''}` : '+ Add KB source'}
      width={680}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isSubmitting}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={!valid || isSubmitting} onClick={submit}>
            {isSubmitting ? (mode === 'edit' ? 'saving…' : 'creating…') : mode === 'edit' ? 'save' : 'create'}
          </Btn>
        </>
      }
    >
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      {authError && (
        <Banner level="warn" label="warn">
          {authError}
        </Banner>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {TYPES.map((t) => (
          <Chip key={t} value={t} on={type === t} onClick={() => setType(t)} />
        ))}
      </div>
      <FormGrid>
        <FormRow name="name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="url / path" desc="HTTP url, RSS feed, document path, or DSN">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or /path/to/source"
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="schedule" desc="cron expression (empty = on-demand)">
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 */6 * * *"
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="enabled">
          <Toggle on={enabled} onChange={setEnabled} />
        </FormRow>
      </FormGrid>

      <div
        style={{
          marginTop: 12,
          fontSize: 11,
          color: 'var(--fg-3)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        auth / extra config (JSON)
      </div>
      <textarea
        value={authJson}
        onChange={(e) => setAuthJson(e.target.value)}
        placeholder='{ "headers": { "Authorization": "Bearer …" } }'
        style={{ ...v3TextareaStyle, minHeight: 140, marginTop: 4 }}
      />
    </Modal>
  )
}

export default SharedKBModal
