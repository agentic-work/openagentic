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
} from '../../primitives-v3'

export type MCPTransport = 'stdio' | 'http' | 'sse'

export interface MCPServerPayload {
  id: string
  name: string
  description?: string
  transport: MCPTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  server_url?: string
  headers?: Record<string, string>
  capabilities?: string[]
  require_obo?: boolean
  user_isolated?: boolean
  enabled?: boolean
}

export type MCPServerModalMode = 'create' | 'edit'

export interface MCPServerModalProps {
  open: boolean
  mode: MCPServerModalMode
  initial?: Partial<MCPServerPayload> | null
  onClose: () => void
  onSubmit: (payload: MCPServerPayload, mode: MCPServerModalMode) => Promise<void>
  isSubmitting: boolean
  error?: string | null
}

export const MCPServerModal: React.FC<MCPServerModalProps> = ({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}) => {
  const [id, setId] = React.useState('')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [transport, setTransport] = React.useState<MCPTransport>('http')
  const [command, setCommand] = React.useState('')
  const [argsCsv, setArgsCsv] = React.useState('')
  const [serverUrl, setServerUrl] = React.useState('')
  const [headersJson, setHeadersJson] = React.useState('{}')
  const [envJson, setEnvJson] = React.useState('{}')
  const [capsCsv, setCapsCsv] = React.useState('')
  const [requireObo, setRequireObo] = React.useState(false)
  const [userIsolated, setUserIsolated] = React.useState(false)
  const [enabled, setEnabled] = React.useState(true)
  const [parseError, setParseError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setParseError(null)
    setId(initial?.id ?? '')
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setTransport((initial?.transport as MCPTransport) ?? 'http')
    setCommand(initial?.command ?? '')
    setArgsCsv((initial?.args ?? []).join(', '))
    setServerUrl(initial?.server_url ?? '')
    setHeadersJson(JSON.stringify(initial?.headers ?? {}, null, 2))
    setEnvJson(JSON.stringify(initial?.env ?? {}, null, 2))
    setCapsCsv((initial?.capabilities ?? []).join(', '))
    setRequireObo(!!initial?.require_obo)
    setUserIsolated(!!initial?.user_isolated)
    setEnabled(initial?.enabled !== false)
  }, [open, initial])

  const csv = (s: string): string[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

  const valid =
    name.trim().length > 0 &&
    (mode === 'edit' || /^[a-zA-Z0-9_-]+$/.test(id.trim())) &&
    (transport === 'stdio' ? command.trim().length > 0 : serverUrl.trim().length > 0)

  const submit = () => {
    let headers: Record<string, string> = {}
    let env: Record<string, string> = {}
    try {
      headers = JSON.parse(headersJson || '{}')
      env = JSON.parse(envJson || '{}')
      setParseError(null)
    } catch (e: any) {
      setParseError(`headers/env JSON: ${e?.message ?? 'parse failed'}`)
      return
    }
    void onSubmit(
      {
        id: id.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        args: transport === 'stdio' ? csv(argsCsv) : undefined,
        env: transport === 'stdio' ? env : undefined,
        server_url: transport !== 'stdio' ? serverUrl.trim() : undefined,
        headers: transport !== 'stdio' ? headers : undefined,
        capabilities: csv(capsCsv),
        require_obo: requireObo,
        user_isolated: userIsolated,
        enabled,
      },
      mode,
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? `Edit MCP server · ${initial?.id ?? ''}` : '+ Add MCP server'}
      width={720}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isSubmitting}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={!valid || isSubmitting} onClick={submit}>
            {isSubmitting ? (mode === 'edit' ? 'saving…' : 'registering…') : mode === 'edit' ? 'save' : 'register'}
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
      <FormGrid>
        <FormRow name="id" desc="alphanumeric + - _ . Immutable after create.">
          <input
            value={id}
            onChange={(e) => setId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            disabled={mode === 'edit'}
            placeholder="my-mcp"
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="name" desc="display name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="transport">
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as MCPTransport)}
            style={v3InputStyle}
          >
            <option value="http">http</option>
            <option value="sse">sse</option>
            <option value="stdio">stdio</option>
          </select>
        </FormRow>
        {transport === 'stdio' ? (
          <>
            <FormRow name="command" desc="binary path or shell command">
              <input value={command} onChange={(e) => setCommand(e.target.value)} style={v3InputStyle} />
            </FormRow>
            <FormRow name="args (csv)">
              <input value={argsCsv} onChange={(e) => setArgsCsv(e.target.value)} style={v3InputStyle} />
            </FormRow>
          </>
        ) : (
          <FormRow name="server url" desc="full URL (k8s service or external)">
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://oap-openagentic-my-mcp:80XX"
              style={v3InputStyle}
            />
          </FormRow>
        )}
        <FormRow name="capabilities (csv)" desc="advertised capabilities">
          <input value={capsCsv} onChange={(e) => setCapsCsv(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="require OBO" desc="user OAuth-on-behalf-of token required">
          <Toggle on={requireObo} onChange={setRequireObo} />
        </FormRow>
        <FormRow name="user isolated" desc="spawn one server instance per user">
          <Toggle on={userIsolated} onChange={setUserIsolated} />
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
          fontFamily: 'var(--font-v3-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {transport === 'stdio' ? 'env (JSON)' : 'headers (JSON)'}
      </div>
      <textarea
        value={transport === 'stdio' ? envJson : headersJson}
        onChange={(e) => (transport === 'stdio' ? setEnvJson(e.target.value) : setHeadersJson(e.target.value))}
        style={{ ...v3TextareaStyle, minHeight: 140, marginTop: 4 }}
      />
    </Modal>
  )
}

export default MCPServerModal
