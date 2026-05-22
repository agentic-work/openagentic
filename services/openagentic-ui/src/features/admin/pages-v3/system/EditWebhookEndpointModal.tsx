import * as React from 'react'
import {
  Banner,
  Btn,
  FormGrid,
  FormRow,
  SidePanel,
  StatusDot,
  Toggle,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'

export interface PlatformAllowlistDraft {
  id: string
  enabled?: boolean
  cidrs?: string[]
  signatureHeader?: string
  description?: string
}

interface EditWebhookEndpointModalProps {
  platform: PlatformAllowlistDraft | null
  /** When true, modal renders in "add new" mode + lets the operator pick the id. */
  addNew?: boolean
  onClose: () => void
}

interface SaveResponse {
  platform: PlatformAllowlistDraft
}

interface SaveBody {
  enabled?: boolean
  cidrs?: string[]
  signatureHeader?: string
  description?: string
}

const splitCidrs = (raw: string): string[] =>
  raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

const joinCidrs = (cidrs: string[] | undefined): string =>
  (cidrs ?? []).join('\n')

export const EditWebhookEndpointModal: React.FC<EditWebhookEndpointModalProps> = ({
  platform,
  addNew,
  onClose,
}) => {
  const open = platform !== null || !!addNew
  const [id, setId] = React.useState('')
  const [enabled, setEnabled] = React.useState(true)
  const [cidrsRaw, setCidrsRaw] = React.useState('')
  const [signatureHeader, setSignatureHeader] = React.useState('')
  const [description, setDescription] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setId(platform?.id ?? '')
      setEnabled(platform?.enabled ?? true)
      setCidrsRaw(joinCidrs(platform?.cidrs))
      setSignatureHeader(platform?.signatureHeader ?? '')
      setDescription(platform?.description ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, platform?.id])

  const save = useAdminMutation<SaveResponse, SaveBody>(
    id ? `/api/admin/webhook-security/platforms/${encodeURIComponent(id)}` : '/api/admin/webhook-security/platforms/_',
    {
      method: 'PUT',
      invalidateKeys: [['webhook-security']],
    },
  )
  React.useEffect(() => { save.reset() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open])

  const idValid = id.trim().length > 0 && /^[a-z0-9_-]+$/i.test(id.trim())
  const canSubmit = idValid && !save.isPending

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    save.mutate(
      {
        enabled,
        cidrs: splitCidrs(cidrsRaw),
        signatureHeader: signatureHeader.trim() || undefined,
        description: description.trim() || undefined,
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={addNew ? 'add webhook platform' : `edit platform — ${platform?.id ?? ''}`}
      meta="PUT /api/admin/webhook-security/platforms/:id"
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {save.isError && (
          <Banner level="err" label="error">
            {save.error?.message ?? 'failed to save platform'}
          </Banner>
        )}

        <FormGrid>
          <FormRow
            name="Platform id"
            desc="Slug used in webhook URLs (e.g. github, stripe). Lowercase letters, digits, dash, underscore."
            configKey="webhook.platforms.id"
          >
            <input
              className="aw-input"
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              disabled={!addNew}
              aria-invalid={id.length > 0 && !idValid}
              required
            />
          </FormRow>
          <FormRow name="Enabled" configKey="webhook.platforms.enabled">
            <Toggle on={enabled} onChange={setEnabled} label="enabled" />
            <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={enabled ? 'ok' : 'idle'} />
              {enabled ? 'on' : 'off'}
            </span>
          </FormRow>
          <FormRow
            name="Allowed CIDRs"
            desc="Source IP allow-list. One CIDR per line. Empty = accept any source IP."
            configKey="webhook.platforms.cidrs"
          >
            <textarea
              className="aw-input"
              rows={4}
              value={cidrsRaw}
              onChange={(e) => setCidrsRaw(e.target.value)}
              placeholder={'192.30.252.0/22\n185.199.108.0/22'}
            />
          </FormRow>
          <FormRow
            name="Signature header"
            desc="HMAC verification header sent by the provider (e.g. X-Hub-Signature-256)."
            configKey="webhook.platforms.signatureHeader"
          >
            <input
              className="aw-input"
              type="text"
              value={signatureHeader}
              onChange={(e) => setSignatureHeader(e.target.value)}
              placeholder="X-Hub-Signature-256"
            />
          </FormRow>
          <FormRow name="Description">
            <textarea
              className="aw-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(optional admin notes)"
            />
          </FormRow>
        </FormGrid>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--line-1)',
        }}>
          <Btn variant="ghost" type="button" onClick={onClose}>cancel</Btn>
          <Btn variant="primary" type="submit" disabled={!canSubmit} onClick={() => submit()}>
            {save.isPending ? 'saving…' : addNew ? 'add platform' : 'save'}
          </Btn>
        </div>
      </form>
    </SidePanel>
  )
}

export default EditWebhookEndpointModal
