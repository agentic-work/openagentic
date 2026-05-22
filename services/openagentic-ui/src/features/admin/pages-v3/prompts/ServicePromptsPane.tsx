import * as React from 'react'
import { Panel, PanelHead, EmptyInline, Btn, Banner } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'

interface ServicePromptSummary {
  prompt_key: string
  version: number | null
  updated_at: string | null
  description: string | null
  preview: string | null
}

interface ServicePromptVersion {
  id: string
  version: number
  is_active: boolean
  created_at: string
  updated_at: string
  body_preview: string
  body_chars: number
}

/** Human-readable label for each key. */
const KEY_LABELS: Record<string, string> = {
  'slack.integration_prompt': 'Slack — integration system prompt',
  'title_gen.ai_service': 'Title generation — AITitleGenerationService',
  'title_gen.client': 'Title generation — TitleGenerationClient (multiple titles)',
  'codemode.summary_prompt': 'Code mode — session compaction system prompt',
  'memory.context_system': 'Memory context — cached-context system prompt',
  'memory.context_build': 'Memory context — buildSystemPrompt()',
}

async function fetchKeys(): Promise<ServicePromptSummary[]> {
  const r = await apiRequest('/api/admin/service-prompts')
  if (!r.ok) throw new Error(`GET /api/admin/service-prompts ${r.status}`)
  const json = await r.json()
  return json.prompts ?? []
}

async function fetchBody(key: string): Promise<string> {
  const r = await apiRequest(`/api/admin/service-prompts/${encodeURIComponent(key)}`)
  if (!r.ok) throw new Error(`GET /api/admin/service-prompts/${key} ${r.status}`)
  const json = await r.json()
  return json.body ?? ''
}

async function fetchVersions(key: string): Promise<ServicePromptVersion[]> {
  const r = await apiRequest(`/api/admin/service-prompts/${encodeURIComponent(key)}/versions`)
  if (!r.ok) throw new Error(`GET versions for ${key}: ${r.status}`)
  const json = await r.json()
  return json.versions ?? []
}

async function saveBody(key: string, body: string, reason: string): Promise<void> {
  const r = await apiRequest(`/api/admin/service-prompts/${encodeURIComponent(key)}`, {
    method: 'POST',
    body: JSON.stringify({ body, reason }),
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`POST ${r.status} ${txt}`)
  }
}

async function rollbackVersion(key: string, version: number, reason: string): Promise<void> {
  const r = await apiRequest(
    `/api/admin/service-prompts/${encodeURIComponent(key)}/rollback/${version}`,
    { method: 'POST', body: JSON.stringify({ reason: reason || `rollback to v${version}` }) },
  )
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`POST rollback ${r.status} ${txt}`)
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso ?? '—' }
}

interface EditorProps {
  promptKey: string
  onClose: () => void
  onSaved: () => void
}

const ServicePromptEditor: React.FC<EditorProps> = ({ promptKey, onClose, onSaved }) => {
  const [body, setBody] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [versions, setVersions] = React.useState<ServicePromptVersion[]>([])
  const [busy, setBusy] = React.useState(false)
  const [rollbackBusy, setRollbackBusy] = React.useState<number | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [info, setInfo] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    try {
      const [b, vs] = await Promise.all([fetchBody(promptKey), fetchVersions(promptKey)])
      setBody(b)
      setVersions(vs)
    } catch (e: any) {
      setErr(e?.message ?? 'load failed')
    }
  }, [promptKey])

  React.useEffect(() => { void reload() }, [reload])

  const onSave = async () => {
    setBusy(true); setErr(null); setInfo(null)
    try {
      await saveBody(promptKey, body, reason || `edit at ${new Date().toISOString()}`)
      setInfo('Saved. New active version published to redis.')
      setReason('')
      await reload()
      onSaved()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const onRollback = async (version: number) => {
    setRollbackBusy(version); setErr(null); setInfo(null)
    try {
      await rollbackVersion(promptKey, version, `rollback to v${version}`)
      setInfo(`Rolled back to v${version}. Active version published to redis.`)
      await reload()
      onSaved()
    } catch (e: any) {
      setErr(e?.message ?? 'rollback failed')
    } finally {
      setRollbackBusy(null)
    }
  }

  const label = KEY_LABELS[promptKey] ?? promptKey

  return (
    <Panel>
      <PanelHead
        title={`Edit: ${label}`}
        right={<Btn onClick={onClose}>Close</Btn>}
      />
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && <Banner level="err">{err}</Banner>}
        {info && <Banner level="ok">{info}</Banner>}

        <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          Key: <code style={{ fontFamily: 'var(--font-mono)' }}>{promptKey}</code>
        </div>

        <label style={{ fontSize: 11, color: 'var(--fg-3)' }}>Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 280,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 12,
            background: 'var(--bg-1)',
            color: 'var(--fg-0)',
            border: '1px solid var(--bd-1)',
            borderRadius: 4,
            padding: 8,
            resize: 'vertical',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          {body.length.toLocaleString()} chars · ~{Math.ceil(body.length / 4).toLocaleString()} tokens (rough)
        </div>

        <label style={{ fontSize: 11, color: 'var(--fg-3)' }}>Reason (audit log)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. tightened Slack tone"
          style={{
            width: '100%',
            background: 'var(--bg-1)',
            color: 'var(--fg-0)',
            border: '1px solid var(--bd-1)',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 12,
          }}
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn variant="primary" onClick={onSave} disabled={busy || body.trim().length === 0}>
            {busy ? 'Saving…' : 'Save new version'}
          </Btn>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            Save publishes to <code>service-prompt:invalidate</code> redis channel; every replica's cache busts within ~ms.
          </span>
        </div>

        {versions.length > 0 && (
          <div className="aw-panel">
            <PanelHead title={`Version history (${versions.length})`} />
            <div style={{ padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 90px 180px 1fr 90px', gap: 8, fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
                <div>VER</div>
                <div>ACTIVE</div>
                <div>WHEN</div>
                <div>PREVIEW</div>
                <div></div>
              </div>
              {versions.map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 90px 180px 1fr 90px',
                    gap: 8,
                    padding: '6px 0',
                    borderTop: '1px solid var(--bd-1)',
                    alignItems: 'center',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)' }}>v{v.version}</div>
                  <div style={{ color: v.is_active ? 'var(--accent)' : 'var(--fg-3)' }}>
                    {v.is_active ? '● active' : '○'}
                  </div>
                  <div style={{ color: 'var(--fg-2)', fontSize: 11 }}>{fmtDate(v.created_at)}</div>
                  <div
                    style={{
                      color: 'var(--fg-2)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {v.body_preview}
                  </div>
                  <div>
                    {!v.is_active && (
                      <Btn
                        variant="ghost"
                        onClick={() => void onRollback(v.version)}
                        disabled={rollbackBusy !== null}
                      >
                        {rollbackBusy === v.version ? 'rolling…' : 'rollback'}
                      </Btn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

export const ServicePromptsPane: React.FC = () => {
  const [keys, setKeys] = React.useState<ServicePromptSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [bumpKey, setBumpKey] = React.useState(0)

  const reload = React.useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      setKeys(await fetchKeys())
    } catch (e: any) {
      setErr(e?.message ?? 'load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void reload() }, [reload, bumpKey])

  if (editing) {
    return (
      <ServicePromptEditor
        promptKey={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setBumpKey((k) => k + 1)}
      />
    )
  }

  return (
    <Panel>
      <PanelHead
        title="Service Prompts"
        right={
          <Btn onClick={() => void reload()} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </Btn>
        }
      />
      <div style={{ padding: 12 }}>
        {err && <div style={{ marginBottom: 12 }}><Banner level="err">{err}</Banner></div>}
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 12, lineHeight: 1.5 }}>
          Named system prompts for Slack integration, title generation, code mode compaction, and memory context.
          Edits propagate <strong>LIVE</strong> via redis pubsub — every api replica's cache busts within ~ms.
          Default values are seeded from source at first deploy; subsequent changes persist to DB.
        </div>
        {keys.length === 0 && !loading && !err && (
          <EmptyInline>No service prompt rows yet — bootstrap seeder runs on next api boot.</EmptyInline>
        )}
        {keys.map((k) => (
          <div key={k.prompt_key} className="aw-panel" style={{ marginBottom: 12 }}>
            <div
              style={{
                padding: 12,
                display: 'grid',
                gridTemplateColumns: '260px 80px 160px 1fr 100px',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg-0)' }}>
                  {KEY_LABELS[k.prompt_key] ?? k.prompt_key}
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {k.prompt_key}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>VERSION</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                  {k.version === null ? '—' : `v${k.version}`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>UPDATED</div>
                <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{fmtDate(k.updated_at)}</div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--fg-2)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {k.preview ?? '—'}
              </div>
              <div>
                <Btn variant="primary" onClick={() => setEditing(k.prompt_key)}>
                  Edit
                </Btn>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

export default ServicePromptsPane
