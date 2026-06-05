import * as React from 'react'
import { Panel, PanelHead, EmptyInline, Btn, Banner } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'

type Role = 'admin' | 'member'

interface RbacRoleSummary {
  role_key: Role
  active_version: number | null
  active_id: string | null
  active_updated_at: string | null
  total_versions: number
  preview: string | null
  unseeded?: boolean
}

interface RbacVersion {
  id: string
  version: number
  is_active: boolean
  created_at: string
  updated_at: string
  body_preview: string
  body_chars: number
}

async function fetchRoles(): Promise<RbacRoleSummary[]> {
  const r = await apiRequest('/api/admin/rbac-system-prompts')
  if (!r.ok) throw new Error(`GET /api/admin/rbac-system-prompts ${r.status}`)
  const json = await r.json()
  return json.roles ?? []
}

async function fetchBody(role: Role): Promise<string> {
  const r = await apiRequest(`/api/admin/rbac-system-prompts/${role}`)
  if (!r.ok) throw new Error(`GET /api/admin/rbac-system-prompts/${role} ${r.status}`)
  const json = await r.json()
  return json.body ?? ''
}

async function fetchVersions(role: Role): Promise<RbacVersion[]> {
  const r = await apiRequest(`/api/admin/rbac-system-prompts/${role}/versions`)
  if (!r.ok) throw new Error(`GET versions ${r.status}`)
  const json = await r.json()
  return json.versions ?? []
}

async function saveBody(role: Role, body: string, reason: string): Promise<void> {
  const r = await apiRequest(`/api/admin/rbac-system-prompts/${role}`, {
    method: 'POST',
    body: JSON.stringify({ body, reason }),
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`POST ${r.status} ${txt}`)
  }
}

async function rollback(role: Role, version: number, reason: string): Promise<void> {
  const r = await apiRequest(
    `/api/admin/rbac-system-prompts/${role}/rollback/${version}`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  )
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`rollback ${r.status} ${txt}`)
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

interface EditorProps {
  role: Role
  onClose: () => void
  onSaved: () => void
}

const RoleEditor: React.FC<EditorProps> = ({ role, onClose, onSaved }) => {
  const [body, setBody] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [versions, setVersions] = React.useState<RbacVersion[]>([])
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [info, setInfo] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    try {
      const [b, vs] = await Promise.all([fetchBody(role), fetchVersions(role)])
      setBody(b)
      setVersions(vs)
    } catch (e: any) {
      setErr(e?.message ?? 'load failed')
    }
  }, [role])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const onSave = async () => {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      await saveBody(role, body, reason || `edit at ${new Date().toISOString()}`)
      setInfo(`Saved. New active version published to redis.`)
      setReason('')
      await reload()
      onSaved()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const onRollback = async (v: number) => {
    if (!confirm(`Roll back ${role} to version ${v}? This reactivates the older body.`)) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      await rollback(role, v, reason || `rollback at ${new Date().toISOString()}`)
      setInfo(`Rolled back to v${v}. Active body restored.`)
      setReason('')
      await reload()
      onSaved()
    } catch (e: any) {
      setErr(e?.message ?? 'rollback failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <PanelHead
        title={`Edit ${role} system prompt`}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={onClose}>Close</Btn>
          </div>
        }
      />
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && <Banner level="err">{err}</Banner>}
        {info && <Banner level="ok">{info}</Banner>}

        <label style={{ fontSize: 11, color: 'var(--fg-3)' }}>Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 360,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            background: 'var(--ctl-surf)',
            color: 'var(--fg-0)',
            border: '1px solid var(--bd-1)',
            borderRadius: 4,
            padding: 8,
            resize: 'vertical',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          {body.length.toLocaleString()} chars · ~{Math.ceil(body.length / 4).toLocaleString()} tokens
          (rough)
        </div>

        <label style={{ fontSize: 11, color: 'var(--fg-3)' }}>Reason (audit log)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. tightened tool-use directive"
          style={{
            width: '100%',
            background: 'var(--ctl-surf)',
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
            Save publishes to <code>prompt:invalidate</code> redis channel; every replica's cache busts
            within ~ms.
          </span>
        </div>

        {versions.length > 0 && (
          <div className="aw-panel">
            <PanelHead title={`Version history (${versions.length})`} />
            <div style={{ padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 90px 200px 1fr 80px', gap: 8, fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
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
                    gridTemplateColumns: '60px 90px 200px 1fr 80px',
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
                      <Btn onClick={() => onRollback(v.version)} disabled={busy}>
                        Rollback
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

export const RbacTemplatesPane: React.FC = () => {
  const [roles, setRoles] = React.useState<RbacRoleSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<Role | null>(null)
  const [bumpKey, setBumpKey] = React.useState(0)

  const reload = React.useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setRoles(await fetchRoles())
    } catch (e: any) {
      setErr(e?.message ?? 'load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload, bumpKey])

  if (editing) {
    return (
      <RoleEditor
        role={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setBumpKey((k) => k + 1)}
      />
    )
  }

  return (
    <Panel>
      <PanelHead
        title="RBAC System Prompts (Layer 1)"
        right={
          <Btn onClick={() => void reload()} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </Btn>
        }
      />
      <div style={{ padding: 12 }}>
        {err && (
          <div style={{ marginBottom: 12 }}>
            <Banner level="err">{err}</Banner>
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-3)',
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          Role-keyed RBAC base prompts. Edits propagate <strong>LIVE</strong> via redis pubsub —
          every api replica's cache busts within ~ms; the next chat turn uses the new body.
          Composed with dynamic sections at runtime. DB rows are always served (Sprint W — USE_DB_PROMPT env-gate ripped).
        </div>
        {roles.length === 0 && !loading && !err && (
          <EmptyInline>No RBAC rows yet — bootstrap seeder runs on next api boot.</EmptyInline>
        )}
        {roles.map((r) => (
          <div key={r.role_key} className="aw-panel" style={{ marginBottom: 12 }}>
            <div
              style={{
                padding: 12,
                display: 'grid',
                gridTemplateColumns: '120px 100px 120px 1fr 110px',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: 'var(--fg-0)', textTransform: 'uppercase' }}>
                  {r.role_key}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  {r.unseeded ? 'unseeded' : `${r.total_versions} version${r.total_versions === 1 ? '' : 's'}`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>ACTIVE</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                  {r.active_version === null ? '—' : `v${r.active_version}`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>UPDATED</div>
                <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>
                  {fmtDate(r.active_updated_at)}
                </div>
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
                {r.preview ?? '—'}
              </div>
              <div>
                <Btn variant="primary" onClick={() => setEditing(r.role_key)}>
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

export default RbacTemplatesPane
