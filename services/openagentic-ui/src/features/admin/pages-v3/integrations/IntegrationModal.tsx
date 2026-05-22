import * as React from 'react'
import {
  Modal,
  v3InputStyle,
  v3TextareaStyle,
  Btn,
  Banner,
  FormGrid,
  FormRow,
  Chip,
} from '../../primitives-v3'
import type { IntegrationPlatform, IntegrationRow } from './types'

export type IntegrationModalMode = 'connect' | 'edit-channels'

export interface IntegrationConnectPayload {
  name: string
  platform: IntegrationPlatform
  config: Record<string, unknown>
  allowed_channels: string[]
  allowed_workflows: string[]
}

export interface IntegrationEditChannelsPayload {
  id: string
  allowed_channels: string[]
  allowed_workflows: string[]
  name?: string
}

export interface IntegrationModalProps {
  open: boolean
  mode: IntegrationModalMode
  initial: IntegrationRow | null
  initialPlatform?: IntegrationPlatform
  onClose: () => void
  onConnect: (payload: IntegrationConnectPayload) => Promise<void>
  onEditChannels: (payload: IntegrationEditChannelsPayload) => Promise<void>
  isSubmitting: boolean
  error?: string | null
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({
  open,
  mode,
  initial,
  initialPlatform,
  onClose,
  onConnect,
  onEditChannels,
  isSubmitting,
  error,
}) => {
  const [platform, setPlatform] = React.useState<IntegrationPlatform>('slack')
  const [name, setName] = React.useState('')
  const [configJson, setConfigJson] = React.useState('{}')
  const [parseError, setParseError] = React.useState<string | null>(null)
  const [channelsCsv, setChannelsCsv] = React.useState('')
  const [workflowsCsv, setWorkflowsCsv] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setParseError(null)
    if (mode === 'edit-channels' && initial) {
      setPlatform(initial.platform)
      setName(initial.name)
      setChannelsCsv(initial.channels.join(', '))
      setWorkflowsCsv(initial.workflowIds.join(', '))
      setConfigJson('{}')
    } else {
      setPlatform(initialPlatform ?? 'slack')
      setName('')
      setChannelsCsv('')
      setWorkflowsCsv('')
      setConfigJson(
        JSON.stringify(
          (initialPlatform ?? 'slack') === 'slack'
            ? { botToken: '', signingSecret: '', appId: '' }
            : { appId: '', appPassword: '', tenantId: '' },
          null,
          2,
        ),
      )
    }
  }, [open, mode, initial, initialPlatform])

  const csv = (s: string): string[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

  const submit = () => {
    if (mode === 'edit-channels' && initial) {
      void onEditChannels({
        id: initial.id,
        name: name.trim() || initial.name,
        allowed_channels: csv(channelsCsv),
        allowed_workflows: csv(workflowsCsv),
      })
      return
    }
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(configJson || '{}')
      setParseError(null)
    } catch (e: any) {
      setParseError(`config JSON: ${e?.message ?? 'parse failed'}`)
      return
    }
    void onConnect({
      name: name.trim(),
      platform,
      config: parsed,
      allowed_channels: csv(channelsCsv),
      allowed_workflows: csv(workflowsCsv),
    })
  }

  const valid =
    mode === 'edit-channels' ? !!initial : name.trim().length > 0 && configJson.trim().length > 0

  const title =
    mode === 'edit-channels'
      ? `Edit channels · ${initial?.name ?? ''}`
      : `Connect ${platform === 'slack' ? 'Slack' : 'MS Teams'}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={680}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isSubmitting}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={!valid || isSubmitting} onClick={submit}>
            {isSubmitting
              ? mode === 'edit-channels'
                ? 'saving…'
                : 'connecting…'
              : mode === 'edit-channels'
                ? 'save'
                : 'connect'}
          </Btn>
        </>
      }
    >
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      {parseError && (
        <Banner level="warn" label="warn">
          {parseError}
        </Banner>
      )}
      {mode === 'connect' && (
        <Banner level="info" label="note">
          Prefer "+ connect {platform === 'slack' ? 'Slack' : 'Teams'}" on the toolbar to launch the OAuth popup
          (<span className="accent">/api/admin/integrations/{platform}/oauth-start</span>).
          This form is the manual fallback for environments without
          {' '}<span className="accent">{platform === 'slack' ? 'SLACK_CLIENT_ID' : 'MICROSOFT_TEAMS_CLIENT_ID'}</span>{' '}
          on the api pod.
        </Banner>
      )}
      {mode === 'connect' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <Chip label="platform" value="slack" on={platform === 'slack'} onClick={() => setPlatform('slack')} />
          <Chip label="platform" value="teams" on={platform === 'teams'} onClick={() => setPlatform('teams')} />
        </div>
      )}
      <FormGrid>
        <FormRow name="name" desc="display name surfaced in the integrations list">
          <input value={name} onChange={(e) => setName(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="allowed channels (csv)" desc="empty = all channels">
          <input
            value={channelsCsv}
            onChange={(e) => setChannelsCsv(e.target.value)}
            style={v3InputStyle}
            placeholder="#alerts, #ops"
          />
        </FormRow>
        <FormRow name="allowed workflows (csv)" desc="workflow ids that may be triggered from this integration">
          <input
            value={workflowsCsv}
            onChange={(e) => setWorkflowsCsv(e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
      </FormGrid>

      {mode === 'connect' && (
        <>
          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: 'var(--fg-3)',
              fontFamily: 'var(--font-v3-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            credentials (JSON)
          </div>
          <textarea
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            style={{ ...v3TextareaStyle, minHeight: 180, marginTop: 4 }}
          />
        </>
      )}
    </Modal>
  )
}

export default IntegrationModal
