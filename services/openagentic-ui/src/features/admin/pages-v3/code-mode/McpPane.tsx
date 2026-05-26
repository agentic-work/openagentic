import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  StatusDot,
  Chip,
  Banner,
  EmptyInline,
  SectionBar,
  Toggle,
  Btn,
  SidePanel,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'
import { ConfirmInline } from '../shared/ConfirmInline'
import {
  useCodeModeMcp,
  useMcpServers,
  type CodeModeMcpServerRow,
  type McpServerRow,
} from '../../hooks/useDashboardMetrics'

interface JoinedRow {
  id: string
  name: string
  type?: string
  enabled: boolean
  inFleet: boolean
  fleetHealth?: string
  fleetTools?: number
  pluginSource?: string
}

function joinRows(cm: CodeModeMcpServerRow[], fleet: McpServerRow[]): JoinedRow[] {
  const fleetByName = new Map<string, McpServerRow>()
  for (const f of fleet) {
    const k = (f.name ?? f.id ?? '').toLowerCase()
    if (k) fleetByName.set(k, f)
  }
  return cm.map((s) => {
    const k = (s.name ?? s.id).toLowerCase()
    const hit = fleetByName.get(k)
    return {
      id: s.id,
      name: s.name ?? s.id,
      type: s.type,
      enabled: s.enabled,
      inFleet: !!hit,
      fleetHealth: hit?.health ?? hit?.status,
      fleetTools: hit?.toolCount,
      pluginSource: s.pluginSource,
    }
  })
}

interface NewMcpForm {
  name: string
  description: string
  type: 'stdio' | 'http'
  command: string
  args: string
  url: string
}

const EMPTY_NEW: NewMcpForm = {
  name: '',
  description: '',
  type: 'stdio',
  command: '',
  args: '',
  url: '',
}

export const McpPane: React.FC = () => {
  const cm = useCodeModeMcp()
  const fleet = useMcpServers()
  const [error, setError] = React.useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [newForm, setNewForm] = React.useState<NewMcpForm>(EMPTY_NEW)
  const [policyEdit, setPolicyEdit] = React.useState<{
    open: boolean
    allow: string
    deny: string
  }>({ open: false, allow: '', deny: '' })

  const fleetArr: McpServerRow[] = React.useMemo(() => {
    const d = fleet.data
    if (!d) return []
    return Array.isArray(d) ? d : d.servers ?? []
  }, [fleet.data])

  const cmRows: CodeModeMcpServerRow[] = cm.data?.servers ?? []
  const rows = React.useMemo(() => joinRows(cmRows, fleetArr), [cmRows, fleetArr])

  const policy = cm.data?.policy
  const allow = policy?.allowlist ?? policy?.allow ?? []
  const block = policy?.blocklist ?? policy?.deny ?? []
  const allowOnly = policy?.allowManagedMcpServersOnly === true

  const policyM = useAdminMutation<unknown, { allow: string[]; deny: string[] }>(
    '/api/admin/codemode/mcp-policy',
    {
      method: 'PUT',
      bodyOf: (vars) => vars,
      invalidateKeys: [['code-mode-mcp']],
      onSuccess: () => {
        setPolicyEdit((s) => ({ ...s, open: false }))
        setError(null)
      },
      onError: (err) => setError(err.message),
    },
  )

  const openPolicyEdit = () =>
    setPolicyEdit({
      open: true,
      allow: allow.join(', '),
      deny: block.join(', '),
    })

  const csvToList = (s: string): string[] =>
    s.split(',').map((x) => x.trim()).filter(Boolean)

  const toggleM = useAdminMutation<unknown, { id: string; enabled: boolean }>(
    (vars) => `/api/admin/codemode/mcp-servers/${encodeURIComponent(vars.id)}`,
    {
      method: 'PUT',
      bodyOf: ({ enabled }) => ({ enabled }),
      invalidateKeys: [['code-mode-mcp']],
      onError: (err) => setError(err.message),
    },
  )

  const addM = useAdminMutation<unknown, NewMcpForm>('/api/admin/codemode/mcp-servers', {
    method: 'POST',
    bodyOf: (vars) => ({
      name: vars.name,
      description: vars.description,
      type: vars.type,
      command: vars.type === 'stdio' ? vars.command : undefined,
      args: vars.type === 'stdio' && vars.args.trim() ? vars.args.split(/\s+/g) : undefined,
      url: vars.type === 'http' ? vars.url : undefined,
      enabled: true,
    }),
    invalidateKeys: [['code-mode-mcp']],
    onSuccess: () => {
      setAddOpen(false)
      setNewForm(EMPTY_NEW)
      setError(null)
    },
    onError: (err) => setError(err.message),
  })

  const deleteM = useAdminMutation<unknown, { id: string }>(
    (vars) => `/api/admin/codemode/mcp-servers/${encodeURIComponent(vars.id)}`,
    {
      method: 'DELETE',
      invalidateKeys: [['code-mode-mcp']],
      onSuccess: () => {
        setConfirmDeleteId(null)
        setError(null)
      },
      onError: (err) => setError(err.message),
    },
  )

  const cols: DtCol<JoinedRow>[] = [
    {
      key: 'enabled',
      label: '',
      width: '40px',
      render: (r) => (
        <Toggle
          on={r.enabled}
          onChange={(v) => toggleM.mutate({ id: r.id, enabled: v })}
          label={r.enabled ? 'enabled' : 'disabled'}
        />
      ),
    },
    {
      key: 'health',
      label: '',
      width: '20px',
      render: (r) => <StatusDot status={r.enabled ? 'ok' : 'idle'} />,
    },
    {
      key: 'name',
      label: 'Server',
      className: 'name',
      render: (r) => r.name,
    },
    {
      key: 'type',
      label: 'Type',
      width: '90px',
      className: 'mono',
      render: (r) => r.type ?? '—',
    },
    {
      key: 'fleet',
      label: 'In platform fleet',
      width: '160px',
      render: (r) =>
        r.inFleet ? (
          <span style={{ color: 'var(--ok)' }}>
            yes
            {r.fleetTools != null && (
              <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>· {r.fleetTools} tools</span>
            )}
          </span>
        ) : (
          <span style={{ color: 'var(--warn)' }}>only in code-mode</span>
        ),
    },
    {
      key: 'plugin',
      label: 'Plugin source',
      className: 'dim',
      render: (r) => r.pluginSource ?? '—',
    },
    {
      key: 'actions',
      label: '',
      width: '80px',
      align: 'right',
      render: (r) => (
        <Btn
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            setConfirmDeleteId(r.id)
          }}
        >
          del
        </Btn>
      ),
    },
  ]

  if (cm.isError) {
    return (
      <Banner level="err" label="error">
        failed to load <span className="accent">/api/admin/codemode/mcp-servers</span>
      </Banner>
    )
  }

  return (
    <>
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      {confirmDeleteId && (
        <ConfirmInline
          level="err"
          confirmLabel="remove server"
          busy={deleteM.isPending}
          label={
            <>
              remove MCP server{' '}
              <span className="accent">
                {rows.find((r) => r.id === confirmDeleteId)?.name ?? confirmDeleteId}
              </span>{' '}
              from the managed-mcp.json bundle?
            </>
          }
          onConfirm={() => deleteM.mutate({ id: confirmDeleteId })}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {allowOnly && (
        <Banner level="info" label="policy">
          allow-managed-only is on — sessions cannot add ad-hoc MCP servers
        </Banner>
      )}

      <SectionBar
        title="managed servers"
        count={rows.length}
        right={
          <Btn variant="primary" onClick={() => setAddOpen(true)}>
            + add server
          </Btn>
        }
      />
      <Panel>
        <PanelHead
          title="Code Mode MCP fleet"
          count={`${rows.filter((r) => r.enabled).length} enabled · ${rows.length} total`}
        />
        {cm.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : rows.length === 0 ? (
          <EmptyInline pad>no managed MCP servers configured</EmptyInline>
        ) : (
          <Dt<JoinedRow> columns={cols} rows={rows} rowKey={(r) => r.id} />
        )}
      </Panel>

      <SectionBar
        title="user policy"
        right={
          policyEdit.open ? (
            <Btn variant="ghost" onClick={() => setPolicyEdit((s) => ({ ...s, open: false }))}>
              cancel
            </Btn>
          ) : (
            <Btn variant="ghost" onClick={openPolicyEdit}>
              edit policy
            </Btn>
          )
        }
      />
      {!policyEdit.open ? (
        <div style={{ padding: '12px 18px', background: 'var(--bg-1)', borderBottom: '1px solid var(--line-1)' }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: 'var(--fg-3)', marginRight: 8, fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
              allowlist · {allow.length}
            </span>
            {allow.map((id) => (
              <Chip key={`a-${id}`} value={id} />
            ))}
            {allow.length === 0 && <span style={{ color: 'var(--fg-3)' }}>—</span>}
          </div>
          <div>
            <span style={{ color: 'var(--fg-3)', marginRight: 8, fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
              blocklist · {block.length}
            </span>
            {block.map((id) => (
              <Chip key={`b-${id}`} value={id} />
            ))}
            {block.length === 0 && <span style={{ color: 'var(--fg-3)' }}>—</span>}
          </div>
        </div>
      ) : (
        <div style={{ padding: '12px 18px', background: 'var(--bg-1)', borderBottom: '1px solid var(--line-1)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
              allow (csv)
            </span>
            <input
              className="aw-input"
              type="text"
              placeholder="azure-mcp, aws-mcp"
              value={policyEdit.allow}
              onChange={(e) => setPolicyEdit((s) => ({ ...s, allow: e.target.value }))}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
              deny (csv)
            </span>
            <input
              className="aw-input"
              type="text"
              placeholder="legacy-foo"
              value={policyEdit.deny}
              onChange={(e) => setPolicyEdit((s) => ({ ...s, deny: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn
              variant="primary"
              disabled={policyM.isPending}
              onClick={() =>
                policyM.mutate({
                  allow: csvToList(policyEdit.allow),
                  deny: csvToList(policyEdit.deny),
                })
              }
            >
              {policyM.isPending ? 'saving…' : 'save policy'}
            </Btn>
          </div>
        </div>
      )}

      <SidePanel
        open={addOpen}
        onClose={() => {
          if (!addM.isPending) setAddOpen(false)
        }}
        title="Add MCP server"
        meta="POST /api/admin/codemode/mcp-servers"
      >
        <form
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (!newForm.name.trim()) {
              setError('name is required')
              return
            }
            addM.mutate(newForm)
          }}
        >
          <Field label="name" desc="required · unique slug">
            <input
              className="aw-input"
              type="text"
              autoFocus
              value={newForm.name}
              onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
              required
            />
          </Field>
          <Field label="description">
            <input
              className="aw-input"
              type="text"
              value={newForm.description}
              onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
            />
          </Field>
          <Field label="transport">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['stdio', 'http'] as const).map((t) => (
                <Btn
                  key={t}
                  variant={newForm.type === t ? 'primary' : 'ghost'}
                  onClick={(e) => {
                    e.preventDefault()
                    setNewForm({ ...newForm, type: t })
                  }}
                >
                  {t}
                </Btn>
              ))}
            </div>
          </Field>
          {newForm.type === 'stdio' ? (
            <>
              <Field label="command" desc="executable to spawn">
                <input
                  className="aw-input"
                  type="text"
                  value={newForm.command}
                  onChange={(e) => setNewForm({ ...newForm, command: e.target.value })}
                  placeholder="npx"
                />
              </Field>
              <Field label="args" desc="space-separated">
                <input
                  className="aw-input"
                  type="text"
                  value={newForm.args}
                  onChange={(e) => setNewForm({ ...newForm, args: e.target.value })}
                  placeholder="-y @modelcontextprotocol/server-foo"
                />
              </Field>
            </>
          ) : (
            <Field label="url" desc="streaming-http endpoint">
              <input
                className="aw-input"
                type="url"
                value={newForm.url}
                onChange={(e) => setNewForm({ ...newForm, url: e.target.value })}
                placeholder="https://mcp.example.com/sse"
              />
            </Field>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => setAddOpen(false)} disabled={addM.isPending}>
              cancel
            </Btn>
            <Btn variant="primary" type="submit" disabled={addM.isPending || !newForm.name.trim()}>
              {addM.isPending ? 'saving…' : 'add server'}
            </Btn>
          </div>
        </form>
      </SidePanel>
    </>
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
        fontFamily: 'var(--font-v3-mono)',
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
