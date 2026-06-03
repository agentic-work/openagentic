/**
 * MCPImportModal — "Import from JSON" paste-import for the MCP Fleet page.
 *
 * Accepts Claude Desktop-format JSON:
 *   { "mcpServers": { "<name>": { "command": "...", "args": [...], "env": {...} } } }
 * or the array format:
 *   { "servers": [{ "name": "...", "command": [...], "env": {...} }] }
 *
 * Posts to POST /api/admin/mcp/servers/manifest on submit.
 * On success, calls onImported() so the parent can refresh the fleet list.
 */

import * as React from 'react'
import {
  Modal,
  v3TextareaStyle,
  Btn,
  Banner,
} from '../../primitives-v3'
import { apiRequest } from '../../../../utils/api'

export interface MCPImportModalProps {
  open: boolean
  onClose: () => void
  onImported: () => void
}

/**
 * The real backend response shape from POST /api/admin/mcp/servers/manifest
 * (see services/openagentic-api/src/routes/admin/mcp-management.ts). `success`
 * is a boolean, `imported` is the registered count, and each `results` row
 * reports a `status` of `'registered' | 'error'` (with `error` text on failure).
 */
interface ImportResultRow {
  id: string
  name: string
  status: 'registered' | 'error'
  error?: string
}

interface ImportResult {
  success: boolean
  imported: number
  results: ImportResultRow[]
}

export const MCPImportModal: React.FC<MCPImportModalProps> = ({ open, onClose, onImported }) => {
  const [json, setJson] = React.useState('')
  const [parseError, setParseError] = React.useState<string | null>(null)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [busy, setBusy] = React.useState(false)

  // Reset state when modal opens
  React.useEffect(() => {
    if (!open) return
    setJson('')
    setParseError(null)
    setSubmitError(null)
    setResult(null)
    setBusy(false)
  }, [open])

  const validate = (): boolean => {
    if (!json.trim()) {
      setParseError('Paste a JSON config above.')
      return false
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (e: any) {
      setParseError(`Invalid JSON: ${e?.message ?? 'parse error'}`)
      return false
    }
    const obj = parsed as Record<string, unknown>
    if (!obj.mcpServers && !obj.servers) {
      setParseError('JSON must contain "mcpServers" (Claude Desktop format) or "servers" (array format).')
      return false
    }
    setParseError(null)
    return true
  }

  const handleSubmit = async () => {
    if (!validate()) return

    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      return
    }

    setBusy(true)
    setSubmitError(null)
    setResult(null)

    try {
      const resp = await apiRequest('/api/admin/mcp/servers/manifest', {
        method: 'POST',
        body: JSON.stringify(parsed),
      })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`POST failed: ${resp.status} ${txt}`)
      }
      const data: ImportResult = await resp.json()
      setResult(data)
      if (data.imported > 0) {
        onImported()
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'import failed')
    } finally {
      setBusy(false)
    }
  }

  const hasParseable = json.trim().length > 0 && !parseError

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import MCP servers from JSON"
      width={640}
      footer={
        result ? (
          <Btn variant="primary" onClick={onClose}>
            close
          </Btn>
        ) : (
          <>
            <Btn variant="ghost" onClick={onClose} disabled={busy}>
              cancel
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSubmit}
              disabled={busy || !hasParseable}
            >
              {busy ? 'importing…' : 'import'}
            </Btn>
          </>
        )
      }
    >
      {!result && (
        <>
          <div
            style={{
              marginBottom: 8,
              fontSize: 12,
              color: 'var(--fg-2)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
            }}
          >
            Paste a Claude Desktop or standard MCP config — each server entry becomes a stdio MCP.
          </div>
          <div
            style={{
              marginBottom: 4,
              fontSize: 11,
              color: 'var(--fg-3)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            JSON config
          </div>
          <textarea
            value={json}
            onChange={(e) => {
              setJson(e.target.value)
              setParseError(null)
            }}
            style={{ ...v3TextareaStyle, minHeight: 240 }}
            placeholder={`{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@mcp/my-server"],\n      "env": { "API_KEY": "..." }\n    }\n  }\n}`}
          />
          {parseError && (
            <Banner level="warn" label="parse error">
              {parseError}
            </Banner>
          )}
          {submitError && (
            <Banner level="err" label="error">
              {submitError}
            </Banner>
          )}
        </>
      )}

      {result && (() => {
        const rows = result.results ?? []
        const total = rows.length
        const failed = rows.filter((r) => r.status === 'error').length
        const imported = result.imported
        const summary =
          failed === 0
            ? `Imported ${imported} of ${total} server${total === 1 ? '' : 's'}.`
            : imported > 0
              ? `Imported ${imported} of ${total} server${total === 1 ? '' : 's'} — ${failed} failed.`
              : `Import failed — ${failed} of ${total} server${total === 1 ? '' : 's'} could not be registered.`
        return (
          <>
            <Banner
              level={failed === 0 ? 'ok' : imported > 0 ? 'warn' : 'err'}
              label={failed === 0 ? 'ok' : imported > 0 ? 'partial' : 'failed'}
            >
              {summary}
            </Banner>
            {rows.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                }}
              >
                {rows.map((r) => {
                  const ok = r.status === 'registered'
                  return (
                    <div
                      key={r.id || r.name}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'baseline',
                        padding: '4px 8px',
                        background: 'var(--bg-2)',
                        border: '1px solid var(--line-1)',
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: ok ? 'var(--ok)' : 'var(--err)',
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                      />
                      <span style={{ color: 'var(--fg-0)', flex: 1, minWidth: 0 }}>{r.name}</span>
                      <span style={{ color: ok ? 'var(--ok)' : 'var(--err)', flexShrink: 0 }}>
                        {ok ? 'registered' : r.error || 'error'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )
      })()}
    </Modal>
  )
}

export default MCPImportModal
